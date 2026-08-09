/**
 * @file CLI-owned browser and loopback pieces of MCP OAuth authorization.
 *
 * Creates a one-use HTTP listener bound explicitly to ephemeral `127.0.0.1`,
 * resolves only callback query parameters, returns a minimal completion page,
 * and times out after five minutes without keeping Node alive. Browser launch
 * uses an argv-based platform command with detached stdio; protocol discovery,
 * PKCE, tokens, and issuer validation remain in the official SDK and engine.
 */

import * as http from "node:http";
import { spawn } from "node:child_process";
import { NtError } from "@age.nt/engine";

export interface OAuthCallback {
  redirectUrl: string;
  result: Promise<URLSearchParams>;
  close(): Promise<void>;
}

/**
 * Opens a one-use loopback OAuth callback with strict path, method, and timeout handling.
 * @returns A one-use ephemeral loopback callback that expires after five minutes.
 */
export async function createOAuthCallback(): Promise<OAuthCallback> {
  let resolveResult!: (params: URLSearchParams) => void;
  let rejectResult!: (error: Error) => void;
  const result = new Promise<URLSearchParams>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  let accepted = false;
  const server = http.createServer((request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method !== "GET" || url.pathname !== "/callback") {
        response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        response.end("Not found.\n");
        return;
      }
      if (accepted) {
        response.writeHead(410, { "content-type": "text/plain; charset=utf-8" });
        response.end("Authorization callback already received.\n");
        return;
      }
      accepted = true;
      response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      response.end("Authorization received. You can close this tab and return to NT.\n");
      resolveResult(url.searchParams);
    } catch (error) {
      response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
      response.end("Invalid authorization callback.\n");
      rejectResult(error as Error);
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new NtError("could not start OAuth callback listener", null);
  const timer = setTimeout(
    () => rejectResult(new NtError("OAuth authorization timed out after five minutes", null)),
    300_000,
  );
  timer.unref();
  return {
    redirectUrl: `http://127.0.0.1:${address.port}/callback`,
    result: result.finally(() => clearTimeout(timer)),
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

/**
 * Starts browser and prepares it for use.
 * @param url The SDK-generated authorization URL to open.
 * @returns Nothing; browser launch continues in a detached child process.
 */
export function openBrowser(url: URL): void {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "rundll32.exe"
        : "xdg-open";
  const args =
    process.platform === "win32"
      ? ["url.dll,FileProtocolHandler", url.toString()]
      : [url.toString()];
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.on("error", () => {});
  child.unref();
}
