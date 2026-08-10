/**
 * @file Private typed handoff between MCP discovery and runtime dispatch.
 *
 * `CatalogTool` keeps the exact SDK definition beside its public inspection
 * metadata and compiled validators. `ConnectionSnapshot` captures only the
 * negotiated client facts used by the registry and CLI. Neither shape crosses
 * the package barrel, which prevents protocol-library details from becoming a
 * public compatibility promise.
 */

import type { Client, Tool } from "@modelcontextprotocol/client";
import type { ValidateFunction } from "ajv";
import type { McpToolInfo } from "#types";

export interface CatalogTool {
  sdk: Tool;
  info: McpToolInfo;
  inputValidator: ValidateFunction;
  outputValidator?: ValidateFunction;
}

export interface ConnectionSnapshot {
  client: Client;
  protocolVersion?: string;
  protocolEra?: string;
  serverInfo?: { name: string; version?: string };
  instructions?: string;
}
