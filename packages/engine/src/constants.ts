/**
 * @file Constants shared across the schema and runtime layers.
 *
 * The single source of truth for the built-in tool names, the delegation tool
 * prefix, the valid thinking
 * levels, the sandbox and token defaults, the agentic-loop and delegation-depth
 * limits, and the audit-log location, file modes, and redaction caps — so these
 * values are never duplicated between the schema, session, audit, and tool
 * modules.
 */

import type { ThinkingLevel } from "#types";

export const BUILTIN_TOOL_NAMES = ["fs_read", "fs_write", "fs_list", "bash"] as const;

export type BuiltinToolName = (typeof BUILTIN_TOOL_NAMES)[number];

export const DELEGATE_PREFIX = "delegate_to_";

/**
 * @param name A candidate tool name.
 * @returns Whether the name refers to a built-in tool.
 */
export function isBuiltinTool(name: string): name is BuiltinToolName {
  return (BUILTIN_TOOL_NAMES as readonly string[]).includes(name);
}

export const THINKING_LEVELS: ThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

export const DEFAULT_SANDBOX_CWD = "/workspace";
export const DEFAULT_MAX_TOKENS = 8000;
export const DEFAULT_THINKING: ThinkingLevel = "medium";
export const MAX_AGENT_STEPS = 12;
export const MAX_DELEGATION_DEPTH = 6;
export const HTTP_TOOL_TIMEOUT_MS = 30_000;
export const HTTP_TOOL_MAX_BODY_BYTES = 1_000_000;
export const PROVIDER_TIMEOUT_MS = 120_000;
export const MAX_ERROR_BODY_CHARS = 2_048;
export const MAX_NT_FILE_BYTES = 1_000_000;
export const MAX_IMPORTED_FILES = 500;
export const MAX_PARSE_DEPTH = 100;

export const DEFAULT_AUDIT_DIR = "~/.nt/audit";
export const AUDIT_FILE_PREFIX = "tools-";
export const AUDIT_FILE_EXT = ".jsonl";
export const AUDIT_OFF_VALUES = ["off", "no", "none", "disabled"];
export const AUDIT_ON_VALUES = ["on", "yes", "default"];
export const AUDIT_DIR_MODE = 0o700;
export const AUDIT_FILE_MODE = 0o600;
export const AUDIT_MAX_VALUE_CHARS = 2_000;
export const AUDIT_TAIL_BYTES_PER_ENTRY = 131_072;
export const AUDIT_TAIL_MAX_BYTES = 8_000_000;
export const AUDIT_MAX_OUTPUT_CHARS = 4_000;
export const AUDIT_MAX_REDACT_DEPTH = 8;
export const AUDIT_MIN_SECRET_CHARS = 6;
export const AUDIT_REDACTED = "[redacted]";
