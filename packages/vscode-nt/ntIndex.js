/**
 * @file Workspace index of NT declarations for the VS Code language features.
 *
 * `scanDefinitions` extracts each declaration (kind, name, location, inline
 * description, and MCP transport/policies) from source; `NtIndex` maintains a
 * name-to-definitions map across the workspace, refreshed incrementally per
 * document or fully via an injected file finder. Dotted MCP tool references map
 * back to policy entries or their server declaration. All scanning is bounded,
 * source-only, and testable without importing the `vscode` API.
 */

const fs = require("node:fs");
const { scanMcpToolPolicies } = require("./mcpIndex");

const DECL_RE =
  /^(agent|subagent|sandbox|tool|skill|workflow|provider|mcp)\b[ \t]+([A-Za-z0-9_-]+)/;
const DESC_RE = /^\s*description:[ \t]+(.*\S)/;

const MAX_SCANNED_FILES = 500;
const MAX_SCANNED_FILE_BYTES = 1_000_000;

/**
 * Reads one workspace file only when it is below the extension's byte limit.
 * @param fsPath An on-disk path to a workspace .nt file.
 * @returns The file's text, or null when it is unreadable or exceeds the size cap.
 */
function readBoundedFile(fsPath) {
  try {
    if (fs.statSync(fsPath).size > MAX_SCANNED_FILE_BYTES) return null;
    return fs.readFileSync(fsPath, "utf8");
  } catch {
    return null;
  }
}

const BUILTIN_TOOLS = {
  fs_read: "Built-in tool — read a file from the sandbox.",
  fs_write: "Built-in tool — write a file in the sandbox.",
  fs_list: "Built-in tool — list files in the sandbox.",
  bash: "Built-in tool — run a shell command in the sandbox.",
};

/**
 * Finds the first inline description within one declaration block.
 * @param lines All lines of a file.
 * @param declLine The zero-based index of a declaration line.
 * @returns The block's inline `description:` text, or an empty string.
 */
function findDescription(lines, declLine) {
  for (let i = declLine + 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i])) break;
    const d = lines[i].match(DESC_RE);
    if (d) return d[1];
  }
  return "";
}

/**
 * Combines a source description with the declaration's static MCP transport.
 * @param lines All lines of a file.
 * @param declarationLine The zero-based MCP declaration line.
 * @returns A hover summary that always includes the statically declared transport.
 */
function findMcpDescription(lines, declarationLine) {
  const description = findDescription(lines, declarationLine);
  let transport = "unspecified";
  for (let index = declarationLine + 1; index < lines.length; index++) {
    if (/^\S/.test(lines[index])) break;
    const match = lines[index].match(/^\s*transport:\s*(stdio|streamable_http)\s*$/);
    if (match) transport = match[1];
  }
  return `${description ? `${description} — ` : ""}MCP server — transport ${transport}`;
}

/**
 * Scans definitions into the structures used by later processing.
 * @param text The full text of a .nt file.
 * @param uri The file's URI, stored on each definition.
 * @returns One definition descriptor per declaration found in the file.
 */
function scanDefinitions(text, uri) {
  const lines = text.split(/\r?\n/);
  const defs = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(DECL_RE);
    if (!m) continue;
    const start = lines[i].indexOf(m[2], m[1].length);
    defs.push({
      kind: m[1],
      name: m[2],
      uri,
      line: i,
      start,
      end: start + m[2].length,
      description: m[1] === "mcp" ? findMcpDescription(lines, i) : findDescription(lines, i),
    });
    if (m[1] === "mcp") scanMcpToolPolicies(lines, i, m[2], uri, defs);
  }
  return defs;
}

class NtIndex {
  /**
   * Creates an empty name-to-definition index for one extension workspace.
   */
  constructor() {
    this.byName = new Map();
  }

  /**
   * Atomically replaces every indexed symbol originating from one document.
   * @param uri The file whose definitions are being recorded.
   * @param text The file's current text.
   * @returns Nothing; prior symbols for the URI are atomically replaced.
   */
  updateDoc(uri, text) {
    this.removeUri(uri);
    for (const def of scanDefinitions(text, uri)) this.add(def);
  }

  /**
   * Removes all definitions belonging to one URI while preserving duplicates elsewhere.
   * @param uri The file whose definitions should be dropped from the index.
   * @returns Nothing; other files and duplicate definitions remain indexed.
   */
  removeUri(uri) {
    const key = uri.toString();
    for (const [name, list] of this.byName) {
      const kept = list.filter((d) => d.uri.toString() !== key);
      if (kept.length) this.byName.set(name, kept);
      else this.byName.delete(name);
    }
  }

  /**
   * Adds one discovered definition while preserving same-name duplicates.
   * @param def A definition descriptor to record.
   * @returns Nothing; definitions with the same name are retained together.
   */
  add(def) {
    const list = this.byName.get(def.name) ?? [];
    list.push(def);
    this.byName.set(def.name, list);
  }

  /**
   * Looks up every indexed definition that exactly matches a name.
   * @param name An entity name.
   * @returns Every definition declared with that name.
   */
  lookup(name) {
    return this.byName.get(name) ?? [];
  }

  /**
   * Collects indexed definitions whose declaration kind is requested.
   * @param kinds Declaration kinds to include.
   * @returns Every definition whose kind is in the given list.
   */
  ofKinds(kinds) {
    const out = [];
    for (const list of this.byName.values())
      for (const def of list) if (kinds.includes(def.kind)) out.push(def);
    return out;
  }

  /**
   * Reads are bounded in count and size so a hostile workspace cannot exhaust
   * the extension host.
   *
   * @param findFiles An async function returning the workspace's .nt file URIs.
   * @returns A promise that settles after the bounded workspace rebuild.
   */
  async refresh(findFiles) {
    this.byName = new Map();
    const uris = await findFiles();
    for (const uri of uris.slice(0, MAX_SCANNED_FILES)) {
      const text = readBoundedFile(uri.fsPath);
      if (text === null) continue;
      for (const def of scanDefinitions(text, uri)) this.add(def);
    }
  }
}

module.exports = {
  NtIndex,
  scanDefinitions,
  findDescription,
  readBoundedFile,
  BUILTIN_TOOLS,
  MAX_SCANNED_FILES,
};
