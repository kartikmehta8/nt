/**
 * @file Stateful owner of one trusted MCP server connection.
 *
 * Deduplicates trusted opens, owns SDK operations, bounds diagnostics and cleanup,
 * and aborts in-progress I/O when its engine begins shutdown.
 */

import {
  type CallToolResult,
  type Client,
  type Tool,
  type Transport,
} from "@modelcontextprotocol/client";
import type { NtOAuthProvider } from "#mcp/auth";
import { createConnectionAuth, logoutConnectionAuth } from "#mcp/authentication";
import { connectionSnapshot, createMcpClient } from "#mcp/client";
import { establishMcpAuthorization } from "#mcp/connection-authorization";
import { callConnectionTool, listConnectionTools } from "#mcp/connection-operations";
import { shutdownMcpConnection } from "#mcp/connection-shutdown";
import type { CredentialStore } from "#mcp/credentials";
import { appendMcpStderr, connectionError } from "#mcp/diagnostics";
import { McpError } from "#mcp/errors";
import { McpTrustStore } from "#mcp/trust";
import { openMcpTransport } from "#mcp/transport";
import type { ConnectionSnapshot } from "#mcp/types";
import type { McpServerDef } from "#types";

type State = "idle" | "connecting" | "ready" | "failed" | "closing" | "closed";

/**
 * Maintains one lazy, deduplicated official SDK connection to a trusted MCP
 * server definition.
 */
export class McpConnection {
  private state: State = "idle";
  private client?: Client;
  private transport?: Transport;
  private shutdown = new AbortController();
  private connectPromise?: Promise<ConnectionSnapshot>;
  private closePromise?: Promise<void>;
  private invalidated = true;
  private lastFailure = 0;
  private oauth?: NtOAuthProvider;
  private stderr = "";
  readonly def: McpServerDef;
  private trust: McpTrustStore;
  private credentials: CredentialStore;
  private onCatalogChanged?: () => void;
  private oauthOptions?: { redirectUrl?: string; onRedirect?: (url: URL) => void | Promise<void> };

  /**
   * Creates a lazy connection owner with explicit trust and credential dependencies.
   * @param def Validated server declaration.
   * @param trust Trust persistence checked before the first connection.
   * @param credentials OAuth credential persistence.
   * @param onCatalogChanged Optional catalog invalidation callback.
   * @param oauthOptions Optional interactive OAuth redirect behavior.
   */
  constructor(
    def: McpServerDef,
    trust: McpTrustStore,
    credentials: CredentialStore,
    onCatalogChanged?: () => void,
    oauthOptions?: { redirectUrl?: string; onRedirect?: (url: URL) => void | Promise<void> },
  ) {
    this.def = def;
    this.trust = trust;
    this.credentials = credentials;
    this.onCatalogChanged = onCatalogChanged;
    this.oauthOptions = oauthOptions;
  }
  /**
   * Reports whether a server notification invalidated the cached tool catalog.
   * @returns Whether a server notification invalidated the cached tool catalog.
   */
  get catalogInvalidated(): boolean {
    return this.invalidated;
  }
  /**
   * Marks the registry's cached catalog as synchronized with the live server.
   *
   * @returns Nothing; the next list-change notification invalidates it again.
   */
  markCatalogFresh(): void {
    this.invalidated = false;
  }
  /**
   * Opens or reuses the single trusted SDK connection for this server.
   * @returns A negotiated SDK client snapshot, reusing ready or in-progress work.
   */
  async connect(): Promise<ConnectionSnapshot> {
    if (this.state === "closed" || this.state === "closing")
      throw new McpError("MCP_CLOSED", `MCP server '${this.def.name}' is closed`);
    if (this.state === "ready" && this.client) return this.snapshot();
    if (this.connectPromise) return this.connectPromise;
    if (this.state === "failed" && Date.now() - this.lastFailure < 250)
      throw new McpError(
        "MCP_CONNECTION_FAILED",
        `MCP server '${this.def.name}' connection is cooling down after a failure`,
      );
    this.trust.require(this.def);
    this.state = "connecting";
    this.connectPromise = this.establish();
    return this.connectPromise;
  }
  private async establish(): Promise<ConnectionSnapshot> {
    try {
      const ready = await this.open();
      if (this.state === "closing" || this.state === "closed")
        throw new McpError("MCP_CLOSED", `MCP server '${this.def.name}' closed while connecting`);
      this.state = "ready";
      return ready;
    } catch (error) {
      const shuttingDown = this.state === "closing" || this.state === "closed";
      if (!shuttingDown) {
        this.state = "failed";
        this.lastFailure = Date.now();
      }
      await this.client?.close().catch(() => {});
      this.client = undefined;
      this.transport = undefined;
      throw shuttingDown
        ? new McpError("MCP_CLOSED", `MCP server '${this.def.name}' is closed`)
        : connectionError(this.def, error, this.stderr);
    } finally {
      this.connectPromise = undefined;
    }
  }
  private makeClient() {
    return createMcpClient(this.def, () => {
      this.invalidated = true;
      this.onCatalogChanged?.();
    });
  }
  private async open(): Promise<ConnectionSnapshot> {
    const auth = createConnectionAuth(this.def, this.credentials, this.oauthOptions);
    this.oauth = auth.oauth;
    const { client, transport } = await openMcpTransport({
      def: this.def,
      makeClient: () => this.makeClient(),
      authProvider: auth.provider,
      onStderr: (chunk) => (this.stderr = appendMcpStderr(this.stderr, chunk)),
      signal: this.shutdown.signal,
    });
    this.client = client;
    this.transport = transport;
    return this.snapshot();
  }
  private snapshot(): ConnectionSnapshot {
    if (!this.client)
      throw new McpError("MCP_CLOSED", `MCP server '${this.def.name}' has no active client`);
    return connectionSnapshot(this.client, this.def.name);
  }

