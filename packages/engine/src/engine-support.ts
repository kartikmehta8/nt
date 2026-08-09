/**
 * @file Run-boundary validation and sandbox selection shared by `Engine`.
 *
 * Validates caller input against the runnable's declared field schema before a
 * model request, then resolves either the named sandbox or a fresh default
 * virtual sandbox for the selected agent. Keeping these concerns outside
 * `engine.ts` preserves its lifecycle-focused public API and the file-size
 * convention.
 */

import { randomUUID } from "node:crypto";
import type { AuditLog } from "#audit/log";
import { DEFAULT_SANDBOX_CWD } from "#constants";
import { NtError } from "#errors";
import { validateInput } from "#io";
import type { McpManager } from "#mcp/manager";
import type { ProviderRegistry } from "#provider";
import type { RunContext } from "#runtime";
import { makeSandbox, type Sandbox } from "#sandbox";
import type {
  AgentDef,
  ConfirmRequest,
  FieldSpec,
  Location,
  Project,
  SandboxDef,
  StepEvent,
} from "#types";

/**
 * Validates run input and reports any contract violation.
 * @param fields Declared input fields.
 * @param input Caller-provided values.
 * @param what Runnable label used in diagnostics.
 * @param loc Runnable source location.
 * @returns Nothing; invalid input is reported by throwing `NtError`.
 */
export function validateRunInput(
  fields: FieldSpec[],
  input: Record<string, unknown>,
  what: string,
  loc: Location,
): void {
  if (!fields.length) return;
  const keys = Object.keys(input);
  if (keys.length === 0) return;
  if (
    keys.length === 1 &&
    keys[0] === "message" &&
    !fields.some((field) => field.name === "message")
  )
    return;
  const problem = validateInput(fields, input);
  if (problem) throw new NtError(`${what} input: ${problem}`, loc);
}

/**
 * Returns a fresh sandbox scoped to the agent.
 * @param project Loaded project containing declared sandboxes and defaults.
 * @param agent Agent whose sandbox should be instantiated.
 * @returns A fresh sandbox scoped to the agent.
 */
export function sandboxForAgent(project: Project, agent: AgentDef): Sandbox {
  const ref = agent.sandbox ?? project.config.defaults.sandbox ?? "virtual";
  const declared = project.sandboxes.get(ref);
  const def: SandboxDef = declared
    ? { ...declared, cwd: agent.cwd ?? declared.cwd }
    : {
        name: ref,
        type: ref === "local" ? "local" : "virtual",
        description: "",
        cwd: agent.cwd ?? DEFAULT_SANDBOX_CWD,
        env: {},
        loc: agent.loc,
      };
  return makeSandbox(def);
}

/**
 * Creates an isolated execution context with a fresh audit correlation ID.
 *
 * @param project Loaded project used to resolve runtime declarations.
 * @param registry Provider registry owned by the engine.
 * @param log Optional verbose diagnostic sink.
 * @param audit Active audit destination, when auditing is enabled.
 * @param onStep Optional structured progress callback.
 * @param confirm Optional permission confirmation callback.
 * @param mcp Engine-lifetime MCP manager.
 * @returns A run-scoped context safe to pass into sessions and workflows.
 */
export function createRunContext(
  project: Project,
  registry: ProviderRegistry,
  log: (line: string) => void,
  audit: AuditLog | null,
  onStep: ((event: StepEvent) => void) | undefined,
  confirm: ((request: ConfirmRequest) => Promise<boolean>) | undefined,
  mcp: McpManager,
): RunContext {
  return { project, registry, log, audit, runId: randomUUID(), onStep, confirm, mcp };
}
