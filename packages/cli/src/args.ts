/**
 * @file Command-line argument parsing and help text.
 *
 * Parses flags into `Args` (the `--file`/`--dir` path, `--input`/`--message`,
 * `--run`, `--tail`, `--json`, `--template`, `--force`, `--verbose`,
 * `--show-tool-calls`), derives the run input from `--input` JSON or the
 * `--message` shorthand, and holds the `--help` text.
 */

import * as fs from "node:fs";
import * as nodePath from "node:path";
import { DEFAULT_TEMPLATE, NtError, TEMPLATE_NAMES } from "@age.nt/engine";

export const DEFAULT_ENTRY = "age.nt";

export interface Args {
  positional: string[];
  dir: string;
  explicitPath: boolean;
  input?: string;
  message?: string;
  run?: string;
  tail?: number;
  json: boolean;
  verbose: boolean;
  showToolCalls: boolean;
  yes: boolean;
  allowOutsideImports: boolean;
  template?: string;
  force: boolean;
}

export const HELP = `nt — run ecosystems of agents defined in .nt files

USAGE
  nt <command> [options]

COMMANDS
  setup [DIR]         Write a starter project (${DEFAULT_ENTRY}, config.nt, …) into DIR
  validate            Parse and type-check every .nt file
  list                List all defined agents, subagents, tools, etc.
  graph               Show how agents wire to subagents, tools and sandboxes
  up                  Bring up the ecosystem (sandboxes + providers); run entry
  run <name>          Run an agent, subagent, or workflow once
  chat <name>         Interactively chat with an agent (multi-turn, keeps history)
  audit               Show where tool calls are logged and the recent entries

OPTIONS
  -f, --file FILE     Entry .nt file to load; its imports are followed
                      (default: ./age.nt in the current directory)
  -d, --dir DIR       Load every .nt file in a directory instead of one entry
  -i, --input JSON    JSON object passed as the run input
  -m, --message TEXT  Shorthand for --input '{"message": TEXT}'
      --run NAME      With 'up': run this agent/workflow after bring-up
  -n, --tail N        With 'audit': how many recent entries to show (default 20)
      --json          With 'audit': print the raw JSONL entries only
  -t, --template NAME With 'setup': ${TEMPLATE_NAMES.join(" or ")} (default ${DEFAULT_TEMPLATE})
      --force         With 'setup': overwrite files that already exist
      --show-tool-calls   With 'up'/'run'/'chat': name each tool call and
                      delegation in the thinking line as it happens
  -y, --yes           Pre-approve tools declared with 'confirm: true' instead
                      of asking in the terminal before each call
      --allow-outside-imports  Permit imports outside the project directory
  -v, --verbose       Print the agent/tool trace to stderr
  -h, --help          Show this help
`;

/**
 * @param argv The arguments after the command name.
 * @param flag The flag currently being parsed, for the error message.
 * @param i The index of the flag; its value is expected at `i + 1`.
 * @returns The value token following the flag.
 */
function requireValue(argv: string[], flag: string, i: number): string {
  const value = argv[i + 1];
  if (value === undefined || value.startsWith("-"))
    throw new NtError(`${flag} requires a value`, null);
  return value;
}

/**
 * @param argv The arguments after the command name.
 * @param flag The flag currently being parsed, for the error message.
 * @param i The index of the flag; its value is expected at `i + 1`.
 * @returns The value token following the flag, parsed as a positive whole number.
 */
function requireCount(argv: string[], flag: string, i: number): number {
  const value = requireValue(argv, flag, i);
  const count = Number(value);
  if (!Number.isInteger(count) || count <= 0)
    throw new NtError(`${flag} requires a positive whole number, got '${value}'`, null);
  return count;
}

/**
 * @param argv The arguments after the command name.
 * @returns The parsed argument set.
 */
export function parseArgs(argv: string[]): Args {
  const args: Args = {
    positional: [],
    dir: DEFAULT_ENTRY,
    explicitPath: false,
    json: false,
    verbose: false,
    showToolCalls: false,
    yes: false,
    allowOutsideImports: false,
    force: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dir" || arg === "-d") {
      args.dir = requireValue(argv, arg, i++);
      args.explicitPath = true;
    } else if (arg === "--file" || arg === "-f") {
      args.dir = requireValue(argv, arg, i++);
      args.explicitPath = true;
    } else if (arg === "--input" || arg === "-i") args.input = requireValue(argv, arg, i++);
    else if (arg === "--message" || arg === "-m") args.message = requireValue(argv, arg, i++);
    else if (arg === "--run") args.run = requireValue(argv, arg, i++);
    else if (arg === "--tail" || arg === "-n") args.tail = requireCount(argv, arg, i++);
    else if (arg === "--template" || arg === "-t") args.template = requireValue(argv, arg, i++);
    else if (arg === "--force") args.force = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--show-tool-calls") args.showToolCalls = true;
    else if (arg === "--yes" || arg === "-y") args.yes = true;
    else if (arg === "--allow-outside-imports") args.allowOutsideImports = true;
    else if (arg === "--verbose" || arg === "-v") args.verbose = true;
    else if (arg === "--help" || arg === "-h") args.positional.push("help");
    else if (arg === "--") continue;
    else if (arg.startsWith("-")) throw new NtError(`unknown flag '${arg}'`, null);
    else args.positional.push(arg);
  }
  return args;
}

/**
 * @param args The parsed arguments.
 * @returns The path to load: the given `--file`/`--dir`, or `./age.nt` by default.
 */
export function resolveEntry(args: Args): string {
  if (fs.existsSync(args.dir)) return args.dir;
  if (args.explicitPath) throw new NtError(`no such file or directory: ${args.dir}`, null);
  throw new NtError(
    `no ${DEFAULT_ENTRY} in the current directory (${nodePath.resolve(".")}); ` +
      `pass --file <entry.nt> to load a different file, or --dir <folder> to load a directory`,
    null,
  );
}

/**
 * @param args The parsed arguments.
 * @returns The run input, from `--input` JSON or the `--message` shorthand.
 */
export function parseInput(args: Args): Record<string, unknown> {
  if (args.input) {
    try {
      return JSON.parse(args.input);
    } catch {
      throw new NtError(`--input is not valid JSON: ${args.input}`, null);
    }
  }
  return args.message ? { message: args.message } : {};
}