  /**
   * Retrieves the advertised live tool catalog through the connected SDK client.
   * @param refresh Whether SDK caches should be bypassed.
   * @returns The advertised tool catalog.
   */
  async listTools(refresh = false): Promise<Tool[]> {
    return listConnectionTools(() => this.connect(), this.def, refresh);
  }

  /**
   * Invokes one advertised tool with a bounded deadline and progress delivery.
   * @param tool The exact advertised SDK tool definition.
   * @param args Validated invocation arguments.
   * @param timeout Total call deadline in milliseconds.
   * @param onProgress Optional progress sink.
   * @returns The raw MCP call result.
   */
  async callTool(
    tool: Tool,
    args: Record<string, unknown>,
    timeout: number,
    onProgress?: (detail: string) => void,
  ): Promise<CallToolResult> {
    return callConnectionTool(() => this.connect(), tool, args, timeout, onProgress);
  }

  /**
   * Establishes an OAuth-backed session from a validated loopback callback.
   * @param redirectUrl Ephemeral loopback callback URL.
   * @param onRedirect Authorization URL callback.
   * @param callback Validated loopback query parameters.
   * @returns A connected snapshot after completing OAuth authorization.
   */
  async authorize(
    redirectUrl: string,
    onRedirect: (url: URL) => void | Promise<void>,
    callback: Promise<URLSearchParams>,
  ): Promise<ConnectionSnapshot> {
    if (this.state === "closed" || this.state === "closing")
      throw new McpError("MCP_CLOSED", `MCP server '${this.def.name}' is closed`);
    if (this.connectPromise || this.state === "ready")
      throw new McpError("MCP_AUTH_FAILED", "OAuth authorization requires an idle connection");
    const authorization = establishMcpAuthorization({
      def: this.def,
      trust: this.trust,
      credentials: this.credentials,
      redirectUrl,
      onRedirect,
      callback,
      signal: this.shutdown.signal,
      makeClient: () => this.makeClient(),
      isClosing: () => this.state === "closed" || this.state === "closing",
      commit: (provider, client, transport) => {
        this.oauth = provider;
        this.client = client;
        this.transport = transport;
        this.state = "ready";
      },
    });
    this.connectPromise = authorization;
    try {
      return await authorization;
    } finally {
      if (this.connectPromise === authorization) this.connectPromise = undefined;
    }
  }

  /**
   * Deletes OAuth credentials associated with this server's protected resource.
   * @returns Whether local OAuth credentials for this protected resource were removed.
   */
  logout(): boolean {
    return logoutConnectionAuth(this.def, this.credentials, this.oauth);
  }

  /**
   * Closes the remote session and SDK client within bounded deadlines.
   *
   * @returns When cleanup has settled or its defensive deadlines have elapsed.
   */
  async close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.state = "closing";
    this.shutdown.abort();
    this.closePromise = shutdownMcpConnection({
      def: this.def,
      pending: this.connectPromise,
      resources: () => ({ client: this.client, transport: this.transport }),
    }).finally(() => {
      this.state = "closed";
      this.client = undefined;
      this.transport = undefined;
    });
    return this.closePromise;
  }
}
