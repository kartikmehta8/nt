/**
 * @file Entry point for the NT VS Code extension.
 *
 * On activation it builds the workspace declaration index, registers the
 * definition/hover/symbol/completion/reference providers, and keeps the index
 * current through document edits and a `.nt` filesystem watcher.
 */

const vscode = require("vscode");
const { NtIndex } = require("./ntIndex");
const providers = require("./providers");

const SELECTOR = { language: "nt" };
const NT_GLOB = "**/*.nt";
const NT_EXCLUDE = "**/node_modules/**";

/**
 * Activates the NT language features and keeps the workspace index synchronized.
 * @param context The extension context provided by VS Code.
 * @returns A promise that settles after indexing and provider registration.
 */
async function activate(context) {
  const index = new NtIndex();
  const findFiles = () => vscode.workspace.findFiles(NT_GLOB, NT_EXCLUDE);
  await index.refresh(findFiles);

  const reindexDoc = (document) => {
    if (document.languageId === "nt") index.updateDoc(document.uri, document.getText());
  };
  const reindexAll = () => index.refresh(findFiles);

  const watcher = vscode.workspace.createFileSystemWatcher(NT_GLOB);
  watcher.onDidChange(reindexAll);
  watcher.onDidCreate(reindexAll);
  watcher.onDidDelete(reindexAll);

  context.subscriptions.push(
    watcher,
    vscode.languages.registerDefinitionProvider(SELECTOR, providers.definitionProvider(index)),
    vscode.languages.registerHoverProvider(SELECTOR, providers.hoverProvider(index)),
    vscode.languages.registerDocumentSymbolProvider(SELECTOR, providers.symbolProvider()),
    vscode.languages.registerReferenceProvider(SELECTOR, providers.referenceProvider()),
    vscode.languages.registerCompletionItemProvider(SELECTOR, providers.completionProvider(index)),
    vscode.workspace.onDidChangeTextDocument((e) => reindexDoc(e.document)),
    vscode.workspace.onDidOpenTextDocument(reindexDoc),
  );
}

/**
 * Releases no additional state because every registration is owned by the
 * extension context and disposed by VS Code.
 *
 * @returns Nothing; VS Code performs subscription cleanup.
 */
function deactivate() {}

module.exports = { activate, deactivate };
