/**
 * @file Constants shared across the schema and runtime layers.
 *
 * The single source of truth for the built-in tool names, the valid thinking
 * levels, the sandbox and token defaults, and the agentic-loop and
 * delegation-depth limits — so these values are never duplicated between the
 * schema, session, and tool modules.
 */

import type { ThinkingLevel } from "#types";

export const BUILTIN_TOOL_NAMES = ["fs_read", "fs_write", "fs_list", "bash"] as const;

export type BuiltinToolName = (typeof BUILTIN_TOOL_NAMES)[number];

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
