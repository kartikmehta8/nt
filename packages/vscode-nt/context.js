/**
 * @file Pure completion-context parser for the NT VS Code extension.
 *
 * Determines whether a cursor sits in a block or flow-style reference field
 * and maps that field to the declaration kinds that may be suggested. MCP
 * servers and selected MCP policies participate only as indexed source symbols;
 * this module imports no editor API and never connects to an MCP server, which
 * keeps it directly testable in Node.
 */

const LIST_KEYS = {
  tools: ["tool", "mcp", "mcp-tool"],
  subagents: ["subagent"],
  skills: ["skill"],
  sandbox: ["sandbox"],
};

/**
 * Detects the NT syntactic context surrounding the editor cursor.
 * @param document A document exposing `lineAt(index).text`.
 * @param position A zero-based line and character position.
 * @returns The reference-list field surrounding the cursor, or undefined.
 */
function listContext(document, position) {
  const line = document.lineAt(position.line).text;
  const inline = line.match(/^\s*(tools|subagents|skills):\s*\[[^\]]*$/);
  if (inline) return inline[1];
  const scalar = line.match(/^\s*(sandbox):\s*\S*$/);
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

module.exports = { LIST_KEYS, listContext };
