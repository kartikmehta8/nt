/**
 * @file FIFO concurrency primitive for per-server MCP call limits.
 *
 * `Semaphore` admits work in arrival order, releases capacity in `finally`,
 * and therefore cannot strand a waiter when a tool rejects. It intentionally
 * owns no cancellation or timeout policy; the manager and SDK call layer keep
 * those protocol concerns separate.
 */

/**
 * Runs asynchronous work under a fixed FIFO limit and releases capacity after
 * both fulfillment and rejection.
 */
export class Semaphore {
  private active = 0;
  private waiting: Array<() => void> = [];
  private readonly limit: number;

  /**
   * Creates a fair bounded semaphore for one server's concurrent calls.
   * @param limit Maximum number of operations allowed to execute simultaneously.
   */
  constructor(limit: number) {
    this.limit = limit;
  }

  /**
   * Runs one task after acquiring capacity and always releases its permit.
   * @param run Work to execute after capacity becomes available.
   * @returns The work's result.
   */
  async use<T>(run: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active++;
    try {
      return await run();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }
}
