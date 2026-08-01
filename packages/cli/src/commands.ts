/**
 * @file The commands that call the model: `up`, `run`, and the `chat` REPL.
 *
 * Each loads an engine from the given path, then brings the ecosystem up or
 * runs an agent/subagent/workflow, showing the animated thinking line while a
 * model call is in flight. The offline inspection commands live in
 * `inspect.ts`.
 */

import * as readline from "node:readline";
import { Engine, NtError, type EngineOptions } from "@age.nt/engine";
import { bold, cyan, dim, green, out, printWarnings, red, yellow } from "#format";
import { beginThinking, reportStep } from "#spinner";
import { parseInput, resolveEntry, type Args } from "#args";

/**
 * @param args The parsed arguments.
 * @returns The engine options shared by `up`, `run`, and `chat`, wiring step
 *   events into the thinking line when `--show-tool-calls` is set.
 */
function engineOptions(args: Args): EngineOptions & { allowOutsideImports?: boolean } {
  return {
    verbose: args.verbose,
    allowOutsideImports: args.allowOutsideImports,
    onStep: args.showToolCalls ? reportStep : undefined,
  };
}

/**
 * @param args The parsed arguments.
 */
export async function cmdUp(args: Args): Promise<void> {
  const engine = Engine.load(resolveEntry(args), engineOptions(args));
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
  const engine = Engine.load(resolveEntry(args), engineOptions(args));
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
  const thinking = beginThinking();
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
  const engine = Engine.load(resolveEntry(args), engineOptions(args));
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
      const thinking = beginThinking();
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
