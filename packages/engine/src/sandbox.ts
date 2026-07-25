/**
 * @file Sandboxes: the workspaces agents read, write, and run commands in.
 *
 * `VirtualSandbox` is an in-memory filesystem with a tiny built-in shell so
 * nothing touches the host; `LocalSandbox` runs against the real host
 * filesystem and shell and is for trusted use only — it requires the
 * `NT_ALLOW_LOCAL=1` opt-in, jails file operations to its cwd, and passes
 * commands a minimal environment so host credentials never reach
 * model-chosen code. `makeSandbox` constructs the right one from a
 * `SandboxDef`.
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as nodePath from "node:path";
import { DEFAULT_SANDBOX_CWD } from "#constants";
import { NtError } from "#errors";
import type { Location, SandboxDef } from "#types";

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
 * @param stdout The command output.
 * @returns A successful exec result.
 */
function ok(stdout: string): ExecResult {
  return { stdout, stderr: "", code: 0 };
}

/**
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

  constructor(def: { cwd: string; env: Record<string, string> }) {
    this.cwd = def.cwd || DEFAULT_SANDBOX_CWD;
    this.env = def.env ?? {};
  }

  private resolve(path: string): string {
    return nodePath.posix.normalize(
      path.startsWith("/") ? path : nodePath.posix.join(this.cwd, path),
    );
  }

  readFile(path: string): string {
    const key = this.resolve(path);
    if (!this.store.has(key)) throw new Error(`no such file: ${path}`);
    return this.store.get(key)!;
  }

  writeFile(path: string, content: string): void {
    this.store.set(this.resolve(path), content);
  }

  listFiles(): string[] {
    return [...this.store.keys()].sort();
  }

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

const SAFE_ENV_KEYS = ["PATH", "HOME", "LANG", "LC_ALL", "TMPDIR", "TERM", "USER", "SHELL"];

/**
 * @param full An absolute path whose deepest segments may not exist yet.
 * @returns The path with every existing ancestor resolved through symlinks.
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

export class LocalSandbox implements Sandbox {
  readonly kind = "local" as const;
  readonly cwd: string;
  private root: string;
  private env: Record<string, string>;

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

  readFile(path: string): string {
    return fs.readFileSync(this.resolve(path), "utf8");
  }

  writeFile(path: string, content: string): void {
    const full = this.resolve(path);
    fs.mkdirSync(nodePath.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }

  listFiles(): string[] {
    return fs.readdirSync(this.cwd);
  }

  exec(command: string): ExecResult {
    try {
      const stdout = execSync(command, {
        cwd: this.cwd,
        env: this.execEnv(),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 60_000,
      });
      return ok(stdout);
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string; status?: number };
      return {
        stdout: err.stdout ?? "",
        stderr: err.stderr ?? String((e as Error).message),
        code: err.status ?? 1,
      };
    }
  }
}

/**
 * @param def The sandbox definition to instantiate.
 * @returns A virtual or local sandbox instance.
 */
export function makeSandbox(def: SandboxDef): Sandbox {
  return def.type === "local" ? new LocalSandbox(def) : new VirtualSandbox(def);
}
