/**
 * @file Language-model providers, selected by the `provider/model-id` prefix.
 *
 * `ProviderRegistry` resolves a model string to a declared or built-in provider
 * (anthropic, openai), reports credential status for `bringUp`, and issues
 * completions — translating the engine's normalized request into the Anthropic
 * Messages API (adaptive thinking, effort, structured output) or an
 * OpenAI-compatible chat endpoint, then normalizing the response back.
 */

import { MAX_ERROR_BODY_CHARS, PROVIDER_TIMEOUT_MS } from "#constants";
import { NtError } from "#errors";
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

const EFFORT: Record<Exclude<ThinkingLevel, "off">, string> = {
  minimal: "low",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "max",
};

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
   * @param def A declared provider to make available for model resolution.
   */
  register(def: ProviderDef): void {
    this.providers.set(def.name, def);
  }

  /**
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
   * @param id A provider identifier.
   * @returns The provider and whether a credential is currently available for it.
   */
  credentialStatus(id: string): CredentialStatus {
    const provider = this.resolve(id);
    return { provider, hasKey: !!apiKeyFor(provider) };
  }

  /**
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
 * @param def A provider definition.
 * @returns The provider's API key from a literal or its environment variable, or null.
 */
function apiKeyFor(def: ProviderDef): string | null {
  if (def.apiKey) return def.apiKey;
  if (def.apiKeyEnv) return process.env[def.apiKeyEnv] ?? null;
  return null;
}

/**
 * Reads the body as a stream and stops at a byte cap, so a hostile endpoint
 * cannot force the process to buffer an arbitrarily large error response.
 *
 * @param res A failed provider response.
 * @returns The response body truncated to a size safe to embed in an error message.
 */
async function errorBody(res: Response): Promise<string> {
  if (!res.body) return "";
  const maxBytes = MAX_ERROR_BODY_CHARS * 4;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
  } catch {
    return "";
  } finally {
    await reader.cancel().catch(() => {});
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text.length > MAX_ERROR_BODY_CHARS ? text.slice(0, MAX_ERROR_BODY_CHARS) + "…" : text;
}

/**
 * @returns The response from Anthropic's Messages API, normalized.
 */
async function callAnthropic(
  def: ProviderDef,
  key: string,
  modelId: string,
  req: LlmRequest,
): Promise<LlmResponse> {
  const body: Record<string, unknown> = {
    model: modelId,
    max_tokens: req.maxTokens,
    messages: req.messages,
  };
  if (req.system) body.system = req.system;
  if (req.tools && req.tools.length) body.tools = req.tools;

  const outputConfig: Record<string, unknown> = {};
  if (req.thinking === "off") body.thinking = { type: "disabled" };
  else if (req.thinking) {
    body.thinking = { type: "adaptive" };
    outputConfig.effort = EFFORT[req.thinking];
  }
  if (req.outputSchema) outputConfig.format = { type: "json_schema", schema: req.outputSchema };
  if (Object.keys(outputConfig).length) body.output_config = outputConfig;

  const res = await fetch(`${def.baseUrl ?? "https://api.anthropic.com"}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      ...def.headers,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });
  if (!res.ok)
    throw new NtError(`anthropic API error ${res.status}: ${await errorBody(res)}`, null);

  const json = (await res.json()) as {
    content: ContentBlock[];
    stop_reason: string;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const content = json.content ?? [];
  return {
    content,
    stopReason: json.stop_reason,
    text: content
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join(""),
    usage: { input: json.usage?.input_tokens ?? 0, output: json.usage?.output_tokens ?? 0 },
  };
}

/**
 * @returns The response from an OpenAI-compatible chat completions endpoint, normalized.
 */
async function callOpenAi(
  def: ProviderDef,
  key: string,
  modelId: string,
  req: LlmRequest,
): Promise<LlmResponse> {
  const messages: unknown[] = [];
  if (req.system) messages.push({ role: "system", content: req.system });
  for (const m of req.messages)
    messages.push({
      role: m.role,
      content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
    });

  const res = await fetch(`${def.baseUrl ?? "https://api.openai.com/v1"}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}`, ...def.headers },
    body: JSON.stringify({ model: modelId, messages, max_tokens: req.maxTokens }),
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });
  if (!res.ok) throw new NtError(`openai API error ${res.status}: ${await errorBody(res)}`, null);

  const json = (await res.json()) as {
    choices: { message: { content: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const text = json.choices?.[0]?.message?.content ?? "";
  return {
    content: [{ type: "text", text }],
    stopReason: "end_turn",
    text,
    usage: { input: json.usage?.prompt_tokens ?? 0, output: json.usage?.completion_tokens ?? 0 },
  };
}
