/**
 * @file Transport-specific value coercion and field compatibility for MCP.
 *
 * Validates environment/header maps without resolving their values, prevents
 * authorization-header bypasses and obvious literal secrets, and rejects fields
 * that belong to the other transport. Kept separate from the main declaration
 * parser so its auth, selection, and numeric-policy flow remains readable.
 */

import { looksSecretName } from "#audit/redact";
import { NtError } from "#errors";
import { isMap } from "#schema/coerce";
import type { Location, McpServerDef, NtValue } from "#types";

/**
 * Parses mcp values into its validated internal representation.
 * @param value Parsed environment or header map, when declared.
 * @param field Which declaration field is being coerced.
 * @param loc Source location used for actionable errors.
 * @returns The validated source values without resolving environment references.
 */
export function parseMcpValues(
  value: NtValue | undefined,
  field: "env" | "headers",
  loc: Location,
): Record<string, NtValue> {
  if (value === undefined) return {};
  if (!isMap(value)) throw new NtError(`mcp.${field} must be a map`, loc);
  const result: Record<string, NtValue> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (field === "headers" && key.toLowerCase() === "authorization")
      throw new NtError("mcp.headers must not set Authorization; use mcp.auth", loc);
    if (looksSecretName(key) && typeof entry === "string")
      throw new NtError(`mcp.${field}.${key} looks secret and must use env(NAME)`, loc);
    result[key] = entry;
  }
  return result;
}

/**
 * Validates mcp transport fields and reports any contract violation.
 * @param def Fully coerced MCP server definition.
 * @param body Original declaration map used to distinguish absent fields.
 * @returns Nothing; incompatible or missing transport fields throw located errors.
 */
export function validateMcpTransportFields(def: McpServerDef, body: Record<string, NtValue>): void {
  const forbidden =
    def.transport === "stdio"
      ? [
          def.url && "url",
          body.auth !== undefined && "auth",
          Object.keys(def.headers).length && "headers",
          body.allow_legacy_sse !== undefined && "allow_legacy_sse",
        ]
      : [
          def.command && "command",
          def.args.length && "args",
          body.cwd !== undefined && "cwd",
          body.env !== undefined && "env",
          body.allow_outside_cwd !== undefined && "allow_outside_cwd",
        ];
  const invalid = forbidden.find(Boolean);
  if (invalid) throw new NtError(`mcp.${invalid} is not valid for ${def.transport}`, def.loc);
  if (def.transport === "stdio" && !def.command)
    throw new NtError("mcp.command is required for stdio", def.loc);
  if (def.transport === "streamable_http" && !def.url)
    throw new NtError("mcp.url is required for streamable_http", def.loc);
}
