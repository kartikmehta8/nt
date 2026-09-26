/**
 * @file Pure completion-context parser for the NT VS Code extension.
 *
 * Determines whether a cursor sits in a block or flow-style reference field
 * and maps that field to the declaration kinds that may be suggested, and
 * recognizes the key position of a workflow step so its fields — including
 * the `for_each`, `when`, and `retry` control flow — can be completed and
 * documented on hover. MCP servers and selected MCP policies participate only
 * as indexed source symbols; this module imports no editor API and never
 * connects to an MCP server, which keeps it directly testable in Node.
 */

const LIST_KEYS = {
  tools: ["tool", "mcp-tool"],
  subagents: ["subagent"],
  skills: ["skill"],
  sandbox: ["sandbox"],
  agent: ["agent", "subagent"],
  skill: ["skill"],
};

const STEP_FIELDS = {
  agent: "Which agent or subagent runs this step. Falls back to the workflow's `agent`.",
  prompt:
    "What to ask. `{name}` inserts a workflow input or an earlier step's `into`; under `for_each`, `{item}` and `{index}` are the current element and its position.",
  skill: "A skill whose instructions are applied ahead of this step's prompt.",
  into: "The variable this step's result is saved under. A `for_each` step saves a list.",
  for_each:
    "Run this step once per element of the named list — up to 4 in parallel — and save the results in input order. Names a workflow input or an earlier step's `into`.",
  when: "Run this step only when the condition holds: `name`, `not name`, `name is empty`, `name is not empty`, `name == value`, or `name != value`. A skipped step leaves its `into` unset.",
  retry:
    "Extra attempts (0–5) to make when the step errors or its agent returns no structured output. The workflow fails once the budget is spent.",
};

/**
 * Detects the NT syntactic context surrounding the editor cursor.
 * @param document A document exposing `lineAt(index).text`.
 * @param position A zero-based line and character position.
 * @returns The reference field surrounding the cursor, or undefined.
 */
function listContext(document, position) {
  const line = document.lineAt(position.line).text;
  const inline = line.match(/^\s*(tools|subagents|skills):\s*\[[^\]]*$/);
  if (inline) return inline[1];
  const scalar = line.match(/^\s*(?:-\s+)?(sandbox|agent|skill):\s*\S*$/);
  if (scalar) return scalar[1];
  const indent = line.search(/\S|$/);
  for (let index = position.line - 1; index >= 0; index--) {
    const previous = document.lineAt(index).text;
    if (previous.trim() === "") continue;
    const previousIndent = previous.search(/\S|$/);
    const key = previous.match(/^\s*(tools|subagents|skills):\s*$/);
    if (key && previousIndent < indent) return key[1];
    if (previousIndent < indent) return undefined;
  }
  return undefined;
}

/**
 * Walks upward from a key column to decide whether it belongs to a `steps:` list item.
 * @param document A document exposing `lineAt(index).text`.
 * @param lineIndex The zero-based line holding the key.
 * @param column The column the key starts at (after any `- ` list marker).
 * @returns Whether the nearest enclosing key above that column is `steps:`.
 */
function inStepsBlock(document, lineIndex, column) {
  let expected = column;
  for (let index = lineIndex - 1; index >= 0; index--) {
    const text = document.lineAt(index).text;
    if (text.trim() === "") continue;
    const indent = text.search(/\S|$/);
    if (/^\s*-(\s|$)/.test(text) && indent + 2 === expected) {
      expected = indent;
      continue;
    }
    if (indent >= expected) continue;
    return /^\s*steps:\s*$/.test(text);
  }
  return false;
}

/**
 * Detects a cursor typing the key of a workflow step.
 * @param document A document exposing `lineAt(index).text`.
 * @param position A zero-based line and character position.
 * @returns Whether step fields should be suggested at the cursor.
 */
function stepKeyContext(document, position) {
  const typed = document.lineAt(position.line).text.slice(0, position.character);
  const match = typed.match(/^(\s*)(-\s+)?([A-Za-z_]*)$/);
  if (!match) return false;
  return inStepsBlock(document, position.line, match[1].length + (match[2] ? 2 : 0));
}

/**
 * Names the workflow step field declared on a line, when the line is one.
 * @param document A document exposing `lineAt(index).text`.
 * @param lineIndex The zero-based line to inspect.
 * @returns The step field name on that line, or undefined outside a `steps:` list.
 */
function stepFieldAt(document, lineIndex) {
  const match = document.lineAt(lineIndex).text.match(/^(\s*)(-\s+)?([A-Za-z_]+)\s*:/);
  if (!match || !(match[3] in STEP_FIELDS)) return undefined;
  const column = match[1].length + (match[2] ? 2 : 0);
  return inStepsBlock(document, lineIndex, column) ? match[3] : undefined;
}

module.exports = { LIST_KEYS, STEP_FIELDS, listContext, stepKeyContext, stepFieldAt };
