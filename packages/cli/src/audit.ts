/**
 * @file The `nt audit` command: inspect the tool-call audit log.
 *
 * Reports whether logging is on and which folder the project writes to, then
 * prints the most recent entries — one line each, or the raw JSONL with
 * `--json`. Offline: it reads the project only for `config.audit`, never the
 * model.
 */

import { loadProject, readAuditEntries, type AuditEntry } from "@age.nt/engine";
import { resolveEntry, type Args } from "#args";
import { bold, cyan, dim, green, out, printWarnings, red, yellow } from "#format";

const DEFAULT_TAIL = 20;

/**
 * Formats one redacted audit entry as a compact terminal line.
 * @param entry One logged tool call.
 * @returns A single readable line describing the call.
 */
function formatEntry(entry: AuditEntry): string {
  const mark = entry.ok ? green("●") : red("●");
  const nesting = "  ".repeat(entry.depth);
  const args = JSON.stringify(entry.input);
  const head = `${mark} ${dim(entry.ts)} ${nesting}${cyan(entry.agent)} → ${entry.tool}`;
  return `${head}${dim(`(${args})`)} ${dim(`[${entry.kind} · ${entry.duration_ms}ms]`)}`;
}

/**
 * Prints current audit status or tails the selected bounded daily log.
 * @param args The parsed arguments.
 * @returns Nothing; matching audit entries are written to standard output.
 */
export function cmdAudit(args: Args): void {
  const { project, warnings } = loadProject(resolveEntry(args), {
    allowOutsideImports: args.allowOutsideImports,
  });
  const { audit } = project.config;
  const entries = readAuditEntries(audit.dir, args.tail ?? DEFAULT_TAIL);
  if (args.json) {
    for (const entry of entries) out(JSON.stringify(entry));
    return;
  }
  printWarnings(warnings);

  out(bold("Audit log"));
  out(
    `  ${audit.enabled ? green("● on") : yellow("○ off")} ${dim("· config.audit")}` +
      `${audit.enabled ? "" : dim(" (set a folder path to turn it back on)")}`,
  );
  out(`  ${dim("folder: ")}${audit.dir}`);
  if (entries.length === 0) {
    out(dim(`\n  (no entries yet${audit.enabled ? "" : "; logging is off"})`));
    return;
  }
  out(bold(`\nLast ${entries.length} tool call(s)`));
  for (const entry of entries) out("  " + formatEntry(entry));
}
