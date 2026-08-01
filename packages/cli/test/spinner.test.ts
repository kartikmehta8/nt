/**
 * @file Thinking-indicator tests: the spinner animates on a TTY with a word
 * and elapsed counter, cleans the line up on stop, stays idempotent across
 * repeated stops, and stays completely silent on non-TTY streams.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { startThinking, type SpinnerStream } from "#spinner";

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
  handle.stop();
  assert.deepEqual(stream.chunks, []);
});
