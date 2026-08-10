/**
 * @file Minimal presentation tokenizer for the homepage NT preview.
 *
 * Recognizes declaration keywords, keys, values, lists, comments, environment
 * references, and block-scalar bodies solely to assign CSS classes. It is not a
 * validator and intentionally remains independent from the engine parser so the
 * docs client bundle never ships runtime language or MCP behavior.
 */

export interface HighlightSegment {
  t: string;
  c: string | null;
}

const KEYWORDS = [
  "import",
  "config",
  "provider",
  "agent",
  "subagent",
  "sandbox",
  "tool",
  "mcp",
  "skill",
  "workflow",
];

/**
 * Appends value to its bounded destination.
 * @param value Source text following a field separator.
 * @param segments Mutable line segments receiving presentation classes.
 * @returns Nothing; parsed spans are appended to `segments`.
 */
function pushValue(value: string, segments: HighlightSegment[]): void {
  if (value === "") return;
  const leading = value.match(/^\s*/)?.[0] ?? "";
  if (leading) segments.push({ t: leading, c: null });
  const content = value.slice(leading.length);
  if (content === "") return;
  if (content === "|") segments.push({ t: "|", c: "p" });
  else if (/^\d+$/.test(content)) segments.push({ t: content, c: "num" });
  else if (content.startsWith("env(")) segments.push({ t: content, c: "fn" });
  else segments.push({ t: content, c: "s" });
}

/**
 * Appends content to its bounded destination.
 * @param content De-indented declaration, field, list item, or plain text.
 * @param segments Mutable line segments receiving presentation classes.
 * @returns Nothing; parsed spans are appended to `segments`.
 */
function pushContent(content: string, segments: HighlightSegment[]): void {
  const firstWord = content.split(/\s/)[0];
  if (
    KEYWORDS.includes(firstWord) &&
    (content.length === firstWord.length || content[firstWord.length] === " ")
  ) {
    segments.push({ t: firstWord, c: "k" });
    const remainder = content.slice(firstWord.length);
    if (remainder) segments.push({ t: remainder, c: firstWord === "import" ? "s" : "n" });
    return;
  }
  const field = content.match(/^([A-Za-z0-9_-]+)(:)(.*)$/);
  if (field) {
    segments.push({ t: field[1], c: "key" });
    segments.push({ t: ":", c: "p" });
    pushValue(field[3], segments);
    return;
  }
  segments.push({ t: content, c: null });
}

/**
 * Returns ordered presentation segments covering the complete line.
 * @param line One NT source line including indentation.
 * @returns Ordered presentation segments covering the complete line.
 */
function highlightLine(line: string): HighlightSegment[] {
  const segments: HighlightSegment[] = [];
  const indentation = line.match(/^\s*/)?.[0] ?? "";
  if (indentation) segments.push({ t: indentation, c: null });
  let remainder = line.slice(indentation.length);
  if (remainder === "") return segments;
  if (remainder.startsWith("#")) return [...segments, { t: remainder, c: "c" }];
  let comment: string | null = null;
  const commentIndex = remainder.search(/\s#/);
  if (commentIndex !== -1) {
    comment = remainder.slice(commentIndex);
    remainder = remainder.slice(0, commentIndex);
  }
  if (remainder.startsWith("- ")) {
    segments.push({ t: "- ", c: "p" });
    pushContent(remainder.slice(2), segments);
  } else {
    pushContent(remainder, segments);
  }
  if (comment) segments.push({ t: comment, c: "c" });
  return segments;
}

/**
 * Scans preview into the structures used by later processing.
 * @param code Complete NT source displayed in the preview.
 * @returns Styled segments per line, preserving block-scalar bodies as text.
 */
export function tokenizePreview(code: string): HighlightSegment[][] {
  const output: HighlightSegment[][] = [];
  let blockIndent: number | null = null;
  for (const line of code.split("\n")) {
    const indent = (line.match(/^\s*/)?.[0] ?? "").length;
    const trimmed = line.trim();
    if (blockIndent !== null) {
      if (trimmed === "") {
        output.push([{ t: line, c: null }]);
        continue;
      }
      if (indent > blockIndent) {
        output.push([{ t: line, c: "blk" }]);
        continue;
      }
      blockIndent = null;
    }
    output.push(highlightLine(line));
    if (/:\s*\|\s*$/.test(line)) blockIndent = indent;
  }
  return output;
}
