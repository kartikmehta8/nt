/**
 * @file Parser and lexer regression tests: escape decoding, bracket
 * balancing, prototype-key rejection, and `required: false` coercion.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { splitTopLevel, unquote } from "#parse/lexer";
import { parseNt } from "#parse/parser";
import { parseScalar } from "#parse/scalar";
import { parseFields } from "#schema/coerce";

const LOC = { file: "<test>", line: 1 };

test("unquote decodes escaped backslash before n as backslash + n", () => {
  assert.equal(unquote('"a\\\\nb"'), "a\\nb");
});

test("unquote decodes newline, tab, and quote escapes", () => {
  assert.equal(unquote('"a\\nb\\tc\\"d"'), 'a\nb\tc"d');
});

test("unquote leaves unknown escapes intact", () => {
  assert.equal(unquote('"a\\rb"'), "a\\rb");
});

test("unquote leaves single-quoted strings verbatim", () => {
  assert.equal(unquote("'a\\nb'"), "a\\nb");
});

test("splitTopLevel splits respecting quotes and nesting", () => {
  assert.deepEqual(splitTopLevel('a, "b, c", [d, e]', LOC), ["a", ' "b, c"', " [d, e]"]);
});

test("splitTopLevel throws on unbalanced brackets", () => {
  assert.throws(() => splitTopLevel("a, b]", LOC), /unbalanced brackets/);
  assert.throws(() => splitTopLevel("[a, b", LOC), /unbalanced brackets/);
});

test("parseScalar handles booleans, numbers, env refs, and flow lists", () => {
  assert.equal(parseScalar("false", LOC), false);
  assert.equal(parseScalar("42", LOC), 42);
  assert.deepEqual(parseScalar("env(FOO, bar)", LOC), { __env: "FOO", default: "bar" });
  assert.deepEqual(parseScalar("[a, 1, true]", LOC), ["a", 1, true]);
});

test("parser rejects __proto__, constructor, and prototype keys", () => {
  for (const key of ["__proto__", "constructor", "prototype"])
    assert.throws(
      () => parseNt(`agent a:\n  instructions:\n    ${key}: x\n`, "<test>"),
      /not allowed as a key/,
    );
});

test("parser rejects nesting beyond the depth cap", () => {
  let src = "agent a:\n";
  let indent = "  ";
  for (let i = 0; i < 150; i++) {
    src += `${indent}k:\n`;
    indent += "  ";
  }
  assert.throws(() => parseNt(src, "<test>"), /nesting too deep/);
});

test("parser produces plain maps for normal documents", () => {
  const blocks = parseNt(
    "agent greeter:\n  description: hi\n  model: anthropic/claude-opus-4-8\n",
    "<test>",
  );
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].kind, "agent");
  assert.equal(blocks[0].name, "greeter");
  assert.equal(blocks[0].body.description, "hi");
});

test("parseFields treats required false and 'false' as optional", () => {
  const fields = parseFields(
    {
      a: { type: "string", required: false },
      b: { type: "string", required: "false" },
      c: { type: "string", required: true },
      d: { type: "string" },
    },
    "test",
    LOC,
  );
  assert.deepEqual(
    fields.map((f) => f.required),
    [false, false, true, true],
  );
});

test("inline flow-list nesting is capped like container nesting", () => {
  const depth = 150;
  const hostile = "[".repeat(depth) + "]".repeat(depth);
  assert.throws(() => parseScalar(hostile, LOC), /flow list nesting too deep/);
  assert.deepEqual(parseScalar("[[a, b], [c]]", LOC), [["a", "b"], ["c"]]);
});
