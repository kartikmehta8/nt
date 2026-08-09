/**
 * @file Offline coercion of `mcp` blocks into validated server definitions.
 *
 * Parses transport-specific fields, auth, environment/header references,
 * explicit tool selection, approval policy, and numeric limits with located
 * errors and unknown-field warnings. It enforces source-derived security rules
 * only: parsing never resolves a secret, starts a subprocess, opens a socket,
 * reads trust state, or begins OAuth.
 */

import { DELEGATE_PREFIX, MCP_TOOL_PREFIX } from "#constants";
import { NtError } from "#errors";
import { validateMcpSecurity } from "#mcp/security";
import { isEnvRef, isMap, optBool, optNum, optStr, strList, warnUnknown } from "#schema/coerce";
import { parseMcpValues, validateMcpTransportFields } from "#schema/mcp-transport";
import type {
  Location,
  McpApprovalPolicy,
  McpAuthDef,
  McpServerDef,
  McpToolPolicy,
  NtValue,
} from "#types";

type Body = Record<string, NtValue>;

const MCP_NAME_RE = /^[A-Za-z][A-Za-z0-9_-]{0,47}$/;
const MCP_APPROVALS = new Set<McpApprovalPolicy>(["required", "once", "never"]);
const MCP_FIELDS = [
  "description",
  "transport",
  "tools",
  "connect_timeout_ms",
  "call_timeout_ms",
  "max_concurrency",
  "include_instructions",
  "allow_internal",
  "command",
  "args",
  "cwd",
  "allow_outside_cwd",
  "env",
  "url",
  "auth",
  "headers",
  "allow_legacy_sse",
];

function boundedInt(
  value: NtValue | undefined,
  field: string,
  fallback: number,
  min: number,
  max: number,
  loc: Location,
): number {
  const result = optNum(value, field, loc) ?? fallback;
  if (!Number.isInteger(result) || result < min || result > max)
    throw new NtError(`${field} must be a whole number in the range ${min}..${max}`, loc);
  return result;
}

function envOnly(value: NtValue, field: string, loc: Location): string {
  if (!isEnvRef(value) || value.default !== null)
    throw new NtError(`${field} must be env(NAME) without a fallback literal`, loc);
  return value.__env;
}

function parseAuth(value: NtValue | undefined, loc: Location, warnings: string[]): McpAuthDef {
  if (value === undefined) return { type: "none" };
  if (!isMap(value)) throw new NtError("mcp.auth must be a map", loc);
  warnUnknown(value, ["type", "token", "scopes"], "mcp.auth", warnings);
  const type = optStr(value.type, "mcp.auth.type", loc) ?? "none";
  if (type === "none") {
    if (value.token !== undefined || value.scopes !== undefined)
      throw new NtError("mcp.auth token/scopes are not valid for none auth", loc);
    return { type };
  }
  if (type === "bearer") {
    if (value.token === undefined)
      throw new NtError("mcp.auth.token is required for bearer auth", loc);
    if (value.scopes !== undefined)
      throw new NtError("mcp.auth.scopes is only valid for oauth auth", loc);
    return { type, tokenEnv: envOnly(value.token, "mcp.auth.token", loc) };
  }
  if (type === "oauth") {
    if (value.token !== undefined)
      throw new NtError("mcp.auth.token is only valid for bearer auth", loc);
    return { type, scopes: strList(value.scopes, "mcp.auth.scopes", loc) };
  }
  throw new NtError("mcp.auth.type must be 'none', 'bearer', or 'oauth'", loc);
}

function parseTools(
  value: NtValue | undefined,
  loc: Location,
  warnings: string[],
): Map<string, McpToolPolicy> {
  const tools = new Map<string, McpToolPolicy>();
  if (value === undefined) return tools;
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item !== "string")
        throw new NtError("mcp.tools list entries must be strings", loc);
      if (tools.has(item)) throw new NtError(`duplicate MCP tool selection '${item}'`, loc);
      tools.set(item, { approval: "required" });
    }
    return tools;
  }
  if (!isMap(value)) throw new NtError("mcp.tools must be a list or map", loc);
  for (const [name, raw] of Object.entries(value)) {
    const policy = parseToolPolicy(name, raw, loc, warnings);
    if (name === "*" && policy.approval === "never")
      throw new NtError("mcp wildcard approval cannot be 'never'", loc);
    tools.set(name, policy);
  }
  return tools;
}

