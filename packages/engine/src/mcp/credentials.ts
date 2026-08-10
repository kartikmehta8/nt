/**
 * @file Resource-scoped persistence backends for MCP OAuth state.
 *
 * The in-memory backend supports tests and explicitly ephemeral CI runs. The
 * file backend stores registered clients, rotated tokens, and PKCE verifiers in
 * a versioned owner-only file using atomic replacement. Records are addressed
 * by canonical resource URL, validated issuer, and client identifier so tokens
 * cannot be reused for a different protected resource.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import type { StoredOAuthClientInformation, StoredOAuthTokens } from "@modelcontextprotocol/client";

export interface CredentialRecord {
  client?: StoredOAuthClientInformation;
  tokens?: StoredOAuthTokens;
  verifier?: string;
}

interface CredentialFile {
  schema_version: 1;
  records: Record<string, CredentialRecord>;
}

/**
 * Verifies the versioned envelope before untrusted disk data reaches callers.
 *
 * @param value Parsed credential-file candidate.
 * @returns Whether the value has the supported schema and record map.
 */
function isCredentialFile(value: unknown): value is CredentialFile {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<CredentialFile>;
  return (
    candidate.schema_version === 1 &&
    candidate.records !== null &&
    typeof candidate.records === "object" &&
    !Array.isArray(candidate.records)
  );
}

export interface CredentialStore {
  get(key: string): CredentialRecord | undefined;
  find(resourceUrl: string, issuer: string): { key: string; record: CredentialRecord } | undefined;
  set(key: string, value: CredentialRecord): void;
  delete(key: string): boolean;
  deleteResource(resourceUrl: string): boolean;
}

/**
 * Process-local credential backend for tests and explicitly ephemeral runtime
 * environments; no record survives process exit.
 */
export class MemoryCredentialStore implements CredentialStore {
  private records = new Map<string, CredentialRecord>();

  /**
   * Loads an exact credential record from memory without exposing shared state.
   * @param key Exact resource, issuer, and client key.
   * @returns The stored record.
   */
  get(key: string): CredentialRecord | undefined {
    const record = this.records.get(key);
    return record ? structuredClone(record) : undefined;
  }

  /**
   * Finds all in-memory records matching the requested server and resource.
   * @param resourceUrl Canonical protected resource URL.
   * @param issuer Validated authorization-server issuer.
   * @returns The first record bound to the pair.
   */
  find(resourceUrl: string, issuer: string) {
    for (const [key, record] of this.records) {
      try {
        const parsed = JSON.parse(key) as unknown[];
        if (parsed[0] === resourceUrl && parsed[1] === issuer)
          return { key, record: structuredClone(record) };
      } catch {
        continue;
      }
    }
    return undefined;
  }

  /**
   * Stores a defensive copy of one credential record in memory.
   * @param key Exact resource, issuer, and client key.
   * @param value Credential material to keep in memory.
   * @returns Nothing; the record is synchronously available to later reads.
   */
  set(key: string, value: CredentialRecord): void {
    this.records.set(key, structuredClone(value));
  }

  /**
   * Deletes matching in-memory credential records and reports whether any existed.
   * @param key Exact resource, issuer, and client key.
   * @returns Whether a record was removed.
   */
  delete(key: string): boolean {
    return this.records.delete(key);
  }

  /**
   * Deletes every in-memory credential bound to one protected resource.
   * @param resourceUrl Canonical protected resource URL.
   * @returns Whether any bound record was removed.
   */
  deleteResource(resourceUrl: string): boolean {
    let deleted = false;
    for (const key of this.records.keys())
      if (key.startsWith(`[${JSON.stringify(resourceUrl)},`)) {
        this.records.delete(key);
        deleted = true;
      }
    return deleted;
  }
}

/**
 * Versioned file credential backend that applies owner-only permissions and an
 * atomic replace for every mutation.
 */
export class FileCredentialStore implements CredentialStore {
  readonly file: string;

  /**
   * Creates a plaintext, owner-only credential store at the configured path.
   * @param file Optional credential path supplied by an embedder or isolated test.
   */
  constructor(file = nodePath.join(os.homedir(), ".nt", "mcp", "credentials.json")) {
    this.file = file;
  }

  private read(): CredentialFile {
    try {
      const value = JSON.parse(fs.readFileSync(this.file, "utf8")) as unknown;
      return isCredentialFile(value) ? value : { schema_version: 1, records: {} };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return { schema_version: 1, records: {} };
      throw error;
    }
  }

  private write(value: CredentialFile): void {
    const dir = nodePath.dirname(this.file);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.chmodSync(dir, 0o700);
    const temp = nodePath.join(dir, `.credentials-${process.pid}-${Date.now()}.tmp`);
    fs.writeFileSync(temp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
    fs.renameSync(temp, this.file);
    fs.chmodSync(this.file, 0o600);
  }

  /**
   * Loads one exact plaintext credential record from the owner-only file.
   * @param key Exact resource, issuer, and client key.
   * @returns The persisted record.
   */
  get(key: string): CredentialRecord | undefined {
    return this.read().records[key];
  }

  /**
   * Finds a plaintext file-backed credential bound to the resource and issuer.
   * @param resourceUrl Canonical protected resource URL.
   * @param issuer Validated authorization-server issuer.
   * @returns The first persisted record bound to the pair.
   */
  find(resourceUrl: string, issuer: string) {
    for (const [key, record] of Object.entries(this.read().records)) {
      try {
        const parsed = JSON.parse(key) as unknown[];
        if (parsed[0] === resourceUrl && parsed[1] === issuer) return { key, record };
      } catch {
        continue;
      }
    }
    return undefined;
  }

  /**
   * Atomically persists one plaintext credential record with owner-only access.
   * @param key Exact resource, issuer, and client key.
   * @param record Credential material to persist atomically.
   * @returns Nothing; the atomic replacement completes before returning.
   */
  set(key: string, record: CredentialRecord): void {
    const value = this.read();
    value.records[key] = record;
    this.write(value);
  }

  /**
   * Removes one matching credential and atomically rewrites the owner-only store.
   * @param key Exact resource, issuer, and client key.
   * @returns Whether a persisted record was removed.
   */
  delete(key: string): boolean {
    const value = this.read();
    if (!value.records[key]) return false;
    delete value.records[key];
    this.write(value);
    return true;
  }

  /**
   * Removes every persisted credential bound to one protected resource.
   * @param resourceUrl Canonical protected resource URL.
   * @returns Whether any persisted record was removed.
   */
  deleteResource(resourceUrl: string): boolean {
    const value = this.read();
    let deleted = false;
    for (const key of Object.keys(value.records)) {
      try {
        if ((JSON.parse(key) as unknown[])[0] === resourceUrl) {
          delete value.records[key];
          deleted = true;
        }
      } catch {
        continue;
      }
    }
    if (deleted) this.write(value);
    return deleted;
  }
}

/**
 * Selects the configured persistent or explicitly in-memory credential store.
 *
 * @returns The owner-only file store, or memory when explicitly selected by the
 * `NT_MCP_CREDENTIAL_STORE` environment setting.
 */
export function defaultCredentialStore(): CredentialStore {
  return process.env.NT_MCP_CREDENTIAL_STORE === "memory"
    ? new MemoryCredentialStore()
    : new FileCredentialStore();
}
