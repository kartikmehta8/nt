/**
 * @file Coercion and validation helpers for interpreting parsed blocks.
 *
 * Type guards (`isMap`, `isEnvRef`), env resolution, scalar/number/list
 * accessors that raise located `NtError`s, unknown-field warnings, and the
 * shared `parseThinking` and `parseFields` used by every declaration parser.
 */

import { THINKING_LEVELS } from "#constants";
import { NtError } from "#errors";
import type { EnvRef, FieldSpec, FieldType, Location, NtValue, ThinkingLevel } from "#types";

/**
 * @param v A parsed value.
 * @returns Whether the value is a plain key/value map.
 */
export function isMap(v: NtValue): v is Record<string, NtValue> {
  return typeof v === "object" && v !== null && !Array.isArray(v) && !("__env" in (v as object));
}

/**
 * @param v A parsed value.
 * @returns Whether the value is an `env(...)` reference.
 */
export function isEnvRef(v: NtValue): v is EnvRef {
  return typeof v === "object" && v !== null && "__env" in (v as object);
}

/**
 * @param v An env reference or scalar.
 * @returns The resolved environment value, or the passed-through scalar.
 */
export function resolveEnv(v: NtValue): NtValue {
  if (!isEnvRef(v)) return v;
  const value = process.env[v.__env];
  return value !== undefined && value !== "" ? value : (v.default ?? "");
}

/**
 * @param v The value to coerce.
 * @param ctx Field description for error messages.
 * @param loc Source location for error messages.
 * @returns The value as a string, erroring on non-scalars.
 */
export function str(v: NtValue | undefined, ctx: string, loc: Location): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  throw new NtError(`${ctx} must be a string`, loc);
}

/**
 * @param v The value to coerce, if present.
 * @param ctx Field description for error messages.
 * @param loc Source location for error messages.
 * @returns The string value, or null when absent.
 */
export function optStr(v: NtValue | undefined, ctx: string, loc: Location): string | null {
  return v === undefined || v === null ? null : str(v, ctx, loc);
}

/**
 * @param v The value to coerce, if present.
 * @param ctx Field description for error messages.
 * @param loc Source location for error messages.
 * @returns The numeric value, or null when absent.
 */
export function optNum(v: NtValue | undefined, ctx: string, loc: Location): number | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "number") return v;
  throw new NtError(`${ctx} must be a number`, loc);
}

/**
 * @param v The value to coerce, if present.
 * @param ctx Field description for error messages.
 * @param loc Source location for error messages.
 * @returns The list coerced to strings, or an empty array when absent.
 */
export function strList(v: NtValue | undefined, ctx: string, loc: Location): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new NtError(`${ctx} must be a list`, loc);
  return v.map((x, i) => str(x, `${ctx}[${i}]`, loc));
}

/**
 * @param body The block body being interpreted.
 * @param allowed The set of recognized field names.
 * @param ctx Block description for the warning text.
 * @param warnings Accumulator that receives one message per unknown field.
 */
export function warnUnknown(
  body: Record<string, NtValue>,
  allowed: string[],
  ctx: string,
  warnings: string[],
): void {
  for (const k of Object.keys(body))
    if (!allowed.includes(k)) warnings.push(`${ctx}: unknown field '${k}' (ignored)`);
}

/**
 * @param v The candidate thinking level.
 * @param loc Source location for error messages.
 * @returns The validated thinking level, or null when absent.
 */
export function parseThinking(v: NtValue | undefined, loc: Location): ThinkingLevel | null {
  if (v === undefined || v === null) return null;
  const s = String(v);
  if (!THINKING_LEVELS.includes(s as ThinkingLevel))
    throw new NtError(`thinking must be one of: ${THINKING_LEVELS.join(", ")}`, loc);
  return s as ThinkingLevel;
}

/**
 * @param v A map of field name to type name or descriptor.
 * @param ctx Field description for error messages.
 * @param loc Source location for error messages.
 * @param warnings Accumulator that receives one message per unrecognized type name.
 * @returns The parsed field specifications.
 */
export function parseFields(
  v: NtValue | undefined,
  ctx: string,
  loc: Location,
  warnings: string[] = [],
): FieldSpec[] {
  if (v === undefined || v === null) return [];
  if (!isMap(v)) throw new NtError(`${ctx} must be a set of field: type entries`, loc);
  return Object.entries(v).map(([name, spec]) => {
    if (isMap(spec)) {
      const rawType = optStr(spec.type, `${ctx}.${name}.type`, loc) ?? "string";
      return {
        name,
        type: normalizeFieldType(rawType, `${ctx}.${name}`, warnings),
        description: optStr(spec.description, `${ctx}.${name}.description`, loc) ?? undefined,
        required:
          spec.required === undefined ? true : spec.required !== false && spec.required !== "false",
      };
    }
    return {
      name,
      type: normalizeFieldType(String(spec), `${ctx}.${name}`, warnings),
      required: true,
    };
  });
}

/**
 * @param t A raw type name from the source.
 * @param ctx Field description for the warning text.
 * @param warnings Accumulator that receives a message when the type is unrecognized.
 * @returns The name if it is a known field type, otherwise "string".
 */
function normalizeFieldType(t: string, ctx: string, warnings: string[]): FieldType {
  const known: FieldType[] = ["string", "number", "boolean", "object", "array"];
  if (known.includes(t as FieldType)) return t as FieldType;
  warnings.push(`${ctx}: unknown type '${t}', defaulting to 'string'`);
  return "string";
}
