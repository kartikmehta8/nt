/**
 * @file Provider-specific HTTP request and response adapters.
 *
 * Converts NT's normalized model request into Anthropic Messages or
 * OpenAI-compatible chat payloads, applies bounded request deadlines, parses
 * tool calls and usage back into one `LlmResponse`, and truncates provider error
 * bodies. Provider selection and credential lookup remain in `provider.ts` so
 * this module owns network translation only.
 */

import { MAX_ERROR_BODY_CHARS, PROVIDER_TIMEOUT_MS } from "#constants";
import { NtError } from "#errors";
import type { ContentBlock, LlmRequest, LlmResponse } from "#provider";
import type { ProviderDef, ThinkingLevel } from "#types";

const EFFORT: Record<Exclude<ThinkingLevel, "off">, string> = {
  minimal: "low",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "max",
};

async function errorBody(response: Response): Promise<string> {
  if (!response.body) return "";
  const maxBytes = MAX_ERROR_BODY_CHARS * 4;
  const reader = response.body.getReader();
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
 * Sends one normalized request to the configured Anthropic Messages endpoint.
 * @param def The resolved Anthropic provider definition.
 * @param key The resolved API credential.
 * @param modelId The provider-local model identifier.
 * @param request The normalized model request.
 * @returns A normalized model response.
 */
export async function callAnthropic(
  def: ProviderDef,
  key: string,
  modelId: string,
  request: LlmRequest,
): Promise<LlmResponse> {
  const body: Record<string, unknown> = {
    model: modelId,
    max_tokens: request.maxTokens,
    messages: request.messages,
  };
  if (request.system) body.system = request.system;
  if (request.tools?.length) body.tools = request.tools;
  const outputConfig: Record<string, unknown> = {};
  if (request.thinking === "off") body.thinking = { type: "disabled" };
  else if (request.thinking) {
    body.thinking = { type: "adaptive" };
    outputConfig.effort = EFFORT[request.thinking];
  }
  if (request.outputSchema)
    outputConfig.format = { type: "json_schema", schema: request.outputSchema };
  if (Object.keys(outputConfig).length) body.output_config = outputConfig;
  const response = await fetch(`${def.baseUrl ?? "https://api.anthropic.com"}/v1/messages`, {
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
  if (!response.ok)
    throw new NtError(`anthropic API error ${response.status}: ${await errorBody(response)}`, null);
  const json = (await response.json()) as {
    content: ContentBlock[];
    stop_reason: string;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const content = json.content ?? [];
  return {
    content,
    stopReason: json.stop_reason,
    text: content
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join(""),
    usage: { input: json.usage?.input_tokens ?? 0, output: json.usage?.output_tokens ?? 0 },
  };
}

/**
 * Sends one normalized request to an OpenAI-compatible Chat Completions endpoint.
 * @param def The resolved OpenAI-compatible provider definition.
 * @param key The resolved API credential.
 * @param modelId The provider-local model identifier.
 * @param request The normalized model request.
 * @returns A normalized model response.
 */
export async function callOpenAi(
  def: ProviderDef,
  key: string,
  modelId: string,
  request: LlmRequest,
): Promise<LlmResponse> {
  const messages: unknown[] = [];
  if (request.system) messages.push({ role: "system", content: request.system });
  for (const message of request.messages)
    messages.push({
      role: message.role,
      content:
        typeof message.content === "string" ? message.content : JSON.stringify(message.content),
    });
  const response = await fetch(`${def.baseUrl ?? "https://api.openai.com/v1"}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
      ...def.headers,
    },
    body: JSON.stringify({ model: modelId, messages, max_tokens: request.maxTokens }),
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });
  if (!response.ok)
    throw new NtError(`openai API error ${response.status}: ${await errorBody(response)}`, null);
  const json = (await response.json()) as {
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
