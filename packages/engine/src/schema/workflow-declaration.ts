/**
 * @file Workflow declaration coercion and step validation.
 *
 * Converts the parser's generic map representation into a typed workflow,
 * validates the workflow-only fields, and checks each step's control flow
 * statically: `for_each` and `when` may only name a declared input or an
 * earlier step's `into`, `for_each` cannot iterate an input declared as a
 * non-list type, and `retry` is a bounded whole number. Prototype-related
 * `into` keys are rejected before runtime state is assembled.
 */

import { MAX_STEP_RETRIES } from "#constants";
import { NtError } from "#errors";
import { isMap, optStr, parseFields, str, warnUnknown } from "#schema/coerce";
import { parseCondition } from "#workflow-condition";
import type { FieldSpec, Location, NtValue, WorkflowDef, WorkflowStep } from "#types";

type Body = Record<string, NtValue>;

export const STEP_FIELDS = ["prompt", "agent", "skill", "into", "for_each", "when", "retry"];

const FORBIDDEN_INTO = ["__proto__", "constructor", "prototype"];
const VARIABLE_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Parses and validates a named workflow declaration.
 *
 * @param name Declaration name supplied by the syntax parser.
 * @param body Raw workflow fields.
 * @param loc Source location used in diagnostics.
 * @param warnings Collector for non-fatal unknown-field warnings.
 * @returns Fully typed workflow definition ready for reference validation.
 */
export function parseWorkflow(
  name: string | null,
  body: Body,
  loc: Location,
  warnings: string[],
): WorkflowDef {
  if (!name) throw new NtError("workflow declaration requires a name", loc);
  warnUnknown(
    body,
    ["description", "agent", "input", "output", "steps"],
    `workflow ${name}`,
    warnings,
  );
  const input = parseFields(body.input, `workflow ${name}.input`, loc, warnings);
  return {
    name,
    description: optStr(body.description, "workflow.description", loc) ?? "",
    agent: optStr(body.agent, "workflow.agent", loc),
    input,
    output: parseFields(body.output, `workflow ${name}.output`, loc, warnings),
    steps: parseSteps(body.steps, name, input, loc, warnings),
    loc,
  };
}

/**
 * Tracks which variable names a step may reference: declared inputs (with
 * their field spec) and the `into` names of every step declared before it.
 */
class KnownVariables {
  private inputs = new Map<string, FieldSpec>();
  private results = new Set<string>();

  constructor(inputs: FieldSpec[]) {
    for (const field of inputs) this.inputs.set(field.name, field);
    this.results.add("message");
  }

  input(name: string): FieldSpec | undefined {
    return this.inputs.get(name);
  }

  has(name: string): boolean {
    return this.inputs.has(name) || this.results.has(name);
  }

  addResult(name: string): void {
    this.results.add(name);
  }
}

/**
 * Coerces the optional step list and validates each step's control flow.
 *
 * @param value Raw `steps` field, when one was declared.
 * @param workflow The workflow name, for diagnostics.
 * @param inputs The workflow's declared input fields.
 * @param loc Workflow source location used in diagnostics.
 * @param warnings Collector for non-fatal unknown-field warnings.
 * @returns Typed steps in declaration order.
 */
function parseSteps(
  value: NtValue | undefined,
  workflow: string,
  inputs: FieldSpec[],
  loc: Location,
  warnings: string[],
): WorkflowStep[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new NtError("workflow.steps must be a list", loc);
  const known = new KnownVariables(inputs);
  return value.map((raw, index) => {
    if (!isMap(raw)) throw new NtError("each workflow step must be a map", loc);
    warnUnknown(raw, STEP_FIELDS, "workflow step", warnings);
    const where = `workflow '${workflow}' step ${index + 1}`;
    const step: WorkflowStep = {
      prompt: optStr(raw.prompt, "step.prompt", loc) ?? undefined,
      agent: optStr(raw.agent, "step.agent", loc) ?? undefined,
      skill: optStr(raw.skill, "step.skill", loc) ?? undefined,
      into: parseInto(raw.into, loc),
      forEach: parseForEach(raw.for_each, known, where, loc),
      when: parseWhen(raw.when, known, where, loc),
      retry: parseRetry(raw.retry, loc),
    };
    if (step.into) known.addResult(step.into);
    return step;
  });
}

function parseInto(value: NtValue | undefined, loc: Location): string | undefined {
  const into = optStr(value, "step.into", loc) ?? undefined;
  if (into && FORBIDDEN_INTO.includes(into))
    throw new NtError(`step.into must not be '${into}'`, loc);
  return into;
}

function parseForEach(
  value: NtValue | undefined,
  known: KnownVariables,
  where: string,
  loc: Location,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  const name = variableName(str(value, "step.for_each", loc), "step.for_each", loc);
  requireKnown(name, known, `${where} for_each`, loc);
  const input = known.input(name);
  if (input && input.type !== "array")
    throw new NtError(
      `${where} for_each '${name}' must be a list, but input '${name}' is declared as ${input.type}`,
      loc,
    );
  return name;
}

function parseWhen(
  value: NtValue | undefined,
  known: KnownVariables,
  where: string,
  loc: Location,
): WorkflowStep["when"] {
  if (value === undefined || value === null) return undefined;
  const condition = parseCondition(str(value, "step.when", loc), loc);
  requireKnown(condition.variable, known, `${where} when`, loc);
  return condition;
}

function parseRetry(value: NtValue | undefined, loc: Location): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > MAX_STEP_RETRIES
  )
    throw new NtError(`step.retry must be a whole number between 0 and ${MAX_STEP_RETRIES}`, loc);
  return value;
}

function variableName(raw: string, ctx: string, loc: Location): string {
  const name = raw.trim().replace(/^\{(.*)\}$/, "$1");
  if (!VARIABLE_RE.test(name))
    throw new NtError(`${ctx} must name a variable, got '${raw.trim()}'`, loc);
  return name;
}

function requireKnown(name: string, known: KnownVariables, ctx: string, loc: Location): void {
  if (!known.has(name))
    throw new NtError(
      `${ctx} references '${name}', which is not a workflow input or an earlier step's into`,
      loc,
    );
}
