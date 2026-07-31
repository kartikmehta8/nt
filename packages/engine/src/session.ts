/**
 * @file The agentic tool-use loop, shared by one-shot runs and chat turns.
 *
 * `driveConversation` runs the request → execute-tools → repeat loop over a
 * messages array, dispatching built-in, custom, and delegation tools (subagents
 * run as nested sessions) and appending every call to the audit log.
 * `runSession` wraps a single input into one complete run; the chat layer reuses
 * `driveConversation` across turns. The per-run state and prompt building live in
 * `runtime.ts`.
 */

import { auditToolKind } from "#audit/log";
import {
  DELEGATE_PREFIX,
  isBuiltinTool,
  MAX_AGENT_STEPS,
  MAX_DELEGATION_DEPTH,
  type BuiltinToolName,
} from "#constants";
import { NtError } from "#errors";
import { runCustomTool, type ToolOutcome } from "#custom-tools";
import type { ContentBlock, LlmMessage } from "#provider";
import {
  buildRuntime,
  buildUserMessage,
  parseStructuredOutput,
  type AgentRuntime,
  type RunContext,
  type TurnResult,
} from "#runtime";
import type { Sandbox } from "#sandbox";
import type { AgentDef, RunResult, TokenUsage } from "#types";

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
      content: await runToolCalls(context, runtime, sandbox, response.content, depth),
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
 * Tool names in the response are untrusted: only names the runtime offered
 * this agent are dispatched, so a hostile response cannot reach capabilities
 * the agent was not wired to.
 *
 * @returns The tool_result blocks produced by executing every tool_use in a response.
 */
async function runToolCalls(
  context: RunContext,
  runtime: AgentRuntime,
  sandbox: Sandbox,
  content: ContentBlock[],
  depth: number,
): Promise<unknown[]> {
  const results: unknown[] = [];
  for (const block of content) {
    if (block.type !== "tool_use") continue;
    const name = block.name!;
    const input = block.input ?? {};
    context.log(`  ${"  ".repeat(depth)}· ${runtime.name} → ${name}(${JSON.stringify(input)})`);
    const startedAt = Date.now();
    const outcome = runtime.allowedTools.has(name)
      ? await dispatchTool(context, sandbox, name, input, depth)
      : { content: `tool '${name}' is not available to this agent`, isError: true };
    context.audit?.record({
      run: context.runId,
      agent: runtime.name,
      depth,
      tool: name,
      kind: auditToolKind(context.project, name),
      input,
      ok: !outcome.isError,
      durationMs: Date.now() - startedAt,
      output: outcome.content,
    });
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
