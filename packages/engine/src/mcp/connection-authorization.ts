/**
 * @file OAuth authorization commit boundary for a live MCP connection.
 *
 * Runs the interactive SDK authorization flow only after exact trust succeeds,
 * then checks connection shutdown state before transferring ownership of the
 * authorized client and transport. If shutdown won the race, the newly opened
 * client is closed immediately and never becomes reachable through the owning
 * connection.
 */

import type { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { NtOAuthProvider } from "#mcp/auth";
import type { CredentialStore } from "#mcp/credentials";
import { McpError } from "#mcp/errors";
import { authorizeMcpConnection } from "#mcp/oauth-authorization";
import { connectionSnapshot } from "#mcp/client";
import { McpTrustStore } from "#mcp/trust";
import type { ConnectionSnapshot } from "#mcp/types";
import type { McpServerDef } from "#types";

interface AuthorizationOptions {
  def: McpServerDef;
  trust: McpTrustStore;
  credentials: CredentialStore;
  redirectUrl: string;
  onRedirect: (url: URL) => void | Promise<void>;
  callback: Promise<URLSearchParams>;
  signal: AbortSignal;
  makeClient: () => Client;
  isClosing: () => boolean;
  commit: (
    provider: NtOAuthProvider,
    client: Client,
    transport: StreamableHTTPClientTransport,
  ) => void;
}

/**
 * Authorizes and atomically commits a client unless shutdown began meanwhile.
 *
 * @param options Trust, SDK factories, callback state, and owner callbacks.
 * @returns Connected snapshot after the owner accepts transport responsibility.
 */
export async function establishMcpAuthorization(
  options: AuthorizationOptions,
): Promise<ConnectionSnapshot> {
  options.trust.require(options.def);
  const result = await authorizeMcpConnection(
    options.def,
    options.makeClient,
    options.credentials,
    options.redirectUrl,
    options.onRedirect,
    options.callback,
    options.signal,
  );
  if (options.isClosing()) {
    await result.client.close().catch(() => {});
    throw new McpError("MCP_CLOSED", `MCP server '${options.def.name}' closed during OAuth`);
  }
  options.commit(result.provider, result.client, result.transport);
  return connectionSnapshot(result.client, options.def.name);
}
