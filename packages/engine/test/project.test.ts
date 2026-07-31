/**
 * @file Project-level validation tests: secret-hygiene warnings, HTTPS
 * enforcement, openai-completions capability errors, workflow `into` guards,
 * and http-tool URL policy.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { runCustomTool } from "#custom-tools";
import { Engine } from "#engine";
import { parseNt } from "#parse/parser";
import { VirtualSandbox } from "#sandbox";
import { buildProject } from "#schema/build";

/**
 * @param source NT source text to parse and assemble.
 * @returns The build result for a single-file project.
 */
function build(source: string) {
  return buildProject([{ file: "<test>", blocks: parseNt(source, "<test>") }]);
}

test("literal api_key in source produces a warning", () => {
  const { warnings } = build("provider p:\n  api: anthropic\n  api_key: sk-live-123\n");
  assert.ok(warnings.some((w) => w.includes("literal in source")));
});

test("env() api_key with a fallback literal produces a warning", () => {
  const { warnings } = build(
    "provider p:\n  api: anthropic\n  api_key: env(MY_KEY, sk-live-123)\n",
  );
  assert.ok(warnings.some((w) => w.includes("fallback literal")));
});

test("env() api_key without fallback is clean", () => {
  const { warnings } = build("provider p:\n  api: anthropic\n  api_key: env(MY_KEY)\n");
  assert.equal(warnings.length, 0);
});

test("cleartext http base_url is refused unless localhost", () => {
  assert.throws(
    () => build("provider p:\n  base_url: http://api.example.com/v1\n"),
    /must use https/,
  );
  assert.doesNotThrow(() => build("provider p:\n  base_url: http://localhost:11434/v1\n"));
  assert.doesNotThrow(() => build("provider p:\n  base_url: http://127.0.0.1:8080/v1\n"));
  assert.doesNotThrow(() => build("provider p:\n  base_url: http://[::1]:8080/v1\n"));
});

test("unknown field types warn and default to string", () => {
  const { project, warnings } = build("tool t:\n  type: shell\n  input:\n    age: integr\n");
  assert.ok(warnings.some((w) => w.includes("unknown type 'integr'")));
  assert.equal(project.tools.get("t")?.input[0].type, "string");
});

test("a second config block warns about the override", () => {
  const { warnings } = build("config\n  target: node\nconfig\n  target: node\n");
  assert.ok(warnings.some((w) => w.includes("duplicate config block")));
});

test("declared auth-header overrides produce a warning", () => {
  const { warnings } = build(
    "provider p:\n  api: anthropic\n  headers:\n    x-api-key: something\n",
  );
  assert.ok(warnings.some((w) => w.includes("credential header")));
});

test("agents with tools cannot target an openai-completions provider", () => {
  const source =
    "provider ollama:\n  api: openai-completions\n  base_url: http://localhost:11434/v1\n" +
    "agent a:\n  model: ollama/llama3\n  tools: [bash]\n";
  assert.throws(() => build(source), /openai-completions/);
});

test("agents without tools or output may target an openai-completions provider", () => {
  const source =
    "provider ollama:\n  api: openai-completions\n  base_url: http://localhost:11434/v1\n" +
    "agent a:\n  model: ollama/llama3\n";
  assert.doesNotThrow(() => build(source));
});

test("workflow step into rejects prototype-polluting names", () => {
  const source =
    "agent a:\n  model: anthropic/claude-opus-4-8\nworkflow w:\n  steps:\n    - agent: a\n      into: __proto__\n";
  assert.throws(() => build(source), /step.into/);
});

test("http tools refuse non-http(s) schemes and invalid URLs", async () => {
  const sandbox = new VirtualSandbox({ cwd: "/workspace", env: {} });
  const base = {
    name: "t",
    description: "t",
    input: [],
    headers: {},
    loc: { file: "<test>", line: 1 },
  };
  const fileTool = { ...base, type: "http" as const, url: "file:///etc/passwd" };
  const badTool = { ...base, type: "http" as const, url: "not a url" };
  assert.equal((await runCustomTool(fileTool, sandbox, {})).isError, true);
  assert.match((await runCustomTool(fileTool, sandbox, {})).content, /not allowed/);
  assert.match((await runCustomTool(badTool, sandbox, {})).content, /invalid URL/);
});

