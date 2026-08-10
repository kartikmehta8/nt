/**
 * @file Language-model providers, selected by the `provider/model-id` prefix.
 *
 * `ProviderRegistry` resolves a model string to a declared or built-in provider
 * (Anthropic or OpenAI-compatible), reports credential status for `bringUp`,
 * checks tool-capability compatibility, and delegates HTTP translation to
 * `provider-http.ts`. This file owns the normalized provider-neutral request,
 * response, content, and tool-definition shapes.
 */

import { NtError } from "#errors";
import { callAnthropic, callOpenAi } from "#provider-http";
import type { ProviderDef, ThinkingLevel } from "#types";

export interface LlmToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface LlmMessage {
  role: "user" | "assistant";
  content: unknown;
}

export interface ContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  [k: string]: unknown;
}

export interface LlmRequest {
  model: string;
  system: string;
  messages: LlmMessage[];
  tools?: LlmToolDef[];
  maxTokens: number;
  thinking: ThinkingLevel | null;
  outputSchema?: Record<string, unknown> | null;
}

export interface LlmResponse {
  content: ContentBlock[];
  stopReason: string;
  text: string;
  usage: { input: number; output: number };
}

export interface CredentialStatus {
  provider: ProviderDef;
  hasKey: boolean;
}

const ANTHROPIC = (): ProviderDef => ({
  name: "anthropic",
  api: "anthropic",
  baseUrl: null,
  apiKeyEnv: "ANTHROPIC_API_KEY",
  apiKey: null,
  headers: {},
  loc: { file: "<builtin>", line: 0 },
});

const OPENAI = (): ProviderDef => ({
  name: "openai",
  api: "openai-completions",
  baseUrl: "https://api.openai.com/v1",
  apiKeyEnv: "OPENAI_API_KEY",
  apiKey: null,
  headers: {},
  loc: { file: "<builtin>", line: 0 },
});

export class ProviderRegistry {
  private providers = new Map<string, ProviderDef>();

  /**
   * Registers one provider definition by name for later model resolution.
   * @param def A declared provider to make available for model resolution.
   * @returns Nothing; later registrations with the same name replace it.
   */
  register(def: ProviderDef): void {
    this.providers.set(def.name, def);
  }

  /**
   * Returns the declared provider, or a built-in definition for anthropic/openai.
   * @param id A provider identifier.
   * @returns The declared provider, or a built-in definition for anthropic/openai.
   */
  resolve(id: string): ProviderDef {
    const declared = this.providers.get(id);
    if (declared) return declared;
    if (id === "anthropic") return ANTHROPIC();
    if (id === "openai") return OPENAI();
    throw new NtError(`unknown provider '${id}'`, null);
  }

  /**
   * Returns the provider and whether a credential is currently available for it.
   * @param id A provider identifier.
   * @returns The provider and whether a credential is currently available for it.
   */
  credentialStatus(id: string): CredentialStatus {
    const provider = this.resolve(id);
    return { provider, hasKey: !!apiKeyFor(provider) };
  }

  /**
   * Returns the model response, normalized across provider APIs.
   * @param req The model request to execute.
   * @returns The model response, normalized across provider APIs.
   */
  async complete(req: LlmRequest): Promise<LlmResponse> {
    const slash = req.model.indexOf("/");
    const providerId = req.model.slice(0, slash);
    const modelId = req.model.slice(slash + 1);
    const def = this.resolve(providerId);
    const key = apiKeyFor(def);
    if (!key)
      throw new NtError(
        `no API key for provider '${providerId}'${def.apiKeyEnv ? ` (set ${def.apiKeyEnv})` : ""}`,
        null,
      );
    return def.api === "anthropic"
      ? callAnthropic(def, key, modelId, req)
      : callOpenAi(def, key, modelId, req);
  }
}

/**
 * Returns the provider's API key from a literal or its environment variable, or null.
 * @param def A provider definition.
 * @returns The provider's API key from a literal or its environment variable, or null.
 */
function apiKeyFor(def: ProviderDef): string | null {
  if (def.apiKey) return def.apiKey;
  if (def.apiKeyEnv) return process.env[def.apiKeyEnv] ?? null;
  return null;
}
