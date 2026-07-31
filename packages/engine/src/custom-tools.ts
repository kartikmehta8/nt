/**
 * @file Executes user-declared `http` and `shell` tools.
 *
 * Called by the session loop when the model invokes a custom tool. Model
 * arguments are first validated against the tool's declared `input:` schema.
 * `shell` tools run their command in the agent's sandbox with values
 * shell-quoted; `http` tools call the interpolated URL with env-resolved
 * headers under a timeout, refuse redirects, non-http(s) schemes, and
 * private/loopback destinations — checking literal addresses and resolving
 * hostnames through DNS (unless `allow_internal`) — cap the response
 * body, and withhold declared headers when the model controls the URL's
 * origin — the model influences these values, so nothing it supplies may
 * change command or URL structure or steer secrets to an attacker host.
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { HTTP_TOOL_MAX_BODY_BYTES, HTTP_TOOL_TIMEOUT_MS } from "#constants";
import { interpolate, interpolateShell, interpolateUrl, validateInput } from "#io";
import type { Sandbox } from "#sandbox";
import { resolveEnv } from "#schema/coerce";
import type { ToolDef } from "#types";

export interface ToolOutcome {
  content: string;
  isError: boolean;
}

/**
 * @param def The custom tool definition.
 * @param sandbox The sandbox used for shell tools.
 * @param input The model-supplied arguments.
 * @returns The tool output and whether it represents an error.
 */
export async function runCustomTool(
  def: ToolDef,
  sandbox: Sandbox,
  input: Record<string, unknown>,
): Promise<ToolOutcome> {
  const invalid = validateInput(def.input, input);
  if (invalid) return { content: invalid, isError: true };
  return def.type === "http" ? runHttpTool(def, input) : runShellTool(def, sandbox, input);
}

/**
 * @returns The sandbox command output for a shell tool.
 */
function runShellTool(def: ToolDef, sandbox: Sandbox, input: Record<string, unknown>): ToolOutcome {
  const result = sandbox.exec(interpolateShell(def.command ?? "", input));
  return {
    content: result.stdout + (result.stderr ? "\n" + result.stderr : ""),
    isError: result.code !== 0,
  };
}

const PLACEHOLDER_SENTINEL = "0ntplaceholder0";

/**
 * @param urlTemplate The declared URL template, possibly containing `{name}` placeholders.
 * @returns The origin of the template with placeholders neutralized, or null when it can't be parsed.
 */
function templateOrigin(urlTemplate: string): string | null {
  try {
    return new URL(urlTemplate.replace(/\{(\w+)\}/g, PLACEHOLDER_SENTINEL)).origin;
  } catch {
    return null;
  }
}

/**
 * @param ip An IPv6 address literal, lowercased.
 * @returns The embedded IPv4 address when the literal is IPv4-mapped — in the
 * dotted form DNS returns or the hex form the URL parser serializes — else null.
 */
function mappedIpv4(ip: string): string | null {
  const dotted = ip.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) return dotted[1];
  const hex = ip.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hex) return null;
  const hi = parseInt(hex[1], 16);
  const lo = parseInt(hex[2], 16);
  return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
}

/**
 * @param ip A validated IPv4 or IPv6 address literal, lowercased and unbracketed.
 * @returns Whether the address is loopback, link-local, or private (an SSRF risk).
 */
function isPrivateAddress(ip: string): boolean {
  const candidate = mappedIpv4(ip) ?? ip;
  if (isIP(candidate) === 4) {
    const [a, b] = candidate.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  if (candidate === "::1" || candidate === "::") return true;
  return /^f[cd]/.test(candidate) || /^fe[89ab]/.test(candidate);
}

/**
 * Hostnames are DNS-resolved before connecting because a model-chosen name may
 * point at metadata or private space; `fetch` re-resolves, so a rebinding race
 * remains theoretically possible, but a privately-resolving name never passes.
 *
 * @param hostname A URL hostname, possibly bracketed for IPv6.
 * @returns A refusal message when the host is private or unresolvable, else null.
 */
async function vetEgressHost(hostname: string): Promise<string | null> {
  const refusal = (detail: string) =>
    `refusing to call private/loopback address ${detail} (set allow_internal: true to permit)`;
  const bare = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (bare === "localhost" || bare.endsWith(".localhost")) return refusal(`'${hostname}'`);
  if (isIP(bare)) return isPrivateAddress(bare) ? refusal(`'${hostname}'`) : null;
  let addresses: { address: string }[];
  try {
    addresses = await lookup(bare, { all: true });
  } catch {
    return `cannot resolve host '${hostname}'`;
  }
  const bad = addresses.find((a) => isPrivateAddress(a.address.toLowerCase()));
  return bad ? refusal(`'${bad.address}' (resolved from '${hostname}')`) : null;
}

/**
 * @param res A fetch response whose body should be read.
 * @returns The body text, truncated at the configured byte cap with a notice.
 */
async function readBody(res: Response): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < HTTP_TOOL_MAX_BODY_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  await reader.cancel().catch(() => {});
  const text = Buffer.concat(chunks).toString("utf8");
  return total >= HTTP_TOOL_MAX_BODY_BYTES
    ? `${text}\n[response truncated at ${HTTP_TOOL_MAX_BODY_BYTES} bytes]`
    : text;
}

/**
 * @returns The HTTP response body for an http tool.
 */
async function runHttpTool(def: ToolDef, input: Record<string, unknown>): Promise<ToolOutcome> {
  const url = interpolateUrl(def.url ?? "", input);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { content: `invalid URL: ${url}`, isError: true };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:")
    return {
      content: `URL scheme '${parsed.protocol}' is not allowed (use http or https)`,
      isError: true,
    };
  if (!def.allowInternal) {
    const refusal = await vetEgressHost(parsed.hostname);
    if (refusal) return { content: refusal, isError: true };
  }

  const method = (def.method ?? "GET").toUpperCase();
  const headers: Record<string, string> = {};
  const originPinned = parsed.origin === templateOrigin(def.url ?? "");
  if (originPinned)
    for (const [k, v] of Object.entries(def.headers ?? {}))
      headers[k] = interpolate(String(resolveEnv(v)), input);

  const init: RequestInit = {
    method,
    headers,
    redirect: "manual",
    signal: AbortSignal.timeout(HTTP_TOOL_TIMEOUT_MS),
  };
  if (method !== "GET" && method !== "HEAD") {
    headers["content-type"] = headers["content-type"] ?? "application/json";
    init.body = JSON.stringify(input);
  }
  const res = await fetch(url, init);
  if (res.status >= 300 && res.status < 400)
    return {
      content: `HTTP ${res.status}: redirect to '${res.headers.get("location") ?? "?"}' blocked (redirects are not followed)`,
      isError: true,
    };
  return { content: `HTTP ${res.status}\n${await readBody(res)}`, isError: !res.ok };
}
