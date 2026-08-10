/**
 * @file `nt setup` output tests: what it reports for a fresh folder, for a
 * folder that already holds part of a project, and with `--force`; plus the
 * validation pass that runs on whatever ends up on disk.
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { parseArgs } from "#args";
import { cmdSetup } from "#setup";

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(nodePath.join(os.tmpdir(), "nt-cli-setup-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/**
 * @param argv CLI arguments for the setup command.
 * @returns Everything the command wrote to standard output.
 */
function capture(argv: string[]): string {
  const written: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk: string | Uint8Array): boolean => {
    written.push(String(chunk));
    return true;
  };
  try {
    cmdSetup(parseArgs(argv));
  } finally {
    process.stdout.write = original;
  }
  return written.join("");
}

test("setup writes the minimal project and prints what to do next", () => {
  const output = capture(["setup", root]);
  assert.match(output, /template: minimal/);
  assert.match(output, /\+ age\.nt/);
  assert.match(output, /\+ config\.nt/);
  assert.match(output, /✓ 2 \.nt file\(s\) OK/);
  assert.match(output, /Next steps/);
  assert.match(output, /ANTHROPIC_API_KEY/);
  assert.match(output, /nt run age -m/);
  assert.doesNotMatch(output, /nt mcp (?:trust|doctor)/);
  assert.ok(fs.existsSync(nodePath.join(root, "age.nt")));
});

test("setup --template full writes every file of the wired example", () => {
  const output = capture(["setup", root, "--template", "full"]);
  assert.match(output, /template: full/);
  assert.match(output, /\+ subagents\/researcher\.nt/);
  assert.match(output, /\+ mcp\/local\.nt/);
  assert.match(output, /\+ mcp\/echo-server\.mjs/);
  assert.match(output, /✓ 8 \.nt file\(s\) OK/);
  assert.match(output, /nt mcp trust local_demo/);
  assert.match(output, /nt mcp doctor local_demo/);
  assert.match(
    output,
    /nt mcp trust local_demo[\s\S]*nt mcp doctor local_demo[\s\S]*ANTHROPIC_API_KEY/,
  );
});

test("a second setup leaves existing files alone and points at --force", () => {
  capture(["setup", root]);
  const output = capture(["setup", root]);
  assert.match(output, /age\.nt \(already exists, left alone\)/);
  assert.match(output, /Pass --force to replace/);
  assert.equal(output.includes("+ age.nt"), false);
});

test("setup --force rewrites the files it wrote before", () => {
  capture(["setup", root]);
  fs.writeFileSync(nodePath.join(root, "age.nt"), "# gone\n");
  const output = capture(["setup", root, "--force"]);
  assert.match(output, /\+ age\.nt/);
  assert.equal(output.includes("already exists"), false);
  assert.match(fs.readFileSync(nodePath.join(root, "age.nt"), "utf8"), /^agent age$/m);
});

test("setup surfaces a broken file already in the folder", () => {
  fs.writeFileSync(nodePath.join(root, "age.nt"), "agent age\n  tools:\n    - nope\n");
  assert.throws(() => capture(["setup", root]), /unknown tool 'nope'/);
});

test("setup accepts the short template flag and defaults the folder to the current one", () => {
  const args = parseArgs(["setup", "-t", "full"]);
  assert.deepEqual(args.positional, ["setup"]);
  assert.equal(args.template, "full");
  assert.equal(args.force, false);
});
