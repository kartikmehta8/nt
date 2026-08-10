/**
 * @file The commands that call the model: `up`, `run`, and the `chat` REPL.
 *
 * Each loads and signal-tracks one engine, wires human approval and progress,
 * then brings the ecosystem up or runs an agent/subagent/workflow while the
 * thinking line reports model and tool activity. `up` also probes declared MCP
 * servers after source-only status. Every command closes the engine in
 * `finally`; offline inspection commands remain in `inspect.ts`.
 */

import * as readline from "node:readline";
import { Engine, NtError } from "@age.nt/engine";
import { bold, cyan, dim, green, out, printWarnings, red, yellow } from "#format";
import { makeConfirm } from "#permission";
import { beginThinking, reportStep, setStepReporting } from "#spinner";
import { parseInput, resolveEntry, type Args } from "#args";
import { closeEngine, trackEngine } from "#lifecycle";

/**
 * Loads the engine for `up`, `run`, and `chat`, wiring step events into the
 * thinking line and the interactive permission selector for `confirm: true`
 * tools. Reporting turns on when `--show-tool-calls` is passed or the project
 * sets `config.show_tool_calls: true`.
 *
 * @param args The parsed arguments.
 * @returns The loaded engine.
 */
function loadEngine(args: Args): Engine {
  const engine = trackEngine(
    Engine.load(resolveEntry(args), {
      verbose: args.verbose,
      allowOutsideImports: args.allowOutsideImports,
      onStep: reportStep,
      confirm: makeConfirm({
        yes: args.yes,
        interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
      }),
    }),
  );
  setStepReporting(args.showToolCalls || engine.project.config.showToolCalls);
  return engine;
}

/**
 * Returns a promise that settles after probing servers and closing the engine.
 * @param args The parsed arguments.
 * @returns A promise that settles after probing servers and closing the engine.
 */
export async function cmdUp(args: Args): Promise<void> {
  const engine = loadEngine(args);
  try {
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

    if (project.mcpServers.size) {
      out(bold("\nMCP servers"));
      const mcp = await engine.listMcp();
      for (const item of mcp)
        out(
          `  ${item.status.status === "connected" ? green("●") : yellow("○")} ${item.status.name} ${dim(`(${item.status.transport})`)}${item.status.protocolVersion ? ` protocol ${item.status.protocolVersion}` : ""}${item.status.error ? yellow(" — " + item.status.error) : ""}`,
        );
    }

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
  } finally {
    await closeEngine(engine);
  }
}

/**
 * Returns a promise that settles after the requested run and engine cleanup.
 * @param args The parsed arguments.
 * @returns A promise that settles after the requested run and engine cleanup.
 */
export async function cmdRun(args: Args): Promise<void> {
  const name = args.positional[1];
  if (!name) throw new NtError("usage: nt run <name> [--input JSON | --message TEXT]", null);
  const engine = loadEngine(args);
  try {
    printWarnings(engine.warnings);
    await runNamed(engine, name, parseInput(args));
  } finally {
    await closeEngine(engine);
  }
}

/**
 * Resolves and runs one named agent, subagent, or workflow from parsed CLI input.
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
 * Returns a promise that settles when the interactive session ends cleanly.
 * @param args The parsed arguments.
 * @returns A promise that settles when the interactive session ends cleanly.
 */
export async function cmdChat(args: Args): Promise<void> {
  const name = args.positional[1];
  if (!name) throw new NtError("usage: nt chat <name> [--file FILE]", null);
  const engine = loadEngine(args);
  try {
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
  } finally {
    await closeEngine(engine);
  }
}
