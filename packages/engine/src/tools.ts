/**
 * @file Builds the model-facing tool list an agent is offered each turn.
 *
 * Combines the built-in tools (fs_read, fs_write, fs_list, bash), the agent's
 * declared custom tools (as JSON schemas), and one `delegate_to_<name>` tool per
 * wired subagent — so the model can act, read and write the sandbox, and
 * delegate.
 */

import { DELEGATE_PREFIX, isBuiltinTool, type BuiltinToolName } from "#constants";
import { buildInputSchema } from "#io";
import type { LlmToolDef } from "#provider";
import type { AgentDef, Project } from "#types";

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
    const tool = project.tools.get(name)!;
    defs.push({
      name: tool.name,
      description: tool.description,
      input_schema: buildInputSchema(tool.input),
    });
  }
  for (const subName of agent.subagents) {
    const sub = project.subagents.get(subName)!;
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
