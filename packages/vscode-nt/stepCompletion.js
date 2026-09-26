/**
 * @file Completion items for the fields of a workflow step.
 *
 * Turns the documented step-field vocabulary from `context.js` — including
 * the `for_each`, `when`, and `retry` control flow — into VS Code completion
 * items that insert the field with its colon and carry the field's
 * documentation, so `providers.js` stays focused on wiring providers.
 */

const vscode = require("vscode");
const { STEP_FIELDS } = require("./context");

/**
 * Creates completion items for every workflow step field, documented inline.
 * @returns One item per step field, inserting the field with its colon.
 */
function stepFieldItems() {
  return Object.entries(STEP_FIELDS).map(([key, doc]) => {
    const item = new vscode.CompletionItem(key, vscode.CompletionItemKind.Property);
    item.detail = "(workflow step)";
    item.insertText = `${key}: `;
    item.documentation = new vscode.MarkdownString(doc);
    return item;
  });
}

module.exports = { stepFieldItems };
