/**
 * @file Graph rendering tests for workflow steps: the agent, skill, control
 * flow, and `into` target appear on one stable line per step, so `nt graph`
 * shows `for_each`, `when`, and `retry` exactly as the docs promise.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { describeStep } from "#inspect";

/**
 * @param text Possibly colored terminal text.
 * @returns The text with ANSI styling removed, so assertions hold on a TTY too.
 */
function plain(text: string): string {
  return text.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g"), "");
}

test("describeStep names the agent, skill, control flow, and into target", () => {
  assert.equal(plain(describeStep({ prompt: "x" }, "age")), "age");
  assert.equal(plain(describeStep({ prompt: "x" }, null)), "(default)");
  assert.equal(
    plain(describeStep({ agent: "researcher", forEach: "clues", into: "years" }, "age")),
    "researcher  [for each clues] → years",
  );
  assert.equal(
    plain(
      describeStep(
        {
          skill: "estimation",
          when: { variable: "years", op: "not_empty", source: "years is not empty" },
          retry: 2,
          into: "estimate",
        },
        "age",
      ),
    ),
    "age +skill:estimation  [when years is not empty · retry 2] → estimate",
  );
  assert.equal(plain(describeStep({ retry: 0 }, "age")), "age  [retry 0]");
});
