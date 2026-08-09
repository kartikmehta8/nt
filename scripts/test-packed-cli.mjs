import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
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
    cwd: temp,
    env: { ...process.env, PATH: path },
  });
  assert.match(help, /^nt — run ecosystems of agents defined in \.nt files/m);
  process.stdout.write("packed CLI smoke test passed\n");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
