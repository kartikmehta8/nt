/**
 * @file The starter templates `nt setup` can write.
 *
 * Names each template, the entry file a scaffolded project is loaded through,
 * and the ordered file list it produces. `getTemplate` is the single place an
 * unknown name is rejected, so every caller reports the same choices.
 */

import { NtError } from "#errors";
import { FULL_FILES } from "#scaffold/full";
import { MINIMAL_FILES } from "#scaffold/minimal";
import type { ScaffoldFile } from "#types";

export const TEMPLATE_NAMES = ["minimal", "full"] as const;

export type TemplateName = (typeof TEMPLATE_NAMES)[number];

export const DEFAULT_TEMPLATE: TemplateName = "minimal";

export const SCAFFOLD_ENTRY_FILE = "age.nt";

export interface Template {
  name: TemplateName;
  description: string;
  entry: string;
  files: ScaffoldFile[];
}

const TEMPLATES: Record<TemplateName, Template> = {
  minimal: {
    name: "minimal",
    description: "One agent and the config it needs, in two files.",
    entry: SCAFFOLD_ENTRY_FILE,
    files: MINIMAL_FILES,
  },
  full: {
    name: "full",
    description: "A wired ecosystem: sandbox, local and MCP tools, skill, subagent, and workflow.",
    entry: SCAFFOLD_ENTRY_FILE,
    files: FULL_FILES,
  },
};

/**
 * Determines whether template name.
 * @param name A candidate template name.
 * @returns Whether the name refers to a known starter template.
 */
function isTemplateName(name: string): name is TemplateName {
  return (TEMPLATE_NAMES as readonly string[]).includes(name);
}

/**
 * Resolves one immutable starter template by its validated public name.
 * @param name The requested template name, or undefined for the default.
 * @returns The matching template, erroring when the name is not one of the known ones.
 */
export function getTemplate(name?: string): Template {
  if (name === undefined) return TEMPLATES[DEFAULT_TEMPLATE];
  if (!isTemplateName(name))
    throw new NtError(
      `unknown template '${name}'; expected one of: ${TEMPLATE_NAMES.join(", ")}`,
      null,
    );
  return TEMPLATES[name];
}
