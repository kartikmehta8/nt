/**
 * @file Human-in-the-loop gate tests: a tool declared with `confirm: true`
 * runs only after the confirm callback approves it, is refused when the
 * callback denies or when no callback is wired, and the callback receives the
 * acting agent, tool, input, and depth. The provider is replayed from a
 * script, so no test reaches the network.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { parseNt } from "#parse/parser";
import { ProviderRegistry, type LlmResponse } from "#provider";
import { buildRuntime, type RunContext } from "#runtime";
import { VirtualSandbox } from "#sandbox";
import { buildProject } from "#schema/build";
import { driveConversation } from "#session";
import type { AgentDef, ConfirmRequest, Project } from "#types";

const LOC = { file: "/proj/config.nt", line: 1 };

const FIXTURE =
  "config\n  audit: off\n  defaults:\n    model: anthropic/claude-sonnet-5\n" +
  "tool greet:\n  description: says hello\n  command: echo hello-from-greet\n  confirm: true\n" +
  "agent a:\n  tools: [greet]\n";

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
 * @returns A registry that asks for the greet tool once, then finishes.
 */
function greetRegistry(): ProviderRegistry {
  const replies: LlmResponse[] = [
    {
      content: [{ type: "tool_use", id: "u1", name: "greet", input: {} }],
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
  ];
  const registry = new ProviderRegistry();
  let turn = 0;
  registry.complete = async () => replies[Math.min(turn++, replies.length - 1)];
  return registry;
}

/**
 * @param confirm The confirm callback under test, if any.
 * @returns The first tool_result block the model received back.
 */
async function runGreet(
  confirm?: (request: ConfirmRequest) => Promise<boolean>,
): Promise<{ content: string; is_error: boolean }> {
  const { project } = build(FIXTURE);
  const context: RunContext = {
    project,
    registry: greetRegistry(),
    log: () => {},
    audit: null,
    runId: "run-confirm",
    confirm,
  };
  const messages = [{ role: "user" as const, content: "go" }];
  await driveConversation(
    context,
    buildRuntime(context, agentOf(project, "a")),
    new VirtualSandbox({ cwd: "/workspace", env: {} }),
    messages,
    0,
  );
  const results = messages[2].content as unknown as { content: string; is_error: boolean }[];
  return results[0];
}

test("an approved confirm runs the tool and passes the request details", async () => {
  const requests: ConfirmRequest[] = [];
  const result = await runGreet(async (request) => {
    requests.push(request);
    return true;
  });
  assert.equal(result.is_error, false);
  assert.match(result.content, /hello-from-greet/);
  assert.deepEqual(requests, [{ agent: "a", tool: "greet", input: {}, depth: 0 }]);
});

test("a denied confirm refuses the tool without running it", async () => {
  const result = await runGreet(async () => false);
  assert.equal(result.is_error, true);
  assert.match(result.content, /denied permission to run tool 'greet'/);
  assert.doesNotMatch(result.content, /hello-from-greet/);
});

test("a confirm-required tool is refused when no confirm callback is wired", async () => {
  const result = await runGreet(undefined);
  assert.equal(result.is_error, true);
  assert.match(result.content, /requires confirmation/);
  assert.doesNotMatch(result.content, /hello-from-greet/);
});

test("tool.confirm parses as a boolean and defaults to false", () => {
  const { project } = build(FIXTURE);
  assert.equal(project.tools.get("greet")?.confirm, true);
  const plain = build("tool t:\n  command: echo hi\n").project.tools.get("t");
  assert.equal(plain?.confirm, false);
  assert.throws(
    () => build("tool t:\n  command: echo hi\n  confirm: maybe\n"),
    /confirm must be true or false/,
  );
});
