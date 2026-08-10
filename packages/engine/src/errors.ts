/**
 * @file The `NtError` type used for all parse, schema, and runtime failures.
 *
 * Carries an optional source `Location` so the CLI can render `file:line:
 * message` diagnostics. Thrown throughout the pipeline and caught at the CLI
 * boundary in `cli/main`.
 */

import type { Location } from "#types";

export class NtError extends Error {
  loc: Location | null;

  /**
   * Creates a source-aware NT error and preserves its optional root cause.
   * @param message Human-readable description of the problem.
   * @param loc Source location the error refers to, or null when unknown.
   */
  constructor(message: string, loc: Location | null) {
    super(loc ? `${loc.file}:${loc.line}: ${message}` : message);
    this.name = "NtError";
    this.loc = loc;
  }
}
