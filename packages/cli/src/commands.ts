/**
 * @file Implementations of the individual `nt` commands.
 *
 * `validate`, `list`, `graph`, `up`, `run`, and the interactive `chat` REPL.
 * Each loads a project or engine from the given path, then inspects it or runs
 * an agent/subagent/workflow, printing through the format helpers.
 */

import * as readline from "node:readline";
import { Engine, loadProject, NtError, type AgentDef, type Project } from "@age.nt/engine";
import { bold, cyan, dim, green, out, printWarnings, red, yellow } from "#format";
import { startThinking } from "#spinner";
import { parseInput, resolveEntry, type Args } from "#args";

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

/**
 * @param args The parsed arguments.
 */
export async function cmdUp(args: Args): Promise<void> {
  const engine = Engine.load(resolveEntry(args), {
    verbose: args.verbose,
    allowOutsideImports: args.allowOutsideImports,
  });
  printWarnings(engine.warnings);
  const project = engine.project;
  out(bold("Bringing up the NT ecosystem…"));
  out(dim(`  target: ${project.config.target}`));
  const status = engine.bringUp();

  out(bold("\nSandboxes"));
  if (status.sandboxes.length === 0)
    out(dim("  (none declared; agents use the default virtual sandbox)"));
  for (const s of status.sandboxes)
    out(
      `  ${s.ok ? green("●") : yellow("○")} ${s.name} ${dim(`(${s.kind} @ ${s.cwd})`)}${s.error ? yellow(" — " + s.error) : ""}`,
    );

  out(bold("\nProviders"));
  for (const p of status.providers)
    out(
      `  ${p.hasKey ? green("●") : yellow("○")} ${p.name} ${dim("(" + p.api + ")")} ${p.hasKey ? green("key found") : yellow("no key")}`,
    );

  out(bold("\nAudit log"));
  out(
    status.audit.enabled
      ? `  ${green("●")} ${status.audit.file} ${dim("(every tool call, secrets redacted)")}`
      : `  ${yellow("○")} ${dim("off — tool calls are not logged")}`,
  );

  out(bold("\nAgents ready"));
  for (const a of project.agents.values())
    out(
      `  ${green("●")} ${cyan(a.name)}${a.subagents.length ? dim(" → " + a.subagents.join(", ")) : ""}`,
    );
  for (const w of project.workflows.values())
    out(`  ${green("▶")} ${cyan(w.name)} ${dim("(workflow)")}`);

  const runName = args.run ?? project.config.entry;
  if (!runName) {
    out(dim(`\nEcosystem is up. Run something with:  nt run <name> -m "…"`));
    return;
  }
  out(bold(`\nRunning entry: ${runName}\n`));
  await runNamed(engine, runName, parseInput(args));
}

/**
 * @param args The parsed arguments.
 */
export async function cmdRun(args: Args): Promise<void> {
  const name = args.positional[1];
  if (!name) throw new NtError("usage: nt run <name> [--input JSON | --message TEXT]", null);
  const engine = Engine.load(resolveEntry(args), {
    verbose: args.verbose,
    allowOutsideImports: args.allowOutsideImports,
  });
  printWarnings(engine.warnings);
  await runNamed(engine, name, parseInput(args));
}

/**
 * @param engine The loaded engine.
 * @param name The runnable to execute.
 * @param input The run input.
 */
async function runNamed(
  engine: Engine,
  name: string,
  input: Record<string, unknown>,
): Promise<void> {
  const kind = engine.isRunnable(name);
  if (!kind) throw new NtError(`'${name}' is not a runnable agent, subagent, or workflow`, null);
  const thinking = startThinking();
  let result;
  try {
    result =
      kind === "workflow"
        ? await engine.runWorkflow(name, input)
        : await engine.runAgent(name, input);
  } finally {
    thinking.stop();
  }
  if (result.output) {
    out(bold("Output:"));
    out(JSON.stringify(result.output, null, 2));
  } else {
    out(result.text);
  }
  console.error(
    dim(
      `\n[${result.steps} step(s) · ${result.usage.input} in / ${result.usage.output} out tokens]`,
    ),
  );
}

/**
 * @param args The parsed arguments.
 */
export async function cmdChat(args: Args): Promise<void> {
  const name = args.positional[1];
  if (!name) throw new NtError("usage: nt chat <name> [--file FILE]", null);
  const engine = Engine.load(resolveEntry(args), {
    verbose: args.verbose,
    allowOutsideImports: args.allowOutsideImports,
  });
  printWarnings(engine.warnings);
  const chat = engine.createChat(name);
  out(dim(`Chatting with '${chat.agentName}'. Type 'exit' or press Ctrl-D to quit.`));

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: cyan(`${chat.agentName} › `),
  });
  rl.prompt();
  for await (const line of rl) {
    const text = line.trim();
    if (text === "exit" || text === "quit") break;
    if (text !== "") {
      const thinking = startThinking();
      try {
        const result = await chat.send(text);
        thinking.stop();
        out(result.output ? JSON.stringify(result.output, null, 2) : result.text);
      } catch (e) {
        thinking.stop();
        console.error(red("✗ " + (e as Error).message));
      }
    }
    rl.prompt();
  }
  rl.close();
  out(dim("bye"));
}
