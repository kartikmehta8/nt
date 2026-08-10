/**
 * @file Offline contract tests for MCP support in the VS Code extension.
 *
 * Loads the extension's pure CommonJS scanners without the VS Code host and
 * verifies nested and flow-style policy indexing, agent tool completion context,
 * grammar contribution, and secure stdio/bearer/OAuth snippets. The explicit
 * no-network sentinel protects the editor's source-only design.
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as nodePath from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { NtIndex, scanDefinitions } = require("../../vscode-nt/ntIndex.js") as {
  NtIndex: new () => {
    updateDoc(uri: { toString(): string }, text: string): void;
    removeUri(uri: { toString(): string }): void;
    lookup(name: string): Array<{ kind: string; name: string }>;
    ofKinds(kinds: string[]): Array<{ kind: string; name: string }>;
  };
  scanDefinitions(
    text: string,
    uri: { toString(): string },
  ): Array<{
    kind: string;
    name: string;
    description: string;
  }>;
};
const { LIST_KEYS, listContext } = require("../../vscode-nt/context.js") as {
  LIST_KEYS: Record<string, string[]>;
  listContext(
    document: { lineAt(index: number): { text: string } },
    position: { line: number; character: number },
  ): string | undefined;
};

/**
 * Absolute path to the sibling VS Code extension fixture.
 *
 * Deriving the path from this test module keeps the contract suite independent
 * of the caller's working directory, including pnpm's package-scoped release job.
 */
const extensionRoot = nodePath.resolve(
  nodePath.dirname(fileURLToPath(import.meta.url)),
  "../../vscode-nt",
);

test("VS Code index remains offline while indexing MCP declarations and tool policies", () => {
  const definitions = scanDefinitions(
    "mcp github\n  transport: stdio\n  command: node\n  tools:\n    repo.search:\n      approval: once\n",
    { toString: () => "file:///project/age.nt" },
  );
  assert.deepEqual(
    definitions.map((definition) => [definition.kind, definition.name]),
    [
      ["mcp", "github"],
      ["mcp-tool", "github.repo.search"],
    ],
  );
  assert.match(definitions[1].description, /approval once/);
  assert.match(definitions[0].description, /transport stdio/);
});

test("VS Code indexes flow-list MCP policies and detects inline agent tool completion", () => {
  const definitions = scanDefinitions(
    "mcp local\n  transport: stdio\n  command: node\n  tools: [echo, 'repo.search', \"*\"]\n",
    { toString: () => "file:///project/age.nt" },
  );
  assert.deepEqual(
    definitions.map((definition) => definition.name),
    ["local", "local.echo", "local.repo.search", "local.*"],
  );
  const lines = ["agent a", "  tools: [local."];
  assert.equal(
    listContext({ lineAt: (index) => ({ text: lines[index] }) }, { line: 1, character: 22 }),
    "tools",
  );
  assert.deepEqual(LIST_KEYS.tools, ["tool", "mcp-tool"]);
  assert.equal(
    LIST_KEYS.tools.includes("mcp"),
    false,
    "bare MCP server names are not valid agent tool references",
  );
});

test("VS Code incrementally replaces and removes MCP workspace symbols", () => {
  const index = new NtIndex();
  const uri = { toString: () => "file:///project/age.nt" };
  index.updateDoc(
    uri,
    "mcp local\n  transport: stdio\n  command: node\n  tools: [echo]\nagent a\n  tools: [local.echo]\n",
  );
  assert.equal(index.lookup("local.echo")[0]?.kind, "mcp-tool");
  assert.deepEqual(
    index.ofKinds(["mcp", "mcp-tool"]).map((definition) => definition.name),
    ["local", "local.echo"],
  );

  index.updateDoc(
    uri,
    "mcp local\n  transport: streamable_http\n  url: https://example.test/mcp\n  tools: [search]\n",
  );
  assert.equal(index.lookup("local.echo").length, 0);
  assert.equal(index.lookup("local.search")[0]?.kind, "mcp-tool");
  index.removeUri(uri);
  assert.equal(index.lookup("local").length, 0);
  assert.equal(index.lookup("local.search").length, 0);
});

test("VS Code manifest contributes MCP grammar and all secure server snippets", () => {
  const manifest = JSON.parse(
    fs.readFileSync(nodePath.join(extensionRoot, "package.json"), "utf8"),
  ) as {
    contributes: { snippets: Array<{ path: string }>; grammars: Array<{ path: string }> };
  };
  const grammar = JSON.parse(
    fs.readFileSync(nodePath.join(extensionRoot, manifest.contributes.grammars[0].path), "utf8"),
  ) as { repository: { declaration: { match: string } } };
  const snippets = JSON.parse(
    fs.readFileSync(nodePath.join(extensionRoot, manifest.contributes.snippets[0].path), "utf8"),
  ) as Record<string, { prefix: string; body: string[] }>;
  assert.match(grammar.repository.declaration.match, /mcp/);
  assert.deepEqual(
    Object.values(snippets).map((snippet) => snippet.prefix),
    ["mcp-stdio", "mcp-http-bearer", "mcp-oauth"],
  );
  assert.match(snippets["MCP bearer HTTP server"].body.join("\n"), /token: env\(/);
  assert.match(snippets["MCP stdio server"].body.join("\n"), /approval:/);
  assert.match(snippets["MCP stdio server"].body.join("\n"), /@scope\/server@1\.0\.0/);
  assert.match(snippets["MCP OAuth server"].body.join("\n"), /scopes:/);
});
