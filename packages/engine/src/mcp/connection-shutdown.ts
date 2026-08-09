/**
 * @file Bounded shutdown procedure for an MCP connection owner.
 *
 * Waits for an in-progress open to settle, terminates a remote Streamable HTTP
 * session when supported, and closes the SDK client under defensive deadlines.
 * Resource lookup happens after pending work because the connection may acquire
 * its client and transport while shutdown is already waiting.
 */

import type {
  Client,
  StreamableHTTPClientTransport,
  Transport,
} from "@modelcontextprotocol/client";
import { deadline } from "#mcp/deadline";
import type { McpServerDef } from "#types";

interface ShutdownOptions {
  def: McpServerDef;
  pending?: Promise<unknown>;
  resources: () => { client?: Client; transport?: Transport };
}

/**
 * Settles opening work and closes every transport resource within fixed bounds.
 *
 * @param options Declaration, pending operation, and late resource accessor.
 * @returns When cleanup has settled or its defensive deadlines have elapsed.
 */
export async function shutdownMcpConnection(options: ShutdownOptions): Promise<void> {
  if (options.pending)
    await Promise.race([
      options.pending.catch(() => undefined),
      deadline(options.def.connectTimeoutMs),
    ]);
  const { client, transport } = options.resources();
  const remote = transport as StreamableHTTPClientTransport | undefined;
  if (options.def.transport === "streamable_http" && remote && "terminateSession" in remote)
    await Promise.race([remote.terminateSession().catch(() => {}), deadline(1_000)]);
  await Promise.race([client?.close().catch(() => {}), deadline(5_000)]);
}
