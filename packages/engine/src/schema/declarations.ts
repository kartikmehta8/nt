/**
 * @file Interprets each block kind into its typed definition.
 *
 * Owns the focused parsers for sandboxes, tools, skills, agents/subagents, and
 * workflows, validating fields and warning on unknown ones. Provider and MCP
 * coercion live in sibling modules because their transport and credential
 * policies form separate domains. No declaration parser performs runtime I/O.
 */

import { DEFAULT_SANDBOX_CWD, DELEGATE_PREFIX, MCP_TOOL_PREFIX, isBuiltinTool } from "#constants";
import { NtError } from "#errors";
import {
  isMap,
  optBool,
  optNum,
  optStr,
  parseFields,
  parseThinking,
  resolveEnv,
  strList,
  warnUnknown,
} from "#schema/coerce";
import type { AgentDef, Location, NtValue, SandboxDef, SkillDef, ToolDef } from "#types";

type Body = Record<string, NtValue>;

/**
 * Parses a sandbox and resolves its environment references without running it.
 *
 * @param name Declaration name supplied by the syntax parser.
 * @param body Raw sandbox fields.
 * @param loc Source location used in diagnostics.
 * @param warnings Collector for non-fatal unknown-field warnings.
 * @returns Validated sandbox definition.
 */
export function parseSandbox(
  name: string | null,
  body: Body,
  loc: Location,
  warnings: string[],
): SandboxDef {
  if (!name) throw new NtError("sandbox declaration requires a name", loc);
  warnUnknown(body, ["description", "type", "cwd", "env"], `sandbox ${name}`, warnings);
  const type = (optStr(body.type, "sandbox.type", loc) ?? "virtual") as SandboxDef["type"];
  if (type !== "virtual" && type !== "local")
    throw new NtError("sandbox type must be 'virtual' or 'local'", loc);
  const env: Record<string, string> = {};
  if (body.env !== undefined) {
    if (!isMap(body.env)) throw new NtError("sandbox.env must be a map", loc);
    for (const [k, v] of Object.entries(body.env)) env[k] = String(resolveEnv(v));
  }
  return {
    name,
    type,
    description: optStr(body.description, "sandbox.description", loc) ?? "",
    cwd: optStr(body.cwd, "sandbox.cwd", loc) ?? DEFAULT_SANDBOX_CWD,
    env,
    loc,
  };
}

/**
 * Parses a shell or HTTP tool while enforcing reserved-name boundaries.
 *
 * @param name Declaration name supplied by the syntax parser.
 * @param body Raw tool fields.
 * @param loc Source location used in diagnostics.
 * @param warnings Collector for non-fatal unknown-field warnings.
 * @returns Validated custom-tool definition.
 */
export function parseTool(
  name: string | null,
  body: Body,
  loc: Location,
  warnings: string[],
): ToolDef {
  if (!name) throw new NtError("tool declaration requires a name", loc);
  if (isBuiltinTool(name))
    throw new NtError(`tool name '${name}' is reserved for the built-in tool`, loc);
  if (name.startsWith(DELEGATE_PREFIX))
    throw new NtError(
      `tool name '${name}' is reserved: the '${DELEGATE_PREFIX}' prefix is used for subagent delegation`,
      loc,
    );
  if (name.startsWith(MCP_TOOL_PREFIX))
    throw new NtError(
      `tool name '${name}' is reserved: the '${MCP_TOOL_PREFIX}' prefix is used for MCP tools`,
      loc,
    );
  const fields = [
    "description",
    "type",
    "input",
    "method",
    "url",
    "headers",
    "command",
    "allow_internal",
    "confirm",
  ];
  warnUnknown(body, fields, `tool ${name}`, warnings);
  const type = optStr(body.type, "tool.type", loc) ?? "shell";
  if (type !== "shell" && type !== "http")
    throw new NtError(`tool type must be 'shell' or 'http', got '${type}'`, loc);
  const headers: Record<string, NtValue> = {};
  if (body.headers !== undefined) {
    if (!isMap(body.headers)) throw new NtError("tool.headers must be a map", loc);
    Object.assign(headers, body.headers);
  }
  return {
    name,
    description: optStr(body.description, "tool.description", loc) ?? name,
    type,
    input: parseFields(body.input, `tool ${name}.input`, loc, warnings),
    method: optStr(body.method, "tool.method", loc) ?? undefined,
    url: optStr(body.url, "tool.url", loc) ?? undefined,
    headers,
    command: optStr(body.command, "tool.command", loc) ?? undefined,
    allowInternal: body.allow_internal === true,
    confirm: optBool(body.confirm, "tool.confirm", loc) ?? false,
    loc,
  };
}

/**
 * Parses a reusable instruction bundle.
 *
 * @param name Declaration name supplied by the syntax parser.
 * @param body Raw skill fields.
 * @param loc Source location used in diagnostics.
 * @param warnings Collector for non-fatal unknown-field warnings.
 * @returns Validated skill definition.
 */
export function parseSkill(
  name: string | null,
  body: Body,
  loc: Location,
  warnings: string[],
): SkillDef {
  if (!name) throw new NtError("skill declaration requires a name", loc);
  warnUnknown(body, ["description", "instructions"], `skill ${name}`, warnings);
  return {
    name,
    description: optStr(body.description, "skill.description", loc) ?? name,
    instructions: optStr(body.instructions, "skill.instructions", loc) ?? "",
    loc,
  };
}

/**
 * Parses a top-level agent or delegated subagent with the same field contract.
 *
 * @param kind Whether this is a top-level agent or a delegated subagent.
 * @param name Declaration name supplied by the syntax parser.
 * @param body Raw agent fields.
 * @param loc Source location used in diagnostics.
 * @param warnings Collector for non-fatal unknown-field warnings.
 * @returns Validated agent definition.
 */
export function parseAgent(
  kind: "agent" | "subagent",
  name: string | null,
  body: Body,
  loc: Location,
  warnings: string[],
): AgentDef {
  if (!name) throw new NtError(`${kind} declaration requires a name`, loc);
  const fields = [
    "description",
    "model",
    "instructions",
    "thinking",
    "max_tokens",
    "sandbox",
    "cwd",
    "tools",
    "subagents",
    "skills",
    "input",
    "output",
    "message",
  ];
  warnUnknown(body, fields, `${kind} ${name}`, warnings);
  return {
    name,
    kind,
    description: optStr(body.description, `${kind}.description`, loc) ?? "",
    model: optStr(body.model, `${kind}.model`, loc),
    instructions: optStr(body.instructions, `${kind}.instructions`, loc) ?? "",
    thinking: parseThinking(body.thinking, loc),
    maxTokens: optNum(body.max_tokens, `${kind}.max_tokens`, loc),
    sandbox: optStr(body.sandbox, `${kind}.sandbox`, loc),
    cwd: optStr(body.cwd, `${kind}.cwd`, loc),
    tools: strList(body.tools, `${kind}.tools`, loc),
    subagents: strList(body.subagents, `${kind}.subagents`, loc),
    skills: strList(body.skills, `${kind}.skills`, loc),
    input: parseFields(body.input, `${kind} ${name}.input`, loc, warnings),
    output: parseFields(body.output, `${kind} ${name}.output`, loc, warnings),
    message: optStr(body.message, `${kind}.message`, loc),
    loc,
  };
}
