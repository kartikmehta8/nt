/**
 * @file Command-line argument parsing and help text.
 *
 * Parses flags into `Args` (the `--file`/`--dir` path, `--input`/`--message`,
 * `--run`, `--verbose`), derives the run input from `--input` JSON or the
 * `--message` shorthand, and holds the `--help` text.
 */

import * as fs from "node:fs";
import * as nodePath from "node:path";
import { NtError } from "@age.nt/engine";

export const DEFAULT_ENTRY = "age.nt";

export interface Args {
  positional: string[];
  dir: string;
  explicitPath: boolean;
  input?: string;
  message?: string;
  run?: string;
  verbose: boolean;
  allowOutsideImports: boolean;
}

export const HELP = `nt — run ecosystems of agents defined in .nt files

USAGE
  nt <command> [options]

COMMANDS
  validate            Parse and type-check every .nt file
  list                List all defined agents, subagents, tools, etc.
  graph               Show how agents wire to subagents, tools and sandboxes
  up                  Bring up the ecosystem (sandboxes + providers); run entry
  run <name>          Run an agent, subagent, or workflow once
  chat <name>         Interactively chat with an agent (multi-turn, keeps history)

OPTIONS
  -f, --file FILE     Entry .nt file to load; its imports are followed
                      (default: ./age.nt in the current directory)
  -d, --dir DIR       Load every .nt file in a directory instead of one entry
  -i, --input JSON    JSON object passed as the run input
  -m, --message TEXT  Shorthand for --input '{"message": TEXT}'
      --run NAME      With 'up': run this agent/workflow after bring-up
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
 * @returns The parsed argument set.
 */
export function parseArgs(argv: string[]): Args {
  const args: Args = {
    positional: [],
    dir: DEFAULT_ENTRY,
    explicitPath: false,
    verbose: false,
    allowOutsideImports: false,
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
    else if (arg === "--allow-outside-imports") args.allowOutsideImports = true;
    else if (arg === "--verbose" || arg === "-v") args.verbose = true;
    else if (arg === "--help" || arg === "-h") args.positional.push("help");
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
