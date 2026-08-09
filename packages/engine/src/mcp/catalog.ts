/**
 * @file Validation and normalization boundary for advertised MCP tools.
 *
 * Converts an untrusted SDK tool list into NT catalog entries by enforcing
 * catalog count and byte limits, rejecting duplicate identities and generated
 * name collisions, compiling input/output schemas, and applying exact or
 * wildcard source selection. The result is sorted and safe to expose to model
 * providers; tools absent from the declaration remain unselected.
 */

import type { Tool } from "@modelcontextprotocol/client";
import { McpError } from "#mcp/errors";
import { mcpReference, modelToolName } from "#mcp/names";
import { toolPolicy } from "#mcp/policy";
import { compileSchema } from "#mcp/schemas";
import type { CatalogTool } from "#mcp/types";
import type { McpServerDef } from "#types";

const MAX_CATALOG_BYTES = 1024 * 1024;
const MAX_TOOLS = 512;
const MAX_SELECTED = 128;

/**
 * Validates and normalizes an advertised tool list against the source selection policy.
 * @param def The declaration that selects and configures advertised tools.
 * @param advertised Untrusted tool metadata returned by the MCP server.
 * @returns A sorted, schema-compiled catalog with model-facing names.
 */
export function buildCatalog(def: McpServerDef, advertised: Tool[]): CatalogTool[] {
  if (advertised.length > MAX_TOOLS)
    throw new McpError(
      "MCP_SCHEMA_INVALID",
      `MCP server '${def.name}' advertises more than ${MAX_TOOLS} tools`,
    );
  if (Buffer.byteLength(JSON.stringify(advertised)) > MAX_CATALOG_BYTES)
    throw new McpError(
      "MCP_SCHEMA_INVALID",
      `MCP server '${def.name}' catalog exceeds ${MAX_CATALOG_BYTES} bytes`,
    );
  const seenRemote = new Set<string>();
  const seenModel = new Set<string>();
  const catalog: CatalogTool[] = [];
  for (const tool of [...advertised].sort((a, b) => a.name.localeCompare(b.name))) {
    if (!tool.name || tool.name.length > 128) continue;
    if (seenRemote.has(tool.name))
      throw new McpError(
        "MCP_SCHEMA_INVALID",
        `MCP server '${def.name}' advertised duplicate tool '${tool.name}'`,
      );
    seenRemote.add(tool.name);
    const modelName = modelToolName(def.name, tool.name);
    if (seenModel.has(modelName))
      throw new McpError(
        "MCP_SCHEMA_INVALID",
        `MCP model-facing tool name collision at '${modelName}'`,
      );
    seenModel.add(modelName);
    const selection = toolPolicy(def, tool.name);
    const selected = selection.source !== "none";
    const inputSchema = tool.inputSchema as Record<string, unknown>;
    const outputSchema = tool.outputSchema as Record<string, unknown> | undefined;
    const inputValidator = compileSchema(inputSchema, `${def.name}.${tool.name}.inputSchema`);
    const outputValidator = outputSchema
      ? compileSchema(outputSchema, `${def.name}.${tool.name}.outputSchema`)
      : undefined;
    catalog.push({
      sdk: tool,
      inputValidator,
      outputValidator,
      info: {
        server: def.name,
        remoteName: tool.name,
        reference: mcpReference(def.name, tool.name),
        modelName,
        title: tool.title,
        description: selection.policy.description ?? tool.description ?? tool.title ?? tool.name,
        inputSchema,
        outputSchema,
        annotations: tool.annotations as Record<string, unknown> | undefined,
        approval: selection.policy.approval,
        selected,
        selectionSource: selection.source,
      },
    });
  }
  const selectedCount = catalog.filter((tool) => tool.info.selected).length;
  if (selectedCount > MAX_SELECTED)
    throw new McpError(
      "MCP_SCHEMA_INVALID",
      `MCP server '${def.name}' selects more than ${MAX_SELECTED} tools`,
    );
  for (const name of def.tools.keys())
    if (name !== "*" && !seenRemote.has(name))
      throw new McpError(
        "MCP_TOOL_NOT_FOUND",
        `selected MCP tool '${def.name}.${name}' was not advertised by the server`,
      );
  return catalog;
}
