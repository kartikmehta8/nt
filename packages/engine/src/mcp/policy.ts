/**
 * @file Source-policy resolution and run-scoped MCP approval memory.
 *
 * Exact tool declarations override wildcard selection and absent selections
 * retain the secure approval-required default. `McpApprovalCache` remembers
 * only successful `once` decisions for one manager lifetime; required calls
 * always prompt and server-provided annotations never participate in policy.
 */

import type { McpApprovalPolicy, McpServerDef, McpToolPolicy } from "#types";

/**
 * Resolves the exact or wildcard policy that governs an advertised remote tool.
 * @param def The server declaration containing exact and wildcard policies.
 * @param remoteName The exact advertised tool name.
 * @returns The effective policy and the selection that supplied it.
 */
export function toolPolicy(
  def: McpServerDef,
  remoteName: string,
): { policy: McpToolPolicy; source: "exact" | "wildcard" | "none" } {
  const exact = def.tools.get(remoteName);
  if (exact) return { policy: exact, source: "exact" };
  const wildcard = def.tools.get("*");
  if (wildcard) return { policy: wildcard, source: "wildcard" };
  return { policy: { approval: "required" }, source: "none" };
}

/**
 * Remembers successful `once` approvals by exact server and remote-tool pair for
 * one MCP manager lifetime.
 */
export class McpApprovalCache {
  private approved = new Set<string>();
  /**
   * Determines whether approved.
   * @param server Server declaration name.
   * @param tool Exact remote tool name.
   * @returns Whether this exact pair was approved earlier.
   */
  isApproved(server: string, tool: string): boolean {
    return this.approved.has(`${server}\0${tool}`);
  }
  /**
   * Applies required, once-per-session, or never approval semantics to a call.
   * @param server Server declaration name.
   * @param tool Exact remote tool name.
   * @returns Nothing; the approval remains cached for this engine lifetime.
   */
  approve(server: string, tool: string): void {
    this.approved.add(`${server}\0${tool}`);
  }
}

/**
 * Determines whether a tool call still needs an interactive approval decision.
 * @param policy The effective tool approval policy.
 * @param cached Whether a prior `once` approval exists.
 * @returns Whether this invocation must ask the user.
 */
export function needsApproval(policy: McpApprovalPolicy, cached: boolean): boolean {
  return policy === "required" || (policy === "once" && !cached);
}
