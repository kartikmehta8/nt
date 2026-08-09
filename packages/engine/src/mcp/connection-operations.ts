/**
 * @file Catalog and tool operations performed through an MCP connection.
 *
 * Keeps request-specific SDK options outside the connection state machine.
 * Catalog reads choose explicit cache behavior and remain bounded by the server
 * call deadline, while tool invocation delegates stable error and progress
 * handling to the dedicated invocation boundary.
 */

import type { CallToolResult, Tool } from "@modelcontextprotocol/client";
import { invokeMcpTool } from "#mcp/invocation";
import type { ConnectionSnapshot } from "#mcp/types";
import type { McpServerDef } from "#types";

/**
 * Lists the current tool catalog through a ready or lazily opened connection.
 *
 * @param connect Connection snapshot supplier.
 * @param def Server definition providing the request deadline.
 * @param refresh Whether SDK caches should be bypassed.
 * @returns Advertised tools returned by the server.
 */
export async function listConnectionTools(
  connect: () => Promise<ConnectionSnapshot>,
  def: McpServerDef,
  refresh: boolean,
): Promise<Tool[]> {
  const { client } = await connect();
  const result = await client.listTools(undefined, {
    cacheMode: refresh ? "refresh" : "use",
    timeout: def.callTimeoutMs,
    maxTotalTimeout: def.callTimeoutMs,
  });
  return result.tools;
}

/**
 * Invokes one exact advertised tool through a ready or lazy connection.
 *
 * @param connect Connection snapshot supplier.
 * @param tool Exact SDK tool definition selected during discovery.
 * @param args Schema-validated invocation arguments.
 * @param timeout Effective absolute call deadline.
 * @param onProgress Optional bounded progress sink.
 * @returns Raw MCP result for output validation and normalization.
 */
export async function callConnectionTool(
  connect: () => Promise<ConnectionSnapshot>,
  tool: Tool,
  args: Record<string, unknown>,
  timeout: number,
  onProgress?: (detail: string) => void,
): Promise<CallToolResult> {
  const { client } = await connect();
  return invokeMcpTool(client, tool, args, timeout, onProgress);
}
