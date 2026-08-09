/**
 * @file Static MCP security policy and canonical trust fingerprinting.
 *
 * Resolves project-relative stdio working directories, enforces transport URL,
 * secret-reference, header, and containment rules without performing I/O, and
 * hashes every security-relevant declaration field. Runtime environment values
 * are resolved only when a trusted transport is constructed and never enter the
 * persisted fingerprint.
 */

import { createHash } from "node:crypto";
import * as nodePath from "node:path";
import { createRedactor } from "#audit/redact";
import { isEnvRef } from "#schema/coerce";
import { isLiteralLoopback } from "#egress";
import type { McpServerDef, NtValue } from "#types";

/**
 * Resolves the canonical project root used for MCP trust and process boundaries.
 * @param def The declaration whose source file anchors the project.
 * @returns The absolute project root.
 */
export function projectRootFor(def: McpServerDef): string {
  return def.projectRoot;
}

/**
 * Resolves a stdio working directory while preventing project-root escapes.
 * @param def A stdio server declaration.
 * @returns Its absolute working directory.
 */
export function resolvedCwd(def: McpServerDef): string {
  return nodePath.resolve(projectRootFor(def), def.cwd);
}

/**
 * Validates mcp security and reports any contract violation.
 * @param def A parsed server declaration.
 * @returns Non-fatal security warnings after enforcing hard boundaries.
 */
export function validateMcpSecurity(def: McpServerDef): string[] {
  const warnings: string[] = [];
  if (def.transport === "stdio") {
    const root = projectRootFor(def);
    const cwd = resolvedCwd(def);
    const rel = nodePath.relative(root, cwd);
    if (!def.allowOutsideCwd && (rel.startsWith("..") || nodePath.isAbsolute(rel)))
      throw new Error(`mcp ${def.name}.cwd resolves outside the project root`);
    for (const [name, value] of Object.entries(def.env))
      validateDeclaredValue(value, `mcp ${def.name}.env.${name}`);
    if (
      def.command === "npx" &&
      def.args.some((arg) => arg.startsWith("@") && !/@[^@]+@\d/.test(arg))
    )
      warnings.push(`mcp ${def.name} uses an unpinned npx package`);
  } else {
    if (!def.url) throw new Error(`mcp ${def.name}.url is required`);
    const url = new URL(def.url);
    if (url.username || url.password)
      throw new Error(`mcp ${def.name}.url must not contain credentials`);
    if (url.hash) throw new Error(`mcp ${def.name}.url must not contain a fragment`);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && isLiteralLoopback(url.hostname)))
      throw new Error(`mcp ${def.name}.url must use https except for literal loopback/localhost`);
    for (const [name, value] of Object.entries(def.headers))
      validateDeclaredValue(value, `mcp ${def.name}.headers.${name}`);
  }
  return warnings;
}

function validateDeclaredValue(value: NtValue, field: string): void {
  if (isEnvRef(value) && value.default !== null)
    throw new Error(`${field} must not use an env() fallback literal`);
  if (typeof value !== "string" && !isEnvRef(value))
    throw new Error(`${field} must be a string or env(NAME)`);
}

/**
 * Hashes every security-sensitive server field into a stable trust fingerprint.
 * @param def A validated server declaration.
 * @returns A canonical hash of fields that grant process or network authority.
 */
export function serverFingerprint(def: McpServerDef): string {
  const securityFields = {
    transport: def.transport,
    command: def.command ?? null,
    args: def.args,
    cwd: def.transport === "stdio" ? resolvedCwd(def) : null,
    env_names: Object.keys(def.env).sort(),
    url: def.url ?? null,
    auth_type: def.auth.type,
    header_names: Object.keys(def.headers)
      .map((x) => x.toLowerCase())
      .sort(),
    allow_internal: def.allowInternal,
    allow_legacy_sse: def.allowLegacySse,
  };
  return `sha256:${createHash("sha256").update(JSON.stringify(securityFields)).digest("hex")}`;
}

/**
 * Resolves declared values from the available configuration.
 * @param values Literal and environment-backed declaration values.
 * @returns Concrete values, failing closed when an environment variable is absent.
 */
export function resolveDeclaredValues(values: Record<string, NtValue>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(values)) {
    if (isEnvRef(value)) {
      const resolved = process.env[value.__env];
      if (resolved === undefined) throw new Error(`environment variable ${value.__env} is not set`);
      out[name] = resolved;
    } else out[name] = String(value);
  }
  return out;
}

/**
 * Scrubs declared MCP credentials from a transport or SDK diagnostic before it
 * can reach terminal output, JSON, an audit entry, or an embedding application.
 *
 * @param def Server definition whose currently available secrets are sensitive.
 * @param message Untrusted diagnostic from a process, server, or SDK.
 * @returns Bounded text with declared and token-shaped credentials removed.
 */
export function redactMcpDiagnostic(def: McpServerDef, message: string): string {
  const secrets: string[] = [];
  if (def.auth.type === "bearer") {
    const token = process.env[def.auth.tokenEnv];
    if (token) secrets.push(token);
  }
  for (const value of [...Object.values(def.env), ...Object.values(def.headers)]) {
    const resolved = isEnvRef(value) ? process.env[value.__env] : value;
    if (typeof resolved === "string") secrets.push(resolved);
  }
  return createRedactor(secrets).text(message, 2_000);
}
