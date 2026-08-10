/**
 * @file VS Code language providers for `.nt` files.
 *
 * Backed by the workspace index: go-to-definition (names and `import` paths),
 * hover (kind, description, location), document symbols (outline), context-aware
 * completion (including statically selected MCP tools), declaration and MCP
 * policy hover, outline, and find-all-references. Provider actions consult only
 * the bounded workspace index; the extension never starts or connects to an MCP
 * server to obtain dynamic catalog information.
 */

const fs = require("node:fs");
const path = require("node:path");
const vscode = require("vscode");
const { scanDefinitions, readBoundedFile, BUILTIN_TOOLS, MAX_SCANNED_FILES } = require("./ntIndex");
const { LIST_KEYS, listContext } = require("./context");

const WORD_RE = /[A-Za-z0-9_.*/-]+/;
const DECL_KEYWORDS = [
  "agent",
  "subagent",
  "sandbox",
  "tool",
  "skill",
  "workflow",
  "provider",
  "mcp",
  "config",
  "import",
];
const NT_GLOB = "**/*.nt";
const NT_EXCLUDE = "**/node_modules/**";

/**
 * Converts an indexed source span into a VS Code location object.
 * @param def A definition descriptor.
 * @returns A VS Code location pointing at the declared name.
 */
function toLocation(def) {
  return new vscode.Location(def.uri, new vscode.Position(def.line, def.start));
}

/**
 * Determines whether path.
 * @param word A token under the cursor.
 * @returns Whether the token looks like an import path rather than a name.
 */
function isPath(word) {
  return word.includes("/") || word.startsWith(".") || word.endsWith(".nt");
}

/**
 * Resolves a quoted NT path relative to its containing source document.
 * @param document The document the path was referenced from.
 * @param word The import path token.
 * @returns A location at the start of the resolved file, or undefined if missing.
 */
function pathLocation(document, word) {
  const target = path.resolve(path.dirname(document.uri.fsPath), word);
  if (!fs.existsSync(target)) return undefined;
  return new vscode.Location(vscode.Uri.file(target), new vscode.Position(0, 0));
}

/**
 * Creates definition navigation for declarations, imports, skills, and dotted MCP tools.
 * @param index The workspace declaration index.
 * @returns A provider that jumps to a name's declaration or an import target.
 */
function definitionProvider(index) {
  return {
    provideDefinition(document, position) {
      const range = document.getWordRangeAtPosition(position, WORD_RE);
      if (!range) return undefined;
      const word = document.getText(range);
      if (isPath(word)) return pathLocation(document, word);
      return index.lookup(word).map(toLocation);
    },
  };
}

/**
 * Builds trusted Markdown for a bounded indexed declaration summary.
 * @param defs Definitions sharing a name.
 * @returns Hover markdown describing each definition and its location.
 */
function hoverMarkdown(defs) {
  const md = new vscode.MarkdownString();
  md.supportHtml = false;
  for (const def of defs) {
    const where = `${vscode.workspace.asRelativePath(def.uri)}:${def.line + 1}`;
    md.appendMarkdown(`**(${def.kind}) ${def.name}**\n\n`);
    if (def.description) md.appendMarkdown(`${def.description}\n\n`);
    md.appendMarkdown(`_defined in ${where}_\n\n`);
  }
  return md;
}

/**
 * Creates hover details for NT declarations, built-ins, and MCP policy entries.
 * @param index The workspace declaration index.
 * @returns A provider that shows an entity's kind, description, and location on hover.
 */
function hoverProvider(index) {
  return {
    provideHover(document, position) {
      const range = document.getWordRangeAtPosition(position, WORD_RE);
      if (!range) return undefined;
      const word = document.getText(range);
      if (isPath(word)) return undefined;
      const defs = index.lookup(word);
      if (defs.length) return new vscode.Hover(hoverMarkdown(defs), range);
      if (BUILTIN_TOOLS[word])
        return new vscode.Hover(new vscode.MarkdownString(BUILTIN_TOOLS[word]), range);
      return undefined;
    },
  };
}

/**
 * Maps each NT declaration kind to its closest VS Code symbol category.
 * @param kind A declaration kind.
 * @returns The VS Code symbol kind used for the outline.
 */
function symbolKind(kind) {
  if (kind === "tool" || kind === "mcp-tool") return vscode.SymbolKind.Function;
  if (kind === "sandbox") return vscode.SymbolKind.Namespace;
  if (kind === "skill") return vscode.SymbolKind.Interface;
  return vscode.SymbolKind.Class;
}

/**
 * Creates a workspace symbol provider backed by the bounded NT index.
 * @returns A provider that lists a file's declarations in the outline.
 */
function symbolProvider() {
  return {
    provideDocumentSymbols(document) {
      return scanDefinitions(document.getText(), document.uri).map(
        (def) =>
          new vscode.SymbolInformation(
            `${def.kind} ${def.name}`,
            symbolKind(def.kind),
            "",
            toLocation(def),
          ),
      );
    },
  };
}

/**
 * Creates a completion item for one indexed declaration name.
 * @param def A definition descriptor.
 * @returns A completion item suggesting that name.
 */
function nameItem(def) {
  const item = new vscode.CompletionItem(def.name, vscode.CompletionItemKind.Reference);
  item.detail = `(${def.kind})`;
  if (def.description) item.documentation = def.description;
  return item;
}

/**
 * Creates context-sensitive completions for NT fields and declaration references.
 * @param index The workspace declaration index.
 * @returns A provider that suggests names in list contexts and keywords at column 0.
 */
function completionProvider(index) {
  return {
    provideCompletionItems(document, position) {
      const section = listContext(document, position);
      if (section) {
        const items = index.ofKinds(LIST_KEYS[section]).map(nameItem);
        if (section === "tools")
          for (const name of Object.keys(BUILTIN_TOOLS)) {
            const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Function);
            item.detail = "(built-in tool)";
            items.push(item);
          }
        return items;
      }
      if (position.character === 0)
        return DECL_KEYWORDS.map(
          (w) => new vscode.CompletionItem(w, vscode.CompletionItemKind.Keyword),
        );
      return undefined;
    },
  };
}

/**
 * Escapes arbitrary declaration names before building a reference-search expression.
 * @param s A string to embed literally in a regular expression.
 * @returns The string with regex metacharacters escaped.
 */
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Creates bounded workspace references for declarations and dotted MCP policies.
 * @returns A provider that finds every occurrence of a name across .nt files.
 */
function referenceProvider() {
  return {
    async provideReferences(document, position) {
      const range = document.getWordRangeAtPosition(position, WORD_RE);
      if (!range) return undefined;
      const word = document.getText(range);
      if (isPath(word)) return undefined;
      const uris = await vscode.workspace.findFiles(NT_GLOB, NT_EXCLUDE, MAX_SCANNED_FILES);
      const locations = [];
      const wordRe = new RegExp(`(?<![A-Za-z0-9_-])${escapeRe(word)}(?![A-Za-z0-9_-])`, "g");
      for (const uri of uris) {
        const text = readBoundedFile(uri.fsPath);
        if (text === null) continue;
        const lines = text.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          wordRe.lastIndex = 0;
          let match;
          while ((match = wordRe.exec(lines[i])))
            locations.push(new vscode.Location(uri, new vscode.Position(i, match.index)));
        }
      }
      return locations;
    },
  };
}

module.exports = {
  definitionProvider,
  hoverProvider,
  symbolProvider,
  completionProvider,
  referenceProvider,
};
