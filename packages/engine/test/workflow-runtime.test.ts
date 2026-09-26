/**
 * @file Runtime behavior of `for_each` and `when` over a scripted provider:
 * fan-out runs with bounded parallelism and keeps input order, empty and
 * invalid lists are handled before any model call, a false condition skips
 * the step and leaves its `into` unset, and every operator evaluates as
 * documented. No test reaches the network.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { FOR_EACH_CONCURRENCY, MAX_FOR_EACH_ITEMS } from "#constants";
import { Engine } from "#engine";
import { executeWorkflow } from "#workflow";
import { evaluateCondition, parseCondition } from "#workflow-condition";
import { build, FAN_OUT, LOC, reply, run, runtimeOf, scripted } from "./workflow-harness.ts";

test("for_each runs the step per item in bounded parallel and keeps input order", async () => {
  const items = ["a", "b", "c", "d", "e", "f"];
  const { result, events, stats } = await run(FAN_OUT, { items }, async (prompt) => {
    const index = Number(prompt.split(":")[0]);
    await new Promise((resolve) => setTimeout(resolve, (items.length - index) * 4));
    return reply(`done ${prompt}`);
  });
  assert.deepEqual(result.output, { results: items.map((item, i) => `done ${i}:${item}`) });
  assert.equal(result.steps, items.length);
  assert.deepEqual(result.usage, { input: items.length, output: items.length });
  assert.equal(stats.calls, items.length);
  assert.ok(stats.peak > 1 && stats.peak <= FOR_EACH_CONCURRENCY, `peak ${stats.peak}`);
  assert.ok(events.includes("step 1/1 · 6 item(s)"));
  assert.ok(events.includes("step 1/1 · item 3/6"));
});

test("an empty list runs nothing and saves an empty list, end to end through the engine", async () => {
  const engine = new Engine(build(FAN_OUT));
  try {
    const result = await engine.runWorkflow("w", { items: [] });
    assert.deepEqual(result.output, { results: [] });
    assert.equal(result.steps, 0);
    await assert.rejects(engine.runWorkflow("w", { items: "nope" }), /must be of type array/);
  } finally {
    await engine.close();
  }
});

test("a for_each value that is not a list fails before any further model call", async () => {
  const body =
    '  steps:\n    - prompt: first\n      into: first\n    - for_each: first\n      prompt: "{item}"\n';
  await assert.rejects(
    run(body, {}, (prompt) => reply(prompt)),
    /workflow 'w' step 2\/2 for_each 'first' must be a list, got string/,
  );
});

test("a list over the item limit is refused before any model call", async () => {
  const items = Array.from({ length: MAX_FOR_EACH_ITEMS + 1 }, (_, i) => String(i));
  const { registry, stats } = scripted((prompt) => reply(prompt));
  const { project } = build(FAN_OUT);
  const workflow = project.workflows.get("w");
  if (!workflow) throw new Error("fixture declares no workflow w");
  await assert.rejects(
    executeWorkflow("w", workflow, { items }, runtimeOf(project, registry, [])),
    /has 101 items \(limit 100\)/,
  );
  assert.equal(stats().calls, 0);
});

test("when skips a step, leaves its into unset, and reports the skip", async () => {
  const body =
    "  output:\n    first: string\n    second: string\n    third: string\n  steps:\n" +
    "    - prompt: one\n      into: first\n" +
    "    - when: first == other\n      prompt: two\n      into: second\n" +
    "    - when: second is empty\n      prompt: three\n      into: third\n";
  const { result, events, stats } = await run(body, {}, (prompt) => reply(`r:${prompt}`));
  assert.deepEqual(result.output, { first: "r:one", third: "r:three" });
  assert.equal(stats.calls, 2);
  assert.deepEqual(events, ["step 1/3", "step 2/3 skipped (when first == other)", "step 3/3"]);
});

test("evaluateCondition covers every operator over strings, lists, maps, and scalars", () => {
  const vars = {
    s: "x",
    blank: " ",
    l: ["a"],
    el: [],
    m: { k: 1 },
    em: {},
    f: false,
    z: 0,
    n: null,
  };
  const check = (text: string) => evaluateCondition(parseCondition(text, LOC), vars);
  assert.deepEqual(["s", "blank", "l", "el", "m", "em", "f", "z", "n", "unset"].map(check), [
    true,
    false,
    true,
    false,
    true,
    false,
    false,
    false,
    false,
    false,
  ]);
  assert.deepEqual(["not s", "not el", "not f"].map(check), [false, true, true]);
  assert.deepEqual(
    ["s is empty", "blank is empty", "el is empty", "em is empty", "z is empty"].map(check),
    [false, true, true, true, false],
  );
  assert.deepEqual(["l is not empty", "n is not empty"].map(check), [true, false]);
  assert.deepEqual(["s == x", "z == 0", 'm == {"k":1}', "s != x", "unset != x"].map(check), [
    true,
    true,
    true,
    false,
    true,
  ]);
});
