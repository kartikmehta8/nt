/**
 * @file `nt audit` output tests: the status header, the formatted entry list,
 * the raw `--json` mode, and what it reports when logging is off.
 *
 * `audit: off` still resolves the default `~/.nt/audit` folder, so each test
 * points `HOME` at its own temporary directory — otherwise these assertions
 * would read whatever the developer's real audit log happens to contain.
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { cmdAudit } from "#audit";
import { parseArgs } from "#args";

let root: string;
let logs: string;
let savedHome: string | undefined;

beforeEach(() => {
  root = fs.mkdtempSync(nodePath.join(os.tmpdir(), "nt-cli-audit-"));
  logs = nodePath.join(root, "logs");
  savedHome = process.env.HOME;
  process.env.HOME = nodePath.join(root, "home");
});

afterEach(() => {
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
  fs.rmSync(root, { recursive: true, force: true });
});

/**
 * @param auditValue The value written as `config.audit`.
 * @returns The path of the entry `.nt` file for the temporary project.
 */
function writeProject(auditValue: string): string {
  const entry = nodePath.join(root, "age.nt");
  fs.writeFileSync(entry, `config\n  audit: ${auditValue}\nskill s:\n  description: x\n`);
  return entry;
}

/**
 * @param entries Audit entries to seed today's log file with.
 */
function seedLog(entries: Record<string, unknown>[]): void {
  fs.mkdirSync(logs, { recursive: true });
  fs.writeFileSync(
    nodePath.join(logs, "tools-2026-07-25.jsonl"),
    entries.map((e) => JSON.stringify(e)).join("\n") + "\n",
  );
}

/**
 * @param argv CLI arguments for the audit command.
 * @returns Everything the command wrote to standard output.
 */
function capture(argv: string[]): string {
  const written: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk: string | Uint8Array): boolean => {
    written.push(String(chunk));
    return true;
  };
  try {
    cmdAudit(parseArgs(argv));
  } finally {
    process.stdout.write = original;
  }
  return written.join("");
}

const ENTRY = {
  ts: "2026-07-25T10:00:00.000Z",
  run: "run-1",
  agent: "age",
  depth: 0,
  tool: "fs_write",
  kind: "builtin",
  input: { path: "notes.md" },
  ok: true,
  duration_ms: 3,
  output: "wrote notes.md",
};

test("audit reports the destination and lists recent calls", () => {
  const entry = writeProject(logs);
  seedLog([ENTRY, { ...ENTRY, tool: "bash", ok: false, agent: "researcher", depth: 1 }]);
  const output = capture(["audit", "--file", entry]);
  assert.match(output, /Audit log/);
  assert.match(output, /● on/);
  assert.ok(output.includes(logs), "the folder is shown");
  assert.match(output, /Last 2 tool call\(s\)/);
  assert.match(output, /age → fs_write/);
  assert.match(output, /researcher → bash/);
  assert.match(output, /\[builtin · 3ms\]/);
});

test("audit --tail limits how many calls are shown", () => {
  const entry = writeProject(logs);
  seedLog([ENTRY, { ...ENTRY, tool: "bash" }, { ...ENTRY, tool: "fs_list" }]);
  const output = capture(["audit", "--file", entry, "--tail", "1"]);
  assert.match(output, /Last 1 tool call\(s\)/);
  assert.match(output, /fs_list/);
  assert.equal(output.includes("fs_write"), false);
});

test("audit --json prints only parseable JSONL", () => {
  const entry = writeProject(logs);
  seedLog([ENTRY, { ...ENTRY, tool: "bash" }]);
  const lines = capture(["audit", "--file", entry, "--json"]).trim().split("\n");
  assert.deepEqual(
    lines.map((line) => JSON.parse(line).tool),
    ["fs_write", "bash"],
  );
});

test("audit says so when logging is off, and when there is nothing logged yet", () => {
  const off = capture(["audit", "--file", writeProject("off")]);
  assert.match(off, /○ off/);
  assert.match(off, /no entries yet; logging is off/);

  const empty = capture(["audit", "--file", writeProject(logs)]);
  assert.match(empty, /no entries yet\)/);
});
