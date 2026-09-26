/**
 * @file The fixed predicate vocabulary behind a workflow step's `when`.
 *
 * A condition is one of exactly six shapes — `name`, `not name`,
 * `name is empty`, `name is not empty`, `name == literal`, `name != literal`
 * — parsed once at build time into a typed `WorkflowCondition` and evaluated
 * at runtime against the workflow's variable map. There is deliberately no
 * expression evaluator: NT stays a declarative format, and anything richer
 * belongs in an agent's instructions, not in the wiring between steps.
 */

import { NtError } from "#errors";
import { renderValue } from "#io";
import type { Location, WorkflowCondition } from "#types";

const CONDITION_RE =
  /^(not\s+)?\{?([A-Za-z_][A-Za-z0-9_]*)\}?(?:\s+is\s+(not\s+)?empty|\s*(==|!=)\s*(.+?))?$/;

export const CONDITION_FORMS = [
  "name",
  "not name",
  "name is empty",
  "name is not empty",
  "name == value",
  "name != value",
];

/**
 * Parses one `when` predicate into its typed, canonical form.
 * @param text The raw condition text as written in the step.
 * @param loc Source location used in diagnostics.
 * @returns The typed condition, with `source` holding its canonical spelling.
 */
export function parseCondition(text: string, loc: Location): WorkflowCondition {
  const source = text.trim();
  const match = source.match(CONDITION_RE);
  const unsupported = () =>
    new NtError(
      `step.when '${source}' is not a supported condition (use one of: ${CONDITION_FORMS.join(", ")})`,
      loc,
    );
  if (!match) throw unsupported();
  const [, negated, variable, notEmpty, comparator, rawLiteral] = match;
  if (comparator) {
    if (negated) throw unsupported();
    const value = unquoteLiteral(rawLiteral);
    const op = comparator === "==" ? "equals" : "not_equals";
    return { variable, op, value, source: `${variable} ${comparator} ${quoteLiteral(value)}` };
  }
  if (source.includes(" is ")) {
    if (negated) throw unsupported();
    const op = notEmpty ? "not_empty" : "empty";
    return { variable, op, source: `${variable} is ${notEmpty ? "not " : ""}empty` };
  }
  return negated
    ? { variable, op: "falsy", source: `not ${variable}` }
    : { variable, op: "truthy", source: variable };
}

/**
 * Evaluates a parsed condition against the workflow's current variables.
 * @param condition The typed condition from a step's `when`.
 * @param vars The workflow variable map at the moment the step is reached.
 * @returns Whether the step guarded by this condition should run.
 */
export function evaluateCondition(
  condition: WorkflowCondition,
  vars: Record<string, unknown>,
): boolean {
  const value = vars[condition.variable];
  switch (condition.op) {
    case "truthy":
      return isTruthy(value);
    case "falsy":
      return !isTruthy(value);
    case "empty":
      return isEmpty(value);
    case "not_empty":
      return !isEmpty(value);
    case "equals":
      return renderValue(value) === condition.value;
    case "not_equals":
      return renderValue(value) !== condition.value;
  }
}

/**
 * Determines whether a variable holds nothing worth acting on.
 * @param value A workflow variable value, possibly unset.
 * @returns Whether the value is unset, blank, or an empty list or map.
 */
export function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

function isTruthy(value: unknown): boolean {
  return value !== false && value !== 0 && !isEmpty(value);
}

function unquoteLiteral(raw: string): string {
  const literal = raw.trim();
  const quoted =
    literal.length >= 2 &&
    ((literal.startsWith('"') && literal.endsWith('"')) ||
      (literal.startsWith("'") && literal.endsWith("'")));
  return quoted ? literal.slice(1, -1) : literal;
}

function quoteLiteral(value: string): string {
  return /^[A-Za-z0-9_.-]+$/.test(value) ? value : JSON.stringify(value);
}
