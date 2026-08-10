/**
 * @file Session-wiring tests for the audit log: every dispatched tool call is
 * recorded, delegated calls carry their own agent and depth under one run id,
 * and a project with logging off writes nothing. The provider is replayed from
 * a script, so no test reaches the network.
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { openAuditLog, readAuditEntries } from "#audit/log";
import { parseNt } from "#parse/parser";
import { ProviderRegistry, type LlmResponse } from "#provider";
import { buildRuntime, type RunContext } from "#runtime";
import { VirtualSandbox } from "#sandbox";
import { buildProject } from "#schema/build";
import { driveConversation } from "#session";
import type { AgentDef, Project } from "#types";

const LOC = { file: "/proj/config.nt", line: 1 };

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

/**
 * @param project The assembled project.
 * @param name The agent to look up.
 * @returns The declared agent, erroring when the fixture does not declare it.
 */
function agentOf(project: Project, name: string): AgentDef {
  const agent = project.agents.get(name);
  if (!agent) throw new Error(`test fixture declares no agent '${name}'`);
  return agent;
}

/**
 * @param replies The responses to hand back, in order; the last one repeats.
 * @returns A registry whose `complete` replays the scripted responses without a network call.
 */
function fakeRegistry(replies: LlmResponse[]): ProviderRegistry {
  const registry = new ProviderRegistry();
  let turn = 0;
  registry.complete = async () => replies[Math.min(turn++, replies.length - 1)];
  return registry;
}

async function run(context: RunContext, agent: AgentDef): Promise<void> {
  await driveConversation(
    context,
    await buildRuntime(context, agent),
    new VirtualSandbox({ cwd: "/workspace", env: {} }),
    [{ role: "user", content: "go" }],
    0,
  );
}

test("the session loop logs every tool call it dispatches", async () => {
  const { project } = build(
    `config\n  audit: ${dir}\n  defaults:\n    model: anthropic/claude-sonnet-5\n` +
      "agent a:\n  tools: [fs_write, fs_read]\n",
  );
  const agent = agentOf(project, "a");
  const context: RunContext = {
    project,
    registry: fakeRegistry([
      {
        content: [
          {
            type: "tool_use",
            id: "u1",
            name: "fs_write",
            input: { path: "notes.md", content: "keep" },
          },
          { type: "tool_use", id: "u2", name: "fs_read", input: { path: "missing.md" } },
        ],
        stopReason: "tool_use",
        text: "",
        usage: { input: 1, output: 1 },
      },
      {
        content: [{ type: "text", text: "done" }],
        stopReason: "end_turn",
        text: "done",
        usage: { input: 1, output: 1 },
      },
    ]),
    log: () => {},
    audit: openAuditLog(project),
    runId: "run-42",
  };
  await run(context, agent);

  const entries = readAuditEntries(dir, 10);
  assert.deepEqual(
    entries.map((e) => [e.tool, e.ok]),
    [
      ["fs_write", true],
      ["fs_read", false],
    ],
  );
  assert.ok(entries.every((e) => e.run === "run-42" && e.agent === "a" && e.kind === "builtin"));
  assert.deepEqual(entries[0].input, { path: "notes.md", content: "keep" });
  assert.match(entries[1].output, /no such file/);
});

test("delegated calls are logged at their own depth under one run id", async () => {
  const { project } = build(
    `config\n  audit: ${dir}\n  defaults:\n    model: anthropic/claude-sonnet-5\n` +
      "subagent helper:\n  description: helps\n  tools: [fs_list]\n" +
      "agent boss:\n  subagents: [helper]\n",
  );
  const context: RunContext = {
    project,
    registry: fakeRegistry([
      {
        content: [
          {
            type: "tool_use",
            id: "u1",
            name: "delegate_to_helper",
            input: { prompt: "list the files" },
          },
        ],
        stopReason: "tool_use",
        text: "",
        usage: { input: 1, output: 1 },
      },
      {
        content: [{ type: "tool_use", id: "u2", name: "fs_list", input: {} }],
        stopReason: "tool_use",
        text: "",
        usage: { input: 1, output: 1 },
      },
      {
        content: [{ type: "text", text: "nothing there" }],
        stopReason: "end_turn",
        text: "nothing there",
        usage: { input: 1, output: 1 },
      },
      {
        content: [{ type: "text", text: "done" }],
        stopReason: "end_turn",
        text: "done",
        usage: { input: 1, output: 1 },
      },
    ]),
    log: () => {},
    audit: openAuditLog(project),
    runId: "run-nested",
  };
  await run(context, agentOf(project, "boss"));

  const entries = readAuditEntries(dir, 10);
  assert.deepEqual(
    entries.map((e) => [e.agent, e.tool, e.kind, e.depth]),
    [
      ["helper", "fs_list", "builtin", 1],
      ["boss", "delegate_to_helper", "delegate", 0],
    ],
  );
  assert.ok(entries.every((e) => e.run === "run-nested"));
});

test("a session with logging off writes nothing", async () => {
  const { project } = build(
    "config\n  audit: off\n  defaults:\n    model: anthropic/claude-sonnet-5\n" +
      "agent a:\n  tools: [fs_list]\n",
  );
  const agent = agentOf(project, "a");
  const context: RunContext = {
    project,
    registry: fakeRegistry([
      {
        content: [{ type: "tool_use", id: "u1", name: "fs_list", input: {} }],
        stopReason: "end_turn",
        text: "",
        usage: { input: 0, output: 0 },
      },
    ]),
    log: () => {},
    audit: openAuditLog(project),
    runId: "run-off",
  };
  await run(context, agent);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test("a tool the agent was not granted is refused at dispatch and audited", async () => {
  const { project } = build(
    `config\n  audit: ${dir}\n  defaults:\n    model: anthropic/claude-sonnet-5\n` +
      "subagent helper:\n  description: helps\n" +
      "agent a:\n  tools: [fs_read]\n",
  );
  const agent = agentOf(project, "a");
  const context: RunContext = {
    project,
    registry: fakeRegistry([
      {
        content: [
          { type: "tool_use", id: "u1", name: "bash", input: { command: "cat /etc/passwd" } },
          { type: "tool_use", id: "u2", name: "delegate_to_helper", input: { prompt: "go" } },
        ],
        stopReason: "tool_use",
        text: "",
        usage: { input: 1, output: 1 },
      },
      {
        content: [{ type: "text", text: "done" }],
        stopReason: "end_turn",
        text: "done",
        usage: { input: 1, output: 1 },
      },
    ]),
    log: () => {},
    audit: openAuditLog(project),
    runId: "run-99",
  };
  await run(context, agent);

  const entries = readAuditEntries(dir, 10);
  assert.deepEqual(
    entries.map((e) => [e.tool, e.ok]),
    [
      ["bash", false],
      ["delegate_to_helper", false],
    ],
  );
  for (const entry of entries) assert.match(entry.output, /not available to this agent/);
});
