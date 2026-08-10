/**
 * @file Workflow declaration coercion and step validation.
 *
 * Converts the parser's generic map representation into a typed workflow,
 * validates the workflow-only fields, and rejects prototype-related `into`
 * keys before runtime state is assembled. The parser is kept separate from
 * other declarations so each schema module stays focused and reviewable.
 */

import { NtError } from "#errors";
import { isMap, optStr, parseFields, warnUnknown } from "#schema/coerce";
import type { Location, NtValue, WorkflowDef, WorkflowStep } from "#types";

type Body = Record<string, NtValue>;

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
  return {
    name,
    description: optStr(body.description, "workflow.description", loc) ?? "",
    agent: optStr(body.agent, "workflow.agent", loc),
    input: parseFields(body.input, `workflow ${name}.input`, loc, warnings),
    output: parseFields(body.output, `workflow ${name}.output`, loc, warnings),
    steps: parseSteps(body.steps, loc, warnings),
    loc,
  };
}

/**
 * Coerces the optional step list and protects state assignment keys.
 *
 * @param value Raw `steps` field, when one was declared.
 * @param loc Workflow source location used in diagnostics.
 * @param warnings Collector for non-fatal unknown-field warnings.
 * @returns Typed steps in declaration order.
 */
function parseSteps(value: NtValue | undefined, loc: Location, warnings: string[]): WorkflowStep[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new NtError("workflow.steps must be a list", loc);
  return value.map((step) => {
    if (!isMap(step)) throw new NtError("each workflow step must be a map", loc);
    warnUnknown(step, ["prompt", "agent", "skill", "into"], "workflow step", warnings);
    const into = optStr(step.into, "step.into", loc) ?? undefined;
    if (into && ["__proto__", "constructor", "prototype"].includes(into))
      throw new NtError(`step.into must not be '${into}'`, loc);
    return {
      prompt: optStr(step.prompt, "step.prompt", loc) ?? undefined,
      agent: optStr(step.agent, "step.agent", loc) ?? undefined,
      skill: optStr(step.skill, "step.skill", loc) ?? undefined,
      into,
    };
  });
}
