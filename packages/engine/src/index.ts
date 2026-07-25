/**
 * @file Public API of the `@age.nt/engine` package.
 *
 * Re-exports the surface consumers (such as the `nt` CLI) depend on: the
 * `Engine`, the `loadProject` / `discoverNtFiles` loaders, the `ChatSession`,
 * the audit-log readers, the `NtError` type, and the typed project/definition
 * shapes. Internal modules remain private behind the package's `#` subpath
 * imports.
 */

export { Engine } from "#engine";
export type { RunnableKind } from "#engine";
export type { AuditStatus, EcosystemStatus, ProviderStatus, SandboxStatus } from "#status";
export { auditFiles, readAuditEntries } from "#audit/log";
export type { AuditEntry, AuditToolKind } from "#audit/log";
export { loadProject, discoverNtFiles } from "#loader";
export type { LoadOptions } from "#loader";
export type { BuildResult } from "#schema/build";
export { ChatSession } from "#chat";
export { NtError } from "#errors";
export type {
  AgentDef,
  AuditConfig,
  ConfigDef,
  ConfigDefaults,
  EnvRef,
  FieldSpec,
  FieldType,
  Location,
  NtValue,
  Project,
  ProviderDef,
  RunResult,
  SandboxDef,
  SkillDef,
  ThinkingLevel,
  ToolDef,
  TokenUsage,
  WorkflowDef,
  WorkflowStep,
} from "#types";
