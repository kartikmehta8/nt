/**
 * @file Audit redaction tests: which field names count as secret, the scrubbing
 * of declared, host, and pattern-shaped credentials, the values reported as
 * dropped, and value truncation.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { collectSecrets, createRedactor, looksSecretName } from "#audit/redact";
import { parseNt } from "#parse/parser";
import { buildProject } from "#schema/build";

const LOC = { file: "/proj/config.nt", line: 1 };

/**
 * @param source NT source text to parse and assemble.
 * @returns The build result for a single-file project.
 */
function build(source: string) {
  return buildProject([{ file: LOC.file, blocks: parseNt(source, LOC.file) }]);
}

test("looksSecretName matches credential-shaped field names only", () => {
  for (const name of ["api_key", "apiKey", "AUTH_TOKEN", "password", "x-api-key", "key", "cookie"])
    assert.equal(looksSecretName(name), true, `${name} should look secret`);
  for (const name of ["path", "command", "monkey", "keyboard", "clues", "prompt"])
    assert.equal(looksSecretName(name), false, `${name} should not look secret`);
});

test("redaction drops secret-named fields and token-shaped values at any depth", () => {
  const redactor = createRedactor();
  assert.deepEqual(redactor.input({ path: "a.txt", api_key: "whatever" }).input, {
    path: "a.txt",
    api_key: "[redacted]",
  });
  assert.deepEqual(redactor.input({ nested: { list: ["sk-abcdefghijklmnop"] } }).input, {
    nested: { list: ["[redacted]"] },
  });
  assert.equal(
    redactor.text("curl -H 'authorization: Bearer abcdefghijklmnopqrs' https://x.test"),
    "curl -H 'authorization: [redacted]' https://x.test",
  );
  assert.equal(redactor.text("ghp_abcdefghijklmnopqrstuvwxyz"), "[redacted]");
});

test("redaction scrubs declared and host secrets out of arbitrary text", () => {
  process.env.NT_TEST_AUDIT_TOKEN = "hunter2-hunter2";
  try {
    const { project } = build(
      "provider p:\n  api: anthropic\n  api_key: sk-declared-literal\n" +
        "sandbox s:\n  env:\n    SERVICE_SECRET: swordfish-1234\n",
    );
    const redactor = createRedactor(collectSecrets(project));
    assert.equal(redactor.text("echo swordfish-1234 | tee out"), "echo [redacted] | tee out");
    assert.equal(redactor.text("token=hunter2-hunter2"), "token=[redacted]");
    assert.equal(redactor.text("key: sk-declared-literal"), "key: [redacted]");
  } finally {
    delete process.env.NT_TEST_AUDIT_TOKEN;
  }
});

test("redaction reports which input values it dropped", () => {
  const { dropped } = createRedactor().input({
    api_key: "one-secret-value",
    nested: { password: "another-secret" },
    path: "notes.md",
  });
  assert.deepEqual(dropped.sort(), ["another-secret", "one-secret-value"]);
});

test("redaction truncates long values instead of storing them whole", () => {
  const redactor = createRedactor();
  const long = "x".repeat(5_000);
  const out = redactor.text(long);
  assert.ok(out.length < 2_100, `expected a truncated value, got ${out.length} chars`);
  assert.match(out, /…\[5000 chars\]$/);
});
