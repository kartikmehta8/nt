/**
 * @file Terminal output helpers for the CLI.
 *
 * A single `out` writer for stdout (so no other module needs `console.log`),
 * ANSI color helpers that no-op when stdout is not a TTY, and `printWarnings`
 * for non-fatal messages on stderr.
 */

/**
 * @param line The text to print to standard output.
 */
export function out(line: string): void {
  process.stdout.write(line + "\n");
}

/**
 * @param s The text to style.
 * @param code The ANSI SGR code to apply when stdout is a TTY.
 * @returns The styled text, or the plain text when not a TTY.
 */
function color(s: string, code: number): string {
  return process.stdout.isTTY ? `\x1b[${code}m${s}\x1b[0m` : s;
}

export const bold = (s: string): string => color(s, 1);
export const dim = (s: string): string => color(s, 2);
export const red = (s: string): string => color(s, 31);
export const green = (s: string): string => color(s, 32);
export const yellow = (s: string): string => color(s, 33);
export const cyan = (s: string): string => color(s, 36);

/**
 * @param warnings Non-fatal messages to print to standard error.
 */
export function printWarnings(warnings: string[]): void {
  for (const w of warnings) console.error(yellow(`⚠ ${w}`));
}
