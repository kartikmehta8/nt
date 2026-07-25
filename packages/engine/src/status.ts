/**
 * @file The bring-up report: what an ecosystem looks like before it runs.
 *
 * `bringUpStatus` instantiates every declared sandbox to prove it can be
 * created, resolves which providers the project actually needs (declared ones
 * plus any named by an agent's model) and whether each has a credential, and
 * reports where tool calls are being audited.
 */

import type { AuditLog } from "#audit/log";
import type { ProviderRegistry } from "#provider";
import { makeSandbox } from "#sandbox";
import type { Project, SandboxDef } from "#types";

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
}

/**
 * @param model A `provider/model-id` string (validated to contain a slash at load time).
 * @returns The provider id before the first slash, or the whole string when no slash is present.
 */
function providerIdOf(model: string): string {
  const slash = model.indexOf("/");
  return slash > 0 ? model.slice(0, slash) : model;
}

/**
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
  return { sandboxes, providers, audit: auditStatus(project, audit) };
}
