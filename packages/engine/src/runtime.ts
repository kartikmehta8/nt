/**
 * @file Everything a run needs resolved before the loop starts.
 *
 * `RunContext` is the shared per-run state (project, providers, tracing, audit
 * log, run id). `buildRuntime` resolves one agent's model, system prompt, tool
 * list, exact dispatch map, selected MCP catalog, optional trusted-server
 * instructions, and output schema into an asynchronous `AgentRuntime`;
 * `buildUserMessage` creates the first user turn and `parseStructuredOutput`
 * recovers the typed final result.
 */

import type { AuditLog } from "#audit/log";
import { DEFAULT_MAX_TOKENS, DEFAULT_THINKING } from "#constants";
import { NtError } from "#errors";
import { buildOutputSchema, conformsToOutputSchema, extractJson, interpolate } from "#io";
import type { LlmToolDef, ProviderRegistry } from "#provider";
import { buildToolDefs } from "#tools";
import type { PreparedMcpTool } from "#mcp/manager";
import type { McpManager } from "#mcp/manager";
import { parseMcpReference } from "#mcp/names";
import type {
  AgentDef,
  ConfirmRequest,
  Project,
  StepEvent,
  ThinkingLevel,
  TokenUsage,
} from "#types";

export interface RunContext {
  project: Project;
  registry: ProviderRegistry;
  log: (line: string) => void;
  audit: AuditLog | null;
  runId: string;
  onStep?: (event: StepEvent) => void;
  confirm?: (request: ConfirmRequest) => Promise<boolean>;
  mcp?: McpManager;
}

export type ToolDispatch =
  | { kind: "builtin"; name: string; agent: string }
  | { kind: "custom"; name: string; agent: string }
  | { kind: "delegate"; subagent: string; agent: string }
  | { kind: "mcp"; tool: PreparedMcpTool; agent: string };

export interface AgentRuntime {
  name: string;
  model: string;
  system: string;
  thinking: ThinkingLevel;
  maxTokens: number;
  tools: LlmToolDef[];
  dispatch: Map<string, ToolDispatch>;
  outputSchema: Record<string, unknown> | null;
}

export interface TurnResult {
  text: string;
  steps: number;
  usage: TokenUsage;
}

/**
 * Resolves one agent's model, prompts, tools, sandbox, and execution callbacks.
 * @param context The shared run context.
 * @param agent The agent or subagent to prepare.
 * @returns The resolved model, prompt, tools, and output schema for the agent.
 */
export function buildRuntime(
  context: RunContext,
  agent: AgentDef,
): AgentRuntime | Promise<AgentRuntime> {
  const defaults = context.project.config.defaults;
  const tools = buildToolDefs(context.project, agent);
  const dispatch = new Map<string, ToolDispatch>();
  for (const name of agent.tools) {
    if (parseMcpReference(name) && !context.project.tools.has(name)) continue;
    dispatch.set(
      name,
      context.project.tools.has(name)
        ? { kind: "custom", name, agent: agent.name }
        : { kind: "builtin", name, agent: agent.name },
    );
  }
  for (const subagent of agent.subagents)
    dispatch.set(`delegate_to_${subagent}`, { kind: "delegate", subagent, agent: agent.name });
  const finish = (mcp: { tools: PreparedMcpTool[]; instructions: string[] }): AgentRuntime => {
    for (const prepared of mcp.tools) {
      if (
        dispatch.has(prepared.definition.name) ||
        tools.some((tool) => tool.name === prepared.definition.name)
      )
        throw new NtError(
          `model-facing tool name collision '${prepared.definition.name}'`,
          agent.loc,
        );
      tools.push(prepared.definition);
      dispatch.set(prepared.definition.name, { kind: "mcp", tool: prepared, agent: agent.name });
    }
    let system = buildSystemPrompt(context.project, agent);
    if (mcp.instructions.length)
      system = [system, ...mcp.instructions].filter(Boolean).join("\n\n");
    return {
      name: agent.name,
      model: resolveModel(context.project, agent),
      system,
      thinking: agent.thinking ?? defaults.thinking ?? DEFAULT_THINKING,
      maxTokens: agent.maxTokens ?? defaults.maxTokens ?? DEFAULT_MAX_TOKENS,
      tools,
      dispatch,
      outputSchema: agent.output.length ? buildOutputSchema(agent.output) : null,
    };
  };
  const hasMcp = agent.tools.some((name) => {
    const parsed = parseMcpReference(name);
    return parsed !== null && context.project.mcpServers.has(parsed.server);
  });
  return hasMcp && context.mcp
    ? context.mcp.prepare(agent.tools).then(finish)
    : finish({ tools: [], instructions: [] });
}

/**
 * Resolves model from the available configuration.
 * @param project The project, used to resolve the default model.
 * @param agent The agent whose model is needed.
 * @returns The full `provider/model-id` string for the agent.
 */
export function resolveModel(project: Project, agent: AgentDef): string {
  const model = agent.model ?? project.config.defaults.model;
  if (!model)
    throw new NtError(
      `agent '${agent.name}' has no model and config.defaults.model is unset`,
      agent.loc,
    );
  return model;
}

/**
 * Parses structured output into its validated internal representation.
 * @param schema The agent's output schema, or null.
 * @param text The assistant's final text.
 * @returns The parsed structured output, or null when absent, unparseable, or not matching the schema.
 */
export function parseStructuredOutput(
  schema: Record<string, unknown> | null,
  text: string,
): Record<string, unknown> | null {
  if (!schema) return null;
  const parsed = extractJson(text);
  if (!parsed || !conformsToOutputSchema(parsed, schema)) return null;
  return parsed;
}

/**
 * Composes trusted agent guidance and explicitly delimited untrusted MCP instructions.
 * @param project The project the agent belongs to.
 * @param agent The agent to build a system prompt for.
 * @returns The system prompt combining instructions, skills, and the output shape.
 */
function buildSystemPrompt(project: Project, agent: AgentDef): string {
  const parts: string[] = [];
  if (agent.instructions) parts.push(agent.instructions.trim());
  for (const skillName of agent.skills) {
    const skill = project.skills.get(skillName);
    if (!skill) throw new NtError(`unknown skill '${skillName}'`, agent.loc);
    parts.push(`## Skill: ${skill.name}\n${skill.description}\n\n${skill.instructions}`.trim());
  }
  if (agent.output.length) {
    const lines = agent.output.map(
      (f) => `- ${f.name} (${f.type})${f.description ? ": " + f.description : ""}`,
    );
    parts.push(`When finished, produce a result matching this shape:\n${lines.join("\n")}`);
  }
  return parts.join("\n\n");
}

/**
 * Converts validated run input into the initial user message sent to the model.
 * @param agent The agent whose message template is used, if any.
 * @param input The run input.
 * @returns The first user message text for the agent.
 */
export function buildUserMessage(agent: AgentDef, input: Record<string, unknown>): string {
  if (typeof input.message === "string" && agent.message === null) return input.message;
  if (agent.message) return interpolate(agent.message, input);
  const keys = Object.keys(input);
  if (keys.length === 0) return "Begin.";
  if (keys.length === 1 && keys[0] === "message") return String(input.message);
  return "Input:\n" + JSON.stringify(input, null, 2);
}
