/**
 * @file The indentation-based parser for `.nt` source.
 *
 * Turns a file into top-level declaration `Block`s (`import`, `config`, `agent`,
 * `subagent`, `sandbox`, `tool`, `mcp`, `skill`, `workflow`, `provider`),
 * recursively parsing maps, lists, block scalars, and scalars. It remains syntax
 * only: coercion, cross-references, trust, credentials, and network activity
 * belong to later phases. `parseNt` is the entry point.
 */

import { MAX_PARSE_DEPTH } from "#constants";
import { NtError } from "#errors";
import { isBlockMarker, preprocessLines, unquote, type Line } from "#parse/lexer";
import { parseScalar } from "#parse/scalar";
import type { Block, BlockKind, Location, NtValue } from "#types";

const KNOWN_KINDS: BlockKind[] = [
  "import",
  "config",
  "provider",
  "mcp",
  "agent",
  "subagent",
  "sandbox",
  "tool",
  "skill",
  "workflow",
];

const MAP_ENTRY = /^("(?:[^"\\]|\\.)*"|'[^']*'|[A-Za-z0-9_.-]+)\s*:(?:[ \t](.*)|)$/;

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

class Parser {
  private lines: Line[];
  private index = 0;
  private file: string;

  constructor(lines: Line[], file: string) {
    this.lines = lines;
    this.file = file;
  }

  private loc(line: Line): Location {
    return { file: this.file, line: line.lineNo };
  }

  private skipBlanks(): void {
    while (this.index < this.lines.length && this.lines[this.index].blank) this.index++;
  }

  parseDocument(): Block[] {
    const blocks: Block[] = [];
    this.skipBlanks();
    while (this.index < this.lines.length) {
      const line = this.lines[this.index];
      if (line.indent !== 0)
        throw new NtError(
          "unexpected indentation; expected a top-level declaration",
          this.loc(line),
        );
      const header = line.content.replace(/:\s*$/, "").trim();
      const parts = header.split(/\s+/);
      const kind = parts[0] as BlockKind;
      if (!KNOWN_KINDS.includes(kind))
        throw new NtError(
          `unknown declaration '${parts[0]}' (expected one of: ${KNOWN_KINDS.join(", ")})`,
          this.loc(line),
        );
      if ((kind === "config" || kind === "provider") && parts.length > 2)
        throw new NtError(`too many words in '${kind}' header`, this.loc(line));
      const loc = this.loc(line);
      this.index++;
      const body = this.parseContainer(0, 0);
      if (!isPlainMap(body))
        throw new NtError(`'${kind}' body must be a set of key: value fields`, loc);
      blocks.push({ kind, name: parts.length > 1 ? parts[1] : null, body, loc });
      this.skipBlanks();
    }
    return blocks;
  }

  private parseContainer(parentIndent: number, depth: number): NtValue {
    if (depth > MAX_PARSE_DEPTH)
      throw new NtError(`nesting too deep (limit ${MAX_PARSE_DEPTH})`, {
        file: this.file,
        line: this.lines[this.index]?.lineNo ?? 0,
      });
    this.skipBlanks();
    if (this.index >= this.lines.length || this.lines[this.index].indent <= parentIndent) return {};
    const childIndent = this.lines[this.index].indent;
    const first = this.lines[this.index].content;
    if (first === "-" || first.startsWith("- ")) return this.parseList(childIndent, depth);
    if (MAP_ENTRY.test(first)) return this.parseMap(childIndent, depth);

    const line = this.lines[this.index];
    this.index++;
    if (isBlockMarker(first)) return this.parseBlockScalar(childIndent, first);
    return parseScalar(first, this.loc(line));
  }

