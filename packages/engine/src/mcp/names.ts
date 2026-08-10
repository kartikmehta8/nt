/**
 * @file Naming boundary between MCP, NT source, and model providers.
 *
 * MCP remote names are preserved exactly in `server.remote-name` references,
 * while model-facing names are sanitized to the strict shared provider subset.
 * A stable SHA-256 suffix protects punctuation and truncation collisions, and
 * parsing always splits at the first dot so dotted remote names round-trip.
 */

import { createHash } from "node:crypto";
import { MCP_TOOL_PREFIX } from "#constants";

const MAX_MODEL_NAME = 64;

/**
 * Parses mcp reference into its validated internal representation.
 * @param reference A candidate `server.remote-tool` reference.
 * @returns Server and remote name split at the first dot, or null.
 */
export function parseMcpReference(
  reference: string,
): { server: string; remoteName: string } | null {
  const dot = reference.indexOf(".");
  if (dot <= 0 || dot === reference.length - 1) return null;
  return { server: reference.slice(0, dot), remoteName: reference.slice(dot + 1) };
}

/**
 * Parses a dotted MCP grant into its server and exact or wildcard remote name.
 * @param server The declaration name.
 * @param remoteName The exact advertised tool name.
 * @returns The canonical user-facing MCP reference.
 */
export function mcpReference(server: string, remoteName: string): string {
  return `${server}.${remoteName}`;
}

/**
 * Encodes a server and remote tool name into a collision-resistant model identifier.
 * @param server The declaration name.
 * @param remoteName The exact advertised tool name.
 * @returns A collision-resistant model-facing name of at most 64 characters.
 */
export function modelToolName(server: string, remoteName: string): string {
  const raw = `${MCP_TOOL_PREFIX}${server}__${remoteName}`;
  const safe = raw.replace(/[^A-Za-z0-9_-]/g, "_");
  const lossy = safe !== raw || safe.length > MAX_MODEL_NAME;
  if (!lossy) return safe;
  const hash = createHash("sha256")
    .update(server)
    .update("\0")
    .update(remoteName)
    .digest("hex")
    .slice(0, 10);
  return `${safe.slice(0, MAX_MODEL_NAME - hash.length - 2)}__${hash}`;
}
