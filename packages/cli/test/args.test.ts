/**
 * @file Argument-parsing tests: flags requiring values, unknown-flag
 * rejection, and the `--allow-outside-imports` toggle.
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import { test } from "node:test";
import { DEFAULT_ENTRY, parseArgs, resolveEntry } from "#args";

test("a flag missing its value is a clear error, not a later TypeError", () => {
  assert.throws(() => parseArgs(["run", "--dir"]), /--dir requires a value/);
  assert.throws(() => parseArgs(["run", "--dir", "--verbose"]), /--dir requires a value/);
});

test("unknown flags are rejected", () => {
  assert.throws(() => parseArgs(["run", "--nope"]), /unknown flag '--nope'/);
});

test("valid flags and positionals parse", () => {
  const args = parseArgs([
    "run",
    "greeter",
    "--dir",
    "proj",
    "-m",
    "hi",
    "--allow-outside-imports",
  ]);
  assert.deepEqual(args.positional, ["run", "greeter"]);
  assert.equal(args.dir, "proj");
  assert.equal(args.message, "hi");
  assert.equal(args.allowOutsideImports, true);
});

test("allowOutsideImports defaults to false", () => {
  assert.equal(parseArgs(["validate"]).allowOutsideImports, false);
});

test("the path defaults to age.nt and is not marked explicit", () => {
  const args = parseArgs(["validate"]);
  assert.equal(args.dir, DEFAULT_ENTRY);
  assert.equal(args.explicitPath, false);
  assert.equal(parseArgs(["validate", "--file", "other.nt"]).explicitPath, true);
});

test("resolveEntry returns the path when it exists", () => {
  const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), "nt-entry-"));
  try {
    const file = nodePath.join(dir, "custom.nt");
    fs.writeFileSync(file, "skill s:\n  description: x\n");
    assert.equal(resolveEntry(parseArgs(["validate", "--file", file])), file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a missing default age.nt gives a directory-aware error", () => {
  const args = parseArgs(["validate"]);
  args.dir = nodePath.join(os.tmpdir(), "definitely-absent-age.nt");
  assert.throws(() => resolveEntry(args), /no age\.nt in the current directory/);
});

test("a missing explicit path gives a plain not-found error", () => {
  assert.throws(
    () => resolveEntry(parseArgs(["validate", "--file", "/no/such/thing.nt"])),
    /no such file or directory/,
  );
});
