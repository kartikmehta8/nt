/**
 * @file `config.audit` resolution tests: the default destination, every form of
 * the off and on switches, home- and file-relative folders, and the values the
 * field refuses.
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { parseAuditConfig, resolveAuditDir } from "#audit/config";
import { parseNt } from "#parse/parser";
import { buildProject } from "#schema/build";

const TEST_ROOT = nodePath.parse(nodePath.resolve(process.cwd())).root;
const LOC = { file: nodePath.join(TEST_ROOT, "proj", "config.nt"), line: 1 };

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), "nt-audit-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * @param source NT source text to parse and assemble.
 * @returns The build result for a single-file project.
 */
function build(source: string) {
  return buildProject([{ file: LOC.file, blocks: parseNt(source, LOC.file) }]);
}

test("audit defaults to on in ~/.nt/audit when config.audit is absent", () => {
  const { project } = build("config\n  target: node\n");
  assert.equal(project.config.audit.enabled, true);
  assert.equal(project.config.audit.dir, nodePath.join(os.homedir(), ".nt/audit"));
});

test("a project with no config block still has the default audit destination", () => {
  const { project } = build("skill s:\n  description: x\n");
  assert.equal(project.config.audit.enabled, true);
  assert.equal(project.config.audit.dir, nodePath.join(os.homedir(), ".nt/audit"));
});

test("config.audit turns logging off but still remembers the default folder", () => {
  for (const value of ["off", "OFF", "none", "disabled", "no", "false"]) {
    const { project } = build(`config\n  audit: ${value}\n`);
    assert.equal(project.config.audit.enabled, false, `'${value}' should disable the log`);
    assert.equal(project.config.audit.dir, nodePath.join(os.homedir(), ".nt/audit"));
  }
});

test("config.audit accepts an on switch and a home-relative folder", () => {
  for (const value of ["on", "yes", "true", "default"])
    assert.equal(build(`config\n  audit: ${value}\n`).project.config.audit.enabled, true);
  const { project } = build("config\n  audit: ~/logs/nt\n");
  assert.equal(project.config.audit.dir, nodePath.join(os.homedir(), "logs/nt"));
});

test("a relative audit folder resolves against the declaring file, not the cwd", () => {
  const { project } = build("config\n  audit: ./logs\n");
  assert.equal(project.config.audit.dir, nodePath.join(TEST_ROOT, "proj", "logs"));
});

test("an absolute audit folder is used as given", () => {
  const { project } = build(`config\n  audit: ${dir}\n`);
  assert.equal(project.config.audit.dir, dir);
});

test("config.audit rejects maps, lists, env() references, and empty values", () => {
  assert.throws(() => build("config\n  audit:\n    dir: /tmp/x\n"), /must be 'off' or a folder/);
  assert.throws(() => build("config\n  audit: [a, b]\n"), /must be 'off' or a folder/);
  assert.throws(() => build("config\n  audit: env(NT_AUDIT_DIR)\n"), /not an env\(\) reference/);
  assert.throws(() => build('config\n  audit: ""\n'), /config.audit is empty/);
});

test("resolveAuditDir expands a bare tilde and keeps absolute paths", () => {
  const base = nodePath.join(TEST_ROOT, "base");
  const absolute = nodePath.join(TEST_ROOT, "var", "log", "nt");
  assert.equal(resolveAuditDir("~", base), os.homedir());
  assert.equal(resolveAuditDir(absolute, base), absolute);
  assert.equal(resolveAuditDir("rel", base), nodePath.join(base, "rel"));
});

test("parseAuditConfig treats a null value as the default destination", () => {
  assert.deepEqual(parseAuditConfig(null, LOC), {
    enabled: true,
    dir: nodePath.join(os.homedir(), ".nt/audit"),
  });
});
