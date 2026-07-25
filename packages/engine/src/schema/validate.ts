/**
 * @file Cross-reference validation for a fully assembled project.
 *
 * Verifies every agent and subagent references known tools (or built-ins),
 * subagents, skills, and sandboxes; that workflow steps name known agents and
 * skills; that each model uses a built-in or declared provider; and that
 * agents needing tool calls or structured output do not target an
 * `openai-completions` provider, where the engine silently supports neither.
 */

import { BUILTIN_TOOL_NAMES } from "#constants";
import { NtError } from "#errors";
import type { AgentDef, Location, Project } from "#types";

const BUILTINS = new Set<string>(BUILTIN_TOOL_NAMES);
const BUILTIN_PROVIDERS = new Set(["anthropic", "openai"]);
const INLINE_SANDBOXES = new Set(["virtual", "local"]);

/**
 * @param project The assembled project whose references should be checked.
 */
export function validateRefs(project: Project): void {
  for (const agent of project.agents.values()) validateAgent(agent, project);
  for (const agent of project.subagents.values()) validateAgent(agent, project);
  for (const workflow of project.workflows.values()) validateWorkflow(workflow, project);

  const defaultSandbox = project.config.defaults.sandbox;
  if (
    defaultSandbox &&
    !project.sandboxes.has(defaultSandbox) &&
    !INLINE_SANDBOXES.has(defaultSandbox)
  )
    throw new NtError(
      `config.defaults.sandbox references unknown sandbox '${defaultSandbox}'`,
      project.config.loc,
    );
}

/**
 * @param agent The agent or subagent to validate.
 * @param project The project it belongs to.
 */
function validateAgent(agent: AgentDef, project: Project): void {
  for (const tool of agent.tools)
    if (!BUILTINS.has(tool) && !project.tools.has(tool))
      throw new NtError(
        `${agent.kind} '${agent.name}' references unknown tool '${tool}'`,
        agent.loc,
      );
  for (const sub of agent.subagents)
    if (!project.subagents.has(sub))
      throw new NtError(
        `${agent.kind} '${agent.name}' references unknown subagent '${sub}'`,
        agent.loc,
      );
  for (const skill of agent.skills)
    if (!project.skills.has(skill))
      throw new NtError(
        `${agent.kind} '${agent.name}' references unknown skill '${skill}'`,
        agent.loc,
      );
  if (
    agent.sandbox &&
    !project.sandboxes.has(agent.sandbox) &&
    !INLINE_SANDBOXES.has(agent.sandbox)
  )
    throw new NtError(
      `${agent.kind} '${agent.name}' references unknown sandbox '${agent.sandbox}'`,
      agent.loc,
    );
  const model = agent.model ?? project.config.defaults.model;
  if (model) {
    checkModel(model, agent.loc, project);
    checkProviderCapabilities(agent, model, project);
  }
}

/**
 * @param agent The agent whose declared capabilities must be supported.
 * @param model The resolved `provider/model-id` string.
 * @param project The project, used to resolve the provider's API kind.
 */
function checkProviderCapabilities(agent: AgentDef, model: string, project: Project): void {
  const providerId = model.slice(0, model.indexOf("/"));
  const api =
    project.providers.get(providerId)?.api ??
    (providerId === "openai" ? "openai-completions" : "anthropic");
  if (api !== "openai-completions") return;
  const needs = [
    agent.tools.length ? "tools" : null,
    agent.subagents.length ? "subagents" : null,
    agent.output.length ? "structured output" : null,
  ].filter((n) => n !== null);
  if (needs.length)
    throw new NtError(
      `${agent.kind} '${agent.name}' declares ${needs.join(", ")}, but provider '${providerId}' uses the openai-completions API, which this engine calls without tool or structured-output support — use an anthropic-API provider or drop these fields`,
      agent.loc,
    );
}

/**
 * @param workflow The workflow to validate.
 * @param project The project it belongs to.
 */
function validateWorkflow(
  workflow: {
    name: string;
    agent: string | null;
    steps: { agent?: string; skill?: string }[];
    loc: Location;
  },
  project: Project,
): void {
  const knows = (n: string) => project.agents.has(n) || project.subagents.has(n);
  if (workflow.agent && !knows(workflow.agent))
    throw new NtError(
      `workflow '${workflow.name}' references unknown agent '${workflow.agent}'`,
      workflow.loc,
    );
  for (const step of workflow.steps) {
    if (step.agent && !knows(step.agent))
      throw new NtError(
        `workflow '${workflow.name}' step references unknown agent '${step.agent}'`,
        workflow.loc,
      );
    if (step.skill && !project.skills.has(step.skill))
      throw new NtError(
        `workflow '${workflow.name}' step references unknown skill '${step.skill}'`,
        workflow.loc,
      );
  }
}

/**
 * @param model A `provider/model-id` string.
 * @param loc Source location for error messages.
 * @param project The project, used to check declared providers.
 */
function checkModel(model: string, loc: Location, project: Project): void {
  const slash = model.indexOf("/");
  if (slash <= 0)
    throw new NtError(
      `model '${model}' must be in the form 'provider/model-id' (e.g. anthropic/claude-opus-4-8)`,
      loc,
    );
  const provider = model.slice(0, slash);
  if (!BUILTIN_PROVIDERS.has(provider) && !project.providers.has(provider))
    throw new NtError(
      `model '${model}' uses provider '${provider}' which is not built-in and not declared`,
      loc,
    );
}
