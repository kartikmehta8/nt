/**
 * @file Runtime behavior of `retry` over a scripted provider: a failing step
 * is re-run and every attempt is reported, an exhausted budget fails with a
 * located error that names the step, a missing structured result counts as a
 * failure only when `retry` is declared, and `for_each` items retry
 * independently. No test reaches the network.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { NtError } from "#errors";
import { LOC, reply, run } from "./workflow-harness.ts";

test("retry re-runs a failing step and reports each attempt", async () => {
  const body = "  steps:\n    - prompt: go\n      retry: 2\n";
  const { result, events, stats } = await run(body, {}, (prompt, call) => {
    if (call < 3) throw new Error("boom");
    return reply(`r:${prompt}`);
  });
  assert.equal(result.text, "r:go");
  assert.equal(stats.calls, 3);
  assert.deepEqual(events, ["step 1/1", "step 1/1 retry 1/2", "step 1/1 retry 2/2"]);
});

test("retry gives up after the budget with an error that names the step", async () => {
  const body = "  steps:\n    - prompt: go\n      retry: 1\n";
  await assert.rejects(
    run(body, {}, () => {
      throw new Error("boom");
    }),
    (error: unknown) =>
      error instanceof NtError &&
      /workflow 'w' step 1\/1 failed after 2 attempt\(s\): boom/.test(error.message) &&
      error.loc?.file === LOC.file,
  );
});

test("retry treats missing structured output as a failed attempt", async () => {
  const body =
    "  output:\n    year: object\n  steps:\n    - agent: typed\n      retry: 1\n      into: year\n";
  const { result, stats } = await run(body, {}, (_prompt, call) =>
    reply(call === 1 ? "no json here" : '{"year": 2007}'),
  );
  assert.deepEqual(result.output, { year: { year: 2007 } });
  assert.equal(stats.calls, 2);
});

test("without retry, a missing structured result keeps the plain text as before", async () => {
  const body = "  output:\n    year: string\n  steps:\n    - agent: typed\n      into: year\n";
  const { result, stats } = await run(body, {}, () => reply("no json here"));
  assert.deepEqual(result.output, { year: "no json here" });
  assert.equal(stats.calls, 1);
});

test("for_each retries each item independently", async () => {
  const body =
    "  input:\n    items: array\n  output:\n    results: array\n  steps:\n" +
    '    - for_each: items\n      retry: 1\n      prompt: "{index}:{item}"\n      into: results\n';
  const failed = new Set<string>();
  const { result, events, stats } = await run(body, { items: ["a", "b"] }, (prompt) => {
    if (prompt.endsWith("b") && !failed.has(prompt)) {
      failed.add(prompt);
      throw new Error("flaky");
    }
    return reply(`r:${prompt}`);
  });
  assert.deepEqual(result.output, { results: ["r:0:a", "r:1:b"] });
  assert.equal(stats.calls, 3);
  assert.ok(events.includes("step 1/1 · item 2/2 retry 1/1"));
});
