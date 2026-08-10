/**
 * @file Integration test for the CLI's one-use MCP OAuth callback listener.
 *
 * Confirms the listener binds to an ephemeral IPv4 loopback port, resolves the
 * exact callback query parameters, ignores unrelated browser requests, returns
 * a success page, and closes cleanly. The test never opens a browser or contacts
 * a remote authorization server.
 */

import assert from "node:assert/strict";
import * as http from "node:http";
import { test } from "node:test";
import { createOAuthCallback } from "#mcp/oauth";

/**
 * Sends one loopback request and consumes its body so the socket can close.
 *
 * @param url Absolute callback-listener URL.
 * @returns The response status after the complete body arrives.
 */
function requestStatus(url: string): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      response.resume();
      response.once("end", () => resolve(response.statusCode));
    });
    request.once("error", reject);
  });
}

test("OAuth callback listens on ephemeral loopback and returns query parameters", async () => {
  const callback = await createOAuthCallback();
  try {
    const url = new URL(callback.redirectUrl);
    assert.equal(url.hostname, "127.0.0.1");
    assert.notEqual(url.port, "");
    assert.equal(await requestStatus(`${url.origin}/favicon.ico`), 404);
    const response = requestStatus(`${callback.redirectUrl}?code=code-1&state=state-1`);
    const params = await callback.result;
    assert.equal(params.get("code"), "code-1");
    assert.equal(params.get("state"), "state-1");
    assert.equal(await response, 200);
    assert.equal(await requestStatus(`${callback.redirectUrl}?code=code-2&state=state-2`), 410);
  } finally {
    await callback.close();
  }
});
