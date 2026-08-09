/**
 * @file The offline inspection commands: `validate`, `list`, and `graph`.
 *
 * Each loads a project from the given path without touching the model, then
 * prints what it declares — validation counts, the entity listing including
 * MCP source selections, or agent → subagent/tool/MCP/sandbox wiring — through
 * the format helpers. Dynamic MCP catalogs remain exclusive to `nt mcp` so the
 * editor-like inspection path never starts a process or opens a socket.
 */

import { loadProject, type AgentDef, type Project } from "@age.nt/engine";
import { bold, cyan, dim, green, out, printWarnings } from "#format";
import { resolveEntry, type Args } from "#args";

/**
 * Prints a titled inspection section only when it contains declarations.
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
 * Loads the project and reports validation warnings without running it.
 * @param args The parsed arguments.
 * @returns Nothing; validation results are printed to standard output.
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
 * Returns a one-line count of every entity kind.
 * @param project The loaded project.
 * @returns A one-line count of every entity kind.
 */
function summary(project: Project): string {
  return (
    `${project.agents.size} agents · ${project.subagents.size} subagents · ${project.tools.size} tools · ` +
    `${project.mcpServers.size} MCP servers · ` +
    `${project.skills.size} skills · ${project.sandboxes.size} sandboxes · ` +
    `${project.workflows.size} workflows · ${project.providers.size} providers`
  );
}

/**
 * Prints every loaded declaration grouped by its NT entity kind.
 * @param args The parsed arguments.
 * @returns Nothing; project declarations are printed by category.
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
    "MCP servers",
    [...project.mcpServers.values()].map(
      (x) => `${x.name} ${dim(`(${x.transport}, ${x.tools.size} selection(s))`)}`,
    ),
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
 * Prints a readable graph of agent, workflow, tool, and MCP relationships.
 * @param args The parsed arguments.
 * @returns Nothing; the dependency graph is rendered to standard output.
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
 * Formats an agent or subagent with its resolved model and attached capabilities.
 * @param agent The agent or subagent to render.
 * @param project The project it belongs to.
 */
function renderAgent(agent: AgentDef, project: Project): void {
  out(bold(agent.kind === "agent" ? "◆ " + agent.name : "◇ " + agent.name));
  out("  " + dim("model:   ") + (agent.model ?? project.config.defaults.model ?? "(default)"));
  out("  " + dim("sandbox: ") + (agent.sandbox ?? project.config.defaults.sandbox ?? "virtual"));
  if (agent.tools.length) out("  " + dim("tools:   ") + agent.tools.join(", "));
  for (const tool of agent.tools) {
    const dot = tool.indexOf(".");
    const server = dot > 0 ? project.mcpServers.get(tool.slice(0, dot)) : undefined;
    if (server) out(`  ↳ mcp ${cyan(tool.slice(0, dot))} ${dim(`(${server.transport})`)}`);
  }
  if (agent.skills.length) out("  " + dim("skills:  ") + agent.skills.join(", "));
  for (const sub of agent.subagents) out("  ↳ " + cyan(sub));
  out("");
}
