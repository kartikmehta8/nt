/**
 * @file Strips credentials out of anything bound for the audit log.
 *
 * Three layers, applied to every logged value: known secret literals (the
 * project's provider keys, declared sandbox env values, and the host's
 * secret-looking environment variables) are scrubbed wherever they appear in
 * text, since a model can route them through a command or URL; values under a
 * secret-looking key name are dropped whole; and values shaped like a token are
 * matched by pattern. Anything dropped from a call's input is also scrubbed from
 * that call's output, so a tool cannot echo a secret back into the log. Long
 * strings are then truncated so one tool call cannot bloat the log.
 */

import {
  AUDIT_MAX_REDACT_DEPTH,
  AUDIT_MAX_VALUE_CHARS,
  AUDIT_MIN_SECRET_CHARS,
  AUDIT_REDACTED,
} from "#constants";
import type { Project } from "#types";

export interface RedactedInput {
  input: Record<string, unknown>;
  dropped: string[];
}

export interface Redactor {
  text(value: string, maxChars?: number, alsoScrub?: string[]): string;
  input(input: Record<string, unknown>): RedactedInput;
}

const SECRET_KEY_RE =
  /(?:^|[_.-])(?:api[_-]?key|apikey|secret|token|password|passwd|passphrase|credential|authorization|auth|cookie|session|private[_-]?key|access[_-]?key)(?:$|[_.-])|^(?:key|pass|pwd|bearer)$/i;

const SECRET_VALUE_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{12,}/g,
  /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{16,}/g,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{12,}/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  /\b[Bb]earer\s+[A-Za-z0-9._~+/-]{12,}=*/g,
];

/**
 * @param name An environment-variable or field name.
 * @returns Whether the name suggests the value is a credential.
 */
export function looksSecretName(name: string): boolean {
  return SECRET_KEY_RE.test(name);
}

/**
 * @param s A string to embed literally in a regular expression.
 * @returns The string with regex metacharacters escaped.
 */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * @param project The loaded project whose declared credentials should never be logged.
 * @returns The literal secret values worth scrubbing from logged text.
 */
export function collectSecrets(project: Project): string[] {
  const secrets = new Set<string>();
  const add = (value: string | null | undefined) => {
    if (value && value.length >= AUDIT_MIN_SECRET_CHARS) secrets.add(value);
  };
  for (const provider of project.providers.values()) {
    add(provider.apiKey);
    if (provider.apiKeyEnv) add(process.env[provider.apiKeyEnv]);
    for (const [name, value] of Object.entries(provider.headers))
      if (looksSecretName(name)) add(value);
  }
  for (const sandbox of project.sandboxes.values())
    for (const [name, value] of Object.entries(sandbox.env)) if (looksSecretName(name)) add(value);
  for (const [name, value] of Object.entries(process.env)) if (looksSecretName(name)) add(value);
  return [...secrets];
}

/**
 * @param secrets Literal secret values to scrub wherever they appear.
 * @returns A redactor that sanitizes strings, arbitrary values, and tool inputs.
 */
export function createRedactor(secrets: string[] = []): Redactor {
  const toRegexes = (values: string[]): RegExp[] =>
    values
      .filter((s) => s.length >= AUDIT_MIN_SECRET_CHARS)
      .sort((a, b) => b.length - a.length)
      .map((s) => new RegExp(escapeRe(s), "g"));
  const literals = toRegexes(secrets);

  const text = (value: string, maxChars = AUDIT_MAX_VALUE_CHARS, alsoScrub?: string[]): string => {
    let out = value;
    for (const literal of [...literals, ...toRegexes(alsoScrub ?? [])])
      out = out.replace(literal, AUDIT_REDACTED);
    for (const pattern of SECRET_VALUE_PATTERNS) out = out.replace(pattern, AUDIT_REDACTED);
    return out.length > maxChars ? out.slice(0, maxChars) + `…[${out.length} chars]` : out;
  };

  /**
   * @param value A subtree being dropped for its secret-looking key.
   * @param dropped Accumulator that receives every string leaf inside it.
   */
  const collectStrings = (value: unknown, dropped: Set<string>, depth = 0): void => {
    if (typeof value === "string") dropped.add(value);
    else if (depth < AUDIT_MAX_REDACT_DEPTH && value !== null && typeof value === "object")
      for (const item of Object.values(value as Record<string, unknown>))
        collectStrings(item, dropped, depth + 1);
  };

  const walk = (input: unknown, dropped: Set<string>, depth = 0): unknown => {
    if (typeof input === "string") return text(input);
    if (input === null || typeof input !== "object") return input ?? null;
    if (depth >= AUDIT_MAX_REDACT_DEPTH) return AUDIT_REDACTED;
    if (Array.isArray(input)) return input.map((item) => walk(item, dropped, depth + 1));
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(input as Record<string, unknown>)) {
      if (!looksSecretName(key)) {
        out[key] = walk(item, dropped, depth + 1);
        continue;
      }
      collectStrings(item, dropped);
      out[key] = AUDIT_REDACTED;
    }
    return out;
  };

  return {
    text,
    input: (i) => {
      const dropped = new Set<string>();
      return { input: walk(i, dropped) as Record<string, unknown>, dropped: [...dropped] };
    },
  };
}
