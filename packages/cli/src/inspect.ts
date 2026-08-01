/**
 * @file The offline inspection commands: `validate`, `list`, and `graph`.
 *
 * Each loads a project from the given path without touching the model, then
 * prints what it declares — validation counts, the entity listing, or the
 * agent → subagent / tool / sandbox wiring — through the format helpers.
 */

import { loadProject, type AgentDef, type Project } from "@age.nt/engine";
import { bold, cyan, dim, green, out, printWarnings } from "#format";
import { resolveEntry, type Args } from "#args";

/**
 * @param title The section heading.
 * @param items The lines to print under the heading, if any.
 */
function section(title: string, items: string[]): void {
  if (items.length === 0) return;
  out(bold(title));
  for (const item of items) out("  " + item);
  out("");
}

/**
 * @param args The parsed arguments.
 */
export function cmdValidate(args: Args): void {
  const { project, warnings } = loadProject(resolveEntry(args), {
    allowOutsideImports: args.allowOutsideImports,
  });
  printWarnings(warnings);
  out(green(`✓ ${project.files.length} file(s) OK`));
  out(dim("  " + summary(project)));
}

/**
 * @param project The loaded project.
 * @returns A one-line count of every entity kind.
 */
function summary(project: Project): string {
  return (
    `${project.agents.size} agents · ${project.subagents.size} subagents · ${project.tools.size} tools · ` +
    `${project.skills.size} skills · ${project.sandboxes.size} sandboxes · ` +
    `${project.workflows.size} workflows · ${project.providers.size} providers`
  );
}

/**
 * @param args The parsed arguments.
 */
export function cmdList(args: Args): void {
  const { project, warnings } = loadProject(resolveEntry(args), {
    allowOutsideImports: args.allowOutsideImports,
  });
  printWarnings(warnings);
  const described = (x: { name: string; description?: string; model?: string | null }) =>
    `${cyan(x.name)} ${dim("— " + (x.description || x.model || ""))}`;
  section("Agents", [...project.agents.values()].map(described));
  section("Subagents", [...project.subagents.values()].map(described));
  section("Workflows", [...project.workflows.values()].map(described));
  section(
    "Tools",
    [...project.tools.values()].map((x) => `${x.name} ${dim("(" + x.type + ")")}`),
  );
  section(
    "Skills",
    [...project.skills.values()].map((x) => x.name),
  );
  section(
    "Sandboxes",
    [...project.sandboxes.values()].map((x) => `${x.name} ${dim(`(${x.type} @ ${x.cwd})`)}`),
  );
  section(
    "Providers",
    [...project.providers.values()].map((x) => `${x.name} ${dim("(" + x.api + ")")}`),
  );
}

/**
 * @param args The parsed arguments.
 */
export function cmdGraph(args: Args): void {
  const { project, warnings } = loadProject(resolveEntry(args), {
    allowOutsideImports: args.allowOutsideImports,
  });
  printWarnings(warnings);
  for (const agent of project.agents.values()) renderAgent(agent, project);
  for (const agent of project.subagents.values()) renderAgent(agent, project);
  for (const workflow of project.workflows.values()) {
    out(bold("▶ workflow " + workflow.name));
    workflow.steps.forEach((step, i) => {
      const who = step.agent ?? workflow.agent ?? "(default)";
      out(
        `  ${i + 1}. ${cyan(who)}${step.skill ? " +skill:" + step.skill : ""}${step.into ? dim(" → " + step.into) : ""}`,
      );
    });
    out("");
  }
}

/**
 * @param agent The agent or subagent to render.
 * @param project The project it belongs to.
 */
function renderAgent(agent: AgentDef, project: Project): void {
  out(bold(agent.kind === "agent" ? "◆ " + agent.name : "◇ " + agent.name));
  out("  " + dim("model:   ") + (agent.model ?? project.config.defaults.model ?? "(default)"));
  out("  " + dim("sandbox: ") + (agent.sandbox ?? project.config.defaults.sandbox ?? "virtual"));
  if (agent.tools.length) out("  " + dim("tools:   ") + agent.tools.join(", "));
  if (agent.skills.length) out("  " + dim("skills:  ") + agent.skills.join(", "));
  for (const sub of agent.subagents) out("  ↳ " + cyan(sub));
  out("");
}
