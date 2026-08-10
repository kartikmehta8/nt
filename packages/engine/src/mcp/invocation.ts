/**
 * @file Exact SDK tool invocation and protocol-error translation.
 *
 * Sends one already selected and input-validated tool request, binds progress
 * updates to the configured absolute deadline, and deliberately performs no
 * automatic retry because delivery may have produced side effects. SDK and
 * server failures are translated into NT's stable timeout, capability, or call
 * codes without exposing wire envelopes to the session loop.
 */

import {
  InsufficientScopeError,
  UnauthorizedError,
  type CallToolResult,
  type Client,
  type Tool,
} from "@modelcontextprotocol/client";
import { McpError } from "#mcp/errors";

const PROGRESS_INTERVAL_MS = 100;

/**
 * Invokes one schema-validated MCP tool with bounded progress and stable error mapping.
 * @param client Connected official SDK client that advertised the tool.
 * @param tool Exact advertised tool definition selected during preparation.
 * @param args Schema-validated model arguments.
 * @param timeout Absolute call deadline in milliseconds.
 * @param onProgress Optional bounded progress-event sink.
 * @returns The raw SDK result for schema validation and safe normalization.
 */
export async function invokeMcpTool(
  client: Client,
  tool: Tool,
  args: Record<string, unknown>,
  timeout: number,
  onProgress?: (detail: string) => void,
): Promise<CallToolResult> {
  let lastProgressAt = Number.NEGATIVE_INFINITY;
  try {
    return await client.callTool(
      { name: tool.name, arguments: args },
      {
        toolDefinition: tool,
        timeout,
        maxTotalTimeout: timeout,
        resetTimeoutOnProgress: true,
        onprogress: (progress) => {
          const now = Date.now();
          const complete = progress.total !== undefined && progress.progress >= progress.total;
          if (!complete && now - lastProgressAt < PROGRESS_INTERVAL_MS) return;
          lastProgressAt = now;
          onProgress?.(
            `${tool.name}: ${progress.progress}${progress.total === undefined ? "" : `/${progress.total}`}`,
          );
        },
      },
    );
  } catch (error) {
    if (error instanceof McpError) throw error;
    if (error instanceof InsufficientScopeError)
      throw new McpError(
        "MCP_INSUFFICIENT_SCOPE",
        `MCP tool '${tool.name}' requires additional OAuth scope`,
        { cause: error },
      );
    if (error instanceof UnauthorizedError)
      throw new McpError("MCP_AUTH_REQUIRED", `MCP tool '${tool.name}' requires authentication`, {
        cause: error,
      });
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes("input_required"))
      throw new McpError(
        "MCP_UNSUPPORTED_CLIENT_CAPABILITY",
        `MCP tool '${tool.name}' requires an unsupported client capability`,
        { cause: error },
      );
    throw new McpError(
      message.toLowerCase().includes("timeout") ? "MCP_CALL_TIMEOUT" : "MCP_CALL_FAILED",
      `MCP tool '${tool.name}' failed: ${message}`,
      { cause: error },
    );
  }
}
