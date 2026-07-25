/**
 * @file Audit writer and reader tests: append-only JSONL with owner-only
 * permissions, per-day rotation, input secrets scrubbed from output, one line
 * per call whatever the output contains, graceful degradation on an unwritable
 * folder, and reading the most recent entries back.
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { AuditLog, auditToolKind, openAuditLog, readAuditEntries } from "#audit/log";
import { parseNt } from "#parse/parser";
import { buildProject } from "#schema/build";

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

test("the log appends one JSON line per tool call in an owner-only folder", () => {
  const logDir = nodePath.join(dir, "audit");
  const log = new AuditLog(logDir);
  assert.equal(fs.existsSync(logDir), false, "the folder is created lazily on first write");

  log.record({
    run: "run-1",
    agent: "age",
    depth: 0,
    tool: "fs_write",
    kind: "builtin",
    input: { path: "notes.md", content: "hi" },
    ok: true,
    durationMs: 4,
    output: "wrote notes.md",
  });
  log.record({
    run: "run-1",
    agent: "researcher",
    depth: 1,
    tool: "bash",
    kind: "builtin",
    input: { command: "curl -H 'x-api-key: sk-abcdefghijklmnop' https://x.test" },
    ok: false,
    durationMs: 9,
    output: "exit 127",
  });

  const file = log.fileFor(new Date());
  const lines = fs.readFileSync(file, "utf8").trim().split("\n");
  assert.equal(lines.length, 2);
  assert.equal((fs.statSync(logDir).mode & 0o777).toString(8), "700");
  assert.equal((fs.statSync(file).mode & 0o777).toString(8), "600");

  const first = JSON.parse(lines[0]);
  assert.equal(first.tool, "fs_write");
  assert.equal(first.run, "run-1");
  assert.equal(first.ok, true);
  assert.equal(first.duration_ms, 4);
  assert.deepEqual(first.input, { path: "notes.md", content: "hi" });
  assert.match(first.ts, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(JSON.parse(lines[1]).input.command.includes("sk-abc"), false);
});

test("the log file name rotates once per UTC day", () => {
  const log = new AuditLog(dir);
  assert.equal(
    log.fileFor(new Date("2026-07-25T23:59:59Z")),
    nodePath.join(dir, "tools-2026-07-25.jsonl"),
  );
  assert.equal(
    log.fileFor(new Date("2026-07-26T00:00:01Z")),
    nodePath.join(dir, "tools-2026-07-26.jsonl"),
  );
});

test("a secret dropped from the input is also scrubbed from that call's output", () => {
  const log = new AuditLog(dir);
  const entry = log.record({
    run: "r",
    agent: "a",
    depth: 0,
    tool: "peek",
    kind: "custom",
    input: { token: "plain-looking-value", path: "a.txt" },
    ok: true,
    durationMs: 1,
    output: "echoed plain-looking-value back and a.txt stayed",
  });
  assert.equal(entry?.input.token, "[redacted]");
  assert.equal(entry?.output, "echoed [redacted] back and a.txt stayed");
});

test("multi-line output stays on one JSONL line and round-trips", () => {
  const log = new AuditLog(dir);
  const output = 'line one\nline two\r\nwith "quotes", a \\ backslash and a\ttab';
  log.record({
    run: "r",
    agent: "a",
    depth: 0,
    tool: "bash",
    kind: "builtin",
    input: { command: "cat multi.txt" },
    ok: true,
    durationMs: 1,
    output,
  });
  const raw = fs.readFileSync(log.fileFor(new Date()), "utf8");
  assert.equal(raw.split("\n").filter((l) => l.trim() !== "").length, 1);
  assert.equal(readAuditEntries(dir, 5)[0].output, output);
});

test("an unwritable destination degrades to a warning instead of failing the run", () => {
  const blocked = nodePath.join(dir, "file-not-a-dir");
  fs.writeFileSync(blocked, "");
  const log = new AuditLog(nodePath.join(blocked, "audit"));
  const warn = console.warn;
  const seen: string[] = [];
  console.warn = (message: string) => seen.push(message);
  try {
    const entry = { run: "r", agent: "a", depth: 0, tool: "bash", input: {}, output: "" };
    assert.equal(log.record({ ...entry, kind: "builtin", ok: true, durationMs: 1 }), null);
    assert.equal(log.record({ ...entry, kind: "builtin", ok: true, durationMs: 1 }), null);
  } finally {
    console.warn = warn;
  }
  assert.equal(seen.length, 1, "the failure is reported once, not per call");
  assert.match(seen[0], /audit log disabled/);
});

test("readAuditEntries returns the most recent entries oldest-first across files", () => {
  fs.writeFileSync(
    nodePath.join(dir, "tools-2026-07-24.jsonl"),
    ['{"ts":"a","tool":"one"}', '{"ts":"b","tool":"two"}', ""].join("\n"),
  );
  fs.writeFileSync(
    nodePath.join(dir, "tools-2026-07-25.jsonl"),
    ['{"ts":"c","tool":"three"}', "{ not json", '{"ts":"d","tool":"four"}'].join("\n"),
  );
  fs.writeFileSync(nodePath.join(dir, "ignored.txt"), "noise\n");

  assert.deepEqual(
    readAuditEntries(dir, 10).map((e) => e.tool),
    ["one", "two", "three", "four"],
  );
  assert.deepEqual(
    readAuditEntries(dir, 3).map((e) => e.tool),
    ["two", "three", "four"],
  );
  assert.deepEqual(readAuditEntries(nodePath.join(dir, "absent"), 5), []);
});

test("openAuditLog honours the project switch", () => {
  const off = build("config\n  audit: off\n").project;
  assert.equal(openAuditLog(off), null);
  const on = build(`config\n  audit: ${dir}\n`).project;
  assert.equal(openAuditLog(on)?.dir, dir);
});

test("auditToolKind separates built-ins, custom tools, delegation, and unknowns", () => {
  const { project } = build("tool t:\n  type: shell\n  command: echo hi\n");
  assert.equal(auditToolKind(project, "bash"), "builtin");
  assert.equal(auditToolKind(project, "t"), "custom");
  assert.equal(auditToolKind(project, "delegate_to_researcher"), "delegate");
  assert.equal(auditToolKind(project, "nope"), "unknown");
});
