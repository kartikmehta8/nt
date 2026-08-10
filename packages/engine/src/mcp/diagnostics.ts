/**
 * @file Bounded and credential-safe MCP transport diagnostics.
 *
 * Collects a small tail of stdio server output without allowing an untrusted
 * process to grow memory indefinitely, then combines that context with SDK
 * failures only after scrubbing declared credentials and token-shaped values.
 * This keeps human and JSON errors actionable without making stderr a secret
 * exfiltration path.
 */

import { InsufficientScopeError, UnauthorizedError } from "@modelcontextprotocol/client";
import { McpError } from "#mcp/errors";
import { redactMcpDiagnostic } from "#mcp/security";
import type { McpServerDef } from "#types";

const MAX_STDERR_CHARS = 16_384;

/**
 * Appends as much process output as fits in the fixed diagnostic budget.
 *
 * @param current Previously retained stdio output.
 * @param chunk New data emitted by the server process.
 * @returns Updated bounded diagnostic text.
 */
export function appendMcpStderr(current: string, chunk: unknown): string {
  if (current.length >= MAX_STDERR_CHARS) return current;
  return current + String(chunk).slice(0, MAX_STDERR_CHARS - current.length);
}

/**
 * Produces one safe connection failure with optional server stderr context.
 *
 * @param def Server whose resolved declaration values must remain private.
 * @param error Underlying SDK or transport failure.
 * @param stderr Bounded output captured from a stdio child process.
 * @returns Credential-scrubbed diagnostic capped for terminal and JSON output.
 */
export function mcpFailureMessage(def: McpServerDef, error: unknown, stderr: string): string {
  const message = error instanceof Error ? error.message : String(error);
  const context = stderr.trim() ? `${message}; server stderr: ${stderr.trim()}` : message;
  return redactMcpDiagnostic(def, context);
}

/**
 * Maps one failed connection attempt to NT's stable public error vocabulary.
 *
 * @param def Server whose name and credentials shape the safe diagnostic.
 * @param error SDK or transport failure.
 * @param stderr Bounded stdio context captured during startup.
 * @returns A stable, credential-safe MCP error.
 */
export function connectionError(def: McpServerDef, error: unknown, stderr: string): McpError {
  if (error instanceof McpError) return error;
  if (error instanceof InsufficientScopeError)
    return new McpError(
      "MCP_INSUFFICIENT_SCOPE",
      `MCP server '${def.name}' requires additional OAuth scope`,
    );
  if (error instanceof UnauthorizedError)
    return new McpError(
      "MCP_AUTH_REQUIRED",
      `authentication required for MCP server '${def.name}'`,
    );
  const message = mcpFailureMessage(def, error, stderr);
  return new McpError(
    message.toLowerCase().includes("timeout") ? "MCP_CONNECT_TIMEOUT" : "MCP_CONNECTION_FAILED",
    `failed to connect to MCP server '${def.name}': ${message}`,
  );
}
