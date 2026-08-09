/**
 * @file The engine that resolves definitions and runs the ecosystem.
 *
 * Loads a `Project`, owns providers, audit output, and one lazy MCP manager, and
 * resolves each agent's model and sandbox. Its public run, chat, workflow,
 * bring-up, MCP inspection/trust/OAuth, and bounded close methods are the only
 * runtime surface exported through the package barrel.
 */

import { openAuditLog, type AuditLog } from "#audit/log";
import { ChatSession } from "#chat";
import { NtError } from "#errors";
import { createRunContext, sandboxForAgent, validateRunInput } from "#engine-support";
import type { EngineOptions, RunnableKind } from "#engine-types";
import { loadProject } from "#loader";
import { ProviderRegistry } from "#provider";
import { auditStatus, bringUpStatus, type AuditStatus, type EcosystemStatus } from "#status";
import { resolveModel } from "#runtime";
import { runSession } from "#session";
import { executeWorkflow } from "#workflow";
import { McpManager } from "#mcp/manager";
import { McpTrustStore } from "#mcp/trust";
import { FileCredentialStore } from "#mcp/credentials";
import type { BuildResult } from "#schema/build";
import type { ConfirmRequest, Project, RunResult, StepEvent } from "#types";

export type { EngineOptions, RunnableKind } from "#engine-types";

export class Engine {
  readonly project: Project;
  readonly warnings: string[];
  private registry = new ProviderRegistry();
  private log: (line: string) => void;
  private audit: AuditLog | null;
  private onStep?: (event: StepEvent) => void;
  private confirm?: (request: ConfirmRequest) => Promise<boolean>;
  private mcpManager: McpManager;
  private closed = false;