  private parseMap(childIndent: number, depth: number): Record<string, NtValue> {
    const map: Record<string, NtValue> = {};
    while (true) {
      this.skipBlanks();
      if (this.index >= this.lines.length) break;
      const line = this.lines[this.index];
      if (line.indent < childIndent) break;
      if (line.indent > childIndent)
        throw new NtError("unexpected extra indentation", this.loc(line));
      if (line.content.startsWith("-"))
        throw new NtError("list item '-' where a key: value was expected", this.loc(line));
      const match = line.content.match(MAP_ENTRY);
      if (!match)
        throw new NtError(
          `expected 'key: value' but found: ${snippet(line.content)}`,
          this.loc(line),
        );
      const key = unquote(match[1]);
      if (FORBIDDEN_KEYS.has(key))
        throw new NtError(`'${key}' is not allowed as a key`, this.loc(line));
      const valuePart = (match[2] ?? "").trim();
      this.index++;
      if (valuePart === "") map[key] = this.parseContainer(childIndent, depth + 1);
      else if (isBlockMarker(valuePart)) map[key] = this.parseBlockScalar(childIndent, valuePart);
      else map[key] = parseScalar(valuePart, this.loc(line));
    }
    return map;
  }

  private parseList(childIndent: number, depth: number): NtValue[] {
    const items: NtValue[] = [];
    while (true) {
      this.skipBlanks();
      if (this.index >= this.lines.length) break;
      const line = this.lines[this.index];
      if (line.indent < childIndent) break;
      if (line.indent > childIndent)
        throw new NtError("unexpected extra indentation in list", this.loc(line));
      if (!line.content.startsWith("-")) break;
      const rest = line.content.slice(1).trim();
      this.index++;
      items.push(this.parseListItem(childIndent, rest, line.lineNo, depth));
    }
    return items;
  }

  private parseListItem(childIndent: number, rest: string, lineNo: number, depth: number): NtValue {
    const subLines: Line[] = [];
    const effectiveIndent = childIndent + 2;
    if (rest !== "")
      subLines.push({
        raw: " ".repeat(effectiveIndent) + rest,
        indent: effectiveIndent,
        trimmed: rest,
        content: rest,
        lineNo,
        blank: false,
        synthetic: true,
      });
    while (
      this.index < this.lines.length &&
      (this.lines[this.index].blank || this.lines[this.index].indent > childIndent)
    ) {
      subLines.push(this.lines[this.index]);
      this.index++;
    }
    if (subLines.length === 0) return null;
    return new Parser(subLines, this.file).parseContainer(-1, depth + 1);
  }

  private parseBlockScalar(keyIndent: number, marker: string): string {
    const folded = marker[0] === ">";
    const chomp = marker.includes("-");
    let contentIndent = -1;
    const parts: { blank: boolean; text: string }[] = [];
    while (this.index < this.lines.length) {
      const line = this.lines[this.index];
      if (line.blank) {
        parts.push({ blank: true, text: "" });
        this.index++;
        continue;
      }
      if (line.indent <= keyIndent) break;
      if (contentIndent === -1) contentIndent = line.indent;
      parts.push({ blank: false, text: line.raw.slice(contentIndent) });
      this.index++;
    }
    while (parts.length && parts[parts.length - 1].blank) parts.pop();
    if (folded) {
      let out = "";
      for (const part of parts) {
        if (part.blank) out += "\n";
        else out += (out && !out.endsWith("\n") ? " " : "") + part.text;
      }
      return chomp ? out : out + "\n";
    }
    const body = parts.map((p) => p.text).join("\n");
    return chomp ? body : body + "\n";
  }
}

/**
 * Returns the content trimmed to a short, single-line snippet so full file contents never land in errors.
 * @param content A source line to quote back in a diagnostic.
 * @returns The content trimmed to a short, single-line snippet so full file contents never land in errors.
 */
function snippet(content: string): string {
  const oneLine = content.replace(/\s+/g, " ").trim();
  return oneLine.length > 80 ? oneLine.slice(0, 80) + "…" : oneLine;
}

/**
 * Determines whether plain map.
 * @param value A parsed value to test.
 * @returns Whether the value is a plain key/value map (not a list, scalar, or env ref).
 */
function isPlainMap(value: NtValue): value is Record<string, NtValue> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !("__env" in (value as object))
  );
}

/**
 * Parses nt into its validated internal representation.
 * @param text Full `.nt` source text.
 * @param file The originating file path, used in diagnostics.
 * @returns The top-level declaration blocks found in the document.
 */
export function parseNt(text: string, file: string): Block[] {
  return new Parser(preprocessLines(text, file), file).parseDocument();
}
