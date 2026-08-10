/**
 * @file JSON Schema trust boundary for advertised MCP tool contracts.
 *
 * Ajv compiles input and output schemas without coercion after recursive depth,
 * byte-size, and external-reference checks. Separate helpers produce concise
 * validation messages, strip provider presentation keywords without weakening
 * validation, and redact secret-shaped defaults or examples before inspection
 * metadata is printed.
 */

import { Ajv2020 } from "ajv/dist/2020.js";
import type { ErrorObject, ValidateFunction } from "ajv";
import { McpError } from "#mcp/errors";

const MAX_SCHEMA_BYTES = 256 * 1024;
const MAX_SCHEMA_DEPTH = 40;
const ajv = new Ajv2020({ allErrors: true, strict: false, loadSchema: undefined });

function checkSchemaTree(value: unknown, depth = 0): void {
  if (depth > MAX_SCHEMA_DEPTH)
    throw new McpError("MCP_SCHEMA_INVALID", `schema exceeds maximum depth ${MAX_SCHEMA_DEPTH}`);
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === "$ref" && typeof child === "string" && !child.startsWith("#"))
      throw new McpError(
        "MCP_SCHEMA_INVALID",
        `external schema reference '${child}' is not allowed`,
      );
    checkSchemaTree(child, depth + 1);
  }
}

/**
 * Compiles a bounded MCP JSON Schema into a reusable strict validator.
 * @param schema Untrusted input or output schema from a server.
 * @param label Human-readable location used in failures.
 * @returns A strict, non-coercing schema validator.
 */
export function compileSchema(schema: unknown, label: string): ValidateFunction {
  if (!schema || typeof schema !== "object" || Array.isArray(schema))
    throw new McpError("MCP_SCHEMA_INVALID", `${label} must be an object schema`);
  const bytes = Buffer.byteLength(JSON.stringify(schema));
  if (bytes > MAX_SCHEMA_BYTES)
    throw new McpError("MCP_SCHEMA_INVALID", `${label} exceeds ${MAX_SCHEMA_BYTES} bytes`);
  checkSchemaTree(schema);
  try {
    return ajv.compile(schema);
  } catch (error) {
    throw new McpError("MCP_SCHEMA_INVALID", `${label}: ${(error as Error).message}`, {
      cause: error,
    });
  }
}

/**
 * Formats bounded AJV failures into a safe diagnostic for model arguments.
 * @param errors Ajv validation errors.
 * @returns A bounded human-readable validation summary.
 */
export function validationMessage(errors: ErrorObject[] | null | undefined): string {
  return (
    (errors ?? [])
      .slice(0, 5)
      .map((e) => `${e.instancePath || "/"} ${e.message}`)
      .join("; ") || "schema validation failed"
  );
}

/**
 * Converts an MCP input schema into the provider-facing JSON Schema shape.
 * @param schema A compiled MCP input schema.
 * @returns A recursively sanitized schema accepted by model providers.
 */
export function providerSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const strip = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(strip);
    if (!value || typeof value !== "object") return value;
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (["$schema", "$id", "examples", "deprecated", "readOnly", "writeOnly"].includes(key))
        continue;
      out[key] = strip(child);
    }
    return out;
  };
  return strip(schema) as Record<string, unknown>;
}

/**
 * Removes sensitive data from schema secrets before exposure.
 * @param schema Schema metadata that may contain secret-shaped defaults.
 * @returns A deep copy with secret-shaped examples and defaults redacted.
 */
export function redactSchemaSecrets(schema: unknown): unknown {
  const secret = /token|secret|password|authorization|api[_-]?key/i;
  const walk = (value: unknown, property?: string): unknown => {
    if (property && secret.test(property)) return "[redacted]";
    if (Array.isArray(value)) return value.map((x) => walk(x));
    if (!value || typeof value !== "object") return value;
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>))
      out[key] =
        (key === "default" || key === "examples") && property && secret.test(property)
          ? "[redacted]"
          : walk(child, key === "properties" ? property : key);
    return out;
  };
  return walk(schema);
}
