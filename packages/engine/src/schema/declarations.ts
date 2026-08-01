/**
 * @file Interprets each block kind into its typed definition.
 *
 * One parser per kind — `parseSandbox`, `parseTool`, `parseSkill`, `parseAgent`
 * (agents and subagents), `parseWorkflow`, `parseProvider` — validating fields,
 * warning on unknown ones, and resolving env references where credentials or
 * environment values are expected.
 */

import { isIP } from "node:net";
import { DEFAULT_SANDBOX_CWD, DELEGATE_PREFIX, isBuiltinTool } from "#constants";
import { NtError } from "#errors";
import {
  isEnvRef,
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
import type {
  AgentDef,
  Location,
  NtValue,
  ProviderDef,
  SandboxDef,
  SkillDef,
  ToolDef,
  WorkflowDef,
  WorkflowStep,
} from "#types";

type Body = Record<string, NtValue>;

/**
 * @returns The parsed sandbox definition.
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
 * @returns The parsed tool definition.
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
 * @returns The parsed skill definition.
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
 * @param kind Whether this is a top-level agent or a delegated subagent.
 * @returns The parsed agent definition.
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

/**
 * @returns The parsed workflow definition.
 */
export function parseWorkflow(
  name: string | null,
  body: Body,
  loc: Location,
  warnings: string[],
): WorkflowDef {
  if (!name) throw new NtError("workflow declaration requires a name", loc);
  warnUnknown(
    body,
    ["description", "agent", "input", "output", "steps"],
    `workflow ${name}`,
    warnings,
  );
  return {
    name,
    description: optStr(body.description, "workflow.description", loc) ?? "",
    agent: optStr(body.agent, "workflow.agent", loc),
    input: parseFields(body.input, `workflow ${name}.input`, loc, warnings),
    output: parseFields(body.output, `workflow ${name}.output`, loc, warnings),
    steps: parseSteps(body.steps, loc),
    loc,
  };
}

/**
 * @returns The parsed workflow steps.
 */
function parseSteps(v: NtValue | undefined, loc: Location): WorkflowStep[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw new NtError("workflow.steps must be a list", loc);
  return v.map((s) => {
    if (!isMap(s)) throw new NtError("each workflow step must be a map", loc);
    const into = optStr(s.into, "step.into", loc) ?? undefined;
    if (into && ["__proto__", "constructor", "prototype"].includes(into))
      throw new NtError(`step.into must not be '${into}'`, loc);
    return {
      prompt: optStr(s.prompt, "step.prompt", loc) ?? undefined,
      agent: optStr(s.agent, "step.agent", loc) ?? undefined,
      skill: optStr(s.skill, "step.skill", loc) ?? undefined,
      into,
    };
  });
}

const AUTH_HEADER_NAMES = new Set(["x-api-key", "authorization"]);

/**
 * @param baseUrl The declared provider endpoint.
 * @param loc Source location for error messages.
 */
function checkBaseUrl(baseUrl: string, loc: Location): void {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new NtError(`provider.base_url is not a valid URL: ${baseUrl}`, loc);
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  const local =
    host === "localhost" ||
    host === "::1" ||
    (isIP(host) === 4 && host.startsWith("127.")) ||
    host.endsWith(".localhost");
  if (parsed.protocol !== "https:" && !local)
    throw new NtError(
      `provider.base_url must use https (API keys would be sent in cleartext): ${baseUrl}`,
      loc,
    );
}

/**
 * @returns The parsed provider definition, extracting any env-based credentials.
 */
export function parseProvider(
  name: string | null,
  body: Body,
  loc: Location,
  warnings: string[],
): ProviderDef {
  if (!name) throw new NtError("provider declaration requires a name", loc);
  warnUnknown(body, ["api", "base_url", "api_key", "headers"], `provider ${name}`, warnings);
  const api =
    optStr(body.api, "provider.api", loc) ??
    (name === "anthropic" ? "anthropic" : "openai-completions");
  if (api !== "anthropic" && api !== "openai-completions")
    throw new NtError(
      `provider.api must be 'anthropic' or 'openai-completions', got '${api}'`,
      loc,
    );
  const baseUrl = optStr(body.base_url, "provider.base_url", loc);
  if (baseUrl) checkBaseUrl(baseUrl, loc);
  const headers: Record<string, string> = {};
  if (body.headers !== undefined && !isMap(body.headers))
    throw new NtError("provider.headers must be a map", loc);
  if (body.headers !== undefined && isMap(body.headers))
    for (const [k, v] of Object.entries(body.headers)) {
      if (AUTH_HEADER_NAMES.has(k.toLowerCase()))
        warnings.push(
          `provider ${name}: header '${k}' overrides the credential header set from api_key`,
        );
      headers[k] = String(resolveEnv(v));
    }
  if (body.api_key !== undefined && !isEnvRef(body.api_key))
    warnings.push(
      `provider ${name}: api_key is a literal in source; use env(NAME) so the key never lands in a file`,
    );
  if (isEnvRef(body.api_key) && body.api_key.default)
    warnings.push(`provider ${name}: api_key env() has a fallback literal in source; remove it`);
  return {
    name,
    api,
    baseUrl,
    apiKeyEnv: isEnvRef(body.api_key) ? body.api_key.__env : null,
    apiKey: body.api_key !== undefined && !isEnvRef(body.api_key) ? String(body.api_key) : null,
    headers,
    loc,
  };
}
