/**
 * @file Repository-owned Streamable HTTP MCP server used by integration tests.
 *
 * Wraps the official fetch-based server handler in a small Node HTTP bridge,
 * requires a deterministic bearer value, and exposes one schema-constrained
 * echo tool on an ephemeral IPv4 loopback port. The fixture reports only its
 * selected port on stdout and closes on SIGINT/SIGTERM so tests can assert the
 * real client transport without public network or third-party services.
 */

import * as http from "node:http";
import { Readable } from "node:stream";
import { McpServer, createMcpHandler, fromJsonSchema } from "@modelcontextprotocol/server";

const expected = process.env.NT_MCP_TEST_BEARER ?? "test-bearer";

const handler = createMcpHandler(() => {
  const server = new McpServer({ name: "nt-http-test", version: "1.0.0" });
  server.registerTool(
    "echo",
    {
      description: "Echo text over Streamable HTTP.",
      inputSchema: fromJsonSchema({
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
        additionalProperties: false,
      }),
    },
    ({ text }) => ({ content: [{ type: "text", text: `remote: ${text}` }] }),
  );
  return server;
});

const authenticated = {
  fetch(request, options) {
    if (request.headers.get("authorization") !== `Bearer ${expected}`)
      return Promise.resolve(
        new globalThis.Response("unauthorized", {
          status: 401,
          headers: { "www-authenticate": "Bearer" },
        }),
      );
    return handler.fetch(request, options);
  },
};

/**
 * Handles one fixture request and delegates MCP payloads to the SDK transport.
 *
 * @param request Incoming loopback HTTP request.
 * @param response Response paired with the request.
 * @returns A promise that settles after the fixture responds or closes.
 */
async function serve(request, response) {
  try {
    const method = request.method ?? "GET";
    const body = method === "GET" || method === "HEAD" ? undefined : Readable.toWeb(request);
    const webRequest = new globalThis.Request(`http://127.0.0.1${request.url ?? "/"}`, {
      method,
      headers: request.headers,
      body,
      duplex: body ? "half" : undefined,
    });
    const webResponse = await authenticated.fetch(webRequest);
    response.writeHead(webResponse.status, Object.fromEntries(webResponse.headers));
    if (webResponse.body) Readable.fromWeb(webResponse.body).pipe(response);
    else response.end();
  } catch (error) {
    response.writeHead(500, { "content-type": "text/plain" });
    response.end(error instanceof Error ? error.message : "fixture failure");
  }
}

const server = http.createServer((request, response) => void serve(request, response));
server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture has no TCP address");
  process.stdout.write(`${JSON.stringify({ port: address.port })}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => server.close(() => process.exit(0)));
