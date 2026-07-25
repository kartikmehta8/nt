#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const MIN_NODE_MAJOR = 22;
const MIN_NODE_MINOR = 18;

const [major, minor] = process.versions.node.split(".").map(Number);
if (major < MIN_NODE_MAJOR || (major === MIN_NODE_MAJOR && minor < MIN_NODE_MINOR)) {
  console.error(
    `nt requires Node >= ${MIN_NODE_MAJOR}.${MIN_NODE_MINOR} (for TypeScript type stripping); you are on ${process.versions.node}.`,
  );
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));

import(join(here, "..", "src", "main.ts"))
  .then((m) => m.main(process.argv.slice(2)))
  .catch((err) => {
    console.error(err?.stack || String(err));
    process.exit(1);
  });
