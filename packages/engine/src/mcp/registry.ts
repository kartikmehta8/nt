/**
 * @file Shared MCP connection registry and in-memory tool catalog cache.
 *
 * One registry owns at most one connection per declaration, refreshes bounded
 * catalogs after TTL expiry or list-change notifications, and prepares only the
 * intersection of source-selected and agent-assigned tools. It supplies live
 * list/inspect status without mutating the loaded project and closes all cached
 * connections as one engine-owned lifecycle unit.
 */

import type { LlmToolDef } from "#provider";
import type { CredentialStore } from "#mcp/credentials";
import { buildCatalog } from "#mcp/catalog";
import { McpConnection } from "#mcp/connection";
import { McpError, mcpErrorCode } from "#mcp/errors";
import { requestedMcpTools } from "#mcp/references";
import { providerSchema } from "#mcp/schemas";
import { McpTrustStore } from "#mcp/trust";
import type { CatalogTool } from "#mcp/types";
import type {
  McpInspectResult,
  McpServerDef,
  McpServerStatus,
  McpToolInfo,
  Project,
  StepEvent,
} from "#types";

export interface PreparedMcpTool {
  definition: LlmToolDef;
  catalog: CatalogTool;
  server: McpServerDef;
  protocolVersion?: string;
}

/**
 * Maintains lazy live connections and bounded in-memory catalogs for exactly one
 * engine lifetime.
 */
export class McpRegistry {
  private connections = new Map<string, McpConnection>();
  private catalogs = new Map<string, CatalogTool[]>();
  private catalogFetchedAt = new Map<string, number>();
  private project: Project;
  private trust: McpTrustStore;
  private credentials: CredentialStore;
  private onStep?: (event: StepEvent) => void;

  /**
   * Creates an engine-scoped registry for validated declarations and lazy connections.
   * @param project The immutable loaded project.
   * @param trust Trust store checked before each first connection.
   * @param credentials OAuth credential persistence.
   * @param onStep Optional progress event sink.
   */
  constructor(
    project: Project,
    trust: McpTrustStore,
    credentials: CredentialStore,
    onStep?: (event: StepEvent) => void,
  ) {
    this.project = project;
    this.trust = trust;
    this.credentials = credentials;
    this.onStep = onStep;
  }

  /**
   * Resolves a validated MCP declaration or raises a stable unknown-server error.
   * @param name Source declaration name.
   * @returns The validated server definition or a stable unknown-server error.
   */
  definition(name: string): McpServerDef {
    const def = this.project.mcpServers.get(name);
    if (!def) throw new McpError("MCP_TOOL_NOT_FOUND", `unknown MCP server '${name}'`);
    return def;
  }

  /**
   * Returns the one lazy shared connection owned for a declared MCP server.
   * @param name Source declaration name.
   * @returns The server's existing or newly created lazy shared connection.
   */
  connection(name: string): McpConnection {
    let connection = this.connections.get(name);
    if (!connection) {
      connection = new McpConnection(this.definition(name), this.trust, this.credentials, () => {
        this.catalogs.delete(name);
        this.catalogFetchedAt.delete(name);
      });
      this.connections.set(name, connection);
    }
    return connection;
  }

  private async catalog(name: string, refresh = false): Promise<CatalogTool[]> {
    const connection = this.connection(name);
    const cached = this.catalogs.get(name);
    const fresh = Date.now() - (this.catalogFetchedAt.get(name) ?? 0) < 30_000;
    if (!refresh && fresh && !connection.catalogInvalidated && cached) return cached;
    this.onStep?.({
      kind: "mcp-connect",
      agent: name,
      detail: `discovering MCP tools from ${name}`,
      depth: 0,
    });
    const catalog = buildCatalog(this.definition(name), await connection.listTools(refresh));
    this.catalogs.set(name, catalog);
    this.catalogFetchedAt.set(name, Date.now());
    connection.markCatalogFresh();
    return catalog;
  }

