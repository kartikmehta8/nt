/**
 * @file The engine that resolves definitions and runs the ecosystem.
 *
 * Loads a `Project`, registers its providers, and resolves each agent's model
 * and sandbox. Exposes the surface the CLI drives: `runAgent`, `runWorkflow`,
 * `createChat`, and `bringUp` (instantiate declared sandboxes and report
 * provider credential status).
 */

import { ChatSession } from "#chat";
import { DEFAULT_SANDBOX_CWD } from "#constants";
import { NtError } from "#errors";
import { interpolate, validateInput } from "#io";
import { loadProject } from "#loader";
import { ProviderRegistry } from "#provider";
import { makeSandbox, type Sandbox } from "#sandbox";
import { buildUserMessage, resolveModel, runSession, type RunContext } from "#session";
import type { BuildResult } from "#schema/build";
import type { AgentDef, FieldSpec, Location, Project, RunResult, SandboxDef } from "#types";

export type RunnableKind = "agent" | "subagent" | "workflow";

export interface SandboxStatus {
  name: string;
  kind: string;
  cwd: string;
  ok: boolean;
  error?: string;
}

export interface ProviderStatus {
  name: string;
  api: string;
  hasKey: boolean;
}

export interface EcosystemStatus {
  sandboxes: SandboxStatus[];
  providers: ProviderStatus[];
}

/**
 * @param model A `provider/model-id` string (validated to contain a slash at load time).
 * @returns The provider id before the first slash, or the whole string when no slash is present.
 */
function providerIdOf(model: string): string {
  const slash = model.indexOf("/");
  return slash > 0 ? model.slice(0, slash) : model;
}

export class Engine {
  readonly project: Project;
  readonly warnings: string[];
  private registry = new ProviderRegistry();
  private log: (line: string) => void;

  constructor(loaded: BuildResult, opts?: { verbose?: boolean }) {
    this.project = loaded.project;
    this.warnings = loaded.warnings;
    for (const provider of this.project.providers.values()) this.registry.register(provider);
    this.log = opts?.verbose ? (line) => process.stderr.write(line + "\n") : () => {};
  }

  /**
   * @param dir An entry `.nt` file (imports are followed) or a directory of `.nt` files.
   * @param opts Options such as verbose tracing and whether imports may escape the project directory.
   * @returns A ready-to-run engine.
   */
  static load(dir: string, opts?: { verbose?: boolean; allowOutsideImports?: boolean }): Engine {
    return new Engine(loadProject(dir, { allowOutsideImports: opts?.allowOutsideImports }), opts);
  }

  /**
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
   * @param name The agent or subagent to run.
   * @param input The run input.
   * @returns The run result.
   */
  async runAgent(name: string, input: Record<string, unknown>): Promise<RunResult> {
    const agent = this.project.agents.get(name) ?? this.project.subagents.get(name);
    if (!agent) throw new NtError(`no agent or subagent named '${name}'`, null);
    this.checkInput(agent.input, input, `${agent.kind} '${name}'`, agent.loc);
    const sandbox = this.makeSandboxFor(agent);
    this.log(
      `▶ running ${agent.kind} '${name}' (model ${resolveModel(this.project, agent)}, sandbox ${sandbox.kind})`,
    );
    return runSession(this.context(), agent, input, sandbox, 0);
  }

  /**
   * @param name The agent or subagent to converse with.
   * @returns A stateful, multi-turn chat session for that agent.
   */
  createChat(name: string): ChatSession {
    const agent = this.project.agents.get(name) ?? this.project.subagents.get(name);
    if (!agent) throw new NtError(`no agent or subagent named '${name}'`, null);
    return new ChatSession(this.context(), agent, this.makeSandboxFor(agent));
  }

