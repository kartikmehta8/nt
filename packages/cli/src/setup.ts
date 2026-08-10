/**
 * @file The `nt setup` command: write a starter project and check it loads.
 *
 * Scaffolds the chosen template into the given folder (the current one by
 * default), reporting each file as created or left alone, then loads the result
 * so a fresh project is proven valid before the next steps are printed. Offline:
 * scaffolding and validation never reach the model.
 */

import * as nodePath from "node:path";
import { loadProject, scaffoldProject, type Project, type ScaffoldResult } from "@age.nt/engine";
import type { Args } from "#args";
import { bold, cyan, dim, green, out, printWarnings, yellow } from "#format";

/**
 * Returns the name to run first: the configured entry, or the first declared agent.
 * @param project The freshly scaffolded project.
 * @returns The name to run first: the configured entry, or the first declared agent.
 */
function entryName(project: Project): string {
  return project.config.entry ?? [...project.agents.keys()][0] ?? "age";
}

/**
 * Returns the shortest way to name that folder from the current one, or null when it is the current one.
 * @param dir The absolute folder the project was written to.
 * @returns The shortest way to name that folder from the current one, or null when it is the current one.
 */
function changeDirectoryTo(dir: string): string | null {
  const relative = nodePath.relative(process.cwd(), dir);
  if (relative === "") return null;
  return relative.startsWith("..") ? dir : relative;
}

/**
 * Writes next steps in the caller-selected output format.
 * @param result Where the project was written.
 * @param project The loaded project, used to name what to run.
 */
function printNextSteps(result: ScaffoldResult, project: Project): void {
  const target = changeDirectoryTo(result.dir);
  const [mcpServer] = project.mcpServers.keys();
  const steps = [
    ...(target ? [`cd ${target}`] : []),
    ...(mcpServer ? [`nt mcp trust ${mcpServer}`, `nt mcp doctor ${mcpServer}`] : []),
    "export ANTHROPIC_API_KEY=sk-ant-...",
    `nt run ${cyan(entryName(project))} -m "bought the first iPhone at 22"`,
  ];
  out(bold("\nNext steps"));
  steps.forEach((step, i) => out(`  ${i + 1}. ${step}`));
  out(dim(`\n  'nt list' and 'nt graph' show what is in the project; both work offline.`));
}

/**
 * Installs the selected editor integration after explicit replacement checks.
 * @param args The parsed arguments.
 * @returns Nothing; created files and next steps are printed to stdout.
 */
export function cmdSetup(args: Args): void {
  const result = scaffoldProject(args.positional[1] ?? ".", {
    template: args.template,
    force: args.force,
  });
  out(bold(`Setting up an NT project in ${result.dir}`));
  out(dim(`  template: ${result.template}`));
  for (const file of result.created) out(`  ${green("+")} ${file}`);
  for (const file of result.skipped)
    out(`  ${yellow("•")} ${file} ${dim("(already exists, left alone)")}`);
  if (result.skipped.length) out(dim("\n  Pass --force to replace the files that already exist."));

  const { project, warnings } = loadProject(result.entry);
  printWarnings(warnings);
  out(green(`\n✓ ${project.files.length} .nt file(s) OK`));
  printNextSteps(result, project);
}
