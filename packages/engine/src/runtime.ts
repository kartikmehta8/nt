/**
 * @file Everything a run needs resolved before the loop starts.
 *
 * `RunContext` is the shared per-run state (project, providers, tracing, audit
 * log, run id). `buildRuntime` resolves one agent's model, system prompt, tool
 * list, and output schema into an `AgentRuntime`; `buildUserMessage` turns a run
 * input into the first user turn, and `parseStructuredOutput` recovers the typed
 * result from the final assistant text.
 */

import type { AuditLog } from "#audit/log";
import { DEFAULT_MAX_TOKENS, DEFAULT_THINKING } from "#constants";
import { NtError } from "#errors";
import { buildOutputSchema, conformsToOutputSchema, extractJson, interpolate } from "#io";
import type { LlmToolDef, ProviderRegistry } from "#provider";
import { buildToolDefs } from "#tools";
import type { AgentDef, Project, ThinkingLevel, TokenUsage } from "#types";

export interface RunContext {
  project: Project;
  registry: ProviderRegistry;
  log: (line: string) => void;
  audit: AuditLog | null;
  runId: string;
}

export interface AgentRuntime {
  name: string;
  model: string;
  system: string;
  thinking: ThinkingLevel;
  maxTokens: number;
  tools: LlmToolDef[];
  outputSchema: Record<string, unknown> | null;
}

export interface TurnResult {
  text: string;
  steps: number;
  usage: TokenUsage;
}

/**
 * @param context The shared run context.
 * @param agent The agent or subagent to prepare.
 * @returns The resolved model, prompt, tools, and output schema for the agent.
 */
export function buildRuntime(context: RunContext, agent: AgentDef): AgentRuntime {
  const defaults = context.project.config.defaults;
  return {
    name: agent.name,
    model: resolveModel(context.project, agent),
    system: buildSystemPrompt(context.project, agent),
    thinking: agent.thinking ?? defaults.thinking ?? DEFAULT_THINKING,
    maxTokens: agent.maxTokens ?? defaults.maxTokens ?? DEFAULT_MAX_TOKENS,
    tools: buildToolDefs(context.project, agent),
    outputSchema: agent.output.length ? buildOutputSchema(agent.output) : null,
  };
}

/**
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
 * @param project The project the agent belongs to.
 * @param agent The agent to build a system prompt for.
 * @returns The system prompt combining instructions, skills, and the output shape.
 */
function buildSystemPrompt(project: Project, agent: AgentDef): string {
  const parts: string[] = [];
  if (agent.instructions) parts.push(agent.instructions.trim());
  for (const skillName of agent.skills) {
    const skill = project.skills.get(skillName)!;
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