  /**
   * Creates an engine with isolated provider, audit, and MCP lifecycle state.
   * @param loaded A fully built project and its warnings.
   * @param opts Runtime callbacks, tracing, and MCP persistence overrides.
   */
  constructor(loaded: BuildResult, opts?: EngineOptions) {
    this.project = loaded.project;
    this.warnings = loaded.warnings;
    for (const provider of this.project.providers.values()) this.registry.register(provider);
    this.log = opts?.verbose ? (line) => process.stderr.write(line + "\n") : () => {};
    this.audit = openAuditLog(this.project);
    this.onStep = opts?.onStep;
    this.confirm = opts?.confirm;
    this.mcpManager = new McpManager(
      this.project,
      opts?.mcpTrustFile ? new McpTrustStore(opts.mcpTrustFile) : undefined,
      opts?.mcpCredentialFile ? new FileCredentialStore(opts.mcpCredentialFile) : undefined,
      this.onStep,
    );
  }
  /**
   * Loads, validates, and prepares an NT project from a file or directory.
   *
   * @param dir An entry `.nt` file (imports are followed) or a directory of `.nt` files.
   * @param opts Options such as verbose tracing, a per-step progress callback,
   *   and whether imports may escape the project directory.
   * @returns A ready-to-run engine.
   */
  static load(dir: string, opts?: EngineOptions & { allowOutsideImports?: boolean }): Engine {
    return new Engine(loadProject(dir, { allowOutsideImports: opts?.allowOutsideImports }), opts);
  }
  /**
   * Identifies the runnable declaration kind associated with a project name.
   * @param name A candidate name.
   * @returns Which kind of runnable the name refers to, or null.
   */
  isRunnable(name: string): RunnableKind | null {
    if (this.project.agents.has(name)) return "agent";
    if (this.project.workflows.has(name)) return "workflow";
    if (this.project.subagents.has(name)) return "subagent";
    return null;
  }
  /**
   * Runs an agent or subagent after validating input and resolving its sandbox.
   * @param name The agent or subagent to run.
   * @param input The run input.
   * @returns The run result.
   */
  async runAgent(name: string, input: Record<string, unknown>): Promise<RunResult> {
    this.requireOpen();
    const agent = this.project.agents.get(name) ?? this.project.subagents.get(name);
    if (!agent) throw new NtError(`no agent or subagent named '${name}'`, null);
    validateRunInput(agent.input, input, `${agent.kind} '${name}'`, agent.loc);
    const sandbox = sandboxForAgent(this.project, agent);
    this.log(
      `▶ running ${agent.kind} '${name}' (model ${resolveModel(this.project, agent)}, sandbox ${sandbox.kind})`,
    );
    return runSession(this.context(), agent, input, sandbox, 0);
  }
  /**
   * Opens a stateful chat session for a validated agent or subagent name.
   * @param name The agent or subagent to converse with.
   * @returns A stateful, multi-turn chat session for that agent.
   */
  createChat(name: string): ChatSession {
    this.requireOpen();
    const agent = this.project.agents.get(name) ?? this.project.subagents.get(name);
    if (!agent) throw new NtError(`no agent or subagent named '${name}'`, null);
    return new ChatSession(this.context(), agent, sandboxForAgent(this.project, agent));
  }
  /**
   * Runs a declared workflow after validating its external input contract.
   * @param name The workflow to run.
   * @param input The workflow input.
   * @returns The aggregated result across all steps.
   */
  async runWorkflow(name: string, input: Record<string, unknown>): Promise<RunResult> {
    this.requireOpen();
    const workflow = this.project.workflows.get(name);
    if (!workflow) throw new NtError(`no workflow named '${name}'`, null);
    validateRunInput(workflow.input, input, `workflow '${name}'`, workflow.loc);
    this.log(`▶ running workflow '${name}' (${workflow.steps.length} steps)`);

    return executeWorkflow(name, workflow, input, {
      project: this.project,
      context: this.context(),
      makeSandbox: (agent) => sandboxForAgent(this.project, agent),
      onStep: this.onStep,
    });
  }
  /**
   * Checks provider credentials, sandboxes, and audit readiness without running a model.
   * @returns The instantiated sandboxes, provider credential status, and audit destination.
   */
  bringUp(): EcosystemStatus {
    this.requireOpen();
    return bringUpStatus(this.project, this.registry, this.audit);
  }
  /**
   * Discovers live MCP server status and selected or advertised tool catalogs.
   * @param server Optional single server to query.
   * @param all Whether unselected advertised tools should be included.
   * @returns Live server statuses and tool catalogs.
   */
  async listMcp(server?: string, all = false) {
    return this.mcpManager.list(server, all);
  }
  /**
   * Fetches the live schema and metadata for one exact advertised MCP tool.
   * @param server Server declaration name.
   * @param tool Exact remote tool name.
   * @returns Live normalized metadata for the advertised tool.
   */
  async inspectMcp(server: string, tool: string) {
    return this.mcpManager.inspect(server, tool);
  }
  /**
   * Diagnoses trust, connectivity, initialization, and discovery for MCP servers.
   * @param server Optional single server to diagnose.
   * @returns Live diagnostic results for the requested declarations.
   */
  async doctorMcp(server?: string) {
    return this.mcpManager.doctor(server);
  }
  /**
   * Computes a server fingerprint and reports whether that definition is trusted.
   * @param server Server declaration name.
   * @returns Its fingerprint, definition, and persisted trust state.
   */
  mcpTrustInfo(server: string) {
    return this.mcpManager.trustInfo(server);
  }
  /**
   * Persists approval for the server's current security-sensitive fingerprint.
   * @param server Server declaration name.
   * @param expected Optional compare-and-set fingerprint for non-interactive use.
   * @returns The persisted fingerprint.
   */
  trustMcp(server: string, expected?: string) {
    return this.mcpManager.trustServer(server, expected);
  }
  /**
   * Removes the persisted trust decision for the server's current definition.
   * @param server Server declaration name.
   * @returns Whether an existing trust decision was removed.
   */
  untrustMcp(server: string) {
    return this.mcpManager.untrustServer(server);
  }
  /**
   * Deletes locally persisted OAuth credentials associated with an MCP server.
   * @param server OAuth server declaration name.
   * @returns Whether any local credential for its resource was removed.
   */
  logoutMcp(server: string) {
    return this.mcpManager.logout(server);
  }
  /**
   * Completes interactive OAuth authorization and retains the connected session.
   * @param server OAuth server declaration name.
   * @param redirectUrl Ephemeral loopback callback URL.
   * @param onRedirect Handler for the generated authorization URL.
   * @param callback Validated callback query parameters.
   * @returns A connected snapshot after successful authorization.
   */
  authorizeMcp(
    server: string,
    redirectUrl: string,
    onRedirect: (url: URL) => void | Promise<void>,
    callback: Promise<URLSearchParams>,
  ) {
    return this.mcpManager.authorize(server, redirectUrl, onRedirect, callback);
  }
  /**
   * Permanently closes this engine and all MCP work and transports it owns.
   * @returns When all MCP subprocesses, remote sessions, and active calls are closed.
   */
  async close(): Promise<void> {
    this.closed = true;
    await this.mcpManager.close();
  }
  /**
   * Integrates bounded engine cleanup with JavaScript asynchronous disposal.
   * @returns When asynchronous engine disposal has delegated to bounded close.
   */
  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }
  /**
   * Reports the active audit configuration and current daily destination.
   * @returns Whether tool calls are being logged, where, and today's log file.
   */
  auditStatus(): AuditStatus {
    return auditStatus(this.project, this.audit);
  }
  private context() {
    return createRunContext(
      this.project,
      this.registry,
      this.log,
      this.audit,
      this.onStep,
      this.confirm,
      this.mcpManager,
    );
  }
  private requireOpen(): void {
    if (this.closed) throw new NtError("engine is closed", null);
  }
}
