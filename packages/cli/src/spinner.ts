/**
 * @file Animated "thinking" indicator for interactive commands.
 *
 * While a model call is in flight, renders a single rewriting line — a pulsing
 * glyph, a randomly rotating gerund ("Pondering…", "Percolating…"), and the
 * elapsed seconds. Animates only on a TTY; on pipes and files it is a no-op so
 * scripted output stays clean.
 */

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
 * A handle to a running indicator; `stop` is idempotent.
 */
export interface ThinkingHandle {
  stop(): void;
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
 * @returns A handle whose `stop` ends the animation and cleans up the line.
 */
export function startThinking(stream: SpinnerStream = process.stdout): ThinkingHandle {
  if (!stream.isTTY) return { stop: () => {} };
  const startedAt = Date.now();
  let frame = 0;
  let word = nextWord("");
  let stopped = false;

  const render = (): void => {
    if (frame > 0 && frame % FRAMES_PER_WORD === 0) word = nextWord(word);
    const glyph = FRAMES[frame % FRAMES.length];
    const seconds = Math.floor((Date.now() - startedAt) / 1000);
    stream.write(`${CLEAR_LINE}${cyan(glyph)} ${word}… ${dim(`(${seconds}s)`)}`);
    frame += 1;
  };

  stream.write(HIDE_CURSOR);
  render();
  const timer = setInterval(render, FRAME_INTERVAL_MS);

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

  return { stop };
}
