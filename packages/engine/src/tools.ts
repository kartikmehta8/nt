/**
 * @file Builds the model-facing tool list an agent is offered each turn.
 *
 * Combines built-in tools, source-declared custom tools as JSON schemas, and one
 * `delegate_to_<name>` tool per wired subagent. Selected MCP definitions are
 * discovered asynchronously and merged later by `buildRuntime`, keeping this
 * source-only builder synchronous and validation offline.
 */

import { DELEGATE_PREFIX, isBuiltinTool, type BuiltinToolName } from "#constants";
import { buildInputSchema } from "#io";
import type { LlmToolDef } from "#provider";
import type { AgentDef, Project } from "#types";
import { parseMcpReference } from "#mcp/names";

const OBJECT = (
  properties: Record<string, unknown>,
  required: string[],
): Record<string, unknown> => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

const BUILTIN_SCHEMAS: Record<BuiltinToolName, LlmToolDef> = {
  fs_read: {
    name: "fs_read",
    description: "Read a file from the sandbox.",
    input_schema: OBJECT({ path: { type: "string" } }, ["path"]),
  },
  fs_write: {
    name: "fs_write",
    description: "Write a file in the sandbox.",
    input_schema: OBJECT({ path: { type: "string" }, content: { type: "string" } }, [
      "path",
      "content",
    ]),
  },
  fs_list: {
    name: "fs_list",
    description: "List files in the sandbox.",
    input_schema: OBJECT({}, []),
  },
  bash: {
    name: "bash",
    description: "Run a shell command in the sandbox.",
    input_schema: OBJECT({ command: { type: "string" } }, ["command"]),
  },
};

export { DELEGATE_PREFIX };

/**
 * Builds the provider-facing built-in and custom tool definitions granted to an agent.
 * @param project The project the agent belongs to.
 * @param agent The agent whose tools should be exposed.
 * @returns Model-facing tool definitions for built-ins, custom tools, and subagent delegation.
 */
export function buildToolDefs(project: Project, agent: AgentDef): LlmToolDef[] {
  const defs: LlmToolDef[] = [];
  for (const name of agent.tools) {
    if (isBuiltinTool(name)) {
      defs.push(BUILTIN_SCHEMAS[name]);
      continue;
    }
    if (parseMcpReference(name) && !project.tools.has(name)) continue;
    const tool = project.tools.get(name);
    if (!tool) continue;
    defs.push({
      name: tool.name,
      description: tool.description,
      input_schema: buildInputSchema(tool.input),
    });
  }
  for (const subName of agent.subagents) {
    const sub = project.subagents.get(subName);
    if (!sub) continue;
    defs.push({
      name: `${DELEGATE_PREFIX}${subName}`,
      description: `Delegate a task to the '${subName}' subagent. ${sub.description}`.trim(),
      input_schema: OBJECT(
        { prompt: { type: "string", description: "The task for the subagent." } },
        ["prompt"],
      ),
    });
  }
  return defs;
}
