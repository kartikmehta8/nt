/**
 * @file The agentic tool-use loop, shared by one-shot runs and chat turns.
 *
 * `buildRuntime` resolves an agent's model, system prompt, tool list, and output
 * schema. `driveConversation` runs the request → execute-tools → repeat loop
 * over a messages array, dispatching built-in, custom, and delegation tools
 * (subagents run as nested sessions). `runSession` wraps a single input into one
 * complete run; the chat layer reuses `driveConversation` across turns.
 */

import {
  DEFAULT_MAX_TOKENS,
  DEFAULT_THINKING,
  isBuiltinTool,
  MAX_AGENT_STEPS,
  MAX_DELEGATION_DEPTH,
  type BuiltinToolName,
} from "#constants";
import { NtError } from "#errors";
import { runCustomTool, type ToolOutcome } from "#custom-tools";
import { buildOutputSchema, conformsToOutputSchema, extractJson, interpolate } from "#io";
import type { ContentBlock, LlmMessage, LlmToolDef, ProviderRegistry } from "#provider";
import type { Sandbox } from "#sandbox";
import { buildToolDefs, DELEGATE_PREFIX } from "#tools";
import type { AgentDef, Project, RunResult, ThinkingLevel, TokenUsage } from "#types";

export interface RunContext {
  project: Project;
  registry: ProviderRegistry;
  log: (line: string) => void;
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
 * @param context The shared run context.
 * @param runtime The prepared agent runtime.
 * @param sandbox The workspace the agent operates in.
 * @param messages The conversation so far; new turns are appended in place.
 * @param depth Delegation depth, used to guard against cycles.
 * @returns The assistant's final text, step count, and token usage for the turn.
 */
export async function driveConversation(
  context: RunContext,
  runtime: AgentRuntime,
  sandbox: Sandbox,
  messages: LlmMessage[],
  depth: number,
): Promise<TurnResult> {
  const usage: TokenUsage = { input: 0, output: 0 };
  let steps = 0;
  let lastText = "";

  for (let iter = 0; iter < MAX_AGENT_STEPS; iter++) {
    steps++;
    const response = await context.registry.complete({
      model: runtime.model,
      system: runtime.system,
      messages,
      tools: runtime.tools.length ? runtime.tools : undefined,
      maxTokens: runtime.maxTokens,
      thinking: runtime.thinking,
      outputSchema: runtime.outputSchema,
    });
    usage.input += response.usage.input;
    usage.output += response.usage.output;
    lastText = response.text || lastText;
    messages.push({ role: "assistant", content: response.content });
    if (response.stopReason !== "tool_use") break;
    messages.push({
      role: "user",
      content: await runToolCalls(context, runtime.name, sandbox, response.content, depth),
    });
  }
  return { text: lastText, steps, usage };
}

/**
 * @param context The shared run context.
 * @param agent The agent or subagent to run once.
 * @param input The run input, used to build the first user message.
 * @param sandbox The workspace the agent operates in.
 * @param depth Delegation depth, used to guard against cycles.
 * @returns The final text, parsed structured output, step count, and token usage.
 */
export async function runSession(
  context: RunContext,
  agent: AgentDef,
  input: Record<string, unknown>,
  sandbox: Sandbox,
  depth: number,
): Promise<RunResult> {
  if (depth > MAX_DELEGATION_DEPTH)
    throw new NtError("subagent delegation too deep (possible cycle)", agent.loc);
  const runtime = buildRuntime(context, agent);
  const messages: LlmMessage[] = [{ role: "user", content: buildUserMessage(agent, input) }];
  const turn = await driveConversation(context, runtime, sandbox, messages, depth);
  return { ...turn, output: parseStructuredOutput(runtime.outputSchema, turn.text) };
}

/**
 * @returns The tool_result blocks produced by executing every tool_use in a response.
 */
async function runToolCalls(
  context: RunContext,
  agentName: string,
  sandbox: Sandbox,
  content: ContentBlock[],
  depth: number,
): Promise<unknown[]> {
  const results: unknown[] = [];
  for (const block of content) {
    if (block.type !== "tool_use") continue;
    context.log(
      `  ${"  ".repeat(depth)}· ${agentName} → ${block.name}(${JSON.stringify(block.input)})`,
    );
    const outcome = await dispatchTool(context, sandbox, block.name!, block.input ?? {}, depth);
    results.push({
      type: "tool_result",
      tool_use_id: block.id,
      content: outcome.content,
      is_error: outcome.isError,
    });
  }
  return results;
}

const BUILTIN_HANDLERS: Record<
  BuiltinToolName,
  (sandbox: Sandbox, input: Record<string, unknown>) => ToolOutcome
> = {
  fs_read: (sandbox, input) => ({ content: sandbox.readFile(String(input.path)), isError: false }),
  fs_write: (sandbox, input) => {
    sandbox.writeFile(String(input.path), String(input.content ?? ""));
    return { content: `wrote ${input.path}`, isError: false };
  },
  fs_list: (sandbox) => ({ content: sandbox.listFiles().join("\n") || "(empty)", isError: false }),
  bash: (sandbox, input) => {
    const r = sandbox.exec(String(input.command));
    return {
      content: `exit ${r.code}\n${r.stdout}${r.stderr ? "\n[stderr]\n" + r.stderr : ""}`,
      isError: r.code !== 0,
    };
  },
};

/**
 * @returns The outcome of a single tool invocation.
 */
async function dispatchTool(
  context: RunContext,
  sandbox: Sandbox,
  name: string,
  input: Record<string, unknown>,
  depth: number,
): Promise<ToolOutcome> {
  try {
    if (isBuiltinTool(name)) return BUILTIN_HANDLERS[name](sandbox, input);
    if (name.startsWith(DELEGATE_PREFIX))
      return await delegate(
        context,
        name.slice(DELEGATE_PREFIX.length),
        String(input.prompt ?? ""),
        sandbox,
        depth,
      );
    const custom = context.project.tools.get(name);
    if (custom) return await runCustomTool(custom, sandbox, input);
    return { content: `unknown tool '${name}'`, isError: true };
  } catch (e) {
    return { content: String((e as Error).message), isError: true };
  }
}

/**
 * @returns The subagent's response as a tool outcome, sharing the parent sandbox.
 */
async function delegate(
  context: RunContext,
  subName: string,
  prompt: string,
  sandbox: Sandbox,
  depth: number,
): Promise<ToolOutcome> {
  const sub = context.project.subagents.get(subName);
  if (!sub) return { content: `unknown subagent '${subName}'`, isError: true };
  context.log(`  ${"  ".repeat(depth)}↳ delegating to subagent '${subName}'`);
  const result = await runSession(context, sub, { message: prompt }, sandbox, depth + 1);
  return { content: result.text || JSON.stringify(result.output), isError: false };
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
