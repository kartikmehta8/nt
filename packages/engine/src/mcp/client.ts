/**
 * @file Constructs official MCP SDK clients and reads negotiated identity.
 *
 * Every connection receives the same tools-only capability surface, automatic
 * protocol-era negotiation, bounded list pagination, catalog TTL, and tool-list
 * invalidation callback. NT deliberately advertises no sampling, roots, or
 * elicitation capability. Snapshot conversion keeps SDK-specific client state
 * out of the public engine status types.
 */

import { Client } from "@modelcontextprotocol/client";
import { McpError } from "#mcp/errors";
import type { ConnectionSnapshot } from "#mcp/types";
import type { McpServerDef } from "#types";

/**
 * Creates a disconnected tools-only MCP client with bounded negotiation and pagination.
 * @param def The server definition supplying negotiation deadlines.
 * @param onToolsChanged Invalidates NT's catalog cache after notifications.
 * @returns A new, disconnected official SDK client.
 */
export function createMcpClient(def: McpServerDef, onToolsChanged: () => void): Client {
  return new Client(
    { name: "nt", version: "0.7.0" },
    {
      capabilities: {},
      versionNegotiation: {
        mode: "auto",
        probe: { timeoutMs: def.connectTimeoutMs, maxRetries: 0 },
      },
      inputRequired: { autoFulfill: false },
      listMaxPages: 100,
      defaultCacheTtlMs: 30_000,
      listChanged: { tools: { onChanged: onToolsChanged } },
    },
  );
}

/**
 * Captures negotiated protocol and server metadata from a connected SDK client.
 * @param client A connected SDK client.
 * @param serverName The declaration name used in errors.
 * @returns Negotiated server information needed by NT.
 */
export function connectionSnapshot(client: Client, serverName: string): ConnectionSnapshot {
  if (!client.getNegotiatedProtocolVersion())
    throw new McpError("MCP_CLOSED", `MCP server '${serverName}' has no active client`);
  const info = client.getServerVersion();
  return {
    client,
    protocolVersion: client.getNegotiatedProtocolVersion(),
    protocolEra: client.getProtocolEra(),
    serverInfo: info ? { name: info.name, version: info.version } : undefined,
    instructions: client.getInstructions(),
  };
}
