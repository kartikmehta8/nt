/**
 * @file CLI entry point: parse arguments and dispatch to a command.
 *
 * `main` routes the first positional argument to the matching command handler
 * (`setup`, `validate`, `list`, `graph`, `up`, `run`, `chat`, `audit`),
 * renders `NtError`s as `✗ file:line: message`, and sets the process exit code.
 * Invoked by `bin/nt.mjs` and runnable directly via `node src/cli/main.ts`.
 */

import { NtError } from "@age.nt/engine";
import { cmdAudit } from "#audit";
import { HELP, parseArgs } from "#args";
import { cmdChat, cmdRun, cmdUp } from "#commands";
import { out, red } from "#format";
import { cmdGraph, cmdList, cmdValidate } from "#inspect";
import { cmdSetup } from "#setup";

/**
 * @param argv The process arguments after the node binary and script.
 */
export async function main(argv: string[]): Promise<void> {
  try {
    const args = parseArgs(argv);
    const command = args.positional[0];
    switch (command) {
      case undefined:
      case "help":
        out(HELP);
        break;
      case "setup":
        cmdSetup(args);
        break;
      case "validate":
        cmdValidate(args);
        break;
      case "list":
        cmdList(args);
        break;
      case "graph":
        cmdGraph(args);
        break;
      case "up":
        await cmdUp(args);
        break;
      case "run":
        await cmdRun(args);
        break;
      case "chat":
        await cmdChat(args);
        break;
      case "audit":
        cmdAudit(args);
        break;
      default:
        console.error(red(`unknown command '${command}'`));
        out(HELP);
        process.exit(2);
    }
  } catch (e) {
    console.error(red("✗ " + (e instanceof NtError ? e.message : (e as Error).message)));
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
