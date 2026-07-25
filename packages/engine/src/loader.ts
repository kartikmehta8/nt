/**
 * @file Turns a path into a validated `Project`.
 *
 * Given an entry `.nt` file, follows its `import` statements transitively
 * (deduping by real path); given a directory, globs every `.nt` file inside.
 * Imports are confined to the entry's directory tree unless
 * `allowOutsideImports` is set, and per-file size and total file count are
 * capped so a hostile or runaway project can't exhaust host resources. Either
 * way it parses each file, drops the `import` blocks, and hands the
 * declaration blocks to the schema builder.
 */

import * as fs from "node:fs";
import * as nodePath from "node:path";
import { MAX_IMPORTED_FILES, MAX_NT_FILE_BYTES } from "#constants";
import { NtError } from "#errors";
import { parseNt } from "#parse/parser";
import { buildProject, type BuildResult, type FileBlocks } from "#schema/build";
import type { Block } from "#types";

export interface LoadOptions {
  allowOutsideImports?: boolean;
}

/**
 * @param dir A directory to search, or a single `.nt` file.
 * @returns The sorted list of `.nt` files found.
 */
export function discoverNtFiles(dir: string): string[] {
  if (fs.statSync(dir).isFile()) return dir.endsWith(".nt") ? [dir] : [];
  const out: string[] = [];
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const full = nodePath.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith(".nt")) out.push(full);
    }
  };
  walk(dir);
  return out.sort();
}

/**
 * @param file A `.nt` file path.
 * @returns The file's text, erroring if it is unreadable or exceeds the size cap.
 */
function readNtFile(file: string): string {
  try {
    if (fs.statSync(file).size > MAX_NT_FILE_BYTES)
      throw new NtError(`.nt file exceeds the ${MAX_NT_FILE_BYTES}-byte limit: ${file}`, null);
    return fs.readFileSync(file, "utf8");
  } catch (e) {
    if (e instanceof NtError) throw e;
    throw new NtError(`cannot read ${file}: ${(e as Error).message}`, null);
  }
}

/**
 * @param file A `.nt` file path.
 * @returns The parsed declaration blocks for that file.
 */
function parseFile(file: string): Block[] {
  return parseNt(readNtFile(file), file);
}

/**
 * @param blocks Parsed blocks from one file.
 * @returns The blocks that declare entities, excluding `import` statements.
 */
function declarationBlocks(blocks: Block[]): Block[] {
  return blocks.filter((b) => b.kind !== "import");
}

/**
 * @param s A raw import path that may be wrapped in quotes.
 * @returns The path without surrounding quotes.
 */
function stripQuotes(s: string): string {
  if (s.length >= 2 && ((s[0] === '"' && s.endsWith('"')) || (s[0] === "'" && s.endsWith("'"))))
    return s.slice(1, -1);
  return s;
}

/**
 * @param file The importing file, used to resolve relative paths.
 * @param blocks The importing file's parsed blocks.
 * @returns Absolute paths named by the file's `import` statements.
 */
function importTargets(file: string, blocks: Block[]): string[] {
  const dir = nodePath.dirname(file);
  const targets: string[] = [];
  for (const b of blocks) {
    if (b.kind !== "import") continue;
    if (!b.name) throw new NtError("import requires a path, e.g. `import ./tools.nt`", b.loc);
    targets.push(nodePath.resolve(dir, stripQuotes(b.name)));
  }
  return targets;
}

/**
 * @param root The project root directory that imports must stay within.
 * @param target An absolute import target path.
 * @returns Whether the target resolves inside the root directory tree.
 */
function isInside(root: string, target: string): boolean {
  const rel = nodePath.relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !nodePath.isAbsolute(rel));
}

/**
 * @param entry The entry `.nt` file whose imports should be followed.
 * @param options Loader options, including whether imports may escape the root.
 * @returns Declaration blocks for the entry and every transitively imported file.
 */
function collectFromEntry(entry: string, options: LoadOptions): FileBlocks[] {
  const root = nodePath.dirname(fs.realpathSync(entry));
  const seen = new Set<string>();
  const collected: FileBlocks[] = [];
  const queue = [entry];
  for (let head = 0; head < queue.length; head++) {
    let canonical: string;
    try {
      canonical = fs.realpathSync(queue[head]);
    } catch {
      throw new NtError(`imported file not found: ${queue[head]}`, null);
    }
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    if (fs.statSync(canonical).isDirectory()) {
      queue.push(...discoverNtFiles(canonical));
      continue;
    }
    if (collected.length >= MAX_IMPORTED_FILES)
      throw new NtError(`too many imported .nt files (limit ${MAX_IMPORTED_FILES})`, null);
    const blocks = parseFile(canonical);
    collected.push({ file: canonical, blocks: declarationBlocks(blocks) });
    for (const next of importTargets(canonical, blocks)) {
      if (!options.allowOutsideImports && !isInside(root, next))
        throw new NtError(
          `import '${next}' is outside the project directory ${root}; pass --allow-outside-imports to permit it`,
          null,
        );
      queue.push(next);
    }
  }
  return collected;
}

/**
 * @param target An entry `.nt` file (imports are followed) or a directory (globbed).
 * @param options Loader options, including whether imports may escape the root.
 * @returns The assembled project and any accumulated warnings.
 */
export function loadProject(target: string, options: LoadOptions = {}): BuildResult {
  const resolved = nodePath.resolve(target);
  let isDirectory: boolean;
  try {
    isDirectory = fs.statSync(resolved).isDirectory();
  } catch {
    throw new NtError(`path not found: ${target}`, null);
  }
  let fileBlocks: FileBlocks[];
  if (isDirectory) {
    const files = discoverNtFiles(resolved);
    if (files.length > MAX_IMPORTED_FILES)
      throw new NtError(`too many .nt files in ${target} (limit ${MAX_IMPORTED_FILES})`, null);
    fileBlocks = files.map((f) => ({ file: f, blocks: declarationBlocks(parseFile(f)) }));
  } else {
    fileBlocks = collectFromEntry(resolved, options);
  }
  if (fileBlocks.length === 0) throw new NtError(`no .nt files found in ${target}`, null);
  return buildProject(fileBlocks);
}
