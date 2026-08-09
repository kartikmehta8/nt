/**
 * @file Terminal output helpers for the CLI.
 *
 * A single `out` writer for stdout (so no other module needs `console.log`),
 * ANSI color helpers that no-op when stdout is not a TTY, and `printWarnings`
 * for non-fatal messages on stderr.
 */

/**
 * Writes one user-facing line to standard output.
 * @param line The text to print to standard output.
 * @returns Nothing; the complete line is written synchronously.
 */
export function out(line: string): void {
  process.stdout.write(line + "\n");
}

/**
 * Returns the styled text, or the plain text when not a TTY.
 * @param s The text to style.
 * @param code The ANSI SGR code to apply when stdout is a TTY.
 * @returns The styled text, or the plain text when not a TTY.
 */
function color(s: string, code: number): string {
  return process.stdout.isTTY ? `\x1b[${code}m${s}\x1b[0m` : s;
}

/**
 * Returns bold text on a TTY, or unchanged text elsewhere.
 * @param text Terminal text to emphasize.
 * @returns Bold text on a TTY, or unchanged text elsewhere.
 */
export const bold = (text: string): string => color(text, 1);

/**
 * Returns dim text on a TTY, or unchanged text elsewhere.
 * @param text Terminal text to de-emphasize.
 * @returns Dim text on a TTY, or unchanged text elsewhere.
 */
export const dim = (text: string): string => color(text, 2);

/**
 * Returns red text on a TTY, or unchanged text elsewhere.
 * @param text Terminal text representing an error.
 * @returns Red text on a TTY, or unchanged text elsewhere.
 */
export const red = (text: string): string => color(text, 31);

/**
 * Returns green text on a TTY, or unchanged text elsewhere.
 * @param text Terminal text representing success.
 * @returns Green text on a TTY, or unchanged text elsewhere.
 */
export const green = (text: string): string => color(text, 32);

/**
 * Returns yellow text on a TTY, or unchanged text elsewhere.
 * @param text Terminal text representing a warning.
 * @returns Yellow text on a TTY, or unchanged text elsewhere.
 */
export const yellow = (text: string): string => color(text, 33);

/**
 * Returns cyan text on a TTY, or unchanged text elsewhere.
 * @param text Terminal text representing a name or active value.
 * @returns Cyan text on a TTY, or unchanged text elsewhere.
 */
export const cyan = (text: string): string => color(text, 36);

/**
 * Writes warnings in the caller-selected output format.
 * @param warnings Non-fatal messages to print to standard error.
 * @returns Nothing; every warning is emitted in input order.
 */
export function printWarnings(warnings: string[]): void {
  for (const w of warnings) console.error(yellow(`⚠ ${w}`));
}
