/**
 * @file Trusted host-filesystem sandbox implementation.
 *
 * `LocalSandbox` is the explicit escape hatch from the in-memory sandbox. It
 * requires `NT_ALLOW_LOCAL=1`, resolves every file operation beneath a
 * canonical working-directory root, and supplies child processes only a small
 * environment allowlist plus values declared in the project. Keeping this
 * implementation separate makes the host-execution boundary easy to review.
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as nodePath from "node:path";
import { NtError } from "#errors";
import type { Sandbox, ExecResult } from "#sandbox";
import type { Location } from "#types";

const SAFE_ENV_KEYS = ["PATH", "HOME", "LANG", "LC_ALL", "TMPDIR", "TERM", "USER", "SHELL"];

/**
 * Resolves existing ancestors through symlinks even when the target does not
 * exist yet, preventing a later write from escaping through a linked parent.
 *
 * @param full Absolute path whose deepest segments may not exist yet.
 * @returns Path with every existing ancestor resolved through symlinks.
 */
function realpathDeep(full: string): string {
  let base = full;
  let rest = "";
  while (!fs.existsSync(base)) {
    const parent = nodePath.dirname(base);
    if (parent === base) break;
    rest = rest ? nodePath.join(nodePath.basename(base), rest) : nodePath.basename(base);
    base = parent;
  }
  return rest ? nodePath.join(fs.realpathSync(base), rest) : fs.realpathSync(base);
}

/**
 * Host-backed sandbox for explicitly trusted execution, with a canonical path
 * jail and deliberately restricted child-process environment.
 */
export class LocalSandbox implements Sandbox {
  readonly kind = "local" as const;
  readonly cwd: string;
  private root: string;
  private env: Record<string, string>;

  /**
   * Verifies the local-execution opt-in and establishes a canonical jail root.
   *
   * @param def Working directory, declared environment, and source location.
   */
  constructor(def: { cwd: string; env: Record<string, string>; loc?: Location }) {
    if (process.env.NT_ALLOW_LOCAL !== "1")
      throw new NtError(
        "local sandboxes run model-chosen commands on the host and are disabled by default; set NT_ALLOW_LOCAL=1 to opt in",
        def.loc ?? null,
      );
    this.cwd = def.cwd || process.cwd();
    this.env = def.env ?? {};
    if (!fs.existsSync(this.cwd))
      throw new NtError(`local sandbox cwd does not exist: ${this.cwd}`, def.loc ?? null);
    this.root = fs.realpathSync(this.cwd);
  }

  private resolve(path: string): string {
    const real = realpathDeep(nodePath.resolve(this.root, path));
    if (real !== this.root && !real.startsWith(this.root + nodePath.sep))
      throw new Error(`path escapes the sandbox cwd: ${path}`);
    return real;
  }

  private execEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    for (const key of SAFE_ENV_KEYS) {
      const value = process.env[key];
      if (value !== undefined) env[key] = value;
    }
    return { ...env, ...this.env };
  }

  /**
   * Reads a UTF-8 file after verifying it remains inside the sandbox root.
   *
   * @param path Absolute or sandbox-relative file path.
   * @returns File contents decoded as UTF-8.
   */
  readFile(path: string): string {
    return fs.readFileSync(this.resolve(path), "utf8");
  }

  /**
   * Writes a UTF-8 file and creates missing parent directories inside the jail.
   *
   * @param path Absolute or sandbox-relative destination path.
   * @param content Complete file contents to write.
   * @returns Nothing; the file is persisted before the method returns.
   */
  writeFile(path: string, content: string): void {
    const full = this.resolve(path);
    fs.mkdirSync(nodePath.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }

  /**
   * Lists the immediate entries in the sandbox working directory.
   *
   * @returns Entry names in the host directory's native order.
   */
  listFiles(): string[] {
    return fs.readdirSync(this.cwd);
  }

  /**
   * Runs a shell command with a minimal environment and a fixed timeout.
   *
   * @param command Shell command to run from the sandbox working directory.
   * @returns Captured output and exit status, including non-zero executions.
   */
  exec(command: string): ExecResult {
    try {
      const stdout = execSync(command, {
        cwd: this.cwd,
        env: this.execEnv(),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 60_000,
      });
      return { stdout, stderr: "", code: 0 };
    } catch (error) {
      const failure = error as { stdout?: string; stderr?: string; status?: number };
      return {
        stdout: failure.stdout ?? "",
        stderr: failure.stderr ?? String((error as Error).message),
        code: failure.status ?? 1,
      };
    }
  }
}
