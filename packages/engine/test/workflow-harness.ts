/**
 * @file Shared harness for the workflow control-flow suites: assembles a
 * workflow beside a plain and a structured-output agent, replays a scripted
 * provider in-process while tracking total and peak in-flight calls, and runs
 * the workflow with every `workflow-step` event captured. Nothing here
 * reaches the network or the audit log.
 */

import { parseNt } from "#parse/parser";
import { ProviderRegistry, type LlmMessage, type LlmResponse } from "#provider";
import type { RunContext } from "#runtime";
import { VirtualSandbox } from "#sandbox";
import { buildProject } from "#schema/build";
import type { Project, StepEvent } from "#types";
import { executeWorkflow, type WorkflowRuntime } from "#workflow";

export const LOC = { file: "<test>", line: 1 };

export type Handler = (prompt: string, call: number) => LlmResponse | Promise<LlmResponse>;

export const FAN_OUT =
  "  input:\n    items: array\n  output:\n    results: array\n  steps:\n" +
  '    - for_each: items\n      prompt: "{index}:{item}"\n      into: results\n';

const HEADER =
  "config\n  audit: off\n  defaults:\n    model: anthropic/claude-sonnet-5\n" +
  "agent a:\n  description: plain\nagent typed:\n  output:\n    year: number\n";

/**
 * Assembles workflow `w` beside a plain agent `a` and a structured-output agent `typed`.
 * @param body The workflow body, indented two spaces per line.
 * @returns The build result for the single-file project.
 */
export function build(body: string) {
  const source = `${HEADER}workflow w:\n  agent: a\n${body}`;
  return buildProject([{ file: LOC.file, blocks: parseNt(source, LOC.file) }]);
}

/**
 * Builds a plain end-of-turn response carrying one token each way.
 * @param text The assistant text to reply with.
 * @returns The scripted provider response.
 */
export function reply(text: string): LlmResponse {
  return {
    content: [{ type: "text", text }],
    stopReason: "end_turn",
    text,
    usage: { input: 1, output: 1 },
  };
}

function promptOf(messages: LlmMessage[]): string {
  const first = messages[0]?.content;
  return typeof first === "string" ? first : "";
}

/**
 * Creates a registry that replays a handler and tracks total and peak in-flight calls.
 * @param handler Produces each reply from the step prompt and the 1-based call count.
 * @returns The registry and a statistics accessor.
 */
export function scripted(handler: Handler) {
  const registry = new ProviderRegistry();
  let calls = 0;
  let inFlight = 0;
  let peak = 0;
  registry.complete = async (request: { messages: LlmMessage[] }) => {
    calls++;
    inFlight++;
    peak = Math.max(peak, inFlight);
    try {
      return await handler(promptOf(request.messages), calls);
    } finally {
      inFlight--;
    }
  };
  return { registry, stats: () => ({ calls, peak }) };
}

/**
 * Creates workflow services that never reach the network or the audit log.
 * @param project The assembled project.
 * @param registry The scripted provider registry.
 * @param events Receives every step event.
 * @returns The runtime handed to `executeWorkflow`.
 */
export function runtimeOf(
  project: Project,
  registry: ProviderRegistry,
  events: StepEvent[],
): WorkflowRuntime {
  const onStep = (event: StepEvent) => events.push(event);
  const context: RunContext = {
    project,
    registry,
    log: () => {},
    audit: null,
    runId: "wf",
    onStep,
  };
  return {
    project,
    context,
    makeSandbox: () => new VirtualSandbox({ cwd: "/workspace", env: {} }),
    onStep,
  };
}

/**
 * Runs workflow `w` over a scripted provider and captures its step events.
 * @param body The workflow body.
 * @param input The workflow input.
 * @param handler The scripted provider behavior.
 * @returns The run result, the `workflow-step` event details in order, and call statistics.
 */
export async function run(body: string, input: Record<string, unknown>, handler: Handler) {
  const { project } = build(body);
  const { registry, stats } = scripted(handler);
  const events: StepEvent[] = [];
  const workflow = project.workflows.get("w");
  if (!workflow) throw new Error("fixture declares no workflow w");
  const result = await executeWorkflow("w", workflow, input, runtimeOf(project, registry, events));
  const details = events.filter((e) => e.kind === "workflow-step").map((e) => e.detail);
  return { result, events: details, stats: stats() };
}
