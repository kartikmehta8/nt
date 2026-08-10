/**
 * @file Presentation boundary for live MCP CLI results.
 *
 * Renders compact terminal summaries for server catalogs and ordered doctor
 * checks, while `inspectJsonSafe` deep-redacts secret-shaped schema examples
 * before either human or JSON inspection output is produced. No helper in this
 * file connects, changes trust, or reads credentials.
 */

import type { McpDoctorResult, McpToolInfo } from "@age.nt/engine";
import { dim, green, out, yellow } from "#format";

/**
 * Prints server status and tool selection metadata in stable text or JSON form.
 * @param items Live server statuses and advertised tool catalogs.
 * @returns Nothing; the human-readable catalog is written to stdout.
 */
export function printMcpTools(
  items: Awaited<ReturnType<import("@age.nt/engine").Engine["listMcp"]>>,
): void {
  for (const { status, tools } of items) {
    out(
      `${status.name}  ${status.transport}  ${status.status}${status.protocolVersion ? `  protocol ${status.protocolVersion}` : ""}`,
    );
    if (status.error)
      out(
        `  ${yellow("!")} ${status.error}${status.errorCode ? dim(` (${status.errorCode})`) : ""}`,
      );
    for (const tool of tools)
      out(
        tool.selected
          ? `  ${green("✓")} ${tool.remoteName}  ${tool.reference}  approval ${tool.approval}`
          : `  ${dim("○")} ${tool.remoteName}  ${dim("not selected")}`,
      );
  }
}

/**
 * Removes live SDK-only values so inspection output remains valid deterministic JSON.
 * @param tool Untrusted advertised tool metadata.
 * @returns A deep copy with secret-shaped schema defaults redacted.
 */
export function inspectJsonSafe(tool: McpToolInfo): McpToolInfo {
  const redact = (value: unknown, parent = ""): unknown => {
    if (Array.isArray(value)) return value.map((item) => redact(item, parent));
    if (!value || typeof value !== "object") return value;
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const secret = /token|secret|password|authorization|api[_-]?key/i.test(parent);
      out[key] =
        secret && (key === "default" || key === "examples") ? "[redacted]" : redact(child, key);
    }
    return out;
  };
  return {
    ...tool,
    inputSchema: redact(tool.inputSchema) as Record<string, unknown>,
    outputSchema: tool.outputSchema
      ? (redact(tool.outputSchema) as Record<string, unknown>)
      : undefined,
  };
}

/**
 * Prints ordered MCP diagnostic checks with actionable status and error details.
 * @param reports Ordered per-server diagnostic reports.
 * @returns Nothing; each diagnostic check is written to stdout.
 */
export function printMcpDoctor(reports: McpDoctorResult[]): void {
  for (const report of reports) {
    out(
      `${report.name}  ${report.transport}  ${report.usable ? green("usable") : yellow("failed")}`,
    );
    for (const check of report.checks) {
      const marker =
        check.status === "pass" ? green("✓") : check.status === "fail" ? yellow("!") : dim("-");
      out(
        `  ${marker} ${check.name}: ${check.message}${check.code ? dim(` (${check.code})`) : ""}`,
      );
    }
  }
}
