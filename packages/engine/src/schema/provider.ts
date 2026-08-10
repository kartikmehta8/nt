/**
 * @file Offline coercion and secret-safety checks for provider declarations.
 *
 * Parses API kind, base URL, environment-backed credentials, and custom
 * headers while rejecting cleartext remote endpoints and authorization-header
 * overrides. The parser warns about literal or fallback secrets but never makes
 * a provider request; runtime credential resolution remains in the provider
 * registry.
 */

import { isIP } from "node:net";
import { NtError } from "#errors";
import { isEnvRef, isMap, optStr, resolveEnv, warnUnknown } from "#schema/coerce";
import type { Location, NtValue, ProviderDef } from "#types";

type Body = Record<string, NtValue>;

const AUTH_HEADER_NAMES = new Set(["x-api-key", "authorization"]);

function checkBaseUrl(baseUrl: string, loc: Location): void {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new NtError(`provider.base_url is not a valid URL: ${baseUrl}`, loc);
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  const local =
    host === "localhost" ||
    host === "::1" ||
    (isIP(host) === 4 && host.startsWith("127.")) ||
    host.endsWith(".localhost");
  if (parsed.protocol !== "https:" && !local)
    throw new NtError(
      `provider.base_url must use https (API keys would be sent in cleartext): ${baseUrl}`,
      loc,
    );
}

/**
 * Parses provider into its validated internal representation.
 * @param name The provider declaration name.
 * @param body The parsed declaration fields.
 * @param loc The declaration source location.
 * @param warnings Destination for non-fatal credential warnings.
 * @returns The validated provider definition.
 */
export function parseProvider(
  name: string | null,
  body: Body,
  loc: Location,
  warnings: string[],
): ProviderDef {
  if (!name) throw new NtError("provider declaration requires a name", loc);
  warnUnknown(body, ["api", "base_url", "api_key", "headers"], `provider ${name}`, warnings);
  const api =
    optStr(body.api, "provider.api", loc) ??
    (name === "anthropic" ? "anthropic" : "openai-completions");
  if (api !== "anthropic" && api !== "openai-completions")
    throw new NtError(
      `provider.api must be 'anthropic' or 'openai-completions', got '${api}'`,
      loc,
    );
  const baseUrl = optStr(body.base_url, "provider.base_url", loc);
  if (baseUrl) checkBaseUrl(baseUrl, loc);
  const headers: Record<string, string> = {};
  if (body.headers !== undefined && !isMap(body.headers))
    throw new NtError("provider.headers must be a map", loc);
  if (body.headers !== undefined && isMap(body.headers))
    for (const [key, value] of Object.entries(body.headers)) {
      if (AUTH_HEADER_NAMES.has(key.toLowerCase()))
        warnings.push(
          `provider ${name}: header '${key}' overrides the credential header set from api_key`,
        );
      headers[key] = String(resolveEnv(value));
    }
  if (body.api_key !== undefined && !isEnvRef(body.api_key))
    warnings.push(
      `provider ${name}: api_key is a literal in source; use env(NAME) so the key never lands in a file`,
    );
  if (isEnvRef(body.api_key) && body.api_key.default)
    warnings.push(`provider ${name}: api_key env() has a fallback literal in source; remove it`);
  return {
    name,
    api,
    baseUrl,
    apiKeyEnv: isEnvRef(body.api_key) ? body.api_key.__env : null,
    apiKey: body.api_key !== undefined && !isEnvRef(body.api_key) ? String(body.api_key) : null,
    headers,
    loc,
  };
}
