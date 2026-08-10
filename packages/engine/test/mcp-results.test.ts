/**
 * @file Result-normalization security and compatibility tests for MCP tools.
 *
 * Covers ordered text, resource links, embedded text, structured content,
 * explicit tool errors, binary placeholders, schema failures, audit-safe
 * summaries, the model-output byte cap, and stable OAuth-scope error mapping.
 * Fixtures are in-memory SDK shapes so no transport or provider is involved.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  InsufficientScopeError,
  type CallToolResult,
  type Client,
  type Tool,
} from "@modelcontextprotocol/client";
import { McpError } from "#mcp/errors";
import { invokeMcpTool } from "#mcp/invocation";
import { normalizeResult } from "#mcp/results";
import { compileSchema } from "#mcp/schemas";

function result(value: Record<string, unknown>): CallToolResult {
  return value as CallToolResult;
}

test("normalization preserves text, links, resources, structured data, and tool errors", () => {
  const normalized = normalizeResult(
    result({
      isError: true,
      content: [
        { type: "text", text: "visible text" },
        { type: "resource_link", name: "guide", uri: "file:///guide", mimeType: "text/plain" },
        {
          type: "resource",
          resource: { uri: "file:///note", mimeType: "text/plain", text: "note body" },
        },
      ],
      structuredContent: { count: 2 },
    }),
  );
  assert.equal(normalized.isError, true);
  assert.match(normalized.modelContent, /visible text/);
  assert.match(normalized.modelContent, /resource link: guide/);
  assert.match(normalized.modelContent, /note body/);
  assert.match(normalized.modelContent, /"count": 2/);
});

test("binary MCP content is represented without retaining its base64 body", () => {
  const encoded = "A".repeat(400);
  const normalized = normalizeResult(
    result({
      content: [
        { type: "image", data: encoded, mimeType: "image/png" },
        {
          type: "resource",
          resource: { uri: "file:///blob", blob: encoded, mimeType: "application/octet-stream" },
        },
      ],
    }),
  );
  assert.doesNotMatch(normalized.modelContent, new RegExp(encoded));
  assert.doesNotMatch(normalized.auditSummary, new RegExp(encoded));
  assert.match(normalized.modelContent, /image omitted/);
  assert.match(normalized.modelContent, /binary resource omitted/);
});

test("structured output is validated and oversized text is bounded", () => {
  const validator = compileSchema(
    {
      type: "object",
      properties: { ok: { type: "boolean" } },
      required: ["ok"],
      additionalProperties: false,
    },
    "output",
  );
  assert.throws(
    () => normalizeResult(result({ content: [], structuredContent: { ok: "yes" } }), validator),
    (error: unknown) =>
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "MCP_OUTPUT_INVALID",
  );
  const normalized = normalizeResult(
    result({ content: [{ type: "text", text: "🙂".repeat(300_000) }] }),
  );
  assert.match(normalized.modelContent, /result truncated at 1048576 bytes/);
  assert.ok(Buffer.byteLength(normalized.modelContent) <= 1024 * 1024);
  assert.doesNotMatch(normalized.modelContent, /�/);
  assert.ok(Buffer.byteLength(normalized.auditSummary) <= 4000);
});

test("invocation preserves insufficient OAuth scope as a stable public code", async () => {
  const client = {
    callTool: async () => {
      throw new InsufficientScopeError({ requiredScope: "documents.write" });
    },
  } as unknown as Client;
  const tool = { name: "write_document" } as Tool;
  await assert.rejects(
    () => invokeMcpTool(client, tool, {}, 1_000),
    (error: unknown) => error instanceof McpError && error.code === "MCP_INSUFFICIENT_SCOPE",
  );
});

test("invocation rate-limits progress bursts but preserves completion", async () => {
  const client = {
    callTool: async (
      _request: unknown,
      options: { onprogress(progress: { progress: number; total?: number }): void },
    ) => {
      for (let progress = 0; progress <= 100; progress++)
        options.onprogress({ progress, total: 100 });
      return { content: [{ type: "text", text: "done" }] };
    },
  } as unknown as Client;
  const details: string[] = [];
  await invokeMcpTool(client, { name: "long_task" } as Tool, {}, 1_000, (detail) =>
    details.push(detail),
  );
  assert.deepEqual(details, ["long_task: 0/100", "long_task: 100/100"]);
});
