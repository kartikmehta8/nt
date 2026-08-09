/**
 * @file Repository-wide executable checks for NT's source conventions.
 *
 * Scans hand-authored JavaScript and TypeScript across packages, documentation,
 * and scripts while excluding generated and build output. It enforces the
 * reviewability rules documented in `CLAUDE.md`: focused file sizes, useful
 * multiline file headers, JSDoc-only comments, and complete documentation for
 * exported functions and public methods. Any violation fails CI with locations.
 */

import * as fs from "node:fs";
import * as nodePath from "node:path";
import ts from "typescript";

const ROOTS = ["packages", "apps/docs", "scripts"];
const ROOT_FILES = ["commitlint.config.mjs", "eslint.config.mjs"];
const CODE_FILE = /\.(?:js|mjs|mts|ts|tsx)$/;
const SKIP_DIRECTORIES = new Set([".next", ".source", "dist", "node_modules"]);
const MAX_LINES = 250;
const MIN_FILE_WORDS = 20;
const failures = [];

/**
 * Recursively collects source files while excluding generated directories.
 *
 * @param directory Repository-relative directory to inspect.
 * @returns Hand-authored source paths in stable lexical order.
 */
function collectFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (SKIP_DIRECTORIES.has(entry.name)) continue;
    const file = nodePath.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectFiles(file));
    else if (CODE_FILE.test(file) && !file.endsWith("next-env.d.ts")) files.push(file);
  }
  return files.sort();
}

/**
 * Records one actionable convention failure.
 *
 * @param file Source file containing the violation.
 * @param line One-based line number, or zero for a whole-file failure.
 * @param message Explanation of the required correction.
 * @returns Nothing; the diagnostic is appended to the shared result list.
 */
function fail(file, line, message) {
  failures.push(`${file}${line ? `:${line}` : ""} ${message}`);
}

/**
 * Counts visible source lines without treating the final newline as empty code.
 *
 * @param source Complete file contents.
 * @returns Number of lines an editor displays.
 */
function lineCount(source) {
  return source === "" ? 0 : source.replace(/\r?\n$/, "").split(/\r?\n/).length;
}

/**
 * Converts an absolute character offset to a one-based line number.
 *
 * @param source Complete file contents.
 * @param offset Character offset reported by the TypeScript parser.
 * @returns One-based line containing the offset.
 */
function lineAt(source, offset) {
  return source.slice(0, offset).split(/\r?\n/).length;
}

/**
 * Finds the nearest leading JSDoc attached to a syntax node.
 *
 * @param source Complete file contents.
 * @param node TypeScript syntax node being documented.
 * @returns Raw JSDoc text, or an empty string when no block is attached.
 */
function leadingJsdoc(source, node) {
  return (
    (ts.getLeadingCommentRanges(source, node.pos) ?? [])
      .map((range) => source.slice(range.pos, range.end))
      .filter((comment) => comment.startsWith("/**"))
      .at(-1) ?? ""
  );
}

/**
 * Extracts identifier names from ordinary and destructured parameters.
 *
 * @param name Parameter binding name.
 * @returns Individual identifiers that need `@param` documentation.
 */
function bindingNames(name) {
  if (ts.isIdentifier(name)) return [name.text];
  const names = [];
  for (const element of name.elements) {
    if (ts.isOmittedExpression(element)) continue;
    names.push(...bindingNames(element.name));
  }
  return names;
}

/**
 * Removes delimiters and tags to determine whether JSDoc contains real prose.
 *
 * @param comment Raw JSDoc block.
 * @returns Human explanation with tag lines removed.
 */
function prose(comment) {
  const lines = comment
    .replace(/^\/\*\*/, "")
    .replace(/\*\/$/, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\*\s?/, "").trim());
  const firstTag = lines.findIndex((line) => line.startsWith("@"));
  return lines
    .slice(0, firstTag < 0 ? undefined : firstTag)
    .filter((line) => line !== "")
    .join(" ")
    .trim();
}

/**
 * Validates the documentation contract for one callable declaration.
 *
 * @param file Source path used in diagnostics.
 * @param source Complete file contents.
 * @param node Function, constructor, accessor, or method node.
 * @param requireReturns Whether an `@returns` contract is required.
 * @param commentNode Syntax node that owns the callable's leading JSDoc.
 * @returns Nothing; every discovered violation is recorded.
 */
