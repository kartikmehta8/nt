/**
 * @file Loader containment tests: imports are confined to the project
 * directory unless opted out, and the per-file size cap is enforced.
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { loadProject } from "#loader";

let root: string;
let outside: string;

beforeEach(() => {
  root = fs.mkdtempSync(nodePath.join(os.tmpdir(), "nt-proj-"));
  outside = fs.mkdtempSync(nodePath.join(os.tmpdir(), "nt-out-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});

test("imports outside the project directory are rejected by default", () => {
  fs.writeFileSync(nodePath.join(outside, "secret.nt"), "skill s:\n  description: x\n");
  fs.writeFileSync(
    nodePath.join(root, "main.nt"),
    `import ${nodePath.join(outside, "secret.nt")}\n`,
  );
  assert.throws(() => loadProject(nodePath.join(root, "main.nt")), /outside the project directory/);
});

test("allowOutsideImports permits an escaping import", () => {
  fs.writeFileSync(nodePath.join(outside, "secret.nt"), "skill s:\n  description: x\n");
  fs.writeFileSync(
    nodePath.join(root, "main.nt"),
    `import ${nodePath.join(outside, "secret.nt")}\n`,
  );
  assert.doesNotThrow(() =>
    loadProject(nodePath.join(root, "main.nt"), { allowOutsideImports: true }),
  );
});

test("imports inside the project directory load normally", () => {
  fs.writeFileSync(nodePath.join(root, "tools.nt"), "skill s:\n  description: x\n");
  fs.writeFileSync(nodePath.join(root, "main.nt"), "import ./tools.nt\n");
  const { project } = loadProject(nodePath.join(root, "main.nt"));
  assert.ok(project.skills.has("s"));
});

test("a .nt file over the size cap is refused", () => {
  const big = "skill s:\n  description: " + "x".repeat(1_100_000) + "\n";
  fs.writeFileSync(nodePath.join(root, "main.nt"), big);
  assert.throws(() => loadProject(nodePath.join(root, "main.nt")), /byte limit/);
});
