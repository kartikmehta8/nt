/**
 * @file Interprets the `config.audit` field into a resolved `AuditConfig`.
 *
 * The field takes one of two forms: a switch that turns tool-call logging off
 * (`off`, `false`, `none`, `disabled`) or the folder the JSONL files are written
 * to. A leading `~` expands to the home directory and a relative folder resolves
 * against the directory of the `.nt` file that declared it, so the destination
 * never depends on the current working directory.
 */

import * as os from "node:os";
import * as nodePath from "node:path";
import { AUDIT_OFF_VALUES, AUDIT_ON_VALUES, DEFAULT_AUDIT_DIR } from "#constants";
import { NtError } from "#errors";
import { isEnvRef } from "#schema/coerce";
import type { AuditConfig, Location, NtValue } from "#types";

/**
 * Resolves audit dir from the available configuration.
 * @param dir A folder that may start with `~` for the home directory.
 * @param base The directory a relative folder resolves against.
 * @returns The folder as an absolute path.
 */
export function resolveAuditDir(dir: string, base: string): string {
  const expanded =
    dir === "~" || dir.startsWith("~/") ? nodePath.join(os.homedir(), dir.slice(1)) : dir;
  return nodePath.resolve(base, expanded);
}

/**
 * Returns the audit configuration used when `config.audit` is absent: on, in the default folder.
 * @returns The audit configuration used when `config.audit` is absent: on, in the default folder.
 */
export function defaultAuditConfig(): AuditConfig {
  return { enabled: true, dir: resolveAuditDir(DEFAULT_AUDIT_DIR, process.cwd()) };
}

/**
 * Returns the directory a relative audit folder resolves against.
 * @param loc The location of the `config` block, whose file anchors relative folders.
 * @returns The directory a relative audit folder resolves against.
 */
function baseDirOf(loc: Location | null): string {
  return loc && nodePath.isAbsolute(loc.file) ? nodePath.dirname(loc.file) : process.cwd();
}

/**
 * Parses audit config into its validated internal representation.
 * @param value The raw `config.audit` value.
 * @param loc Source location for error messages and relative-folder resolution.
 * @returns The resolved audit configuration.
 */
export function parseAuditConfig(value: NtValue, loc: Location): AuditConfig {
  const fallback = resolveAuditDir(DEFAULT_AUDIT_DIR, baseDirOf(loc));
  if (value === null || value === true) return { enabled: true, dir: fallback };
  if (value === false) return { enabled: false, dir: fallback };
  if (typeof value !== "string")
    throw new NtError(
      isEnvRef(value)
        ? "config.audit must be a literal 'off' or folder path, not an env() reference"
        : `config.audit must be 'off' or a folder path (e.g. ${DEFAULT_AUDIT_DIR})`,
      loc,
    );
  const token = value.trim();
  if (token === "") throw new NtError("config.audit is empty; use 'off' or a folder path", loc);
  if (AUDIT_OFF_VALUES.includes(token.toLowerCase())) return { enabled: false, dir: fallback };
  if (AUDIT_ON_VALUES.includes(token.toLowerCase())) return { enabled: true, dir: fallback };
  return { enabled: true, dir: resolveAuditDir(token, baseDirOf(loc)) };
}
