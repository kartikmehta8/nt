/**
 * @file Static validation of workflow control flow: `for_each`, `when`, and
 * `retry` are coerced into typed steps, may only reference declared inputs or
 * earlier `into` results, respect declared input types and the retry bound,
 * and the repository example declares them the way the docs promise. Nothing
 * here runs a model.
 */

import assert from "node:assert/strict";
import * as nodePath from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { MAX_STEP_RETRIES } from "#constants";
import { loadProject } from "#loader";
import { parseNt } from "#parse/parser";
import { buildProject } from "#schema/build";
import { parseCondition } from "#workflow-condition";
import type { WorkflowStep } from "#types";

const LOC = { file: "<test>", line: 1 };
const HEADER = "agent a:\n  model: anthropic/claude-sonnet-5\n";

/**
 * @param source NT source text to parse and assemble.
 * @returns The build result for a single-file project.
 */
function build(source: string) {
  return buildProject([{ file: LOC.file, blocks: parseNt(source, LOC.file) }]);
}

/**
 * @param body The workflow body, indented two spaces per line.
 * @returns The parsed steps of workflow `w`, built alongside a valid agent.
 */
function stepsOf(body: string): WorkflowStep[] {
  const { project } = build(`${HEADER}workflow w:\n  agent: a\n${body}`);
  return project.workflows.get("w")?.steps ?? [];
}

test("for_each, when, and retry parse into typed control flow", () => {
  const { project, warnings } = build(
    `${HEADER}workflow w:\n  agent: a\n  input:\n    clues: array\n  steps:\n` +
      '    - for_each: clues\n      prompt: "{item}"\n      into: years\n' +
      "    - when: years is not empty\n      retry: 2\n      into: estimate\n",
  );
  assert.deepEqual(warnings, []);
  const steps = project.workflows.get("w")?.steps ?? [];
  assert.equal(steps[0].forEach, "clues");
  assert.equal(steps[0].when, undefined);
  assert.deepEqual(steps[1].when, {
    variable: "years",
    op: "not_empty",
    source: "years is not empty",
  });
  assert.equal(steps[1].retry, 2);
});

test("the {name} spelling of for_each is accepted and normalized to the bare name", () => {
  const steps = stepsOf('  input:\n    clues: array\n  steps:\n    - for_each: "{clues}"\n');
  assert.equal(steps[0].forEach, "clues");
  assert.throws(
    () => stepsOf("  input:\n    clues: array\n  steps:\n    - for_each: clues[0]\n"),
    /step.for_each must name a variable, got 'clues\[0\]'/,
  );
});

test("when accepts exactly six condition forms", () => {
  assert.deepEqual(parseCondition("x", LOC), { variable: "x", op: "truthy", source: "x" });
  assert.deepEqual(parseCondition("not x", LOC), { variable: "x", op: "falsy", source: "not x" });
  assert.deepEqual(parseCondition("x is empty", LOC), {
    variable: "x",
    op: "empty",
    source: "x is empty",
  });
  assert.deepEqual(parseCondition("{x} is not empty", LOC), {
    variable: "x",
    op: "not_empty",
    source: "x is not empty",
  });
  assert.deepEqual(parseCondition("x == foo", LOC), {
    variable: "x",
    op: "equals",
    value: "foo",
    source: "x == foo",
  });
  assert.deepEqual(parseCondition('x != "two words"', LOC), {
    variable: "x",
    op: "not_equals",
    value: "two words",
    source: 'x != "two words"',
  });
  for (const bad of ["x > 1", "not x is empty", "not x == y", "x is blank", "", "x == "])
    assert.throws(() => parseCondition(bad, LOC), /not a supported condition/, bad);
});

test("retry must be a whole number within the bound", () => {
  assert.equal(stepsOf("  steps:\n    - retry: 0\n")[0].retry, 0);
  assert.equal(stepsOf(`  steps:\n    - retry: ${MAX_STEP_RETRIES}\n`)[0].retry, MAX_STEP_RETRIES);
  assert.equal(stepsOf("  steps:\n    - prompt: x\n")[0].retry, undefined);
  for (const bad of ["1.5", "-1", String(MAX_STEP_RETRIES + 1), "two", '"2"'])
    assert.throws(
      () => stepsOf(`  steps:\n    - retry: ${bad}\n`),
      /step.retry must be a whole number between 0 and 5/,
      bad,
    );
});

test("for_each and when may only name a workflow input or an earlier step's into", () => {
  const undeclared =
    /references 'missing', which is not a workflow input or an earlier step's into/;
  assert.throws(() => stepsOf("  steps:\n    - for_each: missing\n"), undeclared);
  assert.throws(() => stepsOf("  steps:\n    - when: missing is empty\n"), undeclared);
  assert.throws(
    () => stepsOf("  steps:\n    - when: later\n    - prompt: x\n      into: later\n"),
    /step 1 when references 'later'/,
  );
  const steps = stepsOf(
    "  steps:\n    - when: message\n      into: first\n    - for_each: first\n      when: not first\n",
  );
  assert.equal(steps[1].forEach, "first");
  assert.equal(steps[1].when?.op, "falsy");
});

test("for_each refuses an input declared as a non-list type", () => {
  assert.throws(
    () => stepsOf("  input:\n    clues: string\n  steps:\n    - for_each: clues\n"),
    /step 1 for_each 'clues' must be a list, but input 'clues' is declared as string/,
  );
  assert.equal(
    stepsOf("  input:\n    clues: array\n  steps:\n    - for_each: clues\n")[0].forEach,
    "clues",
  );
});

test("the repository example declares the batch workflow the docs describe", () => {
  const entry = nodePath.resolve(
    nodePath.dirname(fileURLToPath(import.meta.url)),
    "../../../example/age.nt",
  );
  const { project } = loadProject(entry);
  const batch = project.workflows.get("estimate_ages");
  assert.ok(batch, "example should declare estimate_ages");
  assert.deepEqual(
    batch.steps.map((step) => [step.forEach, step.when?.source, step.retry, step.into]),
    [
      ["clues", undefined, undefined, "years"],
      [undefined, "years is not empty", 2, "estimate"],
    ],
  );
  assert.ok(project.workflows.has("estimate_age"), "the two-step pipeline remains");
});
