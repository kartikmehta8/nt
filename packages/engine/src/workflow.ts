/**
 * @file Sequential workflow execution over an isolated variable map.
 *
 * Seeds only declared inputs, walks the steps in order, and applies each
 * step's control flow: a `when` condition is evaluated once and skips the
 * step (leaving its `into` unset) when false, `for_each` fans the step out
 * over a list, and `retry` re-runs failed attempts — all through
 * `workflow-step.ts`. Only declared `into` results are copied forward, and
 * steps and token usage are aggregated while engine-owned provider, MCP,
 * audit, sandbox, and progress services arrive through `WorkflowRuntime`.
 */

import { NtError } from "#errors";
import type { RunContext } from "#runtime";
import type { Sandbox } from "#sandbox";
import type { AgentDef, FieldSpec, Project, RunResult, WorkflowDef } from "#types";
import { evaluateCondition } from "#workflow-condition";
import { runForEach, runStep, type StepRun } from "#workflow-step";

export interface WorkflowRuntime {
  project: Project;
  context: RunContext;
  makeSandbox: (agent: AgentDef) => Sandbox;
  onStep?: RunContext["onStep"];
}

/**
 * Executes ordered workflow steps while carrying validated input and saved results forward.
 * @param name The workflow name used in diagnostics.
 * @param workflow The validated workflow definition.
 * @param input Caller-provided workflow inputs.
 * @param runtime Engine services shared by every step.
 * @returns The aggregated result across all workflow steps.
 */
export async function executeWorkflow(
  name: string,
  workflow: WorkflowDef,
  input: Record<string, unknown>,
  runtime: WorkflowRuntime,
): Promise<RunResult> {
  const vars = seedVariables(workflow.input, input);
  const usage = { input: 0, output: 0 };
  let steps = 0;
  let lastText = "";
  for (const [index, step] of workflow.steps.entries()) {
    const agent = resolveAgent(runtime.project, name, step.agent ?? workflow.agent);
    const label = `step ${index + 1}/${workflow.steps.length}`;
    const run: StepRun = { workflow: name, label, step, agent, loc: workflow.loc, runtime };
    if (step.when && !evaluateCondition(step.when, vars)) {
      runtime.onStep?.({
        kind: "workflow-step",
        agent: agent.name,
        detail: `${label} skipped (when ${step.when.source})`,
        depth: 0,
      });
      continue;
    }
    if (!step.forEach)
      runtime.onStep?.({ kind: "workflow-step", agent: agent.name, detail: label, depth: 0 });
    const outcome = step.forEach ? await runForEach(run, vars) : await runStep(run, vars);
    usage.input += outcome.usage.input;
    usage.output += outcome.usage.output;
    steps += outcome.steps;
    lastText = outcome.text;
    if (step.into) vars[step.into] = outcome.value;
  }
  return {
    text: lastText,
    output: collectOutput(workflow.output, vars),
    steps,
    usage,
  };
}

function seedVariables(
  fields: FieldSpec[],
  input: Record<string, unknown>,
): Record<string, unknown> {
  const vars: Record<string, unknown> = {};
  for (const field of fields) if (field.name in input) vars[field.name] = input[field.name];
  if (!("message" in vars) && typeof input.message === "string") vars.message = input.message;
  return vars;
}

function resolveAgent(project: Project, workflow: string, agentName: string | null): AgentDef {
  if (!agentName)
    throw new NtError(`workflow '${workflow}' step has no agent and workflow.agent is unset`, null);
  const agent = project.agents.get(agentName) ?? project.subagents.get(agentName);
  if (!agent)
    throw new NtError(`workflow '${workflow}' references unknown agent '${agentName}'`, null);
  return agent;
}

function collectOutput(
  fields: FieldSpec[],
  vars: Record<string, unknown>,
): Record<string, unknown> | null {
  if (!fields.length) return null;
  const output: Record<string, unknown> = {};
  for (const field of fields) if (field.name in vars) output[field.name] = vars[field.name];
  return output;
}
