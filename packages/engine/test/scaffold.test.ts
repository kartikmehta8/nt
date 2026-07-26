/**
 * @file Scaffolding tests: every starter template loads as a valid project with
 * no warnings, existing files are never clobbered without `--force`, template
 * paths stay inside the target folder, and bad targets fail with clear errors.
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { loadProject } from "#loader";
import { getTemplate, TEMPLATE_NAMES } from "#scaffold/templates";
import { scaffoldProject } from "#scaffold/write";

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(nodePath.join(os.tmpdir(), "nt-scaffold-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

test("every template scaffolds into a project that loads with no warnings", () => {
  for (const name of TEMPLATE_NAMES) {
    const dir = nodePath.join(root, name);
    const result = scaffoldProject(dir, { template: name });
    assert.equal(result.template, name);
    assert.deepEqual(result.skipped, []);
    assert.deepEqual(
      result.created,
      getTemplate(name).files.map((f) => f.path),
    );
    const { project, warnings } = loadProject(result.entry);
    assert.deepEqual(warnings, [], `${name} template should scaffold without warnings`);
    assert.equal(project.files.length, result.created.length);
    assert.ok(project.agents.has("age"), `${name} template should declare the age agent`);
    assert.equal(project.config.entry, "age");
  }
});

test("the full template wires up one of every capability", () => {
  const { entry } = scaffoldProject(root, { template: "full" });
  const { project } = loadProject(entry);
  assert.ok(project.subagents.has("researcher"));
  assert.ok(project.tools.has("current_year"));
  assert.ok(project.skills.has("estimation"));
  assert.ok(project.sandboxes.has("workspace"));
  assert.ok(project.workflows.has("estimate_age"));
  assert.ok(fs.existsSync(nodePath.join(root, "subagents", "researcher.nt")), "nested dirs made");
});

test("the default template is minimal, and it creates the folder it is given", () => {
  const dir = nodePath.join(root, "nested", "project");
  const result = scaffoldProject(dir);
  assert.equal(result.template, "minimal");
  assert.deepEqual(result.created, ["age.nt", "config.nt"]);
  assert.equal(result.entry, nodePath.join(dir, "age.nt"));
});

test("existing files are reported and left byte-for-byte alone", () => {
  scaffoldProject(root);
  fs.writeFileSync(nodePath.join(root, "age.nt"), "skill mine:\n  description: hand written\n");
  fs.rmSync(nodePath.join(root, "config.nt"));

  const result = scaffoldProject(root);
  assert.deepEqual(result.skipped, ["age.nt"]);
  assert.deepEqual(result.created, ["config.nt"]);
  assert.equal(
    fs.readFileSync(nodePath.join(root, "age.nt"), "utf8"),
    "skill mine:\n  description: hand written\n",
  );
});

test("force replaces existing files with the template's version", () => {
  scaffoldProject(root);
  fs.writeFileSync(nodePath.join(root, "age.nt"), "# clobber me\n");
  const result = scaffoldProject(root, { force: true });
  assert.deepEqual(result.skipped, []);
  assert.deepEqual(result.created, ["age.nt", "config.nt"]);
  assert.match(fs.readFileSync(nodePath.join(root, "age.nt"), "utf8"), /^agent age$/m);
});

test("an unknown template names the ones that exist, and writes nothing", () => {
  assert.throws(
    () => scaffoldProject(root, { template: "enterprise" }),
    /unknown template 'enterprise'; expected one of: minimal, full/,
  );
  assert.deepEqual(fs.readdirSync(root), []);
});

test("a target that is a file is refused", () => {
  const file = nodePath.join(root, "age.nt");
  fs.writeFileSync(file, "");
  assert.throws(() => scaffoldProject(file), /it is a file, not a folder/);
});

test("template paths are relative and stay inside the project folder", () => {
  for (const name of TEMPLATE_NAMES)
    for (const file of getTemplate(name).files) {
      assert.ok(!nodePath.isAbsolute(file.path), `${file.path} must be relative`);
      assert.ok(!file.path.split("/").includes(".."), `${file.path} must not traverse upwards`);
      assert.ok(file.content.endsWith("\n"), `${file.path} must end with a newline`);
    }
});
