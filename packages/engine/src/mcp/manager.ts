/**
 * @file Engine-lifetime coordinator for MCP preparation and invocation.
 *
 * The manager validates model arguments, enforces per-server concurrency and
 * call deadlines, normalizes SDK results, and delegates live discovery to one
 * shared registry. It also exposes trust, diagnostics, OAuth, and inspection to
 * `Engine`. Close waits briefly for active calls before closing every transport,
 * while all methods reject work after shutdown begins.
 */

import { defaultCredentialStore, type CredentialStore } from "#mcp/credentials";
import { Semaphore } from "#mcp/concurrency";
import { McpConnection } from "#mcp/connection";
import { diagnoseMcpServer } from "#mcp/doctor";
import { deadline } from "#mcp/deadline";
import { McpError } from "#mcp/errors";
import { serializeMcpInput } from "#mcp/input";
import { McpRegistry, type PreparedMcpTool } from "#mcp/registry";
import { normalizeResult } from "#mcp/results";
import { validationMessage } from "#mcp/schemas";
import { redactMcpDiagnostic, serverFingerprint } from "#mcp/security";
import { McpTrustStore } from "#mcp/trust";
import type { McpServerDef, Project, StepEvent } from "#types";

export type { PreparedMcpTool } from "#mcp/registry";

/**
 * Owns invocation, registry, credential, and shutdown state for one engine
 * lifetime.
 */
export class McpManager {
  private semaphores = new Map<string, Semaphore>();
  private closed = false;
  private closePromise?: Promise<void>;
  private inFlight = new Set<Promise<unknown>>();
  private registry: McpRegistry;
  private project: Project;
  private trust: McpTrustStore;
  private credentials: CredentialStore;

  /**
   * Creates the engine-owned MCP coordinator with isolated trust and credential stores.
   * @param project The loaded project whose MCP declarations are managed.
   * @param trust Trust persistence checked before connecting.
   * @param credentials OAuth credential persistence.
   * @param onStep Optional progress event sink.
   */
  constructor(
    project: Project,
    trust = new McpTrustStore(),
    credentials: CredentialStore = defaultCredentialStore(),
    onStep?: (event: StepEvent) => void,
  ) {
    this.project = project;
    this.trust = trust;
    this.credentials = credentials;
    this.registry = new McpRegistry(project, trust, credentials, onStep);
  }

  /**
   * Prepares the exact MCP tools and opt-in server instructions granted to an agent.
   * @param references Agent-granted `server.tool` references.
   * @returns Model-facing tools and opt-in untrusted instructions for an agent.
   */
  async prepare(
    references: string[],
  ): Promise<{ tools: PreparedMcpTool[]; instructions: string[] }> {
    this.requireOpen();
    return this.registry.prepare(references);
  }

  /**
   * Validates, bounds, schedules, invokes, and normalizes one prepared MCP call.
   * @param tool Prepared exact tool dispatch.
   * @param input Untrusted model arguments to validate.
   * @param onProgress Optional progress event sink.
   * @returns The normalized MCP result.
   */
  async call(
    tool: PreparedMcpTool,
    input: Record<string, unknown>,
    onProgress?: (detail: string) => void,
  ) {
    if (this.closed) throw new McpError("MCP_CLOSED", "MCP manager is closed");
    const serialized = serializeMcpInput(input);
    if (Buffer.byteLength(serialized) > 256 * 1024)
      throw new McpError("MCP_INPUT_INVALID", "MCP tool arguments exceed 256 KiB");
    if (!tool.catalog.inputValidator(input))
      throw new McpError(
        "MCP_INPUT_INVALID",
        `invalid MCP tool arguments: ${validationMessage(tool.catalog.inputValidator.errors)}`,
      );
    let semaphore = this.semaphores.get(tool.server.name);
    if (!semaphore) {
      semaphore = new Semaphore(tool.server.maxConcurrency);
      this.semaphores.set(tool.server.name, semaphore);
    }
    const policy =
      tool.server.tools.get(tool.catalog.info.remoteName) ?? tool.server.tools.get("*");
    const timeout = Math.min(
      policy?.callTimeoutMs ?? tool.server.callTimeoutMs,
      tool.server.callTimeoutMs,
    );
    const invocation = semaphore.use(async () =>
      normalizeResult(
        await this.registry
          .connection(tool.server.name)
          .callTool(tool.catalog.sdk, input, timeout, onProgress),
        tool.catalog.outputValidator,
      ),
    );
    this.inFlight.add(invocation);
    try {
      return await invocation;
    } catch (error) {
      if (!(error instanceof McpError)) throw error;
      throw new McpError(error.code, redactMcpDiagnostic(tool.server, error.message));
    } finally {
      this.inFlight.delete(invocation);
    }
  }

