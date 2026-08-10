/**
 * @file Cross-platform cleanup for integration-test temporary directories.
 *
 * Child processes and filesystem scanners can release working-directory handles
 * slightly after shutdown completes, especially on Windows. This helper retries
 * only transient removal errors for a bounded period, while immediately surfacing
 * programming errors and unexpected filesystem failures to the owning test.
 */

import { rm } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

const MAX_ATTEMPTS = 50;
const RETRY_DELAY_MS = 100;
const TRANSIENT_CODES = new Set(["EBUSY", "EMFILE", "ENFILE", "ENOTEMPTY", "EPERM"]);

/**
 * Identifies operating-system errors that can clear after open handles settle.
 *
 * @param error Unknown removal failure.
 * @returns Whether retrying the exact removal operation is safe.
 */
function isTransientRemovalError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    TRANSIENT_CODES.has(error.code)
  );
}

/**
 * Removes every tracked test directory, tolerating bounded handle-release lag.
 *
 * The input acts as an ownership stack and is drained even when directories were
 * already removed. Unexpected errors and exhausted retries still fail the test.
 *
 * @param paths Mutable stack of temporary directories owned by the current test.
 * @returns When all tracked directories have been removed.
 */
export async function removeTemporaryDirectories(paths: string[]): Promise<void> {
  while (paths.length) {
    const target = paths.pop();
    if (!target) continue;
    for (let attempt = 1; ; attempt += 1) {
      try {
        await rm(target, { recursive: true, force: true });
        break;
      } catch (error) {
        if (!isTransientRemovalError(error) || attempt >= MAX_ATTEMPTS) throw error;
        await delay(RETRY_DELAY_MS);
      }
    }
  }
}
