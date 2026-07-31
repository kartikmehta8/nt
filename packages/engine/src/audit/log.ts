/**
 * @file The append-only JSONL audit log of every tool call.
 *
 * `AuditLog.record` appends one redacted JSON line per tool invocation to a
 * per-day file in the configured folder (`~/.nt/audit` by default), creating the
 * folder on first write with owner-only permissions. Lines are only ever
 * appended, never rewritten, and a failing write degrades to a single warning so
 * logging can never break a run. `readAuditEntries` reads the most recent
 * entries back for `nt audit`.
 */

import * as fs from "node:fs";
import * as nodePath from "node:path";
import { collectSecrets, createRedactor, type Redactor } from "#audit/redact";
import {
  AUDIT_DIR_MODE,
  AUDIT_FILE_EXT,
  AUDIT_FILE_MODE,
  AUDIT_FILE_PREFIX,
  AUDIT_MAX_OUTPUT_CHARS,
  AUDIT_TAIL_BYTES_PER_ENTRY,
  AUDIT_TAIL_MAX_BYTES,
  DELEGATE_PREFIX,
  isBuiltinTool,
} from "#constants";
import type { Project } from "#types";

export type AuditToolKind = "builtin" | "custom" | "delegate" | "unknown";

export interface AuditRecord {
  run: string;
  agent: string;
  depth: number;
  tool: string;
  kind: AuditToolKind;
  input: Record<string, unknown>;
  ok: boolean;
  durationMs: number;
  output: string;
}

export interface AuditEntry {
  ts: string;
  run: string;
  agent: string;
  depth: number;
  tool: string;
  kind: AuditToolKind;
  input: Record<string, unknown>;
  ok: boolean;
  duration_ms: number;
  output: string;
}

/**
 * @param project The project the tool belongs to.
 * @param name The invoked tool name.
 * @returns Which family of tool the name refers to.
 */
export function auditToolKind(project: Project, name: string): AuditToolKind {
  if (isBuiltinTool(name)) return "builtin";
  if (name.startsWith(DELEGATE_PREFIX)) return "delegate";
  return project.tools.has(name) ? "custom" : "unknown";
}

export class AuditLog {
  readonly dir: string;
  private redactor: Redactor;
  private ready = false;
  private broken = false;

  constructor(dir: string, redactor: Redactor = createRedactor()) {
    this.dir = dir;
    this.redactor = redactor;
  }

  /**
   * @param at The moment the entry belongs to; the log rotates once per UTC day.
   * @returns The absolute path of the JSONL file that day's entries append to.
   */
  fileFor(at: Date): string {
    const day = at.toISOString().slice(0, 10);
    return nodePath.join(this.dir, `${AUDIT_FILE_PREFIX}${day}${AUDIT_FILE_EXT}`);
  }

  /**
   * @param record One completed tool call; the model-controlled tool name is
   * redacted like input and output.
   * @returns The entry that was appended, or null when logging is unavailable.
   */
  record(record: AuditRecord): AuditEntry | null {
    const at = new Date();
    const redacted = this.redactor.input(record.input);
    const entry: AuditEntry = {
      ts: at.toISOString(),
      run: record.run,
      agent: record.agent,
      depth: record.depth,
      tool: this.redactor.text(record.tool),
      kind: record.kind,
      input: redacted.input,
      ok: record.ok,
      duration_ms: record.durationMs,
      output: this.redactor.text(record.output, AUDIT_MAX_OUTPUT_CHARS, redacted.dropped),
    };
    return this.append(entry) ? entry : null;
  }

  /**
   * @param entry The redacted entry to append.
   * @returns Whether the line reached the log.
   */
  private append(entry: AuditEntry): boolean {
    if (this.broken) return false;
    try {
      if (!this.ready) {
        fs.mkdirSync(this.dir, { recursive: true, mode: AUDIT_DIR_MODE });
        this.ready = true;
      }
      fs.appendFileSync(this.fileFor(new Date(entry.ts)), JSON.stringify(entry) + "\n", {
        mode: AUDIT_FILE_MODE,
      });
      return true;
    } catch (e) {
      this.broken = true;
      console.warn(`⚠ audit log disabled: cannot write to ${this.dir}: ${(e as Error).message}`);
      return false;
    }
  }
}

/**
 * @param project The loaded project whose `config.audit` decides the destination.
 * @returns A ready audit log, or null when logging is turned off.
 */
export function openAuditLog(project: Project): AuditLog | null {
  const { audit } = project.config;
  if (!audit.enabled) return null;
  return new AuditLog(audit.dir, createRedactor(collectSecrets(project)));
}

/**
 * @param dir The audit folder to read.
 * @returns The audit files in the folder, oldest first.
 */
export function auditFiles(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.startsWith(AUDIT_FILE_PREFIX) && f.endsWith(AUDIT_FILE_EXT))
      .sort()
      .map((f) => nodePath.join(dir, f));
  } catch {
    return [];
  }
}

/**
 * @param file The audit file to tail.
 * @param maxLines The most lines the caller will consume.
 * @returns The file's trailing lines, read as one bounded region from the end.
 */
function readTailLines(file: string, maxLines: number): string[] {
  const maxBytes = Math.min(AUDIT_TAIL_MAX_BYTES, (maxLines + 1) * AUDIT_TAIL_BYTES_PER_ENTRY);
  const fd = fs.openSync(file, "r");
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - maxBytes);
    const buffer = Buffer.alloc(size - start);
    fs.readSync(fd, buffer, 0, buffer.length, start);
    const lines = buffer.toString("utf8").split("\n");
    if (start > 0) lines.shift();
    return lines;
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * @param dir The audit folder to read.
 * @param limit The most entries to return.
 * @returns The most recent entries, oldest first; unparseable lines are skipped.
 */
export function readAuditEntries(dir: string, limit: number): AuditEntry[] {
  const files = auditFiles(dir);
  const collected: AuditEntry[] = [];
  for (let i = files.length - 1; i >= 0 && collected.length < limit; i--) {
    let lines: string[];
    try {
      lines = readTailLines(files[i], limit - collected.length);
    } catch {
      continue;
    }
    for (let j = lines.length - 1; j >= 0 && collected.length < limit; j--) {
      const line = lines[j].trim();
      if (line === "") continue;
      try {
        collected.push(JSON.parse(line) as AuditEntry);
      } catch {
        continue;
      }
    }
  }
  return collected.reverse();
}
