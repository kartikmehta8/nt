/**
 * @file Sandboxes: the workspaces agents read, write, and run commands in.
 *
 * `VirtualSandbox` provides an in-memory filesystem and a deliberately small
 * command set, so untrusted runs cannot touch the host. `makeSandbox` selects
 * it by default or delegates explicit local execution to the separately
 * reviewable `LocalSandbox` security boundary.
 */

import * as nodePath from "node:path";
import { DEFAULT_SANDBOX_CWD } from "#constants";
import { LocalSandbox } from "#sandbox-local";
import type { SandboxDef } from "#types";

export { LocalSandbox } from "#sandbox-local";

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface Sandbox {
  readonly kind: "virtual" | "local";
  readonly cwd: string;
  readFile(path: string): string;
  writeFile(path: string, content: string): void;
  listFiles(): string[];
  exec(command: string): ExecResult;
}

/**
 * Returns a successful exec result.
 * @param stdout The command output.
 * @returns A successful exec result.
 */
function ok(stdout: string): ExecResult {
  return { stdout, stderr: "", code: 0 };
}

/**
 * Removes quotes from the supplied value.
 * @param s A token that may be wrapped in quotes.
 * @returns The token without surrounding quotes.
 */
function stripQuotes(s: string): string {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))
    return t.slice(1, -1);
  return t;
}

export class VirtualSandbox implements Sandbox {
  readonly kind = "virtual" as const;
  readonly cwd: string;
  private store = new Map<string, string>();
  private env: Record<string, string>;

  /**
   * Creates an isolated filesystem rooted at the declared virtual directory.
   *
   * @param def Virtual working directory and environment exposed by `env`.
   */
  constructor(def: { cwd: string; env: Record<string, string> }) {
    this.cwd = def.cwd || DEFAULT_SANDBOX_CWD;
    this.env = def.env ?? {};
  }

  private resolve(path: string): string {
    return nodePath.posix.normalize(
      path.startsWith("/") ? path : nodePath.posix.join(this.cwd, path),
    );
  }

  /**
   * Reads a file from the in-memory store.
   *
   * @param path Absolute or sandbox-relative file path.
   * @returns Stored file contents.
   */
  readFile(path: string): string {
    const key = this.resolve(path);
    if (!this.store.has(key)) throw new Error(`no such file: ${path}`);
    return this.store.get(key) ?? "";
  }

  /**
   * Replaces a file in the in-memory store.
   *
   * @param path Absolute or sandbox-relative destination path.
   * @param content Complete file contents to store.
   * @returns Nothing; the new value is available synchronously.
   */
  writeFile(path: string, content: string): void {
    this.store.set(this.resolve(path), content);
  }

  /**
   * Lists every stored file as a normalized absolute virtual path.
   *
   * @returns Sorted paths for deterministic callers and tests.
   */
  listFiles(): string[] {
    return [...this.store.keys()].sort();
  }

  /**
   * Executes one of the sandbox's small, deterministic built-in commands.
   *
   * @param command Command line to interpret without invoking a host shell.
   * @returns Captured output and an exit status; failures do not throw.
   */
  exec(command: string): ExecResult {
    const [cmd, ...rest] = command.trim().split(/\s+/);
    try {
      return this.run(cmd, rest);
    } catch (e) {
      return { stdout: "", stderr: String((e as Error).message), code: 1 };
    }
  }

  private run(cmd: string, rest: string[]): ExecResult {
    switch (cmd) {
      case "pwd":
        return ok(this.cwd);
      case "cat":
        return ok(rest.map((r) => this.readFile(stripQuotes(r))).join(""));
      case "ls":
        return ok([...new Set(this.listFiles().map((f) => nodePath.posix.basename(f)))].join("\n"));
      case "echo":
        return this.echo(rest);
      case "rm":
        for (const t of rest.filter((r) => !r.startsWith("-")))
          this.store.delete(this.resolve(stripQuotes(t)));
        return ok("");
      case "mkdir":
        return ok("");
      case "date":
        return ok(this.date(rest));
      case "env":
        return ok(
          Object.entries(this.env)
            .map(([k, v]) => `${k}=${v}`)
            .join("\n"),
        );
      default:
        return { stdout: "", stderr: `${cmd}: command not found (virtual sandbox)`, code: 127 };
    }
  }

  private echo(rest: string[]): ExecResult {
    const gt = rest.indexOf(">");
    if (gt < 0) return ok(stripQuotes(rest.join(" ")));
    this.writeFile(rest[gt + 1], stripQuotes(rest.slice(0, gt).join(" ")) + "\n");
    return ok("");
  }

  private date(rest: string[]): string {
    const now = new Date();
    const format = rest[0] ?? "";
    if (format === "+%Y") return String(now.getUTCFullYear());
    if (format === "+%Y-%m-%d") return now.toISOString().slice(0, 10);
    return now.toISOString();
  }
}

/**
 * Instantiates the validated virtual or explicitly enabled local sandbox definition.
 * @param def The sandbox definition to instantiate.
 * @returns A virtual or local sandbox instance.
 */
export function makeSandbox(def: SandboxDef): Sandbox {
  return def.type === "local" ? new LocalSandbox(def) : new VirtualSandbox(def);
}