  /**
   * @param name The workflow to run.
   * @param input The workflow input.
   * @returns The aggregated result across all steps.
   */
  async runWorkflow(name: string, input: Record<string, unknown>): Promise<RunResult> {
    const workflow = this.project.workflows.get(name);
    if (!workflow) throw new NtError(`no workflow named '${name}'`, null);
    this.checkInput(workflow.input, input, `workflow '${name}'`, workflow.loc);
    this.log(`▶ running workflow '${name}' (${workflow.steps.length} steps)`);

    const vars: Record<string, unknown> = { ...input };
    const usage = { input: 0, output: 0 };
    let steps = 0;
    let lastText = "";

    for (const step of workflow.steps) {
      const agent = this.resolveWorkflowAgent(name, step.agent ?? workflow.agent);
      const base = step.prompt ? interpolate(step.prompt, vars) : buildUserMessage(agent, vars);
      const prompt = step.skill ? this.applySkill(step.skill, base) : base;
      const result = await runSession(
        this.context(),
        agent,
        { message: prompt },
        this.makeSandboxFor(agent),
        0,
      );
      usage.input += result.usage.input;
      usage.output += result.usage.output;
      steps += result.steps;
      lastText = result.text;
      if (step.into) vars[step.into] = result.output ?? result.text;
    }

    return {
      text: lastText,
      output: this.collectWorkflowOutput(workflow.output, vars),
      steps,
      usage,
    };
  }

  /**
   * @returns The instantiated sandboxes and provider credential status.
   */
  bringUp(): EcosystemStatus {
    const sandboxes = [...this.project.sandboxes.values()].map((def) => this.probeSandbox(def));
    const providerIds = new Set<string>(this.project.providers.keys());
    for (const agent of [...this.project.agents.values(), ...this.project.subagents.values()]) {
      const model = agent.model ?? this.project.config.defaults.model;
      if (model) providerIds.add(providerIdOf(model));
    }
    const providers = [...providerIds].map((id) => {
      const status = this.registry.credentialStatus(id);
      return { name: id, api: status.provider.api, hasKey: status.hasKey };
    });
    return { sandboxes, providers };
  }

  private context(): RunContext {
    return { project: this.project, registry: this.registry, log: this.log };
  }

  /**
   * Validates a top-level run input against the declared `input:` fields.
   * Skipped when no input was given, or for the bare `--message` shorthand on
   * a runnable that declares no `message` field — those stay free-form.
   */
  private checkInput(
    fields: FieldSpec[],
    input: Record<string, unknown>,
    what: string,
    loc: Location,
  ): void {
    if (!fields.length) return;
    const keys = Object.keys(input);
    if (keys.length === 0) return;
    if (keys.length === 1 && keys[0] === "message" && !fields.some((f) => f.name === "message"))
      return;
    const problem = validateInput(fields, input);
    if (problem) throw new NtError(`${what} input: ${problem}`, loc);
  }

  private makeSandboxFor(agent: AgentDef): Sandbox {
    const ref = agent.sandbox ?? this.project.config.defaults.sandbox ?? "virtual";
    const declared = this.project.sandboxes.get(ref);
    const def: SandboxDef = declared
      ? { ...declared, cwd: agent.cwd ?? declared.cwd }
      : {
          name: ref,
          type: ref === "local" ? "local" : "virtual",
          description: "",
          cwd: agent.cwd ?? DEFAULT_SANDBOX_CWD,
          env: {},
          loc: agent.loc,
        };
    return makeSandbox(def);
  }

  private probeSandbox(def: SandboxDef): SandboxStatus {
    try {
      const sandbox = makeSandbox(def);
      return { name: def.name, kind: sandbox.kind, cwd: sandbox.cwd, ok: true };
    } catch (e) {
      return {
        name: def.name,
        kind: def.type,
        cwd: def.cwd,
        ok: false,
        error: (e as Error).message,
      };
    }
  }

  private resolveWorkflowAgent(workflow: string, agentName: string | null): AgentDef {
    if (!agentName)
      throw new NtError(
        `workflow '${workflow}' step has no agent and workflow.agent is unset`,
        null,
      );
    const agent = this.project.agents.get(agentName) ?? this.project.subagents.get(agentName);
    if (!agent)
      throw new NtError(`workflow '${workflow}' references unknown agent '${agentName}'`, null);
    return agent;
  }

  private applySkill(skillName: string, prompt: string): string {
    const skill = this.project.skills.get(skillName)!;
    return `Apply the '${skill.name}' skill:\n${skill.instructions}\n\n${prompt}`;
  }

  private collectWorkflowOutput(
    fields: FieldSpec[],
    vars: Record<string, unknown>,
  ): Record<string, unknown> | null {
    if (!fields.length) return null;
    const output: Record<string, unknown> = {};
    for (const f of fields) if (f.name in vars) output[f.name] = vars[f.name];
    return output;
  }
}
