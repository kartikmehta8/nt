/**
 * @file Offline contract tests for workflow control-flow support in the VS
 * Code extension: step-field completion context, `agent:` / `skill:`
 * reference completion, hover on step fields, the grammar rules for `when`,
 * `for_each`, and `{placeholder}` references, and the workflow snippets.
 * The extension's pure CommonJS modules load without the editor API.
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as nodePath from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { LIST_KEYS, STEP_FIELDS, listContext, stepKeyContext, stepFieldAt } =
  require("../../vscode-nt/context.js") as {
    LIST_KEYS: Record<string, string[]>;
    STEP_FIELDS: Record<string, string>;
    listContext(document: Doc, position: { line: number; character: number }): string | undefined;
    stepKeyContext(document: Doc, position: { line: number; character: number }): boolean;
    stepFieldAt(document: Doc, lineIndex: number): string | undefined;
  };

interface Doc {
  lineAt(index: number): { text: string };
}

const extensionRoot = nodePath.resolve(
  nodePath.dirname(fileURLToPath(import.meta.url)),
  "../../vscode-nt",
);

/**
 * @param lines The document's lines.
 * @returns The minimal document surface the context parser reads.
 */
function doc(lines: string[]): Doc {
  return { lineAt: (index) => ({ text: lines[index] }) };
}

const WORKFLOW = [
  "workflow w",
  "  agent: a",
  "  steps:",
  "    - agent: researcher",
  "      for_each: clues",
  "      ",
  "    - ",
  "  output:",
  "    x: string",
];

test("step fields are suggested only at the key position inside a steps list", () => {
  assert.equal(stepKeyContext(doc(WORKFLOW), { line: 5, character: 6 }), true, "sibling key");
  assert.equal(stepKeyContext(doc(WORKFLOW), { line: 6, character: 6 }), true, "new list item");
  assert.equal(stepKeyContext(doc(WORKFLOW), { line: 8, character: 4 }), false, "under output");
  assert.equal(stepKeyContext(doc(WORKFLOW), { line: 1, character: 2 }), false, "workflow field");
  assert.equal(stepKeyContext(doc(WORKFLOW), { line: 4, character: 15 }), false, "in a value");
  assert.deepEqual(Object.keys(STEP_FIELDS), [
    "agent",
    "prompt",
    "skill",
    "into",
    "for_each",
    "when",
    "retry",
  ]);
  for (const [field, text] of Object.entries(STEP_FIELDS))
    assert.ok(text.length > 20, `${field} is documented`);
});

test("hover recognizes step fields by line, but not the same words elsewhere", () => {
  assert.equal(stepFieldAt(doc(WORKFLOW), 3), "agent");
  assert.equal(stepFieldAt(doc(WORKFLOW), 4), "for_each");
  assert.equal(stepFieldAt(doc(WORKFLOW), 1), undefined, "workflow.agent is not a step field");
  assert.equal(stepFieldAt(doc(WORKFLOW), 8), undefined);
});

test("agent: and skill: values complete from declarations, in steps and on the workflow", () => {
  assert.equal(
    listContext(doc(["workflow w", "  steps:", "    - agent: res"]), { line: 2, character: 16 }),
    "agent",
  );
  assert.equal(listContext(doc(["      skill: est"]), { line: 0, character: 16 }), "skill");
  assert.equal(listContext(doc(["  agent: a"]), { line: 0, character: 10 }), "agent");
  assert.deepEqual(LIST_KEYS.agent, ["agent", "subagent"]);
  assert.deepEqual(LIST_KEYS.skill, ["skill"]);
});

test("the grammar highlights when conditions, for_each references, and placeholders", () => {
  const grammar = JSON.parse(
    fs.readFileSync(nodePath.join(extensionRoot, "syntaxes/nt.tmLanguage.json"), "utf8"),
  ) as {
    patterns: Array<{ include: string }>;
    repository: Record<string, { match?: string; name?: string }>;
  };
  const order = grammar.patterns.map((entry) => entry.include);
  assert.ok(order.indexOf("#whenCondition") < order.indexOf("#mapping"));
  assert.ok(order.indexOf("#forEachRef") < order.indexOf("#mapping"));
  const when = new RegExp(grammar.repository.whenCondition.match ?? "");
  for (const line of [
    "    - when: years is not empty",
    "      when: not x",
    "      when: {x} == 'a b'",
    "      when: x != 1",
    "      when: x",
  ])
    assert.ok(when.test(line), line);
  assert.equal(when.test("      when: x > 1"), false, "unsupported forms fall back to mapping");
  const forEach = new RegExp(grammar.repository.forEachRef.match ?? "");
  assert.ok(forEach.test("      for_each: clues"));
  assert.ok(forEach.test('      for_each: "{clues}"') === false, "quoted forms are plain strings");
  assert.equal(grammar.repository.placeholder.name, "variable.other.placeholder.nt");
  assert.match(fs.readFileSync(nodePath.join(extensionRoot, "README.md"), "utf8"), /for_each/);
});

test("workflow snippets cover the pipeline, for_each, and when + retry shapes", () => {
  const snippets = JSON.parse(
    fs.readFileSync(nodePath.join(extensionRoot, "snippets/nt.json"), "utf8"),
  ) as Record<string, { prefix: string; body: string[] }>;
  const bodies = Object.fromEntries(
    Object.values(snippets).map((snippet) => [snippet.prefix, snippet.body.join("\n")]),
  );
  assert.match(bodies.workflow, /^workflow \$\{1:name\}/);
  assert.match(bodies.workflow, /steps:/);
  assert.match(bodies["workflow-for-each"], /for_each: /);
  assert.match(bodies["workflow-for-each"], /\{item\}/);
  assert.match(bodies["workflow-when"], /when: /);
  assert.match(bodies["workflow-when"], /retry: /);
});
