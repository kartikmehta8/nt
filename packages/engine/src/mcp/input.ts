/**
 * @file Defensive serialization for untrusted MCP tool arguments.
 *
 * Accepts only ordinary JSON-style records before the manager performs schema
 * and byte-size validation. Rejecting arrays, exotic prototypes, cycles, and
 * non-serializable values keeps model-provided input away from SDK boundaries
 * until it has a predictable representation.
 */

import { McpError } from "#mcp/errors";

/**
 * Serializes a plain MCP argument object for deterministic size validation.
 *
 * @param input Untrusted model arguments supplied to a prepared MCP tool.
 * @returns The JSON representation used to enforce the request-size limit.
 */
export function serializeMcpInput(input: Record<string, unknown>): string {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new McpError("MCP_INPUT_INVALID", "MCP tool arguments must be a plain object");
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null)
    throw new McpError("MCP_INPUT_INVALID", "MCP tool arguments must be a plain object");
  try {
    return JSON.stringify(input);
  } catch {
    throw new McpError("MCP_INPUT_INVALID", "MCP tool arguments must be valid JSON");
  }
}
