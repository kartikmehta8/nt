/**
 * @file Step-event tests for the session loop: `onStep` fires before every
 * model call, tool dispatch, and delegation with the acting agent and depth,
 * and a context without the callback runs exactly as before. The provider is
 * replayed from a script, so no test reaches the network.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { parseNt } from "#parse/parser";
import { ProviderRegistry, type LlmResponse } from "#provider";
import { buildRuntime, type RunContext } from "#runtime";
import { VirtualSandbox } from "#sandbox";
import { buildProject } from "#schema/build";
import { driveConversation } from "#session";
import type { AgentDef, Project, StepEvent } from "#types";

const LOC = { file: "/proj/config.nt", line: 1 };

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

/**
 * @param registry The scripted provider registry.
 * @param project The assembled project.
 * @param onStep The step callback under test, if any.
 * @returns A run context that never reaches the network or the audit log.
 */
function contextOf(
  registry: ProviderRegistry,
  project: Project,
  onStep?: (event: StepEvent) => void,
): RunContext {
  return { project, registry, log: () => {}, audit: null, runId: "run-steps", onStep };
}

test("onStep fires for model calls, tool dispatches, and delegations with depth", async () => {
  const { project } = build(
    "config\n  audit: off\n  defaults:\n    model: anthropic/claude-sonnet-5\n" +
      "subagent helper:\n  description: helps\n  tools: [fs_list]\n" +
      "agent boss:\n  subagents: [helper]\n",
  );
  const registry = fakeRegistry([
    {
      content: [
        { type: "tool_use", id: "u1", name: "delegate_to_helper", input: { prompt: "list" } },
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
  ]);
  const events: StepEvent[] = [];
  const context = contextOf(registry, project, (e) => events.push(e));
  await driveConversation(
    context,
    await buildRuntime(context, agentOf(project, "boss")),
    new VirtualSandbox({ cwd: "/workspace", env: {} }),
    [{ role: "user", content: "go" }],
    0,
  );

  assert.deepEqual(
    events.map((e) => [e.kind, e.agent, e.detail, e.depth]),
    [
      ["model", "boss", "anthropic/claude-sonnet-5", 0],
      ["delegation", "boss", "helper", 0],
      ["model", "helper", "anthropic/claude-sonnet-5", 1],
      ["tool", "helper", "fs_list", 1],
      ["model", "helper", "anthropic/claude-sonnet-5", 1],
      ["model", "boss", "anthropic/claude-sonnet-5", 0],
    ],
  );
});

test("config.show_tool_calls parses as a boolean and defaults to false", () => {
  assert.equal(build("config\n  show_tool_calls: true\n").project.config.showToolCalls, true);
  assert.equal(build("config\n  show_tool_calls: false\n").project.config.showToolCalls, false);
  assert.equal(build("config\n  target: node\n").project.config.showToolCalls, false);
  assert.throws(
    () => build("config\n  show_tool_calls: sometimes\n"),
    /show_tool_calls must be true or false/,
  );
});

test("unknown config and config.defaults fields warn instead of being silently dropped", () => {
  const { warnings } = build(
    "config\n  show_toolcalls: true\n  defaults:\n    modle: anthropic/claude-sonnet-5\n",
  );
  assert.ok(warnings.some((w) => w.includes("config: unknown field 'show_toolcalls'")));
  assert.ok(warnings.some((w) => w.includes("config.defaults: unknown field 'modle'")));
});

test("a context without onStep drives the loop exactly as before", async () => {
  const { project } = build(
    "config\n  audit: off\n  defaults:\n    model: anthropic/claude-sonnet-5\n" +
      "agent a:\n  tools: [fs_list]\n",
  );
  const registry = fakeRegistry([
    {
      content: [{ type: "tool_use", id: "u1", name: "fs_list", input: {} }],
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
  ]);
  const context = contextOf(registry, project);
  const turn = await driveConversation(
    context,
    await buildRuntime(context, agentOf(project, "a")),
    new VirtualSandbox({ cwd: "/workspace", env: {} }),
    [{ role: "user", content: "go" }],
    0,
  );
  assert.equal(turn.text, "done");
  assert.equal(turn.steps, 2);
});
