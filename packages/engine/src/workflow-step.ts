/**
 * @file Execution of one workflow step: a single run, a bounded retry loop,
 * or a bounded parallel fan-out over a list.
 *
 * `runStep` resolves the prompt and optional skill, drives the shared session
 * loop, and — when `retry` is declared — treats a thrown error or a missing
 * structured result as a failed attempt until the retry budget is spent.
 * `runForEach` runs that same step once per list element with `{item}` and
 * `{index}` in scope, at most `FOR_EACH_CONCURRENCY` at a time, and returns
 * the results in input order regardless of completion order. Both report
 * progress through `workflow-step` events so the CLI can name each attempt.
 */

import { FOR_EACH_CONCURRENCY, MAX_FOR_EACH_ITEMS } from "#constants";
import { NtError } from "#errors";
import { interpolate, renderValue } from "#io";
import { buildUserMessage } from "#runtime";
import { runSession } from "#session";
import type { AgentDef, Location, Project, RunResult, TokenUsage, WorkflowStep } from "#types";
import type { WorkflowRuntime } from "#workflow";

export interface StepOutcome {
  value: unknown;
  text: string;
  steps: number;
  usage: TokenUsage;
}

export interface StepRun {
  workflow: string;
  label: string;
  step: WorkflowStep;
  agent: AgentDef;
  loc: Location;
  runtime: WorkflowRuntime;
}

/**
 * Runs one step, retrying failed attempts up to the step's declared budget.
 * @param run The step, its resolved agent, and the shared workflow services.
 * @param vars The workflow variables visible to this attempt.
 * @returns The value to store under `into`, plus aggregated usage across attempts.
 */
export async function runStep(run: StepRun, vars: Record<string, unknown>): Promise<StepOutcome> {
  const budget = run.step.retry ?? 0;
  const strict = run.step.retry !== undefined;
  const usage: TokenUsage = { input: 0, output: 0 };
  let steps = 0;
  let lastError: unknown;
  for (let attempt = 1; attempt <= budget + 1; attempt++) {
    if (attempt > 1) report(run, `${run.label} retry ${attempt - 1}/${budget}`);
    try {
      const result = await runOnce(run, vars);
      usage.input += result.usage.input;
      usage.output += result.usage.output;
      steps += result.steps;
      if (strict && run.agent.output.length && result.output === null)
        throw new NtError(
          `${run.agent.kind} '${run.agent.name}' returned no structured output`,
          run.agent.loc,
        );
      return { value: result.output ?? result.text, text: result.text, steps, usage };
    } catch (error) {
      lastError = error;
    }
  }
  throw new NtError(
    `workflow '${run.workflow}' ${run.label} failed after ${budget + 1} attempt(s): ${describeError(lastError)}`,
    run.loc,
  );
}

/**
 * Runs one step once per element of the list named by `for_each`.
 * @param run The step, its resolved agent, and the shared workflow services.
 * @param vars The workflow variables; each item adds `item` and `index`.
 * @returns The per-item values in input order, plus aggregated usage.
 */
export async function runForEach(
  run: StepRun,
  vars: Record<string, unknown>,
): Promise<StepOutcome> {
  const name = run.step.forEach ?? "";
  const list = vars[name];
  if (!Array.isArray(list))
    throw new NtError(
      `workflow '${run.workflow}' ${run.label} for_each '${name}' must be a list, got ${describeType(list)}`,
      run.loc,
    );
  if (list.length > MAX_FOR_EACH_ITEMS)
    throw new NtError(
      `workflow '${run.workflow}' ${run.label} for_each '${name}' has ${list.length} items (limit ${MAX_FOR_EACH_ITEMS})`,
      run.loc,
    );
  report(run, `${run.label} · ${list.length} item(s)`);
  const values = new Array<unknown>(list.length);
  const usage: TokenUsage = { input: 0, output: 0 };
  let steps = 0;
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < list.length) {
      const index = next++;
      const label = `${run.label} · item ${index + 1}/${list.length}`;
      const itemRun = { ...run, label };
      report(itemRun, label);
      const outcome = await runStep(itemRun, { ...vars, item: list[index], index });
      values[index] = outcome.value;
      usage.input += outcome.usage.input;
      usage.output += outcome.usage.output;
      steps += outcome.steps;
    }
  };
  const workers = Array.from({ length: Math.min(FOR_EACH_CONCURRENCY, list.length) }, worker);
  const settled = await Promise.allSettled(workers);
  const failure = settled.find((entry) => entry.status === "rejected");
  if (failure) throw failure.reason;
  return { value: values, text: renderValue(values), steps, usage };
}

/**
 * Applies a skill's instructions ahead of a step prompt.
 * @param project The project that declares the skill.
 * @param skillName The skill to apply.
 * @param prompt The already interpolated step prompt.
 * @returns The prompt prefixed with the skill's instructions.
 */
export function applySkill(project: Project, skillName: string, prompt: string): string {
  const skill = project.skills.get(skillName);
  if (!skill) throw new NtError(`unknown skill '${skillName}'`, null);
  return `Apply the '${skill.name}' skill:\n${skill.instructions}\n\n${prompt}`;
}

async function runOnce(run: StepRun, vars: Record<string, unknown>): Promise<RunResult> {
  const { step, agent, runtime } = run;
  const base = step.prompt ? interpolate(step.prompt, vars) : buildUserMessage(agent, vars);
  const prompt = step.skill ? applySkill(runtime.project, step.skill, base) : base;
  return runSession(runtime.context, agent, { message: prompt }, runtime.makeSandbox(agent), 0);
}

function report(run: StepRun, detail: string): void {
  run.runtime.onStep?.({ kind: "workflow-step", agent: run.agent.name, detail, depth: 0 });
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function describeType(value: unknown): string {
  if (value === undefined) return "nothing";
  if (value === null) return "null";
  return Array.isArray(value) ? "list" : typeof value;
}
