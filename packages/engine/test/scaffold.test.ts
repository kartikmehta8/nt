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
import { MemoryCredentialStore } from "#mcp/credentials";
import { McpManager } from "#mcp/manager";
import { McpTrustStore } from "#mcp/trust";
import { getTemplate, TEMPLATE_NAMES } from "#scaffold/templates";
import { scaffoldProject } from "#scaffold/write";
import { removeTemporaryDirectories } from "./temp-cleanup.ts";

let root: string;
const temporary: string[] = [];

beforeEach(() => {
  root = fs.mkdtempSync(nodePath.join(os.tmpdir(), "nt-scaffold-"));
  temporary.push(root);
});

afterEach(async () => {
  await removeTemporaryDirectories(temporary);
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
    assert.equal(
      project.files.length,
      result.created.filter((path) => path.endsWith(".nt")).length,
    );
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
  assert.ok(project.mcpServers.has("local_demo"));
  assert.ok(project.agents.get("age")?.tools.includes("local_demo.echo"));
  assert.ok(fs.existsSync(nodePath.join(root, "subagents", "researcher.nt")), "nested dirs made");
  assert.ok(fs.existsSync(nodePath.join(root, "mcp", "local.nt")), "MCP declaration made");
  assert.ok(fs.existsSync(nodePath.join(root, "mcp", "echo-server.mjs")), "MCP server made");
});

test("the full template's local MCP example discovers and calls its echo tool", async () => {
  const { entry } = scaffoldProject(root, { template: "full" });
  const { project } = loadProject(entry);
  const server = project.mcpServers.get("local_demo");
  assert.ok(server, "full template should declare the local MCP server");
  const trust = new McpTrustStore(nodePath.join(root, ".test-trust.json"));
  trust.trust(server);
  const manager = new McpManager(project, trust, new MemoryCredentialStore());

  try {
    const prepared = await manager.prepare(["local_demo.echo"]);
    const tool = prepared.tools[0];
    assert.ok(tool, "local echo should be discovered and prepared");
    assert.equal(tool.catalog.info.remoteName, "echo");
    const result = await manager.call(tool, { text: "hello from the full starter" });
    assert.match(result.modelContent, /echo: hello from the full starter/);
    const report = (await manager.doctor("local_demo"))[0];
    assert.ok(report, "local echo should produce a doctor report");
    assert.equal(report.usable, true);
    assert.equal(report.checks.length, 10);
    assert.ok(report.checks.every((check) => check.status === "pass"));
  } finally {
    await manager.close();
  }
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
