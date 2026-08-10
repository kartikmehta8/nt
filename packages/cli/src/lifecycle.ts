/**
 * @file Process-signal cleanup for engines owned by CLI commands.
 *
 * Tracks every active engine, installs one shared SIGINT/SIGTERM handler on
 * demand, and waits for bounded engine shutdown before exiting with the
 * conventional signal code. Normal command completion unregisters the engine
 * and removes handlers once no command-owned resources remain. The reusable
 * engine package deliberately does not install process-global listeners.
 */

import type { Engine } from "@age.nt/engine";

const active = new Set<Engine>();
let installed = false;

const shutdown = (signal: NodeJS.Signals): void => {
  const code = signal === "SIGINT" ? 130 : 143;
  void Promise.allSettled([...active].map((engine) => engine.close())).finally(() => {
    process.exit(code);
  });
};

function install(): void {
  if (installed) return;
  installed = true;
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

function uninstall(): void {
  if (!installed || active.size) return;
  installed = false;
  process.removeListener("SIGINT", shutdown);
  process.removeListener("SIGTERM", shutdown);
}

/**
 * Returns the same engine after registering signal cleanup.
 * @param engine A newly created engine owned by a CLI command.
 * @returns The same engine after registering signal cleanup.
 */
export function trackEngine<T extends Engine>(engine: T): T {
  active.add(engine);
  install();
  return engine;
}

/**
 * Stops engine and releases its owned resources.
 * @param engine An engine whose command has finished.
 * @returns When engine cleanup and signal-handler removal have completed.
 */
export async function closeEngine(engine: Engine): Promise<void> {
  active.delete(engine);
  try {
    await engine.close();
  } finally {
    uninstall();
  }
}
