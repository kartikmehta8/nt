/**
 * @file Offline MCP language, schema, naming, and trust tests.
 *
 * Covers valid stdio, bearer, OAuth, exact, and wildcard forms alongside unsafe
 * URLs, secret literals, cwd escapes, invalid selections, external schema
 * references, provider-safe name determinism, fingerprint invalidation, and
 * credential-safe diagnostics. Parsing assertions also ensure validation does
 * not spawn, connect, or read runtime credentials.
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import { afterEach, test } from "node:test";
import { modelToolName, parseMcpReference } from "#mcp/names";
import { appendMcpStderr, mcpFailureMessage } from "#mcp/diagnostics";
import { compileSchema } from "#mcp/schemas";
import { redactMcpDiagnostic, resolvedCwd, serverFingerprint } from "#mcp/security";
import { McpTrustStore } from "#mcp/trust";
import { parseNt } from "#parse/parser";
import { buildProject } from "#schema/build";

const temporary: string[] = [];
afterEach(() => {
  while (temporary.length) {
    const target = temporary.pop();
    if (target) fs.rmSync(target, { recursive: true, force: true });
  }
});

function build(
  source: string,
  file = nodePath.join(process.cwd(), "test.nt"),
  projectRoot?: string,
) {
  return buildProject([{ file, blocks: parseNt(source, file) }], projectRoot);
}

function required<T>(value: T | undefined, label: string): T {
  assert.ok(value, label);
  return value;
}

test("MCP declarations parse stdio, bearer HTTP, OAuth, and policies offline", () => {
  const source = `
mcp local
  transport: stdio
  command: node
  args: [server.mjs]
  env:
    TOKEN: env(MCP_TEST_TOKEN)
  tools:
    echo:
      approval: once
      call_timeout_ms: 5000
mcp remote
  transport: streamable_http
  url: https://mcp.example.test/mcp
  allow_legacy_sse: true
  auth:
    type: bearer
    token: env(MCP_BEARER)
  tools: [search]
mcp oauth
  transport: streamable_http
  url: https://oauth.example.test/mcp
  auth:
    type: oauth
    scopes: [files.read]
  tools:
    "*":
      approval: required
agent a
  model: anthropic/test
  tools: [local.echo, remote.search, oauth.*]
`;
  const { project, warnings } = build(source);
  assert.equal(project.mcpServers.size, 3);
  assert.equal(project.mcpServers.get("local")?.tools.get("echo")?.approval, "once");
  assert.equal(project.mcpServers.get("remote")?.auth.type, "bearer");
  assert.equal(project.mcpServers.get("remote")?.allowLegacySse, true);
  assert.ok(warnings.some((warning) => warning.includes("wildcard")));
});

test("MCP offline validation rejects unsafe declarations and unselected references", () => {
  assert.throws(
    () => build("mcp bad\n  transport: stdio\n  command: node\n  cwd: ../../outside\n"),
    /outside the project root/,
  );
  assert.throws(
    () => build("mcp bad\n  transport: stdio\n  command: node\n  allow_legacy_sse: true\n"),
    /allow_legacy_sse is not valid for stdio/,
  );
  assert.throws(
    () => build("mcp bad\n  transport: streamable_http\n  url: http://example.com/mcp\n"),
    /must use https/,
  );
  assert.throws(
    () =>
      build("mcp bad\n  transport: streamable_http\n  url: https://user:pass@example.com/mcp\n"),
    /credentials/,
  );
  assert.throws(
    () => build("mcp bad\n  transport: streamable_http\n  url: https://example.com/mcp#x\n"),
    /fragment/,
  );
  assert.throws(
    () =>
      build(
        "mcp bad\n  transport: streamable_http\n  url: https://example.com/mcp\n  auth:\n    type: bearer\n    token: literal\n",
      ),
    /must be env/,
  );
  for (const auth of [
    "type: none\n    scopes: [read]",
    "type: bearer\n    token: env(TOKEN)\n    scopes: [read]",
    "type: oauth\n    token: env(TOKEN)",
  ])
    assert.throws(
      () =>
        build(
          `mcp bad\n  transport: streamable_http\n  url: https://example.com/mcp\n  auth:\n    ${auth}\n`,
        ),
      /not valid|only valid/,
    );
  assert.throws(
    () =>
      build(
        "mcp good\n  transport: stdio\n  command: node\n  tools: [echo]\nagent a\n  model: anthropic/test\n  tools: [good.mutate]\n",
      ),
    /not selected/,
  );
  assert.throws(
    () =>
      build(
        'mcp good\n  transport: stdio\n  command: node\n  tools:\n    "*":\n      approval: never\n',
      ),
    /wildcard approval/,
  );
});

test("MCP names are deterministic, provider-safe, and dot references split once", () => {
  assert.deepEqual(parseMcpReference("github.repo.search"), {
    server: "github",
    remoteName: "repo.search",
  });
  const a = modelToolName(
    "github",
    "repo.search/with punctuation and a very long suffix that exceeds provider limits",
  );
  assert.equal(
    a,
    modelToolName(
      "github",
      "repo.search/with punctuation and a very long suffix that exceeds provider limits",
    ),
  );
  assert.match(a, /^[A-Za-z0-9_-]+$/);
  assert.ok(a.length <= 64);
  assert.notEqual(modelToolName("s", "a.b"), modelToolName("s", "a/b"));
});

test("stdio cwd and trust identity are anchored to the project root", () => {
  const root = fs.mkdtempSync(nodePath.join(os.tmpdir(), "nt-mcp-root-"));
  temporary.push(root);
  const file = nodePath.join(root, "declarations", "servers.nt");
  const { project } = build(
    "mcp local\n  transport: stdio\n  command: node\n  cwd: runtime\n",
    file,
    root,
  );
  const def = required(project.mcpServers.get("local"), "local MCP definition");
  assert.equal(def.projectRoot, root);
  assert.equal(resolvedCwd(def), nodePath.join(root, "runtime"));
});

test("MCP schema compiler rejects external refs and validates without coercion", () => {
  assert.throws(
    () =>
      compileSchema(
        { type: "object", properties: { x: { $ref: "https://example.test/schema" } } },
        "input",
      ),
    /external schema/,
  );
  const validate = compileSchema(
    {
      type: "object",
      properties: { n: { type: "number" } },
      required: ["n"],
      additionalProperties: false,
    },
    "input",
  );
  assert.equal(validate({ n: 1 }), true);
  assert.equal(validate({ n: "1" }), false);
  assert.equal(validate({ n: 1, extra: true }), false);
});

test("trust fingerprints change for security-relevant fields and stores are owner-only", () => {
  const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), "nt-mcp-trust-"));
  temporary.push(dir);
  const { project } = build(
    "mcp local\n  transport: stdio\n  command: node\n  args: [a.mjs]\n  tools: [echo]\n",
    nodePath.join(dir, "age.nt"),
  );
  const def = required(project.mcpServers.get("local"), "local MCP definition");
  const store = new McpTrustStore(nodePath.join(dir, "state", "trust.json"));
  assert.equal(store.status(def), "missing");
  const first = store.trust(def);
  assert.equal(first, serverFingerprint(def));
  assert.equal(store.status(def), "trusted");
  assert.equal(fs.statSync(store.file).mode & 0o777, 0o600);
  assert.notEqual(first, serverFingerprint({ ...def, args: ["b.mjs"] }));
  assert.equal(store.untrust(def), true);
  fs.writeFileSync(store.file, '{"schema_version":1,"entries":{"malformed":null}}', {
    mode: 0o600,
  });
  assert.equal(store.status(def), "missing");
});

test("MCP diagnostics redact declared bearer, header, and environment values", () => {
  process.env.NT_MCP_DIAGNOSTIC_TOKEN = "diagnostic-secret-value";
  try {
    const { project } = build(`mcp remote
  transport: streamable_http
  url: https://example.test/mcp
  auth:
    type: bearer
    token: env(NT_MCP_DIAGNOSTIC_TOKEN)
  headers:
    x-tenant: tenant-private-value
`);
    const def = required(project.mcpServers.get("remote"), "remote MCP definition");
    const safe = redactMcpDiagnostic(
      def,
      "server echoed diagnostic-secret-value for tenant-private-value",
    );
    assert.doesNotMatch(safe, /diagnostic-secret-value|tenant-private-value/);
    const stderr = appendMcpStderr("", "diagnostic-secret-value".repeat(2_000));
    assert.equal(stderr.length, 16_384);
    assert.doesNotMatch(mcpFailureMessage(def, new Error("startup failed"), stderr), /secret/);
  } finally {
    delete process.env.NT_MCP_DIAGNOSTIC_TOKEN;
  }
});
