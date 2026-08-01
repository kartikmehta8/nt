/**
 * @file The human-in-the-loop permission prompt for gated tool calls.
 *
 * Tools declared with `confirm: true` stop the run until the user approves
 * them. `makeConfirm` builds the engine's confirm callback: `--yes`
 * pre-approves everything, a non-interactive terminal denies (a gated tool
 * must never run unseen in a script), and otherwise the thinking line pauses
 * while an interactive selector takes the terminal — arrow keys move between
 * Yes and No, Enter confirms, `y`/`n` answer directly, and Esc denies. While
 * the selector owns stdin, any other listeners (the chat REPL's readline) are
 * detached and restored afterwards so keystrokes are never double-read.
 */

import type { ConfirmRequest } from "@age.nt/engine";
import { bold, cyan, dim, yellow } from "#format";
import { pauseThinking, resumeThinking } from "#spinner";

const MAX_SHOWN_INPUT = 120;
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const CLEAR_LINE = "\r\x1b[2K";
const CURSOR_UP = "\x1b[1A";

const KEYS_YES = ["y", "Y", "1"];
const KEYS_NO = ["n", "N", "2", "\x1b", "\x03"];
const KEYS_MOVE = ["\x1b[A", "\x1b[B", "\x1b[C", "\x1b[D", "\t"];
const KEYS_CONFIRM = ["\r", "\n"];

/**
 * The stdin surface the selector drives, satisfied by `process.stdin` and by
 * event-emitter fakes in tests.
 */
export interface SelectorStdin {
  isTTY?: boolean;
  isRaw?: boolean;
  setRawMode?(mode: boolean): unknown;
  resume(): void;
  pause(): void;
  isPaused(): boolean;
  on(event: "data", listener: (chunk: Buffer | string) => void): unknown;
  removeListener(event: "data", listener: (chunk: Buffer | string) => void): unknown;
  listeners(event: "data"): ((chunk: Buffer | string) => void)[];
  removeAllListeners(event: "data"): unknown;
}

export interface SelectorIO {
  stdin: SelectorStdin;
  stdout: { write(chunk: string): unknown };
}

export interface ConfirmOptions {
  yes: boolean;
  interactive: boolean;
  io?: SelectorIO;
}

/**
 * @param request The gated tool call.
 * @returns A one-line description of who wants to run what, with what input.
 */
export function describeRequest(request: ConfirmRequest): string {
  const input = JSON.stringify(request.input);
  const shown = input.length > MAX_SHOWN_INPUT ? input.slice(0, MAX_SHOWN_INPUT - 1) + "…" : input;
  return `${request.agent} wants to run ${bold(request.tool)}(${shown})`;
}

/**
 * @param approve Whether the Yes option is highlighted.
 * @returns The two option lines with the pointer on the highlighted one.
 */
function optionLines(approve: boolean): string {
  const yes = approve ? cyan(`${bold("❯")} Yes, run this tool`) : dim("  Yes, run this tool");
  const no = approve ? dim("  No, deny it (esc)") : cyan(`${bold("❯")} No, deny it (esc)`);
  return `${CLEAR_LINE}${yes}\n${CLEAR_LINE}${no}\n`;
}

/**
 * Shows the interactive Yes/No selector and resolves with the user's choice.
 * Stdin is switched to raw mode and every other data listener is detached
 * while the selector runs, then everything is restored and a one-line summary
 * replaces the selector.
 *
 * @param request The gated tool call to describe.
 * @param io The terminal streams, `process.stdin`/`process.stdout` by default.
 * @returns Whether the user approved the call.
 */
export function selectApproval(request: ConfirmRequest, io: SelectorIO): Promise<boolean> {
  const { stdin, stdout } = io;
  return new Promise((resolve) => {
    const savedListeners = stdin.listeners("data");
    stdin.removeAllListeners("data");
    const wasRaw = stdin.isRaw === true;
    const wasPaused = stdin.isPaused();
    stdin.setRawMode?.(true);
    stdin.resume();

    let approve = true;
    stdout.write(
      `${HIDE_CURSOR}${yellow("⚠")} ${describeRequest(request)}\n${optionLines(approve)}`,
    );

    const redraw = (): void => {
      stdout.write(CURSOR_UP + CURSOR_UP + optionLines(approve));
    };
    const finish = (approved: boolean): void => {
      stdin.removeListener("data", onKey);
      stdin.setRawMode?.(wasRaw);
      if (wasPaused) stdin.pause();
      for (const listener of savedListeners) stdin.on("data", listener);
      const summary = dim(`⚠ ${request.tool} — ${approved ? "approved" : "denied"}`);
      stdout.write(
        CURSOR_UP +
          CURSOR_UP +
          CURSOR_UP +
          `${CLEAR_LINE}${summary}\n` +
          `${CLEAR_LINE}\n${CLEAR_LINE}` +
          CURSOR_UP +
          SHOW_CURSOR,
      );
      resolve(approved);
    };
    const onKey = (chunk: Buffer | string): void => {
      const key = chunk.toString();
      if (KEYS_YES.includes(key)) return finish(true);
      if (KEYS_NO.includes(key)) return finish(false);
      if (KEYS_CONFIRM.includes(key)) return finish(approve);
      if (KEYS_MOVE.includes(key)) {
        approve = !approve;
        redraw();
      }
    };
    stdin.on("data", onKey);
  });
}

/**
 * Builds the confirm callback the engine calls before a `confirm: true` tool
 * runs. The thinking line is paused around the selector so the prompt owns
 * the terminal.
 *
 * @param opts The `--yes` flag, whether the terminal can ask, and the streams.
 * @returns The callback resolving to whether the tool may run.
 */
export function makeConfirm(opts: ConfirmOptions): (request: ConfirmRequest) => Promise<boolean> {
  return async (request) => {
    if (opts.yes) return true;
    if (!opts.interactive) return false;
    const io = opts.io ?? { stdin: process.stdin, stdout: process.stdout };
    pauseThinking();
    try {
      return await selectApproval(request, io);
    } finally {
      resumeThinking();
    }
  };
}
