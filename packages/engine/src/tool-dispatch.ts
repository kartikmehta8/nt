/**
 * @file Gates and executes one exact runtime tool dispatch.
 *
 * Availability comes from the runtime dispatch map, approval precedes side
 * effects, and MCP errors retain their stable public codes. Built-in, custom,
 * delegation, and MCP calls share one refusal boundary, but only exact entries
 * prepared for the current agent can execute. MCP approval caches are scoped to
 * the owning manager and progress is forwarded without changing call results.
 */

import { isBuiltinTool, type BuiltinToolName } from "#constants";
import { runCustomTool, type ToolOutcome } from "#custom-tools";
import { McpError } from "#mcp/errors";
import { McpApprovalCache, needsApproval } from "#mcp/policy";
import type { RunContext, ToolDispatch } from "#runtime";
import type { Sandbox } from "#sandbox";

type Delegate = (subagent: string, prompt: string) => Promise<ToolOutcome>;

const approvalCaches = new WeakMap<object, McpApprovalCache>();

const BUILTIN_HANDLERS: Record<
  BuiltinToolName,
  (sandbox: Sandbox, input: Record<string, unknown>) => ToolOutcome
> = {
  fs_read: (sandbox, input) => ({ content: sandbox.readFile(String(input.path)), isError: false }),
  fs_write: (sandbox, input) => {
    sandbox.writeFile(String(input.path), String(input.content ?? ""));
    return { content: `wrote ${input.path}`, isError: false };
  },
  fs_list: (sandbox) => ({ content: sandbox.listFiles().join("\n") || "(empty)", isError: false }),
  bash: (sandbox, input) => {
    const result = sandbox.exec(String(input.command));
    return {
      content: `exit ${result.code}\n${result.stdout}${result.stderr ? "\n[stderr]\n" + result.stderr : ""}`,
      isError: result.code !== 0,
    };
  },
};

/**
 * Returns the tool result or a safe refusal.
 * @param context Shared run services and approval callback.
 * @param sandbox Workspace used by local tool handlers.
 * @param requestedName Model-provided tool name used only in refusals.
 * @param entry Exact capability selected from the runtime dispatch map.
 * @param input Untrusted model-provided tool arguments.
 * @param depth Current delegation depth.
 * @param delegate Callback that runs a wired subagent.
 * @returns The tool result or a safe refusal.
 */
export async function gatedDispatch(
  context: RunContext,
  sandbox: Sandbox,
  requestedName: string,
  entry: ToolDispatch | undefined,
  input: Record<string, unknown>,
  depth: number,
  delegate: Delegate,
): Promise<ToolOutcome> {
  if (!entry)
    return { content: `tool '${requestedName}' is not available to this agent`, isError: true };
  const refusal = await approvalRefusal(context, entry, input, depth);
  if (refusal) return refusal;
  try {
    if (entry.kind === "builtin" && isBuiltinTool(entry.name))
      return BUILTIN_HANDLERS[entry.name](sandbox, input);
    if (entry.kind === "delegate")
      return await delegate(entry.subagent, String(input.prompt ?? ""));
    if (entry.kind === "custom") {
      const custom = context.project.tools.get(entry.name);
      if (!custom) return { content: `unknown tool '${entry.name}'`, isError: true };
      return await runCustomTool(custom, sandbox, input);
    }
    if (entry.kind === "mcp") return await dispatchMcp(context, entry, input, depth);
    return { content: "unknown tool dispatch", isError: true };
  } catch (error) {
    return {
      content:
        error instanceof McpError
          ? `${error.code}: ${error.message}`
          : String((error as Error).message),
      isError: true,
    };
  }
}

async function approvalRefusal(
  context: RunContext,
  entry: ToolDispatch,
  input: Record<string, unknown>,
  depth: number,
): Promise<ToolOutcome | null> {
  if (entry.kind === "mcp") return approveMcp(context, entry, input, depth);
  if (entry.kind !== "custom" || !context.project.tools.get(entry.name)?.confirm) return null;
  if (!context.confirm)
    return {
      content: `tool '${entry.name}' requires confirmation, and this run has no way to ask — re-run interactively or pass --yes`,
      isError: true,
    };
  const approved = await context.confirm({ agent: entry.agent, tool: entry.name, input, depth });
  return approved
    ? null
    : { content: `the user denied permission to run tool '${entry.name}'`, isError: true };
}

async function approveMcp(
  context: RunContext,
  entry: Extract<ToolDispatch, { kind: "mcp" }>,
  input: Record<string, unknown>,
  depth: number,
): Promise<ToolOutcome | null> {
  const { info } = entry.tool.catalog;
  const cache = approvalCacheFor(context);
  if (!needsApproval(info.approval, cache.isApproved(info.server, info.remoteName))) return null;
  if (!context.confirm)
    return {
      content: `MCP tool '${info.reference}' requires ${info.approval} approval, and this run has no way to ask — re-run interactively or pass --yes`,
      isError: true,
    };
  const approved = await context.confirm({
    agent: entry.agent,
    tool: info.modelName,
    input,
    depth,
    server: info.server,
    remoteTool: info.remoteName,
    approvalPolicy: info.approval,
    serverOrigin:
      entry.tool.server.transport === "stdio"
        ? [entry.tool.server.command, ...entry.tool.server.args].filter(Boolean).join(" ")
        : entry.tool.server.url,
  });
  if (!approved)
    return {
      content: `the user denied permission to run MCP tool '${info.reference}'`,
      isError: true,
    };
  if (info.approval === "once") cache.approve(info.server, info.remoteName);
  return null;
}

function approvalCacheFor(context: RunContext): McpApprovalCache {
  const key = context.mcp ?? context;
  let cache = approvalCaches.get(key);
  if (!cache) {
    cache = new McpApprovalCache();
    approvalCaches.set(key, cache);
  }
  return cache;
}

async function dispatchMcp(
  context: RunContext,
  entry: Extract<ToolDispatch, { kind: "mcp" }>,
  input: Record<string, unknown>,
  depth: number,
): Promise<ToolOutcome> {
  if (!context.mcp) return { content: "MCP manager is unavailable", isError: true };
  const outcome = await context.mcp.call(entry.tool, input, (detail) =>
    context.onStep?.({ kind: "tool-progress", agent: entry.tool.server.name, detail, depth }),
  );
  return {
    content: outcome.modelContent,
    auditSummary: outcome.auditSummary,
    isError: outcome.isError,
  };
}
