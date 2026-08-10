/**
 * @file Persistence and authority-boundary tests for MCP OAuth credentials.
 *
 * Verifies atomic owner-only file storage, exact protected-resource deletion,
 * issuer/resource/client keying, PKCE verifier retention across discovery
 * invalidation, malformed-envelope handling, and logout isolation. Tests use
 * temporary or in-memory stores and never contact an authorization server.
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import { afterEach, test } from "node:test";
import { NtOAuthProvider } from "#mcp/auth";
import { FileCredentialStore, MemoryCredentialStore } from "#mcp/credentials";

const temporary: string[] = [];

afterEach(() => {
  while (temporary.length) {
    const target = temporary.pop();
    if (target) fs.rmSync(target, { recursive: true, force: true });
  }
});

test("file credentials are atomic, owner-only, and deleted by exact resource", () => {
  const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), "nt-mcp-credentials-"));
  temporary.push(dir);
  const file = nodePath.join(dir, "state", "credentials.json");
  const store = new FileCredentialStore(file);
  const first = JSON.stringify(["https://one.example/mcp", "https://issuer.example", "client-a"]);
  const second = JSON.stringify(["https://two.example/mcp", "https://issuer.example", "client-b"]);
  store.set(first, { verifier: "one" });
  store.set(second, { verifier: "two" });
  assert.equal(store.get(first)?.verifier, "one");
  assert.equal(store.find("https://one.example/mcp", "https://issuer.example")?.key, first);
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.equal(fs.statSync(nodePath.dirname(file)).mode & 0o777, 0o700);
  }
  assert.equal(store.deleteResource("https://one.example/mcp"), true);
  assert.equal(store.get(first), undefined);
  assert.equal(store.get(second)?.verifier, "two");
});

test("OAuth records bind resource, issuer, and registered client identifier", () => {
  const store = new MemoryCredentialStore();
  const provider = new NtOAuthProvider("https://resource.example/mcp", ["read"], store);
  const context = { issuer: "https://issuer.example" };
  provider.saveClientInformation(
    { client_id: "client-123", redirect_uris: ["http://127.0.0.1/callback"] },
    context,
  );
  provider.saveCodeVerifier("verifier");
  const found = store.find("https://resource.example/mcp", context.issuer);
  assert.deepEqual(JSON.parse(found?.key ?? "[]"), [
    "https://resource.example/mcp",
    context.issuer,
    "client-123",
  ]);
  assert.equal(provider.codeVerifier(), "verifier");
  provider.invalidateCredentials("discovery");
  assert.equal(provider.codeVerifier(), "verifier");
  assert.equal(provider.logout(), true);
  assert.equal(store.find("https://resource.example/mcp", context.issuer), undefined);
});

test("memory credentials do not expose mutable shared records", () => {
  const store = new MemoryCredentialStore();
  const original = { verifier: "first", tokens: { access_token: "token", token_type: "bearer" } };
  store.set("key", original);
  original.verifier = "mutated";
  const loaded = store.get("key");
  assert.equal(loaded?.verifier, "first");
  if (loaded) loaded.verifier = "second mutation";
  assert.equal(store.get("key")?.verifier, "first");
});

test("file credentials fail closed for an unsupported or malformed envelope", () => {
  const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), "nt-mcp-credentials-invalid-"));
  temporary.push(dir);
  const file = nodePath.join(dir, "credentials.json");
  fs.writeFileSync(file, '{"schema_version":1}', { mode: 0o600 });
  const store = new FileCredentialStore(file);
  assert.equal(store.get("missing"), undefined);
  fs.writeFileSync(file, '{"schema_version":2,"records":{"missing":{}}}', { mode: 0o600 });
  assert.equal(store.get("missing"), undefined);
});
