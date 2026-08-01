/**
 * @file Animated "thinking" indicator for interactive commands.
 *
 * While a model call is in flight, renders a single rewriting line — a pulsing
 * glyph, a randomly rotating gerund ("Pondering…", "Percolating…"), and the
 * elapsed seconds. With `--show-tool-calls`, engine step events replace the
 * gerund with what is actually happening ("Running tool fs_read…"). Animates
 * only on a TTY; on pipes and files it is a no-op so scripted output stays
 * clean.
 */

import type { StepEvent } from "@age.nt/engine";
import { cyan, dim } from "#format";

const FRAMES = ["✢", "✳", "✶", "✻", "✽", "✻", "✶", "✳"];

const WORDS = [
  "Thinking",
  "Pondering",
  "Musing",
  "Mulling",
  "Brewing",
  "Percolating",
  "Cogitating",
  "Ruminating",
  "Noodling",
  "Simmering",
  "Marinating",
  "Conjuring",
  "Scheming",
  "Puzzling",
  "Tinkering",
  "Whirring",
  "Divining",
  "Contemplating",
];

const FRAME_INTERVAL_MS = 120;
const FRAMES_PER_WORD = 14;
const STATUS_HOLD_MS = 1500;
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const CLEAR_LINE = "\r\x1b[2K";

/**
 * The minimal stream surface the spinner writes to, satisfied by
 * `process.stdout` and by in-memory fakes in tests.
 */
export interface SpinnerStream {
  isTTY?: boolean;
  write(chunk: string): unknown;
}

/**
 * Tuning knobs for the indicator, exposed mainly for tests.
 */
export interface SpinnerOptions {
  statusHoldMs?: number;
}

/**
 * A handle to a running indicator. `stop` is idempotent; `update` replaces the
 * rotating word with a concrete status ("Running tool fs_read"), and `null`
 * asks to return to the rotating words. A concrete status replaces the line
 * immediately, but a return to the words is deferred until the status has been
 * visible for the hold time — so even a one-millisecond tool call stays
 * readable.
 */
export interface ThinkingHandle {
  stop(): void;
  update(status: string | null): void;
}

/**
 * @param previous The word to avoid repeating back-to-back.
 * @returns A randomly chosen thinking word different from the previous one.
 */
function nextWord(previous: string): string {
  const pool = WORDS.filter((w) => w !== previous);
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Starts the animated thinking line and returns a handle to stop it. Stopping
 * clears the line and restores the cursor, leaving the terminal ready for the
 * response to print in place. While the animation runs, process exit and
 * termination signals also restore the cursor, so an interrupted run never
 * leaves the terminal without one.
 *
 * @param stream The output stream, `process.stdout` by default.
 * @param opts Tuning knobs, such as the minimum time a status stays visible.
 * @returns A handle whose `stop` ends the animation and cleans up the line.
 */
export function startThinking(
  stream: SpinnerStream = process.stdout,
  opts?: SpinnerOptions,
): ThinkingHandle {
  if (!stream.isTTY) return { stop: () => {}, update: () => {} };
  const holdMs = opts?.statusHoldMs ?? STATUS_HOLD_MS;
  const startedAt = Date.now();
  let frame = 0;
  let word = nextWord("");
  let status: string | null = null;
  let holdUntil = 0;
  let revertPending = false;
  let stopped = false;

  const render = (): void => {
    if (status !== null && revertPending && Date.now() >= holdUntil) {
      status = null;
      revertPending = false;
    }
    if (status === null && frame > 0 && frame % FRAMES_PER_WORD === 0) word = nextWord(word);
    const glyph = FRAMES[frame % FRAMES.length];
    const label = status ?? word;
    const seconds = Math.floor((Date.now() - startedAt) / 1000);
    stream.write(`${CLEAR_LINE}${cyan(glyph)} ${label}… ${dim(`(${seconds}s)`)}`);
    frame += 1;
  };

  stream.write(HIDE_CURSOR);
  render();
  const timer = setInterval(render, FRAME_INTERVAL_MS);

  const update = (next: string | null): void => {
    if (stopped) return;
    if (next) {
      status = next;
      revertPending = false;
      holdUntil = Date.now() + holdMs;
    } else {
      revertPending = true;
    }
    render();
  };
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    process.removeListener("exit", onExit);
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
    stream.write(CLEAR_LINE + SHOW_CURSOR);
  };
  const onExit = (): void => stop();
  const onSigint = (): void => {
    stop();
    process.exit(130);
  };
  const onSigterm = (): void => {
    stop();
    process.exit(143);
  };
  process.once("exit", onExit);
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  return { stop, update };
}

let active: ThinkingHandle | null = null;

/**
 * Starts a thinking indicator and records it as the target for `reportStep`,
 * so engine step events can update whichever indicator is currently running.
 *
 * @param stream The output stream, `process.stdout` by default.
 * @param opts Tuning knobs, such as the minimum time a status stays visible.
 * @returns The running indicator's handle.
 */
export function beginThinking(
  stream: SpinnerStream = process.stdout,
  opts?: SpinnerOptions,
): ThinkingHandle {
  const handle = startThinking(stream, opts);
  active = handle;
  return {
    update: (next) => handle.update(next),
    stop(): void {
      if (active === handle) active = null;
      handle.stop();
    },
  };
}

/**
 * Routes an engine step event to the currently running indicator, if any.
 * Tool dispatches, delegations, and workflow steps name what is happening,
 * with the acting agent shown for delegated (nested) work. A top-level model
 * call returns the line to the rotating words; a nested one keeps the
 * delegation visible by naming the subagent that is thinking.
 *
 * @param event The step event reported by the engine.
 */
export function reportStep(event: StepEvent): void {
  if (!active) return;
  const prefix = event.depth > 0 ? `${event.agent} · ` : "";
  if (event.kind === "model") active.update(event.depth > 0 ? `${prefix}Thinking` : null);
  else if (event.kind === "tool") active.update(`${prefix}Running tool ${event.detail}`);
  else if (event.kind === "delegation") active.update(`${prefix}Delegating to ${event.detail}`);
  else active.update(`Running ${event.detail} (${event.agent})`);
}
