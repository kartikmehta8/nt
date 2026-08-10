/**
 * @file Writes a starter template to disk for `nt setup`.
 *
 * Creates the target folder, then writes each template file exactly once:
 * existing files are reported as skipped rather than clobbered, unless `force`
 * is set. Writes are opened with the exclusive flag so a file appearing between
 * the check and the write is still never overwritten, and every template path
 * is confirmed to resolve inside the target folder before anything is created.
 */

import * as fs from "node:fs";
import * as nodePath from "node:path";
import { NtError } from "#errors";
import { getTemplate, type TemplateName } from "#scaffold/templates";

export interface ScaffoldOptions {
  template?: string;
  force?: boolean;
}

export interface ScaffoldResult {
  dir: string;
  template: TemplateName;
  entry: string;
  created: string[];
  skipped: string[];
}

/**
 * Creates a destination directory only when it does not already exist.
 * @param dir The absolute target folder for the new project.
 */
function ensureDirectory(dir: string): void {
  if (fs.existsSync(dir) && !fs.statSync(dir).isDirectory())
    throw new NtError(`cannot set up a project in ${dir}: it is a file, not a folder`, null);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    throw new NtError(`cannot create folder ${dir}: ${(e as Error).message}`, null);
  }
}

/**
 * Returns the absolute path to write, erroring if it would escape the folder.
 * @param dir The absolute target folder.
 * @param relative A template-declared path relative to that folder.
 * @returns The absolute path to write, erroring if it would escape the folder.
 */
function targetPath(dir: string, relative: string): string {
  const full = nodePath.resolve(dir, relative);
  const rel = nodePath.relative(dir, full);
  if (rel === "" || rel.startsWith("..") || nodePath.isAbsolute(rel))
    throw new NtError(`template file '${relative}' escapes the project folder`, null);
  return full;
}

/**
 * Persists file to its configured destination.
 * @param full The absolute path to write.
 * @param content The file contents.
 * @param force Whether an existing file may be overwritten.
 * @returns Whether the file was written; false when it already existed and was left alone.
 */
function writeFile(full: string, content: string, force: boolean): boolean {
  try {
    fs.mkdirSync(nodePath.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, { encoding: "utf8", flag: force ? "w" : "wx" });
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw new NtError(`cannot write ${full}: ${(e as Error).message}`, null);
  }
}

/**
 * Returns where the project was written, which files were created, and which were left alone.
 * @param dir The folder to scaffold into; created when missing.
 * @param options The template to write and whether existing files may be overwritten.
 * @returns Where the project was written, which files were created, and which were left alone.
 */
export function scaffoldProject(dir: string, options: ScaffoldOptions = {}): ScaffoldResult {
  const template = getTemplate(options.template);
  const root = nodePath.resolve(dir);
  const planned = template.files.map((file) => ({ ...file, full: targetPath(root, file.path) }));
  ensureDirectory(root);
  const created: string[] = [];
  const skipped: string[] = [];
  for (const file of planned)
    (writeFile(file.full, file.content, options.force === true) ? created : skipped).push(
      file.path,
    );
  return {
    dir: root,
    template: template.name,
    entry: targetPath(root, template.entry),
    created,
    skipped,
  };
}