test("unknown subagent delegation and custom-tool rejections surface as tool errors", async () => {
  const sandbox = new VirtualSandbox({ cwd: "/workspace", env: {} });
  const shellTool = {
    name: "t",
    description: "t",
    type: "weird" as never,
    input: [],
    headers: {},
    loc: { file: "<test>", line: 1 },
  };
  const outcome = await runCustomTool(shellTool, sandbox, {});
  assert.equal(outcome.isError, true);
});

test("http tools refuse private, loopback, and link-local hosts", async () => {
  const sandbox = new VirtualSandbox({ cwd: "/workspace", env: {} });
  const base = {
    name: "t",
    description: "t",
    input: [],
    headers: {},
    loc: { file: "<test>", line: 1 },
  };
  for (const host of [
    "169.254.169.254",
    "10.0.0.1",
    "192.168.1.1",
    "127.0.0.1",
    "localhost",
    "[::1]",
  ]) {
    const tool = { ...base, type: "http" as const, url: `http://${host}/x` };
    const outcome = await runCustomTool(tool, sandbox, {});
    assert.equal(outcome.isError, true, `${host} should be blocked`);
    assert.match(outcome.content, /private\/loopback/);
  }
});

test("tool input is validated against the declared schema", async () => {
  const sandbox = new VirtualSandbox({ cwd: "/workspace", env: {} });
  const tool = {
    name: "t",
    description: "t",
    type: "shell" as const,
    command: "echo {name}",
    input: [
      { name: "name", type: "string" as const, required: true },
      { name: "count", type: "number" as const, required: false },
    ],
    headers: {},
    loc: { file: "<test>", line: 1 },
  };
  assert.match((await runCustomTool(tool, sandbox, {})).content, /missing required field 'name'/);
  assert.match(
    (await runCustomTool(tool, sandbox, { name: "x", count: "not-a-number" })).content,
    /must be of type number/,
  );
  assert.equal((await runCustomTool(tool, sandbox, { name: "x", count: 3 })).isError, false);
});

test("http tools refuse IPv4-mapped IPv6 literals in either encoding", async () => {
  const sandbox = new VirtualSandbox({ cwd: "/workspace", env: {} });
  const base = {
    name: "t",
    description: "t",
    input: [],
    headers: {},
    loc: { file: "<test>", line: 1 },
  };
  for (const host of ["[::ffff:169.254.169.254]", "[::ffff:7f00:1]", "[::ffff:a9fe:a9fe]"]) {
    const tool = { ...base, type: "http" as const, url: `http://${host}/x` };
    const outcome = await runCustomTool(tool, sandbox, {});
    assert.equal(outcome.isError, true, `${host} should be blocked`);
    assert.match(outcome.content, /private\/loopback/);
  }
});

test("custom tools refuse undeclared input fields before command or URL use", async () => {
  const sandbox = new VirtualSandbox({ cwd: "/workspace", env: {} });
  const tool = {
    name: "t",
    description: "t",
    type: "shell" as const,
    command: "echo {name}",
    input: [{ name: "name", type: "string" as const, required: true }],
    headers: {},
    loc: { file: "<test>", line: 1 },
  };
  const outcome = await runCustomTool(tool, sandbox, { name: "x", extra: "smuggled" });
  assert.equal(outcome.isError, true);
  assert.match(outcome.content, /unknown field 'extra'/);
});

test("built-in and delegation tool names are reserved", () => {
  assert.throws(() => build("tool bash:\n  command: echo hi\n"), /reserved/);
  assert.throws(() => build("tool fs_read:\n  command: cat {f}\n"), /reserved/);
  assert.throws(() => build("tool delegate_to_helper:\n  command: echo hi\n"), /reserved/);
});

test("a 127-prefixed DNS hostname does not qualify for the cleartext loopback exception", () => {
  assert.throws(
    () =>
      build(
        "provider p:\n  api: anthropic\n  base_url: http://127.attacker.example/v1\n  api_key: env(K)\n",
      ),
    /must use https/,
  );
  build("provider p:\n  api: anthropic\n  base_url: http://127.0.0.1:8080\n  api_key: env(K)\n");
});

test("provider.headers with a non-map value is an error, not silently dropped", () => {
  assert.throws(
    () => build("provider p:\n  api: anthropic\n  headers: nope\n  api_key: env(K)\n"),
    /provider.headers must be a map/,
  );
});

test("undeclared workflow input cannot preseed declared outputs", async () => {
  const engine = new Engine(build("workflow w:\n  output:\n    verdict: string\n"));
  const result = await engine.runWorkflow("w", { verdict: "spoofed" });
  assert.deepEqual(result.output, {});
});
