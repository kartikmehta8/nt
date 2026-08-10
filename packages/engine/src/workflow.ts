/**
 * @file Sequential workflow execution over an isolated variable map.
 *
 * Seeds only declared inputs, resolves each step's agent and optional skill,
 * interpolates the step prompt, runs the shared session loop, and copies only
 * declared `into` outputs forward. It aggregates steps and token usage while
 * receiving engine-owned provider, MCP, audit, sandbox, and progress services
 * through `WorkflowRuntime`.
 */

import { NtError } from "#errors";
import { interpolate } from "#io";
import { buildUserMessage, type RunContext } from "#runtime";
import type { Sandbox } from "#sandbox";
import { runSession } from "#session";
import type { AgentDef, FieldSpec, Project, RunResult, WorkflowDef } from "#types";

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
    runtime.onStep?.({
      kind: "workflow-step",
      agent: agent.name,
      detail: `step ${index + 1}/${workflow.steps.length}`,
      depth: 0,
    });
    const base = step.prompt ? interpolate(step.prompt, vars) : buildUserMessage(agent, vars);
    const prompt = step.skill ? applySkill(runtime.project, step.skill, base) : base;
    const result = await runSession(
      runtime.context,
      agent,
      { message: prompt },
      runtime.makeSandbox(agent),
      0,
    );
    usage.input += result.usage.input;
    usage.output += result.usage.output;
    steps += result.steps;
    lastText = result.text;
    if (step.into) vars[step.into] = result.output ?? result.text;
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

function applySkill(project: Project, skillName: string, prompt: string): string {
  const skill = project.skills.get(skillName);
  if (!skill) throw new NtError(`unknown skill '${skillName}'`, null);
  return `Apply the '${skill.name}' skill:\n${skill.instructions}\n\n${prompt}`;
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
