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
import {
  buildRuntime,
  driveConversation,
  parseStructuredOutput,
  type AgentRuntime,
  type RunContext,
} from "#session";
import type { AgentDef, RunResult } from "#types";

export class ChatSession {
  private context: RunContext;
  private runtime: AgentRuntime;
  private sandbox: Sandbox;
  private messages: LlmMessage[] = [];

  constructor(context: RunContext, agent: AgentDef, sandbox: Sandbox) {
    this.context = context;
    this.runtime = buildRuntime(context, agent);
    this.sandbox = sandbox;
  }

  /**
   * @returns The name of the agent this session is chatting with.
   */
  get agentName(): string {
    return this.runtime.name;
  }

  /**
   * @param text The user's next message; the full history is preserved across calls.
   * @returns The agent's reply text, parsed output, step count, and token usage.
   */
  async send(text: string): Promise<RunResult> {
    this.messages.push({ role: "user", content: text });
    const turn = await driveConversation(
      this.context,
      this.runtime,
      this.sandbox,
      this.messages,
      0,
    );
    return { ...turn, output: parseStructuredOutput(this.runtime.outputSchema, turn.text) };
  }
}
