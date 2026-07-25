/**
 * @file LocalSandbox containment tests: the NT_ALLOW_LOCAL opt-in gate, the
 * cwd path jail (including parent traversal), and host-env scrubbing for
 * executed commands. VirtualSandbox coverage for quoted shell arguments.
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { LocalSandbox, VirtualSandbox } from "#sandbox";

let dir: string;
let savedGate: string | undefined;

beforeEach(() => {
  savedGate = process.env.NT_ALLOW_LOCAL;
  dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), "nt-sandbox-"));
});

afterEach(() => {
  if (savedGate === undefined) delete process.env.NT_ALLOW_LOCAL;
  else process.env.NT_ALLOW_LOCAL = savedGate;
  fs.rmSync(dir, { recursive: true, force: true });
});

test("LocalSandbox refuses to construct without NT_ALLOW_LOCAL=1", () => {
  delete process.env.NT_ALLOW_LOCAL;
  assert.throws(() => new LocalSandbox({ cwd: dir, env: {} }), /NT_ALLOW_LOCAL/);
});

test("LocalSandbox jails reads and writes to its cwd", () => {
  process.env.NT_ALLOW_LOCAL = "1";
  const sandbox = new LocalSandbox({ cwd: dir, env: {} });
  sandbox.writeFile("notes/a.txt", "hello");
  assert.equal(sandbox.readFile("notes/a.txt"), "hello");
  assert.throws(() => sandbox.readFile("../outside.txt"), /escapes the sandbox/);
  assert.throws(() => sandbox.writeFile("/etc/nt-test.txt", "x"), /escapes the sandbox/);
  assert.throws(
    () => sandbox.readFile(nodePath.join(os.homedir(), ".ssh/id_rsa")),
    /escapes the sandbox/,
  );
});

test("LocalSandbox rejects symlinks that point outside the jail", () => {
  process.env.NT_ALLOW_LOCAL = "1";
  const outside = fs.mkdtempSync(nodePath.join(os.tmpdir(), "nt-outside-"));
  try {
    fs.writeFileSync(nodePath.join(outside, "secret.txt"), "s3cret");
    fs.symlinkSync(outside, nodePath.join(dir, "link"));
    const sandbox = new LocalSandbox({ cwd: dir, env: {} });
    assert.throws(() => sandbox.readFile("link/secret.txt"), /escapes the sandbox/);
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test("LocalSandbox exec does not inherit host secrets, only declared env", () => {
  process.env.NT_ALLOW_LOCAL = "1";
  process.env.NT_TEST_FAKE_SECRET = "leak-me";
  try {
    const sandbox = new LocalSandbox({ cwd: dir, env: { DECLARED: "yes" } });
    const result = sandbox.exec("env");
    assert.equal(result.code, 0);
    assert.ok(!result.stdout.includes("NT_TEST_FAKE_SECRET"));
    assert.ok(result.stdout.includes("DECLARED=yes"));
    assert.ok(result.stdout.includes("PATH="));
  } finally {
    delete process.env.NT_TEST_FAKE_SECRET;
  }
});

test("VirtualSandbox never touches the host and understands quoted args", () => {
  const sandbox = new VirtualSandbox({ cwd: "/workspace", env: {} });
  sandbox.writeFile("a.txt", "data");
  assert.equal(sandbox.exec("cat 'a.txt'").stdout, "data");
  assert.equal(sandbox.exec("curl http://example.com").code, 127);
  sandbox.exec("rm 'a.txt'");
  assert.throws(() => sandbox.readFile("a.txt"), /no such file/);
});
