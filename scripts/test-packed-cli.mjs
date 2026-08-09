/**
 * @file Published-artifact smoke test for the engine and CLI workspaces.
 *
 * Packs both packages, installs their tarballs into an isolated prefix, verifies
 * compiled entry points and runtime MCP dependencies, then exercises help plus
 * trusted stdio list, inspect, and doctor commands against the repository
 * fixture. All trust state and installed files live under a temporary directory
 * that is removed in `finally`, so the test never mutates the user's home.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const temp = mkdtempSync(join(tmpdir(), "nt-packed-cli-"));
const tarballs = join(temp, "tarballs");
const prefix = join(temp, "install");
const executable = process.platform === "win32" ? "nt.cmd" : "nt";
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

/**
 * Executes a packaging command and fails with its captured diagnostic when the
 * process cannot complete successfully.
 *
 * @param command Executable name.
 * @param args Argument vector passed without a shell.
 * @param options Optional working directory and environment overrides.
 * @returns Captured standard output with surrounding whitespace removed.
 */
function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

try {
  run(pnpm, ["--dir", "packages/engine", "pack", "--pack-destination", tarballs]);
  run(pnpm, ["--dir", "packages/cli", "pack", "--pack-destination", tarballs]);

  const packed = readdirSync(tarballs);
  const engine = join(tarballs, packed.find((name) => name.startsWith("age.nt-engine-")) ?? "");
  const cli = join(tarballs, packed.find((name) => name.startsWith("age.nt-nt-")) ?? "");
  assert.ok(engine.endsWith(".tgz"), "engine tarball was not created");
  assert.ok(cli.endsWith(".tgz"), "CLI tarball was not created");

  run(npm, [
    "install",
    "--prefix",
    prefix,
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    engine,
    cli,
  ]);

  const installedCli = join(prefix, "node_modules", "@age.nt", "nt");
  const installedEngine = join(prefix, "node_modules", "@age.nt", "engine");
  assert.match(readFileSync(join(installedCli, "bin", "nt.mjs"), "utf8"), /dist.*main\.js/s);
  assert.ok(existsSync(join(installedCli, "dist", "main.js")), "compiled CLI entry is missing");
  assert.ok(
    existsSync(join(installedEngine, "dist", "index.js")),
    "compiled engine entry is missing",
  );
  assert.ok(
    existsSync(join(prefix, "node_modules", "@modelcontextprotocol", "client")),
    "official MCP client dependency is missing",
  );
  assert.equal(
    existsSync(join(installedCli, "src")),
    false,
    "CLI tarball contains TypeScript source",
  );
  assert.equal(
    existsSync(join(installedEngine, "src")),
    false,
    "engine tarball contains TypeScript source",
  );

  const path = [join(prefix, "node_modules", ".bin"), process.env.PATH ?? ""].join(delimiter);
  const help = run(join(prefix, "node_modules", ".bin", executable), ["help"], {
    cwd: realpathSync(temp),
    env: { ...process.env, PATH: path },
  });
  assert.match(help, /^nt — run ecosystems of agents defined in \.nt files/m);

  const fixture = join(root, "packages", "engine", "test", "fixtures", "mcp", "stdio-server.mjs");
  const projectFile = join(temp, "mcp.nt");
  writeFileSync(
    projectFile,
    `mcp fixture\n  transport: stdio\n  command: ${process.execPath}\n  args: [${fixture}]\n  tools: [echo]\n`,
  );
  const fingerprintFields = {
    transport: "stdio",
    command: process.execPath,
    args: [fixture],
    cwd: realpathSync(temp),
    env_names: [],
    url: null,
    auth_type: "none",
    header_names: [],
    allow_internal: false,
    allow_legacy_sse: false,
  };
  const fingerprint = `sha256:${createHash("sha256").update(JSON.stringify(fingerprintFields)).digest("hex")}`;
  const isolatedHome = join(temp, "home");
  const mcpEnv = { ...process.env, PATH: path, HOME: isolatedHome, USERPROFILE: isolatedHome };
  run(
    join(prefix, "node_modules", ".bin", executable),
    [
      "mcp",
      "trust",
      "fixture",
      "--file",
      projectFile,
      "--fingerprint",
      fingerprint,
      "--non-interactive",
    ],
    { cwd: temp, env: mcpEnv },
  );
  const listing = run(
    join(prefix, "node_modules", ".bin", executable),
    ["mcp", "list", "fixture", "--file", projectFile, "--json"],
    { cwd: temp, env: mcpEnv },
  );
  const parsed = JSON.parse(listing);
  assert.equal(parsed.schema_version, 1);
  assert.equal(parsed.servers[0].status, "connected");
  assert.equal(parsed.servers[0].tools[0].remoteName, "echo");
  const inspected = JSON.parse(
    run(
      join(prefix, "node_modules", ".bin", executable),
      ["mcp", "inspect", "fixture", "echo", "--file", projectFile, "--json"],
      { cwd: temp, env: mcpEnv },
    ),
  );
  assert.equal(inspected.tool.reference, "fixture.echo");
  const doctor = JSON.parse(
    run(
      join(prefix, "node_modules", ".bin", executable),
      ["mcp", "doctor", "fixture", "--file", projectFile, "--json"],
      { cwd: temp, env: mcpEnv },
    ),
  );
  assert.equal(doctor.servers[0].usable, true);
  assert.equal(doctor.servers[0].checks.length, 10);
  process.stdout.write("packed CLI smoke test passed\n");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
