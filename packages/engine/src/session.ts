/**
 * @file The agentic tool-use loop, shared by one-shot runs and chat turns.
 *
 * `driveConversation` runs the request → execute-tools → repeat loop over a
 * messages array, resolves only the exact prepared dispatch entry, and appends
 * every attempted call to the audit log. Built-in/custom/MCP permission and
 * execution live in `tool-dispatch.ts`; subagents recurse through this loop.
 * `runSession` wraps one input, while chat reuses the conversation across turns.
 */

import { auditToolKind } from "#audit/log";
import { collectSecrets, createRedactor } from "#audit/redact";
import { DELEGATE_PREFIX, MAX_AGENT_STEPS, MAX_DELEGATION_DEPTH } from "#constants";
import { NtError } from "#errors";
import type { ToolOutcome } from "#custom-tools";
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
import { gatedDispatch } from "#tool-dispatch";
import type { AgentDef, RunResult, TokenUsage } from "#types";

/**
 * Returns the assistant's final text, step count, and token usage for the turn.
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
    context.onStep?.({ kind: "model", agent: runtime.name, detail: runtime.model, depth });
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
 * Drives one bounded agentic model/tool loop and aggregates output and token usage.
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
  const runtime = await buildRuntime(context, agent);
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
    const name = block.name;
    if (!name) continue;
    const input = block.input ?? {};
    const safeInput = createRedactor(collectSecrets(context.project)).input(input).input;
    context.log(`  ${"  ".repeat(depth)}· ${runtime.name} → ${name}(${JSON.stringify(safeInput)})`);
    context.onStep?.(
      name.startsWith(DELEGATE_PREFIX)
        ? {
            kind: "delegation",
            agent: runtime.name,
            detail: name.slice(DELEGATE_PREFIX.length),
            depth,
          }
        : { kind: "tool", agent: runtime.name, detail: name, depth },
    );
    const startedAt = Date.now();
    const entry = runtime.dispatch.get(name);
    const outcome = await gatedDispatch(
      context,
      sandbox,
      name,
      entry,
      input,
      depth,
      (subagent, prompt) => delegate(context, subagent, prompt, sandbox, depth),
    );
    context.audit?.record({
      run: context.runId,
      agent: runtime.name,
      depth,
      tool: name,
      kind: entry?.kind === "mcp" ? "mcp" : auditToolKind(context.project, name),
      input,
      ok: !outcome.isError,
      durationMs: Date.now() - startedAt,
      output: outcome.auditSummary ?? outcome.content,
      server: entry?.kind === "mcp" ? entry.tool.server.name : undefined,
      remoteTool: entry?.kind === "mcp" ? entry.tool.catalog.info.remoteName : undefined,
      transport: entry?.kind === "mcp" ? entry.tool.server.transport : undefined,
      approval: entry?.kind === "mcp" ? entry.tool.catalog.info.approval : undefined,
      protocolVersion: entry?.kind === "mcp" ? entry.tool.protocolVersion : undefined,
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

/**
 * Returns the subagent's response as a tool outcome, sharing the parent sandbox.
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
