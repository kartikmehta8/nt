/**
 * @file Interpolation-safety and structured-output tests: shell quoting,
 * URL encoding, JSON extraction, and output-schema conformance. These cases
 * exercise the shared boundary used before custom tools run and after model
 * responses return, with adversarial punctuation kept as literal data.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildOutputSchema,
  conformsToOutputSchema,
  extractJson,
  interpolate,
  interpolateShell,
  interpolateUrl,
  shellQuote,
  validateInput,
} from "#io";
import { parseStructuredOutput } from "#runtime";

test("interpolate substitutes raw values and keeps unknown placeholders", () => {
  assert.equal(interpolate("hi {name}, {missing}", { name: "x" }), "hi x, {missing}");
});

test("shellQuote neutralizes single quotes and metacharacters", () => {
  assert.equal(shellQuote("a'b"), "'a'\\''b'");
  assert.equal(shellQuote("x; rm -rf ~"), "'x; rm -rf ~'");
});

test("interpolateShell wraps model input so injection stays one literal word", () => {
  const cmd = interpolateShell("convert {file}", { file: "x; rm -rf ~" });
  assert.equal(cmd, "convert 'x; rm -rf ~'");
});

test("interpolateUrl percent-encodes model input", () => {
  const url = interpolateUrl("https://api.example.com/v1/{q}", { q: "a/b?c=d#e" });
  assert.equal(url, "https://api.example.com/v1/a%2Fb%3Fc%3Dd%23e");
});

test("extractJson parses raw, fenced, and embedded objects", () => {
  assert.deepEqual(extractJson('{"a": 1}'), { a: 1 });
  assert.deepEqual(extractJson('Sure!\n```json\n{"a": 1}\n```\nDone.'), { a: 1 });
  assert.deepEqual(extractJson('The result is {"a": 1} as requested.'), { a: 1 });
  assert.equal(extractJson("no json here"), null);
  assert.equal(extractJson("[1, 2]"), null);
});

test("conformsToOutputSchema checks required fields and primitive types", () => {
  const schema = buildOutputSchema([
    { name: "age", type: "number", required: true },
    { name: "tags", type: "array", required: true },
  ]);
  assert.equal(conformsToOutputSchema({ age: 3, tags: [] }, schema), true);
  assert.equal(conformsToOutputSchema({ age: "3", tags: [] }, schema), false);
  assert.equal(conformsToOutputSchema({ age: 3 }, schema), false);
});

test("structured output preserves fields declared with required false", () => {
  const schema = buildOutputSchema([
    { name: "required", type: "string", required: true },
    { name: "optional", type: "number", required: false },
  ]);
  assert.deepEqual(schema.required, ["required"]);
  assert.equal(conformsToOutputSchema({ required: "present" }, schema), true);
  assert.equal(conformsToOutputSchema({ required: "present", optional: 2 }, schema), true);
});

test("parseStructuredOutput returns null on schema mismatch and parses prose-wrapped JSON", () => {
  const schema = buildOutputSchema([{ name: "ok", type: "boolean", required: true }]);
  assert.deepEqual(parseStructuredOutput(schema, 'Here you go: {"ok": true}'), { ok: true });
  assert.equal(parseStructuredOutput(schema, '{"ok": "yes"}'), null);
  assert.equal(parseStructuredOutput(null, '{"ok": true}'), null);
});

test("conformsToOutputSchema checks array element types", () => {
  const schema = buildOutputSchema([{ name: "tags", type: "array", required: true }]);
  assert.equal(conformsToOutputSchema({ tags: ["a", "b"] }, schema), true);
  assert.equal(conformsToOutputSchema({ tags: [] }, schema), true);
  assert.equal(conformsToOutputSchema({ tags: [1, 2, 3] }, schema), false);
  assert.equal(conformsToOutputSchema({ tags: ["a", 2] }, schema), false);
});

test("validateInput rejects undeclared fields so nothing outside the schema passes through", () => {
  const fields = [{ name: "q", type: "string" as const, required: true }];
  assert.equal(validateInput(fields, { q: "ok" }), null);
  assert.match(validateInput(fields, { q: "ok", role: "admin" }) ?? "", /unknown field 'role'/);
  assert.match(validateInput([], { anything: 1 }) ?? "", /unknown field 'anything'/);
});

test("validateInput enforces string items in declared arrays", () => {
  const fields = [{ name: "tags", type: "array" as const, required: true }];
  assert.equal(validateInput(fields, { tags: ["a", "b"] }), null);
  assert.match(validateInput(fields, { tags: ["a", 2] }) ?? "", /array of strings/);
  assert.match(validateInput(fields, { tags: [{}] }) ?? "", /array of strings/);
});
