/**
 * @file Permission-selector tests: Enter confirms the highlighted option
 * (Yes by default), arrow keys move the pointer, `y`/`n`/Esc/Ctrl-C answer
 * directly, other stdin listeners are detached while the selector runs and
 * restored after, raw mode and pause state are put back, `--yes` pre-approves
 * without a prompt, and a non-interactive terminal denies without a prompt.
 */

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import type { ConfirmRequest } from "@age.nt/engine";
import { describeRequest, makeConfirm, selectApproval, type SelectorIO } from "#permission";

const REQUEST: ConfirmRequest = {
  agent: "age",
  tool: "current_year",
  input: { locale: "en" },
  depth: 0,
};

class FakeStdin extends EventEmitter {
  isTTY = true;
  isRaw = false;
  private paused = true;

  setRawMode(mode: boolean): this {
    this.isRaw = mode;
    return this;
  }

  resume(): void {
    this.paused = false;
  }

  pause(): void {
    this.paused = true;
  }

  isPaused(): boolean {
    return this.paused;
  }
}

/**
 * @returns A fake terminal capturing everything the selector writes.
 */
function fakeIO(): SelectorIO & { stdin: FakeStdin; written: string[] } {
  const written: string[] = [];
  return {
    stdin: new FakeStdin(),
    stdout: { write: (chunk: string) => written.push(chunk) },
    written,
  };
}

/**
 * @param keys The key sequences to press, in order.
 * @returns The selector's answer for those key presses.
 */
async function press(...keys: string[]): Promise<boolean> {
  const io = fakeIO();
  const answer = selectApproval(REQUEST, io);
  for (const key of keys) io.stdin.emit("data", key);
  return answer;
}

test("Enter confirms the default Yes, and arrows move the pointer to No", async () => {
  assert.equal(await press("\r"), true);
  assert.equal(await press("\x1b[B", "\r"), false);
  assert.equal(await press("\x1b[B", "\x1b[A", "\r"), true);
});

test("y, n, Esc, and Ctrl-C answer directly", async () => {
  assert.equal(await press("y"), true);
  assert.equal(await press("n"), false);
  assert.equal(await press("\x1b"), false);
  assert.equal(await press("\x03"), false);
});

test("the selector names the tool and prints a one-line summary of the answer", async () => {
  const io = fakeIO();
  const answer = selectApproval(REQUEST, io);
  io.stdin.emit("data", "n");
  await answer;
  const output = io.written.join("");
  assert.match(output, /age wants to run .*current_year/);
  assert.match(output, /current_year — denied/);
});

test("the summary line survives: both option rows are cleared and the cursor parks below it", async () => {
  const io = fakeIO();
  const answer = selectApproval(REQUEST, io);
  io.stdin.emit("data", "y");
  await answer;
  const last = io.written[io.written.length - 1];
  assert.match(last, /approved/);
  const clears = last.split("\r\x1b[2K").length - 1;
  assert.equal(clears, 3, "the summary row and both option rows are rewritten or cleared");
  assert.ok(
    last.endsWith("\x1b[1A\x1b[?25h"),
    "the cursor ends one row below the summary, so the resuming spinner cannot overwrite it",
  );
});

test("other stdin listeners are detached while the selector runs and restored after", async () => {
  const io = fakeIO();
  const seen: string[] = [];
  io.stdin.on("data", (chunk) => seen.push(chunk.toString()));
  const answer = selectApproval(REQUEST, io);
  io.stdin.emit("data", "y");
  assert.equal(await answer, true);
  assert.deepEqual(seen, [], "the REPL listener never sees the selector's keys");
  io.stdin.emit("data", "hello");
  assert.deepEqual(seen, ["hello"], "the REPL listener is restored afterwards");
});

test("raw mode and the paused state are restored after the selector", async () => {
  const io = fakeIO();
  const answer = selectApproval(REQUEST, io);
  assert.equal(io.stdin.isRaw, true, "raw mode is on while selecting");
  assert.equal(io.stdin.isPaused(), false, "stdin flows while selecting");
  io.stdin.emit("data", "\r");
  await answer;
  assert.equal(io.stdin.isRaw, false, "raw mode is restored");
  assert.equal(io.stdin.isPaused(), true, "the paused state is restored");
});

test("describeRequest names the agent, tool, and input, truncating long input", () => {
  assert.match(describeRequest(REQUEST), /age wants to run .*current_year.*\{"locale":"en"\}/);
  const long = describeRequest({ ...REQUEST, input: { text: "x".repeat(500) } });
  assert.ok(long.length < 250, "long input is truncated");
  assert.match(long, /…/);
});

test("--yes pre-approves and a non-interactive terminal denies, both without a prompt", async () => {
  const io = fakeIO();
  assert.equal(await makeConfirm({ yes: true, interactive: true, io })(REQUEST), true);
  assert.equal(await makeConfirm({ yes: false, interactive: false, io })(REQUEST), false);
  assert.deepEqual(io.written, [], "no selector was ever drawn");
});

test("an interactive confirm shows the selector and returns the choice", async () => {
  const io = fakeIO();
  const confirm = makeConfirm({ yes: false, interactive: true, io });
  const answer = confirm(REQUEST);
  io.stdin.emit("data", "\x1b[B");
  io.stdin.emit("data", "\r");
  assert.equal(await answer, false);
  assert.match(io.written.join(""), /Yes, run this tool/);
});
