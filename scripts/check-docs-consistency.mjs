/**
 * @file Executable documentation-to-code consistency checks for NT.
 *
 * Treats package manifests, the MCP declaration schema, public CLI parser, and
 * exported field-type vocabulary as sources of truth. It rejects stale build or
 * dependency claims and ensures user-facing references contain every runtime
 * dependency, MCP field, long CLI option, and supported data type. The check is
 * intentionally deterministic and offline so it can run as part of `pnpm lint`.
 */

import * as fs from "node:fs";
import * as nodePath from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

/**
 * Reads one repository-relative UTF-8 text file.
 *
 * @param file Repository-relative path.
 * @returns Complete file contents.
 */
function read(file) {
  return fs.readFileSync(nodePath.join(ROOT, file), "utf8");
}

/**
 * Parses one repository-relative JSON manifest.
 *
 * @param file Repository-relative JSON path.
 * @returns Parsed manifest object.
 */
function json(file) {
  return JSON.parse(read(file));
}

/**
 * Records a consistency failure without stopping later checks.
 *
 * @param message Actionable explanation of the mismatch.
 * @returns Nothing; the message is appended to the final report.
 */
function fail(message) {
  failures.push(message);
}

/**
 * Requires every expected phrase to occur in a documentation file.
 *
 * @param file Repository-relative documentation path.
 * @param values Required literal phrases.
 * @returns Nothing; missing phrases are collected as failures.
 */
function requireText(file, values) {
  const source = read(file);
  for (const value of values)
    if (!source.includes(value)) fail(`${file} must document ${JSON.stringify(value)}`);
}

/**
 * Extracts double-quoted literals from a named source array.
 *
 * @param file Repository-relative TypeScript source path.
 * @param name Constant array identifier.
 * @returns Literal values in their declared order.
 */
function sourceArray(file, name) {
  const source = read(file);
  const match = source.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\](?: as const)?;`));
  if (!match) {
    fail(`${file} no longer exposes parseable ${name}`);
    return [];
  }
  return [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
}

const rootPackage = json("package.json");
const enginePackage = json("packages/engine/package.json");
const cliPackage = json("packages/cli/package.json");
const expectedDependencies = ["@modelcontextprotocol/client", "ajv", "undici"];
const runtimeDependencies = Object.keys(enginePackage.dependencies ?? {}).sort();
if (JSON.stringify(runtimeDependencies) !== JSON.stringify([...expectedDependencies].sort()))
  fail(
    `packages/engine/package.json runtime dependencies changed: ${runtimeDependencies.join(", ")}`,
  );
for (const dependency of expectedDependencies) {
  const version = enginePackage.dependencies?.[dependency];
  if (!/^\d+\.\d+\.\d+$/.test(version ?? ""))
    fail(`packages/engine/package.json must exact-pin ${dependency}, got ${version ?? "missing"}`);
}
if (enginePackage.version !== cliPackage.version)
  fail(`engine and CLI versions differ (${enginePackage.version} vs ${cliPackage.version})`);
for (const [file, manifest] of [
  ["package.json", rootPackage],
  ["packages/engine/package.json", enginePackage],
  ["packages/cli/package.json", cliPackage],
])
  if (manifest.engines?.node !== ">=22.18.0") fail(`${file} must require Node >=22.18.0`);

requireText("README.md", ["MCP client", "Ajv", "Undici"]);
for (const file of ["packages/engine/README.md", "CLAUDE.md"])
  requireText(file, ["@modelcontextprotocol/client", "Ajv", "Undici"]);
requireText("CONTRIBUTING.md", ["compiled to `dist/`", "pnpm check:docs"]);
requireText("apps/docs/content/docs/installation.mdx", [
  "zero-dependency runtime",
  "Ajv",
  "Undici",
]);

const currentDocs = [
  "README.md",
  "CONTRIBUTING.md",
  "packages/engine/README.md",
  "packages/cli/README.md",
  ...fs
    .readdirSync(nodePath.join(ROOT, "apps/docs/content/docs"), { recursive: true })
    .filter((file) => typeof file === "string" && file.endsWith(".mdx"))
    .map((file) => nodePath.join("apps/docs/content/docs", file)),
];
const staleClaims = [
  /\b(?:has|have|with) (?:zero|no) runtime dependencies\b/i,
  /there is no build step/i,
];
for (const file of currentDocs)
  for (const pattern of staleClaims)
    if (pattern.test(read(file))) fail(`${file} contains stale claim ${pattern}`);

const apiReference = "apps/docs/content/docs/reference/api.mdx";
for (const field of sourceArray("packages/engine/src/schema/mcp.ts", "MCP_FIELDS"))
  requireText(apiReference, [`| \`${field}\``]);

const typeMatch = read("packages/engine/src/types.ts").match(/export type FieldType = ([^;]+);/);
if (!typeMatch) fail("packages/engine/src/types.ts FieldType union could not be read");
else {
  const fieldTypes = [...typeMatch[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
  for (const type of fieldTypes)
    requireText("apps/docs/content/docs/reference/syntax.mdx", [`\`${type}\``]);
}

const cliSource = read("packages/cli/src/args.ts");
const longOptions = [
  ...new Set([...cliSource.matchAll(/arg === "(--[a-z-]+)"/g)].map((item) => item[1])),
];
for (const file of ["packages/cli/README.md", "apps/docs/content/docs/reference/cli.mdx"])
  requireText(file, longOptions);

if (failures.length) {
  process.stderr.write(`Documentation consistency check failed:\n${failures.join("\n")}\n`);
  process.exitCode = 1;
} else process.stdout.write("Documentation matches code and package metadata.\n");
