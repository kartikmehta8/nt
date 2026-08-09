/**
 * @file Command router for MCP trust, discovery, diagnostics, and OAuth.
 *
 * Loads one tracked engine, validates subcommand operands, and renders either
 * human output or versioned JSON for list, inspect, and doctor. Trust remains
 * interactive or compare-and-set, OAuth owns a bounded loopback callback, and
 * every branch closes its engine in `finally`. Operational failures use exit
 * code 1 while argument errors continue through the CLI's central handler.
 */

import * as readline from "node:readline/promises";
import { Engine, McpError, NtError } from "@age.nt/engine";
import { resolveEntry, type Args } from "#args";
import { bold, dim, green, out, yellow } from "#format";
import { inspectJsonSafe, printMcpDoctor, printMcpTools } from "#mcp/format";
import { createOAuthCallback, openBrowser } from "#mcp/oauth";
import { closeEngine, trackEngine } from "#lifecycle";

function load(args: Args): Engine {
  return trackEngine(
    Engine.load(resolveEntry(args), {
      allowOutsideImports: args.allowOutsideImports,
      verbose: args.verbose,
    }),
  );
}

function serverArg(args: Args, index = 2): string {
  const value = args.positional[index];
  if (!value) throw new NtError(`usage: nt mcp ${args.positional[1]} SERVER`, null);
  return value;
}

/**
 * Dispatches MCP list, inspect, doctor, trust, logout, and OAuth CLI operations.
 * @param args Parsed CLI arguments containing an MCP subcommand.
 * @returns When the command and engine cleanup have completed.
 */
export async function cmdMcp(args: Args): Promise<void> {
  const subcommand = args.positional[1];
  if (!subcommand)
    throw new NtError("usage: nt mcp <list|inspect|doctor|trust|untrust|auth|logout>", null);
  const engine = load(args);
  try {
    if (subcommand === "list") {
      const result = await engine.listMcp(args.positional[2], args.all);
      if (args.json)
        out(
          JSON.stringify(
            {
              schema_version: 1,
              servers: result.map(({ status, tools }) => ({
                name: status.name,
                transport: status.transport,
                status: status.status,
                protocol_version: status.protocolVersion,
                server_info: status.serverInfo,
                selected_tool_count: status.selectedToolCount,
                error: status.error,
                error_code: status.errorCode,
                tools,
              })),
            },
            null,
            2,
          ),
        );
      else printMcpTools(result);
      if (result.some((item) => item.status.status !== "connected")) process.exitCode = 1;
      return;
    }
    if (subcommand === "inspect") {
      const server = serverArg(args);
      const tool = args.positional[3];
      if (!tool) throw new NtError("usage: nt mcp inspect SERVER TOOL", null);
      const result = await engine.inspectMcp(server, tool);
      const safe = { ...result, tool: inspectJsonSafe(result.tool) };
      if (args.json) out(JSON.stringify({ schema_version: 1, ...safe }, null, 2));
      else {
        out(bold(`${safe.tool.reference} (${safe.tool.modelName})`));
        out(safe.tool.description);
        out(
          dim(
            `transport ${safe.server.transport} · approval ${safe.tool.approval} · annotations are untrusted metadata`,
          ),
        );
        out(
          JSON.stringify(
            {
              input_schema: safe.tool.inputSchema,
              output_schema: safe.tool.outputSchema,
              annotations: safe.tool.annotations,
            },
            null,
            2,
          ),
        );
      }
      return;
    }
    if (subcommand === "doctor") {
      const result = await engine.doctorMcp(args.positional[2]);
      if (args.json) out(JSON.stringify({ schema_version: 1, servers: result }, null, 2));
      else printMcpDoctor(result);
      if (result.some((item) => !item.usable)) process.exitCode = 1;
      return;
    }
    if (subcommand === "trust") {
      const server = serverArg(args);
      const info = engine.mcpTrustInfo(server);
      out(bold(`MCP server ${server}`));
      out(`  transport: ${info.def.transport}`);
      out(
        `  origin: ${info.def.transport === "stdio" ? [info.def.command, ...info.def.args].join(" ") : info.def.url}`,
      );
      if (info.def.transport === "stdio") {
        out(`  cwd: ${info.def.cwd}`);
        out(`  environment names: ${Object.keys(info.def.env).join(", ") || "(none)"}`);
      } else {
        out(`  authentication: ${info.def.auth.type}`);
        out(`  header names: ${Object.keys(info.def.headers).join(", ") || "(none)"}`);
      }
      out(`  internal networking: ${info.def.allowInternal ? "enabled" : "disabled"}`);
      out(`  legacy SSE: ${info.def.allowLegacySse ? "enabled" : "disabled"}`);
      out(`  fingerprint: ${info.fingerprint}`);
      if (info.def.transport === "stdio")
        out(yellow("  Warning: this command executes with your user privileges."));
      if (args.nonInteractive && !args.fingerprint)
        throw new NtError("--non-interactive trust requires --fingerprint", null);
      if (!args.nonInteractive) {
        if (!process.stdin.isTTY)
          throw new NtError(
            "interactive trust requires a terminal; use --fingerprint ... --non-interactive",
            null,
          );
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const answer = await rl.question("Trust this exact server definition? [y/N] ");
        rl.close();
        if (!/^y(?:es)?$/i.test(answer.trim()))
          throw new NtError("MCP server was not trusted", null);
      }
      out(green(`✓ trusted ${server} at ${engine.trustMcp(server, args.fingerprint)}`));
      return;
    }
    if (subcommand === "untrust") {
      const server = serverArg(args);
      out(
        engine.untrustMcp(server)
          ? green(`✓ removed trust for ${server}`)
          : dim(`no trust entry for ${server}`),
      );
      return;
    }
    if (subcommand === "auth") {
      const server = serverArg(args);
      if (process.env.NT_MCP_CREDENTIAL_STORE !== "memory")
        out(
          yellow(
            "OAuth credentials are protected by owner-only file permissions, not hardware-backed encryption.",
          ),
        );
      const callback = await createOAuthCallback();
      try {
        const snapshot = await engine.authorizeMcp(
          server,
          callback.redirectUrl,
          (url) => {
            out(`Open this URL to authorize:\n${url}`);
            openBrowser(url);
          },
          callback.result,
        );
        out(
          green(
            `✓ authorized ${server}${snapshot.protocolVersion ? ` (protocol ${snapshot.protocolVersion})` : ""}`,
          ),
        );
      } finally {
        await callback.close();
      }
      return;
    }
    if (subcommand === "logout") {
      const server = serverArg(args);
      out(
        engine.logoutMcp(server)
          ? green(`✓ deleted local OAuth credentials for ${server}`)
          : dim(`no local OAuth credentials for ${server}`),
      );
      return;
    }
    throw new NtError(`unknown mcp command '${subcommand}'`, null);
  } catch (error) {
    if (args.json && error instanceof McpError) {
      out(
        JSON.stringify(
          { schema_version: 1, error: { code: error.code, message: error.message } },
          null,
          2,
        ),
      );
      process.exitCode = 1;
      return;
    }
    throw error;
  } finally {
    await closeEngine(engine);
  }
}
