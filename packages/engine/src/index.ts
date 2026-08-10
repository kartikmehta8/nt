/**
 * @file Public API of the `@age.nt/engine` package.
 *
 * Re-exports the surface consumers (such as the `nt` CLI) depend on: the
 * `Engine`, the `loadProject` / `discoverNtFiles` loaders, the `ChatSession`,
 * the audit-log readers, the `scaffoldProject` starter-project writer, the
 * `NtError` type, and the typed project/definition shapes. Internal modules
 * remain private behind the package's `#` subpath imports.
 */

export { Engine } from "#engine";
export type { EngineOptions, RunnableKind } from "#engine";
export type { AuditStatus, EcosystemStatus, ProviderStatus, SandboxStatus } from "#status";
export { auditFiles, readAuditEntries } from "#audit/log";
export type { AuditEntry, AuditToolKind } from "#audit/log";
export { loadProject, discoverNtFiles } from "#loader";
export type { LoadOptions } from "#loader";
export type { BuildResult } from "#schema/build";
export { ChatSession } from "#chat";
export { NtError } from "#errors";
export { McpError } from "#mcp/errors";
export type { McpErrorCode } from "#mcp/errors";
export { scaffoldProject } from "#scaffold/write";
export type { ScaffoldOptions, ScaffoldResult } from "#scaffold/write";
export { DEFAULT_TEMPLATE, SCAFFOLD_ENTRY_FILE, TEMPLATE_NAMES } from "#scaffold/templates";
export type { TemplateName } from "#scaffold/templates";
export type {
  AgentDef,
  AuditConfig,
  ConfigDef,
  ConfigDefaults,
  ConfirmRequest,
  EnvRef,
  FieldSpec,
  FieldType,
  Location,
  McpApprovalPolicy,
  McpAuthDef,
  McpDoctorCheck,
  McpDoctorResult,
  McpInspectResult,
  McpServerDef,
  McpServerStatus,
  McpToolInfo,
  McpToolPolicy,
  McpTransportKind,
  NtValue,
  Project,
  ProviderDef,
  RunResult,
  SandboxDef,
  ScaffoldFile,
  SkillDef,
  StepEvent,
  StepEventKind,
  ThinkingLevel,
  ToolDef,
  TokenUsage,
  WorkflowDef,
  WorkflowStep,
} from "#types";
