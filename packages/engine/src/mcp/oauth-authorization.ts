/**
 * @file Interactive MCP OAuth authorization over a hardened remote transport.
 *
 * Builds a fresh SDK OAuth provider and Streamable HTTP transport, lets the SDK
 * perform protected-resource and authorization-server discovery, then resumes
 * connection after NT validates callback state and reported errors. Every
 * server-side request uses the shared redirect and private-network guard, and
 * all partial clients close when authorization or reconnection fails.
 */

import {
  StreamableHTTPClientTransport,
  UnauthorizedError,
  type Client,
} from "@modelcontextprotocol/client";
import { guardedFetch } from "#egress";
import { NtOAuthProvider } from "#mcp/auth";
import type { CredentialStore } from "#mcp/credentials";
import { McpError } from "#mcp/errors";
import { redactMcpDiagnostic, resolveDeclaredValues } from "#mcp/security";
import { requireUrl } from "#mcp/transport";
import type { McpServerDef } from "#types";

export interface AuthorizationResult {
  client: Client;
  transport: StreamableHTTPClientTransport;
  provider: NtOAuthProvider;
}

/**
 * Establishes a fresh OAuth-backed MCP session and commits it only after callback validation.
 * @param def The trusted OAuth server declaration.
 * @param makeClient Factory for an SDK client with NT capabilities.
 * @param credentials Credential persistence selected by the embedder.
 * @param redirectUrl The loopback callback URL registered for this flow.
 * @param onRedirect Callback that opens or displays the authorization URL.
 * @param callback The validated callback query from the loopback listener.
 * @param signal Engine-lifetime cancellation signal.
 * @returns The authorized, connected client and transport.
 */
export async function authorizeMcpConnection(
  def: McpServerDef,
  makeClient: () => Client,
  credentials: CredentialStore,
  redirectUrl: string,
  onRedirect: (url: URL) => void | Promise<void>,
  callback: Promise<URLSearchParams>,
  signal: AbortSignal,
): Promise<AuthorizationResult> {
  if (def.transport !== "streamable_http" || def.auth.type !== "oauth")
    throw new McpError("MCP_AUTH_FAILED", `MCP server '${def.name}' does not use OAuth`);
  const provider = new NtOAuthProvider(requireUrl(def), def.auth.scopes, credentials, {
    redirectUrl,
    onRedirect,
  });
  const transport = new StreamableHTTPClientTransport(new URL(requireUrl(def)), {
    authProvider: provider,
    requestInit: { headers: resolveDeclaredValues(def.headers) },
    fetch: ((input: string | URL | Request, init?: RequestInit) =>
      guardedFetch(input, init, def.allowInternal)) as typeof fetch,
    maxStepUpRetries: 2,
  });
  const client = makeClient();
  const connectOptions = {
    signal,
    timeout: def.connectTimeoutMs,
    maxTotalTimeout: def.connectTimeoutMs,
  };
  try {
    await client.connect(transport, connectOptions);
  } catch (error) {
    if (!(error instanceof UnauthorizedError)) {
      await client.close().catch(() => {});
      throw authFailure(def, error);
    }
    try {
      const params = await abortableCallback(callback, signal);
      validateCallback(params, provider);
      await transport.finishAuth(params);
      await client.connect(transport, connectOptions);
    } catch (authorizationError) {
      await client.close().catch(() => {});
      throw authFailure(def, authorizationError);
    }
  }
  return { client, transport, provider };
}

/**
 * Rejects callback waiting immediately when engine shutdown aborts the flow.
 *
 * @param callback Loopback query promise owned by the CLI or embedder.
 * @param signal Engine-lifetime cancellation signal.
 * @returns Callback parameters when they arrive before cancellation.
 */
function abortableCallback(
  callback: Promise<URLSearchParams>,
  signal: AbortSignal,
): Promise<URLSearchParams> {
  if (signal.aborted) return Promise.reject(new McpError("MCP_CLOSED", "OAuth was cancelled"));
  return new Promise((resolve, reject) => {
    const abort = () => reject(new McpError("MCP_CLOSED", "OAuth was cancelled"));
    signal.addEventListener("abort", abort, { once: true });
    callback.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

/**
 * Converts SDK and callback failures into a stable, credential-scrubbed error.
 *
 * @param def OAuth server whose declared values must remain private.
 * @param error Arbitrary failure from discovery, callback, or token exchange.
 * @returns Stable authorization error safe to expose through engine and CLI APIs.
 */
function authFailure(def: McpServerDef, error: unknown): McpError {
  if (error instanceof McpError)
    return new McpError(error.code, redactMcpDiagnostic(def, error.message));
  const message = error instanceof Error ? error.message : String(error);
  return new McpError(
    "MCP_AUTH_FAILED",
    `OAuth authorization failed for MCP server '${def.name}': ${redactMcpDiagnostic(def, message)}`,
  );
}

function validateCallback(params: URLSearchParams, provider: NtOAuthProvider): void {
  if (params.get("state") !== provider.expectedState)
    throw new McpError("MCP_AUTH_FAILED", "OAuth callback state did not match");
  if (params.get("error"))
    throw new McpError(
      "MCP_AUTH_FAILED",
      `OAuth authorization failed: ${params.get("error_description") ?? params.get("error")}`,
    );
}
