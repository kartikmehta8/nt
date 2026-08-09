/**
 * @file Ordered operational diagnostics for one MCP server declaration.
 *
 * Doctor separates source validity, trust, endpoint resolution, connection,
 * authentication, capabilities, catalog, selection, schemas, and shutdown into
 * stable checks. Failed prerequisites mark dependent checks as skipped rather
 * than hiding them, and every diagnostic uses a fresh connection that is closed
 * before the report is returned.
 */

import * as fs from "node:fs";
import * as nodePath from "node:path";
import { buildCatalog } from "#mcp/catalog";
import { McpConnection } from "#mcp/connection";
import { mcpErrorCode } from "#mcp/errors";
import { resolvedCwd } from "#mcp/security";
import type { McpDoctorCheck, McpDoctorResult, McpServerDef } from "#types";

type CheckState = Record<McpDoctorCheck["name"], McpDoctorCheck>;

const CHECK_NAMES: McpDoctorCheck["name"][] = [
  "schema",
  "trust",
  "endpoint",
  "connection",
  "authentication",
  "capabilities",
  "catalog",
  "selection",
  "schemas",
  "shutdown",
];

function passed(name: McpDoctorCheck["name"], message: string): McpDoctorCheck {
  return { name, status: "pass", message };
}

function failed(name: McpDoctorCheck["name"], code: string, message: string): McpDoctorCheck {
  return { name, status: "fail", code, message };
}

function skipped(name: McpDoctorCheck["name"], blocker: McpDoctorCheck): McpDoctorCheck {
  return {
    name,
    status: "skipped",
    code: blocker.code,
    message: `blocked by ${blocker.name}: ${blocker.message}`,
  };
}

function executablePath(def: McpServerDef): string | null {
  if (!def.command) return null;
  const cwd = resolvedCwd(def);
  const direct =
    nodePath.isAbsolute(def.command) || def.command.includes("/") || def.command.includes("\\");
  const directories = direct ? [cwd] : (process.env.PATH ?? "").split(nodePath.delimiter);
  const extensions =
    process.platform === "win32"
      ? ["", ...(process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";")]
      : [""];
  for (const directory of directories)
    for (const extension of extensions) {
      const candidate = direct
        ? nodePath.resolve(cwd, def.command + extension)
        : nodePath.join(directory, def.command + extension);
      try {
        fs.accessSync(
          candidate,
          process.platform === "win32" ? fs.constants.F_OK : fs.constants.X_OK,
        );
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch {
        continue;
      }
    }
  return null;
}

function endpointCheck(def: McpServerDef): McpDoctorCheck {
  if (def.transport === "streamable_http")
    return passed("endpoint", `URL policy accepted ${new URL(def.url ?? "").origin}`);
  const executable = executablePath(def);
  return executable
    ? passed("endpoint", `resolved executable ${executable}`)
    : failed("endpoint", "MCP_CONNECTION_FAILED", `command '${def.command}' was not found`);
}

/**
 * Runs independent declaration, trust, connection, and discovery diagnostics for a server.
 * @param def A validated server declaration.
 * @param trustStatus Persisted trust state for its current fingerprint.
 * @param connection A fresh connection reserved for this diagnostic.
 * @returns Ten ordered checks and an overall usability flag.
 */
export async function diagnoseMcpServer(
  def: McpServerDef,
  trustStatus: "trusted" | "missing" | "changed",
  connection: McpConnection,
): Promise<McpDoctorResult> {
  const checks = {} as CheckState;
  checks.schema = passed("schema", "declaration and cross-references are valid");
  checks.trust =
    trustStatus === "trusted"
      ? passed("trust", "fingerprint is trusted")
      : failed(
          "trust",
          trustStatus === "changed" ? "MCP_TRUST_CHANGED" : "MCP_NOT_TRUSTED",
          trustStatus === "changed"
            ? "trusted fingerprint has changed"
            : "fingerprint is not trusted",
        );
  checks.endpoint = endpointCheck(def);
  const blocker =
    checks.trust.status === "fail"
      ? checks.trust
      : checks.endpoint.status === "fail"
        ? checks.endpoint
        : null;
  if (blocker) {
    for (const name of CHECK_NAMES.slice(3, 9)) checks[name] = skipped(name, blocker);
  } else {
    await runLiveChecks(def, connection, checks);
  }
  try {
    await connection.close();
    checks.shutdown = passed("shutdown", "connection and transport closed cleanly");
  } catch (error) {
    checks.shutdown = failed("shutdown", "MCP_CLOSED", (error as Error).message);
  }
  const ordered = CHECK_NAMES.map((name) => checks[name]);
  return {
    name: def.name,
    transport: def.transport,
    usable: ordered.every((check) => check.status === "pass"),
    checks: ordered,
  };
}

async function runLiveChecks(
  def: McpServerDef,
  connection: McpConnection,
  checks: CheckState,
): Promise<void> {
  let snapshot: Awaited<ReturnType<McpConnection["connect"]>>;
  try {
    snapshot = await connection.connect();
    checks.connection = passed(
      "connection",
      `negotiated protocol ${snapshot.protocolVersion ?? "unknown"}`,
    );
    checks.authentication = passed("authentication", "server accepted current authentication");
  } catch (error) {
    const code = mcpErrorCode(error);
    const failedName = code.startsWith("MCP_AUTH") ? "authentication" : "connection";
    checks.connection =
      failedName === "connection"
        ? failed("connection", code, (error as Error).message)
        : passed("connection", "transport reached the authentication boundary");
    checks.authentication =
      failedName === "authentication"
        ? failed("authentication", code, (error as Error).message)
        : skipped("authentication", checks.connection);
    const blocker = checks[failedName];
    for (const name of CHECK_NAMES.slice(5, 9)) checks[name] = skipped(name, blocker);
    return;
  }
  checks.capabilities = snapshot.client.getServerCapabilities()?.tools
    ? passed("capabilities", "server advertises tool capability")
    : failed("capabilities", "MCP_UNSUPPORTED_CLIENT_CAPABILITY", "server has no tool capability");
  let advertised: Awaited<ReturnType<McpConnection["listTools"]>>;
  try {
    advertised = await connection.listTools(true);
    checks.catalog = passed("catalog", `discovered ${advertised.length} advertised tool(s)`);
  } catch (error) {
    checks.catalog = failed("catalog", mcpErrorCode(error), (error as Error).message);
    checks.selection = skipped("selection", checks.catalog);
    checks.schemas = skipped("schemas", checks.catalog);
    return;
  }
  try {
    const catalog = buildCatalog(def, advertised);
    checks.selection = passed(
      "selection",
      `${catalog.filter((tool) => tool.info.selected).length} selected tool(s) exist`,
    );
    checks.schemas = passed("schemas", "input and output schemas are valid and compatible");
  } catch (error) {
    const code = mcpErrorCode(error);
    if (code === "MCP_TOOL_NOT_FOUND") {
      checks.selection = failed("selection", code, (error as Error).message);
      checks.schemas = skipped("schemas", checks.selection);
    } else {
      checks.selection = skipped("selection", failed("schemas", code, (error as Error).message));
      checks.schemas = failed("schemas", code, (error as Error).message);
    }
  }
}
