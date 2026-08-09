/**
 * @file Static MCP tool-policy indexing for the NT VS Code extension.
 *
 * Extracts block and flow-style `tools` selections from an MCP declaration so
 * definition, hover, and completion features can understand dotted references
 * without starting a server. The scanner stays source-only and records approval
 * metadata when it is explicitly present in the declaration.
 */

/**
 * Adds statically selected MCP tools to a workspace definition collection.
 *
 * @param lines All lines of the containing NT source file.
 * @param declarationLine Zero-based MCP declaration line.
 * @param server Declared server name used to namespace tool references.
 * @param uri URI stored on each discovered symbol.
 * @param defs Mutable definition collection receiving MCP policy entries.
 * @returns Nothing; matching policies are appended in source order.
 */
function scanMcpToolPolicies(lines, declarationLine, server, uri, defs) {
  let toolsIndent = -1;
  for (let i = declarationLine + 1; i < lines.length && !/^\S/.test(lines[i]); i++) {
    const flow = lines[i].match(/^(\s*)tools:\s*\[([^\]]*)\]\s*$/);
    if (flow) {
      for (const item of flow[2].split(",")) {
        const remote = item.trim().replace(/^(?:"([^"]+)"|'([^']+)'|([^\s]+))$/, "$1$2$3");
        if (!remote) continue;
        const start = lines[i].indexOf(remote);
        defs.push({
          kind: "mcp-tool",
          name: `${server}.${remote}`,
          uri,
          line: i,
          start,
          end: start + remote.length,
          description: "MCP tool policy — approval required",
        });
      }
      continue;
    }
    const tools = lines[i].match(/^(\s*)tools:\s*$/);
    if (tools) {
      toolsIndent = tools[1].length;
      continue;
    }
    if (toolsIndent < 0) continue;
    const match = lines[i].match(/^(\s*)(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_.*-]+)):\s*$/);
    if (!match || match[1].length !== toolsIndent + 2) continue;
    const remote = match[2] ?? match[3] ?? match[4];
    const start = lines[i].indexOf(remote);
    let approval = "required";
    for (
      let j = i + 1;
      j < lines.length && (lines[j].trim() === "" || lines[j].search(/\S|$/) > match[1].length);
      j++
    ) {
      const policy = lines[j].match(/^\s*approval:\s*(required|once|never)/);
      if (policy) approval = policy[1];
    }
    defs.push({
      kind: "mcp-tool",
      name: `${server}.${remote}`,
      uri,
      line: i,
      start,
      end: start + remote.length,
      description: `MCP tool policy — approval ${approval}`,
    });
  }
}

module.exports = { scanMcpToolPolicies };
