/**
 * @file Shared type definitions for the NT language and engine.
 *
 * Declares the parsed value model (`NtValue`, `EnvRef`), the raw `Block` a file
 * parses into, and the typed definitions the schema layer produces (`AgentDef`
 * — used for both agents and subagents, `SandboxDef`, `ToolDef`, `SkillDef`,
 * `WorkflowDef`, `ProviderDef`, `ConfigDef`, `AuditConfig`), plus the assembled
 * `Project`, the `RunResult` / `TokenUsage` shapes the engine returns, and the
 * `ScaffoldFile` a starter template is made of. MCP definitions and inspection
 * results are re-exported from `mcp/public-types.ts` to keep this core model
 * readable. Types only; the entire module is erased at runtime.
 */

import type { McpApprovalPolicy, McpServerDef } from "#mcp/public-types";

export type {
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
} from "#mcp/public-types";

export type Scalar = string | number | boolean | null;
export type NtValue = Scalar | NtValue[] | { [k: string]: NtValue } | EnvRef;

export interface EnvRef {
  __env: string;
  default: string | null;
}

export interface Location {
  file: string;
  line: number;
}

export type BlockKind =
  | "import"
  | "config"
  | "provider"
  | "mcp"
  | "agent"
  | "subagent"
  | "sandbox"
  | "tool"
  | "skill"
  | "workflow";

export interface Block {
  kind: BlockKind;
  name: string | null;
  body: Record<string, NtValue>;
  loc: Location;
}

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export type FieldType = "string" | "number" | "boolean" | "object" | "array";

export interface FieldSpec {
  name: string;
  type: FieldType;
  description?: string;
  required: boolean;
}

export interface SandboxDef {
  name: string;
  type: "virtual" | "local";
  description: string;
  cwd: string;
  env: Record<string, string>;
  loc: Location;
}

export interface ToolDef {
  name: string;
  description: string;
  type: "http" | "shell";
  input: FieldSpec[];
  method?: string;
  url?: string;
  headers?: Record<string, NtValue>;
  command?: string;
  allowInternal?: boolean;
  confirm?: boolean;
  loc: Location;
}

export interface SkillDef {
  name: string;
  description: string;
  instructions: string;
  loc: Location;
}

export interface AgentDef {
  name: string;
  kind: "agent" | "subagent";
  description: string;
  model: string | null;
  instructions: string;
  thinking: ThinkingLevel | null;
  maxTokens: number | null;
  sandbox: string | null;
  cwd: string | null;
  tools: string[];
  subagents: string[];
  skills: string[];
  input: FieldSpec[];
  output: FieldSpec[];
  message: string | null;
  loc: Location;
}

export interface WorkflowStep {
  prompt?: string;
  agent?: string;
  skill?: string;
  into?: string;
}

export interface WorkflowDef {
  name: string;
  description: string;
  agent: string | null;
  input: FieldSpec[];
  output: FieldSpec[];
  steps: WorkflowStep[];
  loc: Location;
}

export interface ProviderDef {
  name: string;
  api: "anthropic" | "openai-completions";
  baseUrl: string | null;
  apiKeyEnv: string | null;
  apiKey: string | null;
  headers: Record<string, string>;
  loc: Location;
}

export interface ConfigDefaults {
  model: string | null;
  sandbox: string | null;
  thinking: ThinkingLevel | null;
  maxTokens: number | null;
}

export interface AuditConfig {
  enabled: boolean;
  dir: string;
}

export interface ConfigDef {
  target: string;
  entry: string | null;
  defaults: ConfigDefaults;
  audit: AuditConfig;
  showToolCalls: boolean;
  loc: Location | null;
}

export interface Project {
  config: ConfigDef;
  providers: Map<string, ProviderDef>;
  agents: Map<string, AgentDef>;
  subagents: Map<string, AgentDef>;
  sandboxes: Map<string, SandboxDef>;
  tools: Map<string, ToolDef>;
  mcpServers: Map<string, McpServerDef>;
  skills: Map<string, SkillDef>;
  workflows: Map<string, WorkflowDef>;
  files: string[];
}

export interface RunResult {
  text: string;
  output: Record<string, unknown> | null;
  steps: number;
  usage: TokenUsage;
}

export type StepEventKind =
  "model" | "tool" | "delegation" | "workflow-step" | "mcp-connect" | "tool-progress";

export interface StepEvent {
  kind: StepEventKind;
  agent: string;
  detail: string;
  depth: number;
}

export interface ConfirmRequest {
  agent: string;
  tool: string;
  input: Record<string, unknown>;
  depth: number;
  server?: string;
  remoteTool?: string;
  approvalPolicy?: McpApprovalPolicy;
  serverOrigin?: string;
}

export interface TokenUsage {
  input: number;
  output: number;
}

export interface ScaffoldFile {
  path: string;
  content: string;
}
