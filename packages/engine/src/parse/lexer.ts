/**
 * @file Line-level lexing helpers for the NT parser.
 *
 * Splits source into indentation-aware `Line`s and provides the primitives the
 * parser builds on: indent counting (tabs rejected), comment stripping that
 * respects quotes, unquoting, block-scalar marker detection, and flow-list
 * splitting.
 */

import { NtError } from "#errors";

export interface Line {
  raw: string;
  indent: number;
  trimmed: string;
  content: string;
  lineNo: number;
  blank: boolean;
  synthetic?: boolean;
}

/**
 * Returns the count of leading spaces used as indentation.
 * @param raw The original source line.
 * @param file File the line belongs to, for error messages.
 * @param lineNo One-based line number.
 * @returns The count of leading spaces used as indentation.
 */
export function countIndent(raw: string, file: string, lineNo: number): number {
  let n = 0;
  for (const c of raw) {
    if (c === " ") n++;
    else if (c === "\t")
      throw new NtError("tabs are not allowed for indentation; use spaces", { file, line: lineNo });
    else break;
  }
  return n;
}

/**
 * Removes comment from the supplied value.
 * @param s A trimmed line whose trailing `#` comment should be removed.
 * @returns The line with any unquoted trailing comment stripped.
 */
export function stripComment(s: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === "#" && !inSingle && !inDouble && (i === 0 || /\s/.test(s[i - 1])))
      return s.slice(0, i).trimEnd();
  }
  return s.trimEnd();
}

/**
 * Returns the unquoted value, with escape sequences resolved for double quotes.
 * @param s A token that may be wrapped in single or double quotes.
 * @returns The unquoted value, with escape sequences resolved for double quotes.
 */
export function unquote(s: string): string {
  if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"')
    return s
      .slice(1, -1)
      .replace(/\\(["\\nt])/g, (_m, c: string) => (c === "n" ? "\n" : c === "t" ? "\t" : c));
  if (s.length >= 2 && s[0] === "'" && s[s.length - 1] === "'") return s.slice(1, -1);
  return s;
}

/**
 * Determines whether block marker.
 * @param s A candidate token.
 * @returns Whether the token opens a block scalar (`|`, `|-`, `>`, `>-`).
 */
export function isBlockMarker(s: string): boolean {
  return s === "|" || s === "|-" || s === ">" || s === ">-";
}

/**
 * Returns the comma-separated items, respecting quotes and nested brackets.
 * @param s The body of a flow list, without its surrounding brackets.
 * @param loc Source location used when the brackets are unbalanced.
 * @returns The comma-separated items, respecting quotes and nested brackets.
 */
export function splitTopLevel(s: string, loc: { file: string; line: number }): string[] {
  const out: string[] = [];
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let cur = "";
  for (const c of s) {
    if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (c === "'" && !inDouble) inSingle = !inSingle;
    if (!inSingle && !inDouble) {
      if (c === "[" || c === "{") depth++;
      else if (c === "]" || c === "}") depth--;
      else if (c === "," && depth === 0) {
        out.push(cur);
        cur = "";
        continue;
      }
      if (depth < 0) throw new NtError("unbalanced brackets in flow list", loc);
    }
    cur += c;
  }
  if (depth !== 0) throw new NtError("unbalanced brackets in flow list", loc);
  if (cur.trim() !== "") out.push(cur);
  return out;
}

/**
 * Returns one structured Line per source line, with indentation and blankness computed.
 * @param text Full source text of a `.nt` file.
 * @param file The file path, used for diagnostics.
 * @returns One structured Line per source line, with indentation and blankness computed.
 */
export function preprocessLines(text: string, file: string): Line[] {
  return text.split(/\r?\n/).map((raw, idx) => {
    const lineNo = idx + 1;
    const indent = countIndent(raw, file, lineNo);
    const trimmed = raw.trim();
    const blank = trimmed === "" || trimmed.startsWith("#");
    const content = blank ? "" : stripComment(trimmed);
    return { raw, indent, trimmed, content, lineNo, blank };
  });
}
