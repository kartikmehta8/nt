/**
 * @file Workspace index of NT declarations for the VS Code language features.
 *
 * `scanDefinitions` extracts each declaration (kind, name, location, inline
 * description) from a file's text; `NtIndex` maintains a name-to-definitions map
 * across the workspace, refreshed incrementally per document or fully via an
 * injected file finder — keeping the scanning logic testable without the
 * `vscode` API.
 */

const fs = require("node:fs");

const DECL_RE = /^(agent|subagent|sandbox|tool|skill|workflow|provider)\b[ \t]+([A-Za-z0-9_-]+)/;
const DESC_RE = /^\s*description:[ \t]+(.*\S)/;

const MAX_SCANNED_FILES = 500;
const MAX_SCANNED_FILE_BYTES = 1_000_000;

/**
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
      description: findDescription(lines, i),
    });
  }
  return defs;
}

class NtIndex {
  constructor() {
    this.byName = new Map();
  }

  /**
   * @param uri The file whose definitions are being recorded.
   * @param text The file's current text.
   */
  updateDoc(uri, text) {
    this.removeUri(uri);
    for (const def of scanDefinitions(text, uri)) this.add(def);
  }

  /**
   * @param uri The file whose definitions should be dropped from the index.
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
   * @param def A definition descriptor to record.
   */
  add(def) {
    const list = this.byName.get(def.name) ?? [];
    list.push(def);
    this.byName.set(def.name, list);
  }

  /**
   * @param name An entity name.
   * @returns Every definition declared with that name.
   */
  lookup(name) {
    return this.byName.get(name) ?? [];
  }

  /**
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
