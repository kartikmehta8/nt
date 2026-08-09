/**
 * @file Opens MCP stdio and remote transports with bounded, hardened defaults.
 *
 * Transport construction stays separate from connection state so reconnect,
 * fallback, and shutdown behavior remain understandable in `connection.ts`.
 * Stdio launches an argv array with a minimal environment and no shell. Remote
 * connections use guarded fetch, Streamable HTTP first, and a fresh client for
 * the explicitly enabled legacy SSE downgrade; authentication failures never
 * trigger that downgrade.
 */

import {
  SSEClientTransport,
  StreamableHTTPClientTransport,
  UnauthorizedError,
  type AuthProvider,
  type Client,
  type OAuthClientProvider,
  type Transport,
} from "@modelcontextprotocol/client";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/client/stdio";
import { guardedFetch } from "#egress";
import { resolveDeclaredValues, resolvedCwd } from "#mcp/security";
import type { McpServerDef } from "#types";

export interface OpenTransportResult {
  client: Client;
  transport: Transport;
}

interface OpenTransportOptions {
  def: McpServerDef;
  makeClient: () => Client;
  authProvider?: AuthProvider | OAuthClientProvider;
  onStderr: (chunk: unknown) => void;
  signal: AbortSignal;
}

function connectionOptions(def: McpServerDef, signal: AbortSignal) {
  return {
    signal,
    timeout: def.connectTimeoutMs,
    maxTotalTimeout: def.connectTimeoutMs,
  };
}

function remoteOptions(
  def: McpServerDef,
  authProvider: AuthProvider | OAuthClientProvider | undefined,
) {
  return {
    authProvider,
    requestInit: { headers: resolveDeclaredValues(def.headers) },
    fetch: ((input: string | URL | Request, init?: RequestInit) =>
      guardedFetch(input, init, def.allowInternal)) as typeof fetch,
    maxStepUpRetries: 2,
  };
}

async function openStdio(options: OpenTransportOptions): Promise<OpenTransportResult> {
  const { def } = options;
  const client = options.makeClient();
  const transport = new StdioClientTransport({
    command: requireCommand(def),
    args: def.args,
    cwd: resolvedCwd(def),
    env: { ...getDefaultEnvironment(), ...resolveDeclaredValues(def.env) },
    stderr: "pipe",
    maxBufferSize: 1024 * 1024,
  });
  transport.stderr?.on("data", options.onStderr);
  await client.connect(transport, connectionOptions(def, options.signal));
  return { client, transport };
}

async function openRemote(options: OpenTransportOptions): Promise<OpenTransportResult> {
  const { def } = options;
  const url = new URL(requireUrl(def));
  const transportOptions = remoteOptions(def, options.authProvider);
  let client = options.makeClient();
  let transport: Transport = new StreamableHTTPClientTransport(url, transportOptions);
  try {
    await client.connect(transport, connectionOptions(def, options.signal));
  } catch (error) {
    await client.close().catch(() => {});
    if (!def.allowLegacySse || error instanceof UnauthorizedError) throw error;
    client = options.makeClient();
    transport = new SSEClientTransport(url, transportOptions);
    await client.connect(transport, connectionOptions(def, options.signal));
  }
  return { client, transport };
}

/**
 * Starts mcp transport and prepares it for use.
 * @param options The declaration, client factory, auth provider, and stderr sink.
 * @returns A connected client and its active transport.
 */
export async function openMcpTransport(
  options: OpenTransportOptions,
): Promise<OpenTransportResult> {
  return options.def.transport === "stdio" ? openStdio(options) : openRemote(options);
}

/**
 * Parses and validates the required URL for a remote MCP transport declaration.
 * @param def A validated remote MCP server definition.
 * @returns Its required URL.
 */
export function requireUrl(def: McpServerDef): string {
  if (!def.url) throw new Error(`MCP server '${def.name}' has no URL`);
  return def.url;
}

function requireCommand(def: McpServerDef): string {
  if (!def.command) throw new Error(`MCP server '${def.name}' has no command`);
  return def.command;
}
