// packages/backend/ai/src/lib/openrouter_adapter.ts
/** biome-ignore-all lint/style/useNamingConvention: OpenAI API uses snake_case field names */

import type { TextGenerationRequest } from './text_generation_types.ts';

const OPENROUTER_DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
const OPENROUTER_DEFAULT_MODEL = 'openai/gpt-4o';

/**
 * An OpenAI-compatible streaming delta chunk from OpenRouter's SSE response.
 */
type OpenRouterDeltaChunk = {
  choices?: Array<{
    delta?: { content?: string };
    finish_reason?: string | null;
  }>;
};

/**
 * Build the OpenAI-compatible chat completion request body for OpenRouter.
 *
 * Converts the {@link TextGenerationRequest} into the standard
 * `{ model, messages, stream: true }` payload expected by OpenRouter's
 * `/chat/completions` endpoint.
 *
 * @param request — The text generation request with prompt and optional history.
 * @returns The OpenAI-compatible request payload.
 */
export const buildOpenRouterPayload = (request: TextGenerationRequest): Record<string, unknown> => {
  const messages: Array<{ role: string; content: string }> = [];

  if (request.systemPrompt) {
    messages.push({ role: 'system', content: request.systemPrompt });
  }

  for (const message of request.messages ?? []) {
    messages.push({ role: message.role, content: message.content });
  }

  messages.push({ role: 'user', content: request.prompt });

  return {
    model: request.model ?? OPENROUTER_DEFAULT_MODEL,
    messages,
    stream: true,
  };
};

/**
 * Parse OpenRouter's SSE stream into a standardized ReadableStream.
 *
 * OpenRouter returns SSE lines in OpenAI format:
 * ```
 * data: {"id":"chatcmpl-...","choices":[{"delta":{"content":"text"}}]}
 * data: [DONE]
 * ```
 *
 * Each non-empty `delta.content` is emitted as a standardized SSE event:
 * `data: {"text":"text"}\n\n`. The `[DONE]` sentinel is passed through.
 *
 * @param response — The fetch Response from OpenRouter's /chat/completions endpoint.
 * @param signal — Optional AbortSignal to stop the upstream reader.
 * @returns A ReadableStream of Uint8Array-encoded SSE events.
 */
export const parseOpenRouterStream = (
  response: Response,
  signal?: AbortSignal,
): ReadableStream<Uint8Array> => {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('OpenRouter response has no readable body');
  }

  const decoder = new TextDecoder();

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (signal?.aborted) {
        controller.close();
        return;
      }

      const { value, done } = await reader.read();
      if (done) {
        controller.close();
        return;
      }

      const text = decoder.decode(value, { stream: true });
      const lines = text.split('\n').filter((line) => line.startsWith('data: '));

      for (const line of lines) {
        const data = line.slice(6).trim();

        if (data === '[DONE]') {
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
          continue;
        }

        try {
          const chunk = JSON.parse(data) as OpenRouterDeltaChunk;
          const content = chunk.choices?.[0]?.delta?.content;

          if (content) {
            const sseEvent = `data: ${JSON.stringify({ text: content })}\n\n`;
            controller.enqueue(new TextEncoder().encode(sseEvent));
          }
        } catch {
          // Skip invalid JSON lines
        }
      }
    },

    cancel() {
      reader.cancel();
    },
  });
};

/**
 * Create an OpenRouter text generation stream.
 *
 * POSTs to OpenRouter's `/chat/completions` endpoint with standard
 * OpenAI-compatible chat completion payload and `stream: true`.
 * Authenticates via `Authorization: Bearer <apiKey>` header.
 *
 * @param request — The text generation request with prompt and optional history.
 * @param options.baseUrl — OpenRouter base URL (default: https://openrouter.ai/api/v1).
 * @param options.apiKey — OpenRouter API key sent as Bearer token.
 * @param options.signal — AbortSignal to cancel upstream fetch on client disconnect.
 * @param options._fetch — Inject mock fetch for testing.
 * @returns A ReadableStream of Uint8Array-encoded SSE events.
 */
export const createOpenRouterStream = async (options: {
  request: TextGenerationRequest;
  baseUrl?: string;
  apiKey?: string;
  signal?: AbortSignal;
  _fetch?: typeof fetch;
}): Promise<ReadableStream<Uint8Array>> => {
  const { request, baseUrl, apiKey, signal, _fetch } = options;
  const fetchImpl = _fetch ?? fetch;
  const url = `${baseUrl ?? OPENROUTER_DEFAULT_BASE_URL}/chat/completions`;
  const payload = buildOpenRouterPayload(request);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const response = await fetchImpl(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok) {
    throw new Error(`OpenRouter returned ${response.status}: ${response.statusText}`);
  }

  return parseOpenRouterStream(response, signal);
};
