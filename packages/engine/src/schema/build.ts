/**
 * @file Assembles parsed blocks from every file into one validated `Project`.
 *
 * Applies the `config` block, registers agents, tools, MCP servers, providers,
 * sandboxes, skills, and workflows while rejecting duplicate identities, then
 * runs offline cross-reference validation. Remote MCP catalogs never enter the
 * source-level project registry. The result includes every accumulated
 * unknown-field and security warning.
 */

import * as nodePath from "node:path";
import { defaultAuditConfig, parseAuditConfig } from "#audit/config";
import { NtError } from "#errors";
import { isMap, optBool, optNum, optStr, parseThinking, warnUnknown } from "#schema/coerce";
import { parseAgent, parseSandbox, parseSkill, parseTool } from "#schema/declarations";
import { parseMcpServer } from "#schema/mcp";
import { parseProvider } from "#schema/provider";
import { parseWorkflow } from "#schema/workflow-declaration";
import { validateRefs } from "#schema/validate";
import type { Block, ConfigDef, Location, NtValue, Project } from "#types";

export interface FileBlocks {
  file: string;
  blocks: Block[];
}

export interface BuildResult {
  project: Project;
  warnings: string[];
}

/**
 * Returns a fresh project with default configuration and empty registries.
 * @returns A fresh project with default configuration and empty registries.
 */
function emptyProject(files: string[]): Project {
  return {
    config: {
      target: "node",
      entry: null,
      defaults: { model: null, sandbox: null, thinking: null, maxTokens: null },
      audit: defaultAuditConfig(),
      showToolCalls: false,
      loc: null,
    },
    providers: new Map(),
    agents: new Map(),
    subagents: new Map(),
    sandboxes: new Map(),
    tools: new Map(),
    mcpServers: new Map(),
    skills: new Map(),
    workflows: new Map(),
    files,
  };
}

/**
 * Inserts a uniquely named declaration and reports duplicate source locations.
 * @param map The registry to insert into.
 * @param def The definition to register.
 * @param what A label used in the duplicate-name error.
 */
function define<T extends { name: string; loc: Location }>(
  map: Map<string, T>,
  def: T,
  what: string,
): void {
  if (map.has(def.name)) throw new NtError(`duplicate ${what} '${def.name}'`, def.loc);
  map.set(def.name, def);
}

/**
 * Merges one validated config block into the project's effective defaults.
 * @param config The mutable config being populated.
 * @param body The `config` block body.
 * @param loc Source location for error messages.
 * @param warnings Accumulator for non-fatal messages.
 * @param providers The provider registry to populate from `config.providers`.
 */
function applyConfig(
  config: ConfigDef,
  body: Record<string, NtValue>,
  loc: Location,
  warnings: string[],
  providers: Project["providers"],
): void {
  if (config.loc)
    warnings.push(
      `duplicate config block at ${loc.file}:${loc.line} overrides the earlier one at ${config.loc.file}:${config.loc.line}`,
    );
  config.loc = loc;
  warnUnknown(
    body,
    ["target", "entry", "audit", "show_tool_calls", "defaults", "providers"],
    "config",
    warnings,
  );
  config.target = optStr(body.target, "config.target", loc) ?? config.target;
  config.entry = optStr(body.entry, "config.entry", loc) ?? config.entry;
  config.showToolCalls =
    optBool(body.show_tool_calls, "config.show_tool_calls", loc) ?? config.showToolCalls;
  if (body.audit !== undefined) config.audit = parseAuditConfig(body.audit, loc);
  if (body.defaults !== undefined) {
    const d = body.defaults;
    if (!isMap(d)) throw new NtError("config.defaults must be a map", loc);
    warnUnknown(d, ["model", "sandbox", "thinking", "max_tokens"], "config.defaults", warnings);
    config.defaults.model = optStr(d.model, "config.defaults.model", loc) ?? config.defaults.model;
    config.defaults.sandbox =
      optStr(d.sandbox, "config.defaults.sandbox", loc) ?? config.defaults.sandbox;
    config.defaults.thinking = parseThinking(d.thinking, loc) ?? config.defaults.thinking;
    config.defaults.maxTokens =
      optNum(d.max_tokens, "config.defaults.max_tokens", loc) ?? config.defaults.maxTokens;
  }
  if (body.providers !== undefined) {
    if (!isMap(body.providers)) throw new NtError("config.providers must be a map", loc);
    for (const [name, pbody] of Object.entries(body.providers)) {
      if (!isMap(pbody)) throw new NtError(`config.providers.${name} must be a map`, loc);
      define(providers, parseProvider(name, pbody, loc, warnings), "provider");
    }
  }
}

/**
 * Assembles parsed files into a typed, reference-checked project without runtime I/O.
 * @param fileBlocks Parsed blocks grouped by originating file.
 * @param projectRoot Project root used by project-scoped security decisions.
 * @returns The assembled, reference-checked project and any accumulated warnings.
 */
export function buildProject(
  fileBlocks: FileBlocks[],
  projectRoot = nodePath.dirname(nodePath.resolve(fileBlocks[0]?.file ?? ".")),
): BuildResult {
  const warnings: string[] = [];
  const normalizedRoot = nodePath.resolve(projectRoot);
  const project = emptyProject(fileBlocks.map((f) => f.file));

  for (const { blocks } of fileBlocks)
    for (const b of blocks) {
      switch (b.kind) {
        case "config":
          applyConfig(project.config, b.body, b.loc, warnings, project.providers);
          break;
        case "provider":
          define(project.providers, parseProvider(b.name, b.body, b.loc, warnings), "provider");
          break;
        case "sandbox":
          define(project.sandboxes, parseSandbox(b.name, b.body, b.loc, warnings), "sandbox");
          break;
        case "tool":
          define(project.tools, parseTool(b.name, b.body, b.loc, warnings), "tool");
          break;
        case "mcp":
          define(
            project.mcpServers,
            parseMcpServer(b.name, b.body, b.loc, warnings, normalizedRoot),
            "MCP server",
          );
          break;
        case "skill":
          define(project.skills, parseSkill(b.name, b.body, b.loc, warnings), "skill");
          break;
        case "agent":
          define(project.agents, parseAgent("agent", b.name, b.body, b.loc, warnings), "agent");
          break;
        case "subagent":
          define(
            project.subagents,
            parseAgent("subagent", b.name, b.body, b.loc, warnings),
            "subagent",
          );
          break;
        case "workflow":
          define(project.workflows, parseWorkflow(b.name, b.body, b.loc, warnings), "workflow");
          break;
      }
    }

  validateRefs(project);
  return { project, warnings };
}
