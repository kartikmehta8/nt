/**
 * @file Decodes a scalar token into a typed `NtValue`.
 *
 * Handles quoted strings, numbers, booleans, null, `env(NAME, default)`
 * references, and inline `[a, b]` flow lists; anything else becomes a bare
 * string.
 */

import { MAX_PARSE_DEPTH } from "#constants";
import { NtError } from "#errors";
import { splitTopLevel, unquote } from "#parse/lexer";
import type { Location, NtValue } from "#types";

const ENV_RE = /^env\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:,\s*(.*?))?\s*\)$/;
const NUM_RE = /^-?\d+(?:\.\d+)?$/;

/**
 * Decodes one NT scalar token with bounded support for nested flow lists.
 *
 * @param token The raw scalar text (already trimmed of surrounding whitespace).
 * @param loc Source location, propagated to nested flow-list items.
 * @param depth Flow-list nesting depth, capped at `MAX_PARSE_DEPTH` so hostile
 * bracket nesting cannot recurse unbounded.
 * @returns The token decoded as a string, number, boolean, null, env ref, or flow list.
 */
export function parseScalar(token: string, loc: Location, depth = 0): NtValue {
  const t = token.trim();
  if (t === "") return "";
  if ((t[0] === '"' && t.endsWith('"')) || (t[0] === "'" && t.endsWith("'"))) return unquote(t);

  const env = t.match(ENV_RE);
  if (env) {
    const fallback = env[2] !== undefined && env[2] !== "" ? unquote(env[2].trim()) : null;
    return { __env: env[1], default: fallback };
  }

  if (t === "true") return true;
  if (t === "false") return false;
  if (t === "null" || t === "~") return null;
  if (NUM_RE.test(t)) return Number(t);

  if (t[0] === "[" && t.endsWith("]")) {
    if (depth >= MAX_PARSE_DEPTH)
      throw new NtError(`flow list nesting too deep (limit ${MAX_PARSE_DEPTH})`, loc);
    const inner = t.slice(1, -1).trim();
    if (inner === "") return [];
    return splitTopLevel(inner, loc).map((x) => parseScalar(x.trim(), loc, depth + 1));
  }
  return t;
}
