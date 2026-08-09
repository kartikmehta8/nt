#!/usr/bin/env node
/**
 * @file Published `nt` executable bootstrap.
 *
 * Refuses unsupported Node.js versions before importing compiled CLI code,
 * resolves `dist/main.js` relative to the installed package rather than the
 * caller's working directory, and reports startup failures with their stack.
 * Published installs always enter through this compiled artifact boundary.
 */

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const MIN_NODE_MAJOR = 22;
const MIN_NODE_MINOR = 18;

const [major, minor] = process.versions.node.split(".").map(Number);
if (major < MIN_NODE_MAJOR || (major === MIN_NODE_MAJOR && minor < MIN_NODE_MINOR)) {
  console.error(
    `nt requires Node >= ${MIN_NODE_MAJOR}.${MIN_NODE_MINOR}; you are on ${process.versions.node}.`,
  );
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));

import(join(here, "..", "dist", "main.js"))
  .then((m) => m.main(process.argv.slice(2)))
  .catch((err) => {
    console.error(err?.stack || String(err));
    process.exit(1);
  });
