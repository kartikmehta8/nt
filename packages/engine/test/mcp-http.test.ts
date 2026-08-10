/**
 * @file End-to-end Streamable HTTP MCP transport integration test.
 *
 * Starts the repository-owned loopback server in a child process, trusts an
 * `allow_internal` declaration, supplies bearer auth through an environment
 * reference, and verifies negotiation, discovery, invocation, and bounded
 * shutdown through the real official client. No public network is used and all
 * process, environment, trust, and temporary-file state is cleaned in `finally`.
 */

import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { MemoryCredentialStore } from "#mcp/credentials";
import { McpManager } from "#mcp/manager";
import { McpTrustStore } from "#mcp/trust";
import { parseNt } from "#parse/parser";
import { buildProject } from "#schema/build";

const BEARER_ENV = "NT_MCP_TEST_BEARER";

function required<T>(value: T | undefined, label: string): T {
  assert.ok(value, label);
  return value;
}

async function startHttpFixture(): Promise<{ child: ChildProcess; port: number }> {
  const fixture = nodePath.join(
    nodePath.dirname(fileURLToPath(import.meta.url)),
    "fixtures/mcp/http-server.mjs",
  );
  const child = spawn(process.execPath, [fixture], {
    env: {
      PATH: process.env.PATH,
      SYSTEMROOT: process.env.SYSTEMROOT,
      [BEARER_ENV]: "test-bearer",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const port = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`HTTP fixture exited early with ${code}`)));
    child.stdout?.on("data", (chunk) => {
      output += String(chunk);
      const line = output.split("\n", 1)[0];
      if (output.includes("\n") && line) resolve((JSON.parse(line) as { port: number }).port);
    });
  });
  return { child, port };
}

async function stopFixture(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.kill("SIGTERM");
  const forced = new Promise<void>((resolve) =>
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      resolve();
    }, 2_000).unref(),
  );
  await Promise.race([exited, forced]);
}

test("Streamable HTTP negotiates, authenticates, discovers, invokes, and shuts down", async () => {
  const fixture = await startHttpFixture();
  const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), "nt-mcp-http-"));
  process.env[BEARER_ENV] = "test-bearer";
  const source = `mcp remote\n  transport: streamable_http\n  url: http://127.0.0.1:${fixture.port}/mcp\n  allow_internal: true\n  auth:\n    type: bearer\n    token: env(${BEARER_ENV})\n  tools:\n    echo:\n      approval: never\n`;
  const file = nodePath.join(dir, "age.nt");
  const { project } = buildProject([{ file, blocks: parseNt(source, file) }]);
  const trust = new McpTrustStore(nodePath.join(dir, "trust.json"));
  trust.trust(required(project.mcpServers.get("remote"), "remote MCP definition"));
  const manager = new McpManager(project, trust, new MemoryCredentialStore());
  try {
    const prepared = await manager.prepare(["remote.echo"]);
    const tool = required(prepared.tools[0], "remote echo tool");
    assert.ok(tool.protocolVersion);
    const result = await manager.call(tool, { text: "hello" });
    assert.equal(result.modelContent, "remote: hello");
  } finally {
    await manager.close();
    await stopFixture(fixture.child);
    delete process.env[BEARER_ENV];
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
