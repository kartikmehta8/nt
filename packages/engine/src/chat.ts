/**
 * @file A stateful, multi-turn conversation with a single agent.
 *
 * `ChatSession` keeps the full message history in memory and, on each `send`,
 * appends the user turn and drives the shared conversation loop — so tools and
 * subagent delegation run every turn while earlier context is preserved. Created
 * by `Engine.createChat` and driven by the `nt chat` REPL.
 */

import type { LlmMessage } from "#provider";
import type { Sandbox } from "#sandbox";
import { buildRuntime, parseStructuredOutput, type AgentRuntime, type RunContext } from "#runtime";
import { driveConversation } from "#session";
import type { AgentDef, RunResult } from "#types";

/**
 * Stateful conversation facade that preserves model history and sandbox state
 * until its owning `Engine` is closed.
 */
export class ChatSession {
  private context: RunContext;
  private runtime: Promise<AgentRuntime>;
  private sandbox: Sandbox;
  private agent: AgentDef;
  private messages: LlmMessage[] = [];

  /**
   * Binds one agent and sandbox to a fresh, initially empty message history.
   *
   * @param context Shared engine services used for model and tool execution.
   * @param agent Agent definition that handles every turn.
   * @param sandbox Persistent sandbox shared across the conversation.
   */
  constructor(context: RunContext, agent: AgentDef, sandbox: Sandbox) {
    this.context = context;
    this.agent = agent;
    this.runtime = Promise.resolve(buildRuntime(context, agent));
    this.sandbox = sandbox;
  }

  /**
   * Returns the name of the agent this session is chatting with.
   * @returns The name of the agent this session is chatting with.
   */
  get agentName(): string {
    return this.agent.name;
  }

  /**
   * Returns the agent's reply text, parsed output, step count, and token usage.
   * @param text The user's next message; the full history is preserved across calls.
   * @returns The agent's reply text, parsed output, step count, and token usage.
   */
  async send(text: string): Promise<RunResult> {
    const runtime = await this.runtime;
    this.messages.push({ role: "user", content: text });
    const turn = await driveConversation(this.context, runtime, this.sandbox, this.messages, 0);
    return { ...turn, output: parseStructuredOutput(runtime.outputSchema, turn.text) };
  }
}
