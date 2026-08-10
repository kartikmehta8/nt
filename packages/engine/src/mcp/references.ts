/**
 * @file Resolution of agent-granted MCP tool references by server.
 *
 * Converts validated `server.tool` and `server.*` references into a grouped map
 * used during live catalog preparation. Unknown or malformed references remain
 * non-fatal here because project validation reports them with source locations
 * before runtime preparation begins.
 */

import { parseMcpReference } from "#mcp/names";
import type { Project } from "#types";

/**
 * Groups valid MCP references into the exact remote names requested per server.
 *
 * @param references Agent-granted `server.tool` or wildcard references.
 * @param project Loaded project containing the server declarations.
 * @returns Requested remote tool names keyed by their declared server.
 */
export function requestedMcpTools(
  references: string[],
  project: Project,
): Map<string, Set<string>> {
  const requested = new Map<string, Set<string>>();
  for (const reference of references) {
    const parsed = parseMcpReference(reference);
    if (!parsed || !project.mcpServers.has(parsed.server)) continue;
    const names = requested.get(parsed.server) ?? new Set<string>();
    names.add(parsed.remoteName);
    requested.set(parsed.server, names);
  }
  return requested;
}
