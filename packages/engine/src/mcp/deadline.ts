/**
 * @file Non-owning deadline primitive for bounded MCP cleanup paths.
 *
 * The returned timer is unref'ed so a defensive close deadline never keeps a
 * completed CLI process alive. Callers race it against SDK shutdown work; this
 * module does not cancel that work or turn the elapsed deadline into an error.
 */

/**
 * Creates a timer promise that resolves after a bounded cleanup deadline.
 * @param milliseconds Delay before the deadline resolves.
 * @returns A promise that resolves after the delay without keeping Node alive.
 */
export function deadline(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    timer.unref();
  });
}
