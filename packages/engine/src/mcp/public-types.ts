/**
 * @file Public MCP definition and inspection shapes exposed by the engine.
 *
 * Keeps protocol-specific types separate from the language's core definition
 * model while allowing `types.ts` and the public barrel to re-export them. The
 * definitions cover source configuration, normalized tools, live status, and
 * ordered doctor results without exposing official SDK client instances or
 * credential records to package consumers.
 */

import type { Location, NtValue } from "#types";

export type McpTransportKind = "stdio" | "streamable_http";
export type McpApprovalPolicy = "required" | "once" | "never";

export type McpAuthDef =
  { type: "none" } | { type: "bearer"; tokenEnv: string } | { type: "oauth"; scopes: string[] };

export interface McpToolPolicy {
  approval: McpApprovalPolicy;
  description?: string;
  callTimeoutMs?: number;
}

export interface McpServerDef {
  name: string;
  projectRoot: string;
  description: string;
  transport: McpTransportKind;
  tools: Map<string, McpToolPolicy>;
  connectTimeoutMs: number;
  callTimeoutMs: number;
  maxConcurrency: number;
  includeInstructions: boolean;
  allowInternal: boolean;
  command?: string;
  args: string[];
  cwd: string;
  allowOutsideCwd: boolean;
  env: Record<string, NtValue>;
  url?: string;
  auth: McpAuthDef;
  headers: Record<string, NtValue>;
  allowLegacySse: boolean;
  loc: Location;
}

export interface McpToolInfo {
  server: string;
  remoteName: string;
  reference: string;
  modelName: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  approval: McpApprovalPolicy;
  selected: boolean;
  selectionSource: "exact" | "wildcard" | "none";
}

export interface McpServerStatus {
  name: string;
  transport: McpTransportKind;
  status: "offline" | "untrusted" | "connected" | "error" | "closed";
  protocolVersion?: string;
  serverInfo?: { name: string; version?: string };
  selectedToolCount?: number;
  error?: string;
  errorCode?: string;
}

export interface McpInspectResult {
  server: McpServerStatus;
  tool: McpToolInfo;
}

export interface McpDoctorCheck {
  name:
    | "schema"
    | "trust"
    | "endpoint"
    | "connection"
    | "authentication"
    | "capabilities"
    | "catalog"
    | "selection"
    | "schemas"
    | "shutdown";
  status: "pass" | "fail" | "skipped";
  code?: string;
  message: string;
}

export interface McpDoctorResult {
  name: string;
  transport: McpTransportKind;
  usable: boolean;
  checks: McpDoctorCheck[];
}
