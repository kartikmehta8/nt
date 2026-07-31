/**
 * @file JSON-schema construction and prompt templating for agent I/O.
 *
 * Converts declared `FieldSpec[]` into the JSON schema sent to the model
 * (`buildInputSchema` for tools, `buildOutputSchema` for structured agent
 * output) and fills `{name}` placeholders in prompts and tool commands.
 * `interpolate` substitutes raw values for prompts; `interpolateShell` and
 * `interpolateUrl` escape model-supplied values so they cannot inject shell
 * syntax or URL structure. `validateInput` checks supplied arguments against
 * declared fields. `extractJson`/`conformsToOutputSchema` recover and check
 * structured agent output.
 */

import type { FieldSpec, FieldType } from "#types";

/**
 * @param t A declared field type.
 * @returns The matching JSON-schema fragment.
 */
function jsonType(t: FieldType): Record<string, unknown> {
  switch (t) {
    case "number":
      return { type: "number" };
    case "boolean":
      return { type: "boolean" };
    case "object":
      return { type: "object" };
    case "array":
      return { type: "array", items: { type: "string" } };
    default:
      return { type: "string" };
  }
}

/**
 * @param fields The tool/agent input fields.
 * @returns A JSON schema describing the input object, with declared required fields.
 */
export function buildInputSchema(fields: FieldSpec[]): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const f of fields) {
    const schema = jsonType(f.type);
    if (f.description) schema.description = f.description;
    properties[f.name] = schema;
    if (f.required) required.push(f.name);
  }
  return { type: "object", properties, required, additionalProperties: false };
}

/**
 * @param fields The agent output fields.
 * @returns A strict JSON schema where every field is required, for structured output.
 */
export function buildOutputSchema(fields: FieldSpec[]): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const f of fields) properties[f.name] = jsonType(f.type);
  return {
    type: "object",
    properties,
    required: fields.map((f) => f.name),
    additionalProperties: false,
  };
}

/**
 * @param value A supplied argument value.
 * @param type The declared field type.
 * @returns Whether the value matches the declared type.
 */
function matchesType(value: unknown, type: FieldType): boolean {
  if (type === "array") return Array.isArray(value);
  if (type === "object")
    return typeof value === "object" && value !== null && !Array.isArray(value);
  return typeof value === type;
}

/**
 * Enforces the contract the emitted JSON schema declares — unknown keys
 * rejected, array items strings — so nothing an untrusted model supplies
 * outside the declared shape reaches shell commands, URLs, or request bodies.
 *
 * @param fields The declared input fields.
 * @param input The supplied arguments.
 * @returns An error message when the input does not match the declared fields, else null.
 */
export function validateInput(fields: FieldSpec[], input: Record<string, unknown>): string | null {
  const declared = new Set(fields.map((f) => f.name));
  for (const key of Object.keys(input)) {
    if (!declared.has(key)) return `unknown field '${key}' is not declared`;
  }
  for (const f of fields) {
    const value = input[f.name];
    if (value === undefined || value === null) {
      if (f.required) return `missing required field '${f.name}'`;
      continue;
    }
    if (!matchesType(value, f.type)) return `field '${f.name}' must be of type ${f.type}`;
    if (f.type === "array" && !(value as unknown[]).every((el) => typeof el === "string"))
      return `field '${f.name}' must be an array of strings`;
  }
  return null;
}

/**
 * @param template A string containing `{name}` placeholders.
 * @param vars Values to substitute; unknown placeholders are left intact.
 * @returns The template with known placeholders replaced.
 */
export function interpolate(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (_m, key) =>
    key in vars ? String(vars[key]) : `{${key}}`,
  );
}

/**
 * @param value A model-supplied value destined for a shell command.
 * @returns The value wrapped in single quotes so it is passed as one literal word.
 */
export function shellQuote(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

/**
 * @param template A shell command template containing `{name}` placeholders.
 * @param vars Model-supplied values; each is single-quoted before substitution.
 * @returns The command with placeholders replaced by shell-safe literals.
 */
export function interpolateShell(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (_m, key) =>
    key in vars ? shellQuote(String(vars[key])) : `{${key}}`,
  );
}

/**
 * @param template A URL template containing `{name}` placeholders.
 * @param vars Model-supplied values; each is percent-encoded before substitution.
 * @returns The URL with placeholders replaced by encoded components.
 */
export function interpolateUrl(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (_m, key) =>
    key in vars ? encodeURIComponent(String(vars[key])) : `{${key}}`,
  );
}

/**
 * @param text Assistant text that should contain a JSON object.
 * @returns The parsed object from the raw text, a fenced block, or the outermost braces; null when none parses.
 */
export function extractJson(text: string): Record<string, unknown> | null {
  const candidates = [text.trim()];
  const fenced = text.match(/```(?:json)?\s*\n([\s\S]*?)\n\s*```/);
  if (fenced) candidates.push(fenced[1].trim());
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) candidates.push(text.slice(first, last + 1));
  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed))
        return parsed as Record<string, unknown>;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * @param value A parsed candidate output object.
 * @param schema The JSON schema built from the agent's declared `output:` fields.
 * @returns Whether every required field is present and each present field matches its declared type.
 */
export function conformsToOutputSchema(
  value: Record<string, unknown>,
  schema: Record<string, unknown>,
): boolean {
  const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
  const properties = (schema.properties ?? {}) as Record<
    string,
    { type?: string; items?: { type?: string } }
  >;
  for (const name of required) if (value[name] === undefined) return false;
  for (const [name, spec] of Object.entries(properties)) {
    const v = value[name];
    if (v === undefined || !spec.type) continue;
    if (spec.type === "array") {
      if (!Array.isArray(v)) return false;
      const itemType = spec.items?.type;
      if (itemType && !v.every((el) => typeof el === itemType)) return false;
      continue;
    }
    if (spec.type === "object" && (typeof v !== "object" || v === null || Array.isArray(v)))
      return false;
    if (["string", "number", "boolean"].includes(spec.type) && typeof v !== spec.type) return false;
  }
  return true;
}
