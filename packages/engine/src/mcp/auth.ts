/**
 * @file OAuth client-provider adapter used by the official MCP SDK.
 *
 * `NtOAuthProvider` binds authorization state to one canonical protected
 * resource, issuer, and registered client. It delegates protocol discovery,
 * PKCE exchange, refresh, and scope upgrades to the SDK while persisting only
 * the SDK material needed to resume a session. Browser redirects remain an
 * embedder concern, and logout deletes only credentials for this resource.
 */

import { randomBytes } from "node:crypto";
import type {
  OAuthClientInformationContext,
  OAuthClientMetadata,
  OAuthClientProvider,
  StoredOAuthClientInformation,
  StoredOAuthTokens,
} from "@modelcontextprotocol/client";
import type { CredentialRecord, CredentialStore } from "#mcp/credentials";

/**
 * Supplies resource-bound OAuth metadata and persisted state to the SDK while
 * leaving protocol exchanges under the SDK's control.
 */
export class NtOAuthProvider implements OAuthClientProvider {
  private issuer = "unknown";
  private lastKey: string;
  private redirect?: string;
  private onRedirect?: (url: URL) => void | Promise<void>;
  private stateValue = randomBytes(24).toString("base64url");
  readonly clientMetadata: OAuthClientMetadata;
  private resource: string;
  private scopes: string[];
  private store: CredentialStore;

  /**
   * Creates a resource-bound SDK OAuth adapter with explicit persistence and redirect behavior.
   * @param resourceUrl Protected MCP resource URL.
   * @param scopes Scopes requested by the declaration.
   * @param store Credential persistence selected by the embedder.
   * @param options Optional redirect URL and authorization callback.
   */
  constructor(
    resourceUrl: string,
    scopes: string[],
    store: CredentialStore,
    options: { redirectUrl?: string; onRedirect?: (url: URL) => void | Promise<void> } = {},
  ) {
    this.resource = new URL(resourceUrl).href;
    this.scopes = scopes;
    this.store = store;
    this.redirect = options.redirectUrl;
    this.onRedirect = options.onRedirect;
    this.lastKey = this.key();
    this.clientMetadata = {
      client_name: "NT MCP client",
      redirect_uris: this.redirect ? [this.redirect] : [],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: scopes.join(" "),
    };
  }
  /**
   * Returns the loopback redirect URI registered for this authorization attempt.
   * @returns The ephemeral loopback redirect URL registered for this CLI flow.
   */
  get redirectUrl(): string | undefined {
    return this.redirect;
  }
  /**
   * Returns the SDK-generated state value sent with the authorization request.
   * @returns The unpredictable state value sent with this authorization attempt.
   */
  state(): string {
    return this.stateValue;
  }
  /**
   * Returns the state value that the loopback callback must match exactly.
   * @returns The exact state value the loopback callback must present.
   */
  get expectedState(): string {
    return this.stateValue;
  }
  private key(issuer = this.issuer, clientId = ""): string {
    return JSON.stringify([this.resource, issuer, clientId]);
  }
  private record(ctx?: OAuthClientInformationContext): CredentialRecord {
    if (ctx?.issuer) {
      this.issuer = ctx.issuer;
      const found = this.store.find(this.resource, ctx.issuer);
      this.lastKey = found?.key ?? this.key(ctx.issuer);
      return found?.record ?? {};
    }
    return this.store.get(this.lastKey) ?? {};
  }
  /**
   * Loads dynamically registered OAuth client metadata for the protected resource.
   * @param ctx SDK issuer context.
   * @returns Previously registered client information for this issuer.
   */
  clientInformation(ctx?: OAuthClientInformationContext): StoredOAuthClientInformation | undefined {
    return this.record(ctx).client;
  }
  /**
   * Persists client information to its configured destination.
   * @param client Dynamically registered client information.
   * @param ctx SDK issuer context.
   * @returns Nothing; the issuer-bound client record is persisted atomically.
   */
  saveClientInformation(
    client: StoredOAuthClientInformation,
    ctx?: OAuthClientInformationContext,
  ): void {
    const record = this.record(ctx);
    const nextKey = this.key(this.issuer, client.client_id);
    if (nextKey !== this.lastKey) this.store.delete(this.lastKey);
    this.lastKey = nextKey;
    this.store.set(nextKey, { ...record, client });
  }
  /**
   * Loads the current OAuth token set for the protected resource.
   * @param ctx SDK issuer context.
   * @returns Persisted access and refresh tokens for this issuer.
   */
  tokens(ctx?: OAuthClientInformationContext): StoredOAuthTokens | undefined {
    return this.record(ctx).tokens;
  }
  /**
   * Persists tokens to its configured destination.
   * @param tokens Access and refresh tokens returned by the authorization server.
   * @param ctx SDK issuer context.
   * @returns Nothing; rotated token material replaces the prior record.
   */
  saveTokens(tokens: StoredOAuthTokens, ctx?: OAuthClientInformationContext): void {
    const record = this.record(ctx);
    this.store.set(this.lastKey, { ...record, tokens });
  }
  /**
   * Hands the validated authorization URL to the CLI browser callback.
   * @param url SDK-generated authorization URL for the user agent.
   * @returns The embedder callback result after displaying or opening the URL.
   */
  redirectToAuthorization(url: URL): void | Promise<void> {
    if (!this.onRedirect)
      throw new Error("OAuth authorization required; run 'nt mcp auth <server>'");
    return this.onRedirect(url);
  }
  /**
   * Persists code verifier to its configured destination.
   * @param verifier PKCE verifier to retain until the authorization-code exchange.
   * @returns Nothing; the verifier is stored with the active resource record.
   */
  saveCodeVerifier(verifier: string): void {
    const record = this.record();
    this.store.set(this.lastKey, { ...record, verifier });
  }
  /**
   * Loads the PKCE verifier saved for the active authorization exchange.
   * @returns The persisted PKCE verifier required by the token exchange.
   */
  codeVerifier(): string {
    const verifier = this.record().verifier;
    if (!verifier) throw new Error("missing OAuth PKCE verifier");
    return verifier;
  }
  /**
   * Deletes invalid token material while retaining reusable client registration.
   * @param scope SDK-requested portion of OAuth state to remove.
   * @returns Nothing; only the requested resource-bound material is invalidated.
   */
  invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery"): void {
    if (scope === "all") {
      this.store.delete(this.lastKey);
      return;
    }
    if (scope === "discovery") return;
    const record = this.record();
    delete record[scope === "client" ? "client" : scope === "tokens" ? "tokens" : "verifier"];
    this.store.set(this.lastKey, record);
  }
  /**
   * Deletes every OAuth credential associated with this protected resource.
   * @returns Whether any local credential for this protected resource was removed.
   */
  logout(): boolean {
    return this.store.deleteResource(this.resource);
  }
}
