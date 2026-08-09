/**
 * @file Owner-only persistence for reviewed MCP server authority.
 *
 * Trust entries are scoped by canonical project root and declaration name, and
 * store only the current security fingerprint plus review time. Reads never
 * create state. Writes use a versioned document, owner-only directory/file
 * modes, and atomic replacement so interrupted trust or untrust operations
 * cannot leave a partially written decision.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import type { McpServerDef } from "#types";
import { McpError } from "#mcp/errors";
import { projectRootFor, serverFingerprint } from "#mcp/security";

interface TrustFile {
  schema_version: 1;
  entries: Record<string, { fingerprint: string; trusted_at: string }>;
}

/**
 * Validates the full persisted envelope so malformed entries cannot be treated
 * as authority or crash a status check.
 *
 * @param value Parsed trust-file candidate.
 * @returns Whether every entry has the supported fingerprint record shape.
 */
function isTrustFile(value: unknown): value is TrustFile {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<TrustFile>;
  if (
    candidate.schema_version !== 1 ||
    candidate.entries === null ||
    typeof candidate.entries !== "object" ||
    Array.isArray(candidate.entries)
  )
    return false;
  return Object.values(candidate.entries).every(
    (entry) =>
      entry !== null &&
      typeof entry === "object" &&
      typeof entry.fingerprint === "string" &&
      typeof entry.trusted_at === "string",
  );
}

function defaultPath(): string {
  return nodePath.join(os.homedir(), ".nt", "mcp", "trust.json");
}

function keyFor(def: McpServerDef): string {
  let root = projectRootFor(def);
  try {
    root = fs.realpathSync(root);
  } catch {
    root = nodePath.resolve(root);
  }
  return JSON.stringify([root, def.name]);
}

function readStore(file: string): TrustFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    return isTrustFile(parsed) ? parsed : { schema_version: 1, entries: {} };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { schema_version: 1, entries: {} };
    throw error;
  }
}

function writeStore(file: string, store: TrustFile): void {
  const dir = nodePath.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  const temp = nodePath.join(dir, `.trust-${process.pid}-${Date.now()}.tmp`);
  fs.writeFileSync(temp, JSON.stringify(store, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(temp, file);
  fs.chmodSync(file, 0o600);
}

/**
 * Persists reviewed fingerprints by canonical project and declaration identity
 * without granting authority to any other server definition.
 */
export class McpTrustStore {
  readonly file: string;
  /**
   * Creates a project-scoped fingerprint store at the configured owner-only path.
   * @param file Optional trust path supplied by an embedder or isolated test.
   */
  constructor(file = defaultPath()) {
    this.file = file;
  }

  /**
   * Compares the current fingerprint with the persisted trust decision.
   * @param def Validated server declaration.
   * @returns Whether its fingerprint is trusted, absent, or changed.
   */
  status(def: McpServerDef): "trusted" | "missing" | "changed" {
    const actual = serverFingerprint(def);
    const entry = readStore(this.file).entries[keyFor(def)];
    if (!entry) return "missing";
    return entry.fingerprint === actual ? "trusted" : "changed";
  }

  /**
   * Enforces exact fingerprint trust before any server process or request starts.
   * @param def Validated server declaration that must match persisted trust.
   * @returns Nothing when trusted; otherwise throws a stable missing/changed error.
   */
  require(def: McpServerDef): void {
    const status = this.status(def);
    if (status === "trusted") return;
    const code = status === "changed" ? "MCP_TRUST_CHANGED" : "MCP_NOT_TRUSTED";
    throw new McpError(
      code,
      `MCP server '${def.name}' is ${status === "changed" ? "changed since it was trusted" : "not trusted"}; run 'nt mcp trust ${def.name}'`,
    );
  }

  /**
   * Atomically records trust for the current security-sensitive declaration.
   * @param def Validated server declaration.
   * @param expected Optional compare-and-set fingerprint.
   * @returns The persisted fingerprint.
   */
  trust(def: McpServerDef, expected?: string): string {
    const fingerprint = serverFingerprint(def);
    if (expected && expected !== fingerprint)
      throw new McpError(
        "MCP_TRUST_CHANGED",
        `fingerprint mismatch: expected ${expected}, got ${fingerprint}`,
      );
    const store = readStore(this.file);
    store.entries[keyFor(def)] = { fingerprint, trusted_at: new Date().toISOString() };
    writeStore(this.file, store);
    return fingerprint;
  }

  /**
   * Removes a persisted trust record for the declaration's project and name.
   * @param def Validated server declaration.
   * @returns Whether an existing trust record was removed.
   */
  untrust(def: McpServerDef): boolean {
    const store = readStore(this.file);
    const key = keyFor(def);
    if (!store.entries[key]) return false;
    delete store.entries[key];
    writeStore(this.file, store);
    return true;
  }
}
