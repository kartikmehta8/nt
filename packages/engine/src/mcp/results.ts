/**
 * @file Safe conversion of untrusted MCP tool results into NT outcomes.
 *
 * Preserves ordered text, renders resource metadata without fetching it,
 * validates structured output, and replaces binary image, audio, and blob data
 * with bounded descriptive placeholders. Model-visible content is capped at one
 * MiB and audit summaries at four thousand characters, with long base64-like
 * material removed before it can reach the append-only audit log.
 */

import type { CallToolResult } from "@modelcontextprotocol/client";
import type { ValidateFunction } from "ajv";
import { McpError } from "#mcp/errors";
import { validationMessage } from "#mcp/schemas";

const MAX_RESULT_BYTES = 1024 * 1024;

/**
 * Truncates UTF-8 at a valid code-point boundary while reserving room for the
 * visible truncation marker inside the byte budget.
 *
 * @param value Untrusted model-facing result text.
 * @param maxBytes Maximum encoded size including the marker.
 * @returns Original text when bounded, otherwise a valid bounded UTF-8 prefix.
 */
function boundedUtf8(value: string, maxBytes: number): string {
  const encoded = Buffer.from(value);
  if (encoded.length <= maxBytes) return value;
  const suffix = `\n[result truncated at ${maxBytes} bytes]`;
  const prefixLimit = maxBytes - Buffer.byteLength(suffix);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (let end = prefixLimit; end >= Math.max(0, prefixLimit - 3); end--)
    try {
      return decoder.decode(encoded.subarray(0, end)) + suffix;
    } catch {
      continue;
    }
  return suffix;
}

function renderBlock(block: Record<string, unknown>): string {
  if (block.type === "text") return String(block.text ?? "");
  if (block.type === "resource_link")
    return `[resource link: ${String(block.name ?? "resource")} — ${String(block.uri ?? "unknown URI")}${block.mimeType ? ` (${block.mimeType})` : ""}]`;
  if (block.type === "resource") {
    const resource = (block.resource ?? {}) as Record<string, unknown>;
    if (typeof resource.text === "string")
      return `[resource: ${String(resource.uri ?? "unknown URI")}${resource.mimeType ? ` (${resource.mimeType})` : ""}]\n${resource.text}`;
    const bytes = typeof resource.blob === "string" ? Math.floor(resource.blob.length * 0.75) : 0;
    return `[embedded binary resource omitted: ${String(resource.mimeType ?? "application/octet-stream")}, approximately ${bytes} bytes]`;
  }
  if (block.type === "image" || block.type === "audio") {
    const data = typeof block.data === "string" ? block.data : "";
    return `[${block.type} omitted: ${String(block.mimeType ?? "unknown MIME type")}, approximately ${Math.floor(data.length * 0.75)} bytes]`;
  }
  return `[unsupported MCP content block: ${String(block.type ?? "unknown")}]`;
}

/**
 * Converts an untrusted SDK result into bounded model and audit representations.
 * @param result The raw SDK call result.
 * @param outputValidator Optional advertised output-schema validator.
 * @returns Bounded model content, an audit-safe summary, and error status.
 */
export function normalizeResult(
  result: CallToolResult,
  outputValidator?: ValidateFunction,
): { modelContent: string; auditSummary: string; isError: boolean } {
  if (
    result.structuredContent !== undefined &&
    outputValidator &&
    !outputValidator(result.structuredContent)
  )
    throw new McpError(
      "MCP_OUTPUT_INVALID",
      `tool output failed schema validation: ${validationMessage(outputValidator.errors)}`,
    );
  const parts = (result.content as unknown[]).map((block) =>
    renderBlock(block as Record<string, unknown>),
  );
  if (
    result.structuredContent !== undefined &&
    !parts.some((part) => part.includes(JSON.stringify(result.structuredContent)))
  )
    parts.push(JSON.stringify(result.structuredContent, null, 2));
  const modelContent = boundedUtf8(parts.join("\n"), MAX_RESULT_BYTES);
  const auditSummary = boundedUtf8(
    modelContent.replace(/[A-Za-z0-9+/]{200,}={0,2}/g, "[binary omitted]"),
    4000,
  );
  return { modelContent, auditSummary, isError: result.isError === true };
}
