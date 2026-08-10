/**
 * @file The bring-up report: what an ecosystem looks like before it runs.
 *
 * `bringUpStatus` instantiates every declared sandbox to prove it can be
 * created, resolves which providers the project needs and whether each has a
 * credential, reports the audit destination, and includes source-only offline
 * MCP summaries. Live MCP trust, authentication, protocol, and catalog status
 * is added by the CLI so base bring-up remains synchronous.
 */

import type { AuditLog } from "#audit/log";
import type { ProviderRegistry } from "#provider";
import { makeSandbox } from "#sandbox";
import type { McpServerStatus, Project, SandboxDef } from "#types";

export interface SandboxStatus {
  name: string;
  kind: string;
  cwd: string;
  ok: boolean;
  error?: string;
}

export interface ProviderStatus {
  name: string;
  api: string;
  hasKey: boolean;
}

export interface AuditStatus {
  enabled: boolean;
  dir: string;
  file: string | null;
}

export interface EcosystemStatus {
  sandboxes: SandboxStatus[];
  providers: ProviderStatus[];
  audit: AuditStatus;
  mcpServers: McpServerStatus[];
}

/**
 * Returns the provider id before the first slash, or the whole string when no slash is present.
 * @param model A `provider/model-id` string (validated to contain a slash at load time).
 * @returns The provider id before the first slash, or the whole string when no slash is present.
 */
function providerIdOf(model: string): string {
  const slash = model.indexOf("/");
  return slash > 0 ? model.slice(0, slash) : model;
}

/**
 * Returns whether the sandbox could be created, and why not when it could not.
 * @param def The sandbox to instantiate.
 * @returns Whether the sandbox could be created, and why not when it could not.
 */
function probeSandbox(def: SandboxDef): SandboxStatus {
  try {
    const sandbox = makeSandbox(def);
    return { name: def.name, kind: sandbox.kind, cwd: sandbox.cwd, ok: true };
  } catch (e) {
    return { name: def.name, kind: def.type, cwd: def.cwd, ok: false, error: (e as Error).message };
  }
}

/**
 * Returns where tool calls are recorded, and today's file when they are.
 * @param project The loaded project.
 * @param audit The open audit log, or null when logging is off.
 * @returns Where tool calls are recorded, and today's file when they are.
 */
export function auditStatus(project: Project, audit: AuditLog | null): AuditStatus {
  const config = project.config.audit;
  return {
    enabled: config.enabled,
    dir: config.dir,
    file: audit ? audit.fileFor(new Date()) : null,
  };
}

/**
 * Returns the instantiated sandboxes, the needed providers, and the audit destination.
 * @param project The loaded project.
 * @param registry The provider registry, used to check credentials.
 * @param audit The open audit log, or null when logging is off.
 * @returns The instantiated sandboxes, the needed providers, and the audit destination.
 */
export function bringUpStatus(
  project: Project,
  registry: ProviderRegistry,
  audit: AuditLog | null,
): EcosystemStatus {
  const sandboxes = [...project.sandboxes.values()].map(probeSandbox);
  const providerIds = new Set<string>(project.providers.keys());
  for (const agent of [...project.agents.values(), ...project.subagents.values()]) {
    const model = agent.model ?? project.config.defaults.model;
    if (model) providerIds.add(providerIdOf(model));
  }
  const providers = [...providerIds].map((id) => {
    const status = registry.credentialStatus(id);
    return { name: id, api: status.provider.api, hasKey: status.hasKey };
  });
  const mcpServers = [...project.mcpServers.values()].map((def) => ({
    name: def.name,
    transport: def.transport,
    status: "offline" as const,
    selectedToolCount: def.tools.size,
  }));
  return { sandboxes, providers, audit: auditStatus(project, audit), mcpServers };
}
