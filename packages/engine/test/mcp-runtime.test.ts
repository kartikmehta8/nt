/**
 * @file End-to-end stdio MCP runtime and operational-diagnostics tests.
 *
 * Exercises the official client against the repository fixture to verify trust
 * before spawn, minimal child environments, discovery, plain-object and schema
 * input validation, exact dispatch, once-per-run approval, doctor reporting,
 * and cleanup. A scripted provider drives the agent loop without a model or
 * public network call.
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, test } from "node:test";
import { buildCatalog } from "#mcp/catalog";
import { MemoryCredentialStore } from "#mcp/credentials";
import { McpManager, type PreparedMcpTool } from "#mcp/manager";
import { modelToolName } from "#mcp/names";
import { McpTrustStore } from "#mcp/trust";
import { parseNt } from "#parse/parser";
import { ProviderRegistry } from "#provider";
import { VirtualSandbox } from "#sandbox";
import { buildProject } from "#schema/build";
import { runSession } from "#session";

const temporary: string[] = [];

afterEach(() => {
  while (temporary.length) {
    const target = temporary.pop();
    if (target) fs.rmSync(target, { recursive: true, force: true });
  }
  delete process.env.ALLOWED_MCP_TEST;
  delete process.env.UNRELATED_HOST_SECRET;
});

function build(source: string, file = nodePath.join(process.cwd(), "test.nt")) {
  return buildProject([{ file, blocks: parseNt(source, file) }]);
}

function required<T>(value: T | undefined, label: string): T {
  assert.ok(value, label);
  return value;
}

function preparedAt(tools: PreparedMcpTool[], index: number): PreparedMcpTool {
  return required(tools[index], `prepared MCP tool at index ${index}`);
}

function fixturePath(): string {
  return nodePath.join(
    nodePath.dirname(fileURLToPath(import.meta.url)),
    "fixtures/mcp/stdio-server.mjs",
  );
}

test("SDK-backed stdio discovery and calls enforce selection, schemas, and minimal environment", async () => {
  const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), "nt-mcp-runtime-"));
  temporary.push(dir);
  const source = `mcp local\n  transport: stdio\n  command: ${process.execPath}\n  args: [${fixturePath()}]\n  env:\n    ALLOWED_MCP_TEST: env(ALLOWED_MCP_TEST)\n  tools:\n    echo:\n      approval: never\n    environment:\n      approval: never\n`;
  const { project } = build(source, nodePath.join(dir, "age.nt"));
  const trust = new McpTrustStore(nodePath.join(dir, "trust.json"));
  trust.trust(required(project.mcpServers.get("local"), "local MCP definition"));
  process.env.ALLOWED_MCP_TEST = "visible";
  process.env.UNRELATED_HOST_SECRET = "must-not-leak";
  const manager = new McpManager(project, trust, new MemoryCredentialStore());
  try {
    const [prepared, concurrent] = await Promise.all([
      manager.prepare(["local.echo", "local.environment"]),
      manager.prepare(["local.echo"]),
    ]);
    assert.equal(concurrent.tools[0]?.catalog.info.remoteName, "echo");
    assert.deepEqual(
      prepared.tools.map((tool) => tool.catalog.info.remoteName),
      ["echo", "environment"],
    );
    await assert.rejects(
      () =>
        manager.call(
          preparedAt(prepared.tools, 0),
          new Date() as unknown as Record<string, unknown>,
        ),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "MCP_INPUT_INVALID",
    );
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    await assert.rejects(
      () => manager.call(preparedAt(prepared.tools, 0), circular),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "MCP_INPUT_INVALID",
    );
    await assert.rejects(
      () => manager.call(preparedAt(prepared.tools, 0), { text: 123 }),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "MCP_INPUT_INVALID",
    );
    const echo = await manager.call(preparedAt(prepared.tools, 0), { text: "hello" });
    assert.match(echo.modelContent, /echo: hello/);
    const environment = await manager.call(preparedAt(prepared.tools, 1), {});
    assert.match(environment.modelContent, /"allowed":"visible"/);
    assert.match(environment.modelContent, /"unrelated":null/);
  } finally {
    await Promise.all([manager.close(), manager.close()]);
  }
  await assert.rejects(() => manager.prepare(["local.echo"]), /closed/);
});

test("catalog rejects selected tools missing from the server", () => {
  const { project } = build("mcp local\n  transport: stdio\n  command: node\n  tools: [missing]\n");
  const definition = required(project.mcpServers.get("local"), "local MCP definition");
  assert.throws(() => buildCatalog(definition, []), /not advertised/);
});

test("closing during connection rejects preparation and settles concurrent closes", async () => {
  const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), "nt-mcp-closing-"));
  temporary.push(dir);
  const source = `mcp local
  transport: stdio
  command: ${process.execPath}
  args: [${fixturePath()}]
  tools: [echo]
`;
  const { project } = build(source, nodePath.join(dir, "age.nt"));
  const trust = new McpTrustStore(nodePath.join(dir, "trust.json"));
  trust.trust(required(project.mcpServers.get("local"), "local MCP definition"));
  const manager = new McpManager(project, trust, new MemoryCredentialStore());
  const preparation = manager.prepare(["local.echo"]);
  await Promise.all([manager.close(), manager.close()]);
  await assert.rejects(
    preparation,
    (error: unknown) =>
      typeof error === "object" && error !== null && "code" in error && error.code === "MCP_CLOSED",
  );
});

test("doctor reports ten independent checks and closes its diagnostic connection", async () => {
  const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), "nt-mcp-doctor-"));
  temporary.push(dir);
  const source = `mcp local\n  transport: stdio\n  command: ${process.execPath}\n  args: [${fixturePath()}]\n  tools: [echo]\n`;
  const { project } = build(source, nodePath.join(dir, "age.nt"));
  const trust = new McpTrustStore(nodePath.join(dir, "trust.json"));
  trust.trust(required(project.mcpServers.get("local"), "local MCP definition"));
  const manager = new McpManager(project, trust, new MemoryCredentialStore());
  try {
    const reports = await manager.doctor("local");
    const report = required(reports[0], "local doctor report");
    assert.equal(report.usable, true);
    assert.equal(report.checks.length, 10);
    assert.ok(report.checks.every((check) => check.status === "pass"));
    assert.equal(report.checks.at(-1)?.name, "shutdown");
  } finally {
    await manager.close();
  }
});

test("doctor reports trust and endpoint blockers without starting a server", async () => {
  const { project } = build(
    "mcp missing\n  transport: stdio\n  command: definitely-not-an-nt-command\n  tools: [echo]\n",
  );
  const manager = new McpManager(
    project,
    new McpTrustStore(nodePath.join(os.tmpdir(), `nt-mcp-untrusted-${process.pid}.json`)),
    new MemoryCredentialStore(),
  );
  try {
    const report = required((await manager.doctor("missing"))[0], "missing doctor report");
    assert.equal(report.usable, false);
    assert.equal(report.checks.find((check) => check.name === "trust")?.code, "MCP_NOT_TRUSTED");
    assert.equal(report.checks.find((check) => check.name === "endpoint")?.status, "fail");
    assert.equal(report.checks.find((check) => check.name === "connection")?.status, "skipped");
  } finally {
    await manager.close();
  }
});

test("MCP once approval is cached for one manager run and exact dispatch reaches the fixture", async () => {
  const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), "nt-mcp-session-"));
  temporary.push(dir);
  const source = `mcp local\n  transport: stdio\n  command: ${process.execPath}\n  args: [${fixturePath()}]\n  tools:\n    echo:\n      approval: once\nagent a\n  model: anthropic/test\n  tools: [local.echo]\n`;
  const { project } = build(source, nodePath.join(dir, "age.nt"));
  const trust = new McpTrustStore(nodePath.join(dir, "trust.json"));
  trust.trust(required(project.mcpServers.get("local"), "local MCP definition"));
  const manager = new McpManager(project, trust, new MemoryCredentialStore());
  const registry = new ProviderRegistry();
  let turn = 0;
  const name = modelToolName("local", "echo");
  registry.complete = async () =>
    turn++ === 0
      ? {
          content: [
            { type: "tool_use", id: "one", name, input: { text: "one" } },
            { type: "tool_use", id: "two", name, input: { text: "two" } },
          ],
          stopReason: "tool_use",
          text: "",
          usage: { input: 1, output: 1 },
        }
      : {
          content: [{ type: "text", text: "done" }],
          stopReason: "end_turn",
          text: "done",
          usage: { input: 1, output: 1 },
        };
  let approvals = 0;
  try {
    const result = await runSession(
      {
        project,
        registry,
        mcp: manager,
        log: () => {},
        audit: null,
        runId: "mcp-run",
        confirm: async (request) => {
          approvals++;
          assert.equal(request.server, "local");
          assert.equal(request.remoteTool, "echo");
          assert.equal(request.approvalPolicy, "once");
          return true;
        },
      },
      required(project.agents.get("a"), "agent a"),
      {},
      new VirtualSandbox({ cwd: "/workspace", env: {} }),
      0,
    );
    assert.equal(result.text, "done");
    assert.equal(approvals, 1);
  } finally {
    await manager.close();
  }
});
