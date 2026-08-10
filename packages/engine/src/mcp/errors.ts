/**
 * @file Stable error vocabulary for MCP engine and CLI boundaries.
 *
 * `McpError` preserves a machine-readable code while retaining an underlying
 * cause for diagnostics. `mcpErrorCode` safely maps unknown failures to the
 * generic call code, allowing JSON CLI output and audit entries to remain
 * predictable without exposing transport internals or credentials.
 */

export type McpErrorCode =
  | "MCP_NOT_TRUSTED"
  | "MCP_TRUST_CHANGED"
  | "MCP_CONNECT_TIMEOUT"
  | "MCP_CONNECTION_FAILED"
  | "MCP_AUTH_REQUIRED"
  | "MCP_AUTH_FAILED"
  | "MCP_INSUFFICIENT_SCOPE"
  | "MCP_TOOL_NOT_FOUND"
  | "MCP_TOOL_NOT_SELECTED"
  | "MCP_SCHEMA_INVALID"
  | "MCP_INPUT_INVALID"
  | "MCP_OUTPUT_INVALID"
  | "MCP_CALL_TIMEOUT"
  | "MCP_CALL_FAILED"
  | "MCP_RESULT_TOO_LARGE"
  | "MCP_UNSUPPORTED_CLIENT_CAPABILITY"
  | "MCP_CLOSED";

/**
 * MCP failure that combines a stable public code with an optional underlying
 * cause for local diagnostics.
 */
export class McpError extends Error {
  readonly code: McpErrorCode;

  /**
   * Creates an MCP-facing error with a stable code and optional root cause.
   *
   * @param code Machine-readable failure category exposed to callers.
   * @param message Human-readable diagnostic without embedded credentials.
   * @param options Standard error options, including the underlying cause.
   */
  constructor(code: McpErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "McpError";
    this.code = code;
  }
}

/**
 * Extracts a stable MCP code from an unknown failure without masking its cause.
 * @param error An arbitrary caught value.
 * @returns Its MCP code, or the generic connection failure code.
 */
export function mcpErrorCode(error: unknown): McpErrorCode {
  return error instanceof McpError ? error.code : "MCP_CONNECTION_FAILED";
}
