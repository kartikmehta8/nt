/**
 * @file Thinking-indicator tests: the spinner animates on a TTY with a word
 * and elapsed counter, cleans the line up on stop, stays idempotent across
 * repeated stops, stays completely silent on non-TTY streams, and renders
 * engine step events as concrete statuses via `beginThinking`/`reportStep`.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  beginThinking,
  reportStep,
  setStepReporting,
  startThinking,
  type SpinnerStream,
} from "#spinner";

/**
 * @param isTTY Whether the fake stream should report itself as a terminal.
 * @returns A fake stream capturing every chunk written to it.
 */
function fakeStream(isTTY: boolean): SpinnerStream & { chunks: string[] } {
  const chunks: string[] = [];
  return {
    isTTY,
    chunks,
    write(chunk: string) {
      chunks.push(chunk);
      return true;
    },
  };
}

test("on a TTY the spinner renders a thinking word and clears on stop", async () => {
  const stream = fakeStream(true);
  const handle = startThinking(stream);
  await new Promise((resolve) => setTimeout(resolve, 300));
  handle.stop();
  const written = stream.chunks.join("");
  assert.ok(written.includes("\x1b[?25l"), "hides the cursor while animating");
  assert.match(written, /[A-Z][a-z]+…/, "shows a rotating thinking word");
  assert.match(written, /\(\d+s\)/, "shows the elapsed seconds");
  const last = stream.chunks[stream.chunks.length - 1];
  assert.equal(last, "\r\x1b[2K\x1b[?25h", "stop clears the line and restores the cursor");
});

test("stop is idempotent and writes cleanup only once", async () => {
  const stream = fakeStream(true);
  const handle = startThinking(stream);
  handle.stop();
  const afterFirstStop = stream.chunks.length;
  handle.stop();
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(stream.chunks.length, afterFirstStop, "no writes after the first stop");
});

test("the exit and signal listeners are installed while spinning and removed on stop", () => {
  const before = {
    exit: process.listenerCount("exit"),
    sigint: process.listenerCount("SIGINT"),
    sigterm: process.listenerCount("SIGTERM"),
  };
  const handle = startThinking(fakeStream(true));
  assert.equal(process.listenerCount("exit"), before.exit + 1);
  assert.equal(process.listenerCount("SIGINT"), before.sigint + 1);
  assert.equal(process.listenerCount("SIGTERM"), before.sigterm + 1);
  handle.stop();
  assert.equal(process.listenerCount("exit"), before.exit);
  assert.equal(process.listenerCount("SIGINT"), before.sigint);
  assert.equal(process.listenerCount("SIGTERM"), before.sigterm);
});

test("on a non-TTY stream the spinner writes nothing", async () => {
  const stream = fakeStream(false);
  const handle = startThinking(stream);
  await new Promise((resolve) => setTimeout(resolve, 200));
  handle.update("Running tool fs_read");
  handle.pause();
  handle.resume();
  handle.stop();
  assert.deepEqual(stream.chunks, []);
});

test("pause clears the line for a prompt and resume continues the animation", async () => {
  const stream = fakeStream(true);
  const handle = startThinking(stream);
  handle.pause();
  assert.equal(
    stream.chunks[stream.chunks.length - 1],
    "\r\x1b[2K\x1b[?25h",
    "pause clears the line and restores the cursor",
  );
  const whilePaused = stream.chunks.length;
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(stream.chunks.length, whilePaused, "no frames render while paused");
  handle.resume();
  assert.ok(stream.chunks.length > whilePaused, "resume renders again");
  assert.match(stream.chunks[stream.chunks.length - 1], /[A-Z][a-z]+… \(\d+s\)/);
  handle.stop();
});

test("update replaces the rotating word with a status, and null returns to it", () => {
  const stream = fakeStream(true);
  const handle = startThinking(stream, { statusHoldMs: 0 });
  handle.update("Running tool fs_read");
  const withStatus = stream.chunks[stream.chunks.length - 1];
  assert.match(withStatus, /Running tool fs_read… \(\d+s\)/);
  handle.update(null);
  const reverted = stream.chunks[stream.chunks.length - 1];
  assert.doesNotMatch(reverted, /Running tool/);
  assert.match(reverted, /[A-Z][a-z]+… \(\d+s\)/);
  handle.stop();
});

test("a status stays visible for the hold time even after a revert is requested", async () => {
  const stream = fakeStream(true);
  const handle = startThinking(stream, { statusHoldMs: 60_000 });
  handle.update("Running tool current_year");
  handle.update(null);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.match(
    stream.chunks[stream.chunks.length - 1],
    /Running tool current_year…/,
    "an instant tool call is still on screen after the revert request",
  );
  handle.stop();
});

test("reportStep routes engine events to the active indicator", () => {
  const stream = fakeStream(true);
  const handle = beginThinking(stream, { statusHoldMs: 0 });
  setStepReporting(false);
  const before = stream.chunks.length;
  reportStep({ kind: "tool", agent: "age", detail: "current_year", depth: 0 });
  assert.equal(stream.chunks.length, before, "events are ignored while reporting is off");
  setStepReporting(true);
  reportStep({ kind: "tool", agent: "age", detail: "current_year", depth: 0 });
  assert.match(stream.chunks[stream.chunks.length - 1], /Running tool current_year…/);
  reportStep({ kind: "delegation", agent: "age", detail: "researcher", depth: 0 });
  assert.match(stream.chunks[stream.chunks.length - 1], /Delegating to researcher…/);
  reportStep({ kind: "model", agent: "researcher", detail: "anthropic/claude-sonnet-5", depth: 1 });
  assert.match(stream.chunks[stream.chunks.length - 1], /researcher · Thinking…/);
  reportStep({ kind: "tool", agent: "researcher", detail: "fs_list", depth: 1 });
  assert.match(stream.chunks[stream.chunks.length - 1], /researcher · Running tool fs_list…/);
  reportStep({ kind: "workflow-step", agent: "age", detail: "step 1/2", depth: 0 });
  assert.match(stream.chunks[stream.chunks.length - 1], /Running step 1\/2 \(age\)…/);
  reportStep({ kind: "model", agent: "age", detail: "anthropic/claude-sonnet-5", depth: 0 });
  assert.doesNotMatch(stream.chunks[stream.chunks.length - 1], /Running|Delegating|Thinking/);
  handle.stop();
  const written = stream.chunks.length;
  reportStep({ kind: "tool", agent: "age", detail: "current_year", depth: 0 });
  assert.equal(stream.chunks.length, written, "a stopped indicator receives no more events");
});