function checkCallable(file, source, node, requireReturns = true, commentNode = node) {
  const comment = leadingJsdoc(source, commentNode);
  const line = lineAt(source, node.getStart());
  if (!comment) {
    fail(file, line, "exported/public callable needs JSDoc");
    return;
  }
  if (!prose(comment)) fail(file, line, "callable JSDoc needs an explanatory sentence");
  for (const parameter of node.parameters ?? [])
    for (const name of bindingNames(parameter.name))
      if (!comment.includes(`@param ${name}`))
        fail(file, line, `callable JSDoc is missing @param ${name}`);
  if (requireReturns && !comment.includes("@returns"))
    fail(file, line, "callable JSDoc is missing @returns");
}

/**
 * Determines whether a declaration is exported from its module.
 *
 * @param node Declaration with optional TypeScript modifiers.
 * @returns Whether the declaration carries the `export` modifier.
 */
function isExported(node) {
  return node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

/**
 * Checks exported functions and public members of exported classes.
 *
 * @param file Source path used in diagnostics.
 * @param source Complete file contents.
 * @returns Nothing; documentation failures are appended to the shared list.
 */
function checkExports(file, source) {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  const commonJs = file.endsWith(".js");
  for (const node of sourceFile.statements) {
    if (ts.isFunctionDeclaration(node) && (commonJs || isExported(node)))
      checkCallable(file, source, node);
    if (ts.isVariableStatement(node) && isExported(node))
      for (const declaration of node.declarationList.declarations)
        if (
          ts.isArrowFunction(declaration.initializer) ||
          ts.isFunctionExpression(declaration.initializer)
        )
          checkCallable(file, source, declaration.initializer, true, node);
    if (!ts.isClassDeclaration(node) || (!commonJs && !isExported(node))) continue;
    for (const member of node.members) {
      const hidden = member.modifiers?.some((modifier) =>
        [ts.SyntaxKind.PrivateKeyword, ts.SyntaxKind.ProtectedKeyword].includes(modifier.kind),
      );
      if (hidden) continue;
      if (ts.isConstructorDeclaration(member)) checkCallable(file, source, member, false);
      else if (
        ts.isMethodDeclaration(member) ||
        ts.isGetAccessorDeclaration(member) ||
        ts.isSetAccessorDeclaration(member)
      )
        checkCallable(file, source, member, !ts.isSetAccessorDeclaration(member));
    }
  }
}

/**
 * Checks file-level structure, comment style, size, and public API docs.
 *
 * @param file Hand-authored source path.
 * @returns Nothing; violations are accumulated for one final report.
 */
function checkFile(file) {
  const source = fs.readFileSync(file, "utf8");
  const lines = lineCount(source);
  if (lines > MAX_LINES) fail(file, 0, `has ${lines} lines; maximum is ${MAX_LINES}`);
  const body = source.replace(/^#![^\n]*\n/, "");
  const header = body.match(/^\/\*\*\s*\n([\s\S]*?)\*\//)?.[0];
  if (!header?.includes("@file")) fail(file, 1, "must open with a multiline @file JSDoc block");
  else {
    const words = header
      .replace(/[^A-Za-z0-9_-]+/g, " ")
      .trim()
      .split(/\s+/).length;
    if (words < MIN_FILE_WORDS)
      fail(file, 1, `@file block needs a useful explanation (${words}/${MIN_FILE_WORDS} words)`);
  }
  for (const match of source.matchAll(/^\s*\/\*\*[^\n]*\*\/\s*$/gm))
    fail(file, lineAt(source, match.index), "one-line JSDoc is not descriptive enough");
  for (const match of source.matchAll(/^\s*\/\/(?!\/).*$/gm))
    fail(file, lineAt(source, match.index), "use JSDoc instead of a line comment");
  checkExports(file, source);
}

for (const file of [...ROOTS.flatMap(collectFiles), ...ROOT_FILES].sort()) checkFile(file);
if (failures.length) {
  process.stderr.write(`Code convention check failed:\n${failures.join("\n")}\n`);
  process.exitCode = 1;
} else process.stdout.write("Code conventions verified.\n");