function parseToolPolicy(
  name: string,
  raw: NtValue,
  loc: Location,
  warnings: string[],
): McpToolPolicy {
  if (raw === null || raw === "") return { approval: "required" };
  if (!isMap(raw)) throw new NtError(`mcp.tools.${name} must be a map`, loc);
  warnUnknown(raw, ["approval", "description", "call_timeout_ms"], `mcp.tools.${name}`, warnings);
  const approval = (optStr(raw.approval, `mcp.tools.${name}.approval`, loc) ??
    "required") as McpApprovalPolicy;
  if (!MCP_APPROVALS.has(approval))
    throw new NtError(`mcp.tools.${name}.approval must be 'required', 'once', or 'never'`, loc);
  return {
    approval,
    description: optStr(raw.description, `mcp.tools.${name}.description`, loc) ?? undefined,
    callTimeoutMs:
      raw.call_timeout_ms === undefined
        ? undefined
        : boundedInt(
            raw.call_timeout_ms,
            `mcp.tools.${name}.call_timeout_ms`,
            60_000,
            1_000,
            600_000,
            loc,
          ),
  };
}

/**
 * Parses mcp server into its validated internal representation.
 * @param name The MCP server declaration name.
 * @param body The parsed declaration fields.
 * @param loc The declaration source location.
 * @param warnings Destination for non-fatal security warnings.
 * @param projectRoot Absolute project boundary for cwd and trust decisions.
 * @returns A validated server definition without connecting to it.
 */
export function parseMcpServer(
  name: string | null,
  body: Body,
  loc: Location,
  warnings: string[],
  projectRoot: string,
): McpServerDef {
  if (!name) throw new NtError("mcp declaration requires a name", loc);
  if (!MCP_NAME_RE.test(name))
    throw new NtError(`mcp server name '${name}' must match ${MCP_NAME_RE}`, loc);
  if (name.startsWith(MCP_TOOL_PREFIX) || name.startsWith(DELEGATE_PREFIX))
    throw new NtError(`mcp server name '${name}' begins with a reserved prefix`, loc);
  warnUnknown(body, MCP_FIELDS, `mcp ${name}`, warnings);
  const transport = optStr(body.transport, "mcp.transport", loc);
  if (transport !== "stdio" && transport !== "streamable_http")
    throw new NtError("mcp.transport is required and must be 'stdio' or 'streamable_http'", loc);
  const def: McpServerDef = {
    name,
    projectRoot,
    description: optStr(body.description, "mcp.description", loc) ?? name,
    transport,
    tools: parseTools(body.tools, loc, warnings),
    connectTimeoutMs: boundedInt(
      body.connect_timeout_ms,
      "mcp.connect_timeout_ms",
      10_000,
      1_000,
      120_000,
      loc,
    ),
    callTimeoutMs: boundedInt(
      body.call_timeout_ms,
      "mcp.call_timeout_ms",
      60_000,
      1_000,
      600_000,
      loc,
    ),
    maxConcurrency: boundedInt(body.max_concurrency, "mcp.max_concurrency", 4, 1, 32, loc),
    includeInstructions:
      optBool(body.include_instructions, "mcp.include_instructions", loc) ?? false,
    allowInternal: optBool(body.allow_internal, "mcp.allow_internal", loc) ?? false,
    command: optStr(body.command, "mcp.command", loc) ?? undefined,
    args: strList(body.args, "mcp.args", loc),
    cwd: optStr(body.cwd, "mcp.cwd", loc) ?? ".",
    allowOutsideCwd: optBool(body.allow_outside_cwd, "mcp.allow_outside_cwd", loc) ?? false,
    env: parseMcpValues(body.env, "env", loc),
    url: optStr(body.url, "mcp.url", loc) ?? undefined,
    auth: parseAuth(body.auth, loc, warnings),
    headers: parseMcpValues(body.headers, "headers", loc),
    allowLegacySse: optBool(body.allow_legacy_sse, "mcp.allow_legacy_sse", loc) ?? false,
    loc,
  };
  if ([...def.tools.keys()].filter((tool) => tool !== "*").length > 128)
    throw new NtError("mcp.tools selects more than 128 concrete tools", loc);
  validateMcpTransportFields(def, body);
  if (def.allowOutsideCwd) warnings.push(`mcp ${name} allows cwd outside the project root`);
  if (def.tools.has("*"))
    warnings.push(
      `mcp ${name} uses wildcard tool selection; newly advertised tools may become visible`,
    );
  try {
    warnings.push(...validateMcpSecurity(def));
  } catch (error) {
    throw new NtError((error as Error).message, loc);
  }
  return def;
}