  /**
   * Reports a declaration's fingerprint alongside its persisted trust status.
   * @param name Server declaration name.
   * @returns The current fingerprint and persisted trust status.
   */
  trustInfo(name: string): { def: McpServerDef; fingerprint: string; status: string } {
    this.requireOpen();
    const def = this.registry.definition(name);
    return { def, fingerprint: serverFingerprint(def), status: this.trust.status(def) };
  }
  /**
   * Persists trust for the server's current fingerprint with optional compare-and-set safety.
   * @param name Server declaration name.
   * @param expected Optional compare-and-set fingerprint.
   * @returns The persisted fingerprint.
   */
  trustServer(name: string, expected?: string): string {
    this.requireOpen();
    return this.trust.trust(this.registry.definition(name), expected);
  }
  /**
   * Removes trust for the resolved declaration and closes no unrelated server state.
   * @param name Server declaration name.
   * @returns Whether an existing trust record was removed.
   */
  untrustServer(name: string): boolean {
    this.requireOpen();
    return this.trust.untrust(this.registry.definition(name));
  }

  /**
   * Returns live MCP server status and bounded tool catalogs.
   * @param name Optional single server name.
   * @param all Whether unselected tools should be included.
   * @returns Live server status and tool catalogs.
   */
  async list(name?: string, all = false) {
    this.requireOpen();
    return this.registry.list(name, all);
  }

  /**
   * Returns normalized live metadata for one exact advertised tool.
   * @param server Server declaration name.
   * @param remoteName Exact advertised tool name.
   * @returns Live metadata for one exact advertised tool.
   */
  async inspect(server: string, remoteName: string) {
    this.requireOpen();
    return this.registry.inspect(server, remoteName);
  }

  /**
   * Diagnoses selected declarations with isolated temporary connections.
   * @param name Optional single server name.
   * @returns Ordered independent diagnostics for each requested server.
   */
  async doctor(name?: string) {
    this.requireOpen();
    const defs = name ? [this.registry.definition(name)] : [...this.project.mcpServers.values()];
    return Promise.all(
      defs.map((def) =>
        diagnoseMcpServer(
          def,
          this.trust.status(def),
          new McpConnection(def, this.trust, this.credentials),
        ),
      ),
    );
  }
  /**
   * Deletes locally stored OAuth credentials for a declared server.
   * @param name OAuth server declaration name.
   * @returns Whether persisted OAuth credentials were removed.
   */
  logout(name: string): boolean {
    this.requireOpen();
    return this.registry.connection(name).logout();
  }
  /**
   * Completes an OAuth callback through the server's owned connection.
   * @param name OAuth server declaration name.
   * @param redirectUrl Ephemeral loopback callback URL.
   * @param onRedirect Authorization URL callback.
   * @param callback Validated loopback query parameters.
   * @returns A connected server snapshot after OAuth authorization.
   */
  async authorize(
    name: string,
    redirectUrl: string,
    onRedirect: (url: URL) => void | Promise<void>,
    callback: Promise<URLSearchParams>,
  ) {
    this.requireOpen();
    return this.registry.connection(name).authorize(redirectUrl, onRedirect, callback);
  }

  /**
   * Rejects new work, bounds in-flight settlement, and closes every connection.
   * @returns When in-flight work has settled or timed out and every transport is closed.
   */
  async close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    this.closePromise = this.finishClose();
    return this.closePromise;
  }

  private async finishClose(): Promise<void> {
    if (this.inFlight.size)
      await Promise.race([
        Promise.allSettled([...this.inFlight]).then(() => undefined),
        deadline(5000),
      ]);
    await this.registry.close();
  }

  private requireOpen(): void {
    if (this.closed) throw new McpError("MCP_CLOSED", "MCP manager is closed");
  }
}