  /**
   * Intersects agent grants with live catalogs to build safe model-facing tools.
   * @param references Agent-granted `server.tool` references.
   * @returns Model-facing definitions and opt-in untrusted server instructions.
   */
  async prepare(
    references: string[],
  ): Promise<{ tools: PreparedMcpTool[]; instructions: string[] }> {
    const requested = requestedMcpTools(references, this.project);
    const tools: PreparedMcpTool[] = [];
    const instructions: string[] = [];
    for (const [server, names] of requested) {
      const snapshot = await this.connection(server).connect();
      for (const tool of await this.catalog(server)) {
        if (!tool.info.selected) continue;
        if (!names.has("*") && !names.has(tool.info.remoteName)) continue;
        tools.push({
          server: this.definition(server),
          catalog: tool,
          protocolVersion: snapshot.protocolVersion,
          definition: {
            name: tool.info.modelName,
            description: tool.info.description.slice(0, 1024),
            input_schema: providerSchema(tool.info.inputSchema),
          },
        });
      }
      if (this.definition(server).includeInstructions && snapshot.instructions)
        instructions.push(
          `## Untrusted MCP server instructions: ${server}\n${snapshot.instructions.slice(0, 16_000)}`,
        );
    }
    if (tools.length > 128)
      throw new McpError("MCP_SCHEMA_INVALID", "agent would expose more than 128 MCP tools");
    return { tools, instructions };
  }

  /**
   * Refreshes live catalogs and returns status for one or every declared server.
   * @param name Optional server name; omitted means every declaration.
   * @param all Whether unselected advertised tools should be included.
   * @returns Live connection status and catalogs for the requested servers.
   */
  async list(
    name?: string,
    all = false,
  ): Promise<Array<{ status: McpServerStatus; tools: McpToolInfo[] }>> {
    const defs = name ? [this.definition(name)] : [...this.project.mcpServers.values()];
    return Promise.all(defs.map((def) => this.listOne(def, all)));
  }

  private async listOne(
    def: McpServerDef,
    all: boolean,
  ): Promise<{ status: McpServerStatus; tools: McpToolInfo[] }> {
    try {
      const tools = (await this.catalog(def.name, true))
        .filter((tool) => all || tool.info.selected)
        .map((tool) => tool.info);
      const snapshot = await this.connection(def.name).connect();
      return {
        status: {
          name: def.name,
          transport: def.transport,
          status: "connected",
          protocolVersion: snapshot.protocolVersion,
          serverInfo: snapshot.serverInfo,
          selectedToolCount: tools.filter((tool) => tool.selected).length,
        },
        tools,
      };
    } catch (error) {
      return {
        status: {
          name: def.name,
          transport: def.transport,
          status: this.trust.status(def) === "trusted" ? "error" : "untrusted",
          error: (error as Error).message,
          errorCode: mcpErrorCode(error),
        },
        tools: [],
      };
    }
  }

  /**
   * Retrieves bounded live metadata for one exact remote MCP tool.
   * @param server Server declaration name.
   * @param remoteName Exact advertised tool name.
   * @returns Live server status and bounded tool metadata.
   */
  async inspect(server: string, remoteName: string): Promise<McpInspectResult> {
    const item = (await this.catalog(server, true)).find(
      (tool) => tool.info.remoteName === remoteName,
    );
    if (!item)
      throw new McpError(
        "MCP_TOOL_NOT_FOUND",
        `MCP tool '${server}.${remoteName}' was not advertised`,
      );
    const snapshot = await this.connection(server).connect();
    return {
      server: {
        name: server,
        transport: this.definition(server).transport,
        status: "connected",
        protocolVersion: snapshot.protocolVersion,
        serverInfo: snapshot.serverInfo,
      },
      tool: item.info,
    };
  }

  /**
   * Closes every owned connection and clears all in-memory catalog state.
   * @returns When all live connections have settled and cached catalog state is cleared.
   */
  async close(): Promise<void> {
    await Promise.allSettled(
      [...this.connections.values()].map((connection) => connection.close()),
    );
    this.connections.clear();
    this.catalogs.clear();
    this.catalogFetchedAt.clear();
  }
}
