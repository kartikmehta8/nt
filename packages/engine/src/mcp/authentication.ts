/**
 * @file Authentication factory and logout routing for MCP connections.
 *
 * Converts the validated `none`, environment-backed bearer, and OAuth source
 * declarations into official SDK providers without copying resolved secrets
 * into the project model. The same module reconstructs the resource-scoped
 * OAuth provider used by logout when no live connection exists.
 */

import type { AuthProvider, OAuthClientProvider } from "@modelcontextprotocol/client";
import { NtOAuthProvider } from "#mcp/auth";
import type { CredentialStore } from "#mcp/credentials";
import { McpError } from "#mcp/errors";
import { requireUrl } from "#mcp/transport";
import type { McpServerDef } from "#types";

export interface ConnectionAuth {
  provider?: AuthProvider | OAuthClientProvider;
  oauth?: NtOAuthProvider;
}

/**
 * Builds the SDK authentication adapter for a validated server declaration.
 * @param def The validated MCP server declaration.
 * @param credentials OAuth credential persistence.
 * @param options Optional redirect behavior for an interactive OAuth attempt.
 * @returns The SDK auth provider and concrete OAuth provider when applicable.
 */
export function createConnectionAuth(
  def: McpServerDef,
  credentials: CredentialStore,
  options?: { redirectUrl?: string; onRedirect?: (url: URL) => void | Promise<void> },
): ConnectionAuth {
  if (def.auth.type === "none") return {};
  if (def.auth.type === "bearer") {
    const provider: AuthProvider = {
      token: async () => {
        const token = process.env[def.auth.type === "bearer" ? def.auth.tokenEnv : ""];
        if (!token)
          throw new McpError(
            "MCP_AUTH_REQUIRED",
            `environment variable ${def.auth.type === "bearer" ? def.auth.tokenEnv : ""} is not set`,
          );
        return token;
      },
    };
    return { provider };
  }
  const oauth = new NtOAuthProvider(requireUrl(def), def.auth.scopes, credentials, options);
  return { provider: oauth, oauth };
}

/**
 * Removes OAuth state through the active provider or the persisted credential index.
 * @param def The validated remote MCP server declaration.
 * @param credentials OAuth credential persistence.
 * @param activeProvider Provider from an active connection, when one exists.
 * @returns Whether matching persisted OAuth credentials were removed.
 */
export function logoutConnectionAuth(
  def: McpServerDef,
  credentials: CredentialStore,
  activeProvider?: NtOAuthProvider,
): boolean {
  return (
    activeProvider ??
    new NtOAuthProvider(
      requireUrl(def),
      def.auth.type === "oauth" ? def.auth.scopes : [],
      credentials,
    )
  ).logout();
}
