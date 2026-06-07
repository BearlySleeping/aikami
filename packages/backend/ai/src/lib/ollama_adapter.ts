// packages/backend/ai/src/lib/ollama_adapter.ts
/** biome-ignore-all lint/style/useNamingConvention: Ollama API uses snake_case field names */

import type { TextGenerationRequest } from './text_generation_types.ts';
import { OLLAMA_VRAM_EVICTION_PARAMS } from './text_generation_types.ts';

const OLLAMA_DEFAULT_BASE_URL = 'http://localhost:11434';
const OLLAMA_DEFAULT_MODEL = 'llama3.2';

/**
 * An individual chunk from Ollama's /api/generate streaming response.
 */
type OllamaGenerateChunk = {
  model: string;
  created_at: string;
  response: string;
  done: boolean;
};

/**
 * Build the Ollama /api/generate request body.
 *
 * Always forcibly merges {@link OLLAMA_VRAM_EVICTION_PARAMS} into the payload
 * to ensure instant VRAM eviction (keep_alive: 0) and single-thread
 * enforcement (num_parallel: 1) — AC-2 mandate.
 *
 * @param request — The text generation request.
 * @returns The Ollama API request payload.
 */
export const buildOllamaPayload = (request: TextGenerationRequest): Record<string, unknown> => {
  const systemPrompt = request.systemPrompt;
  const messages = request.messages ?? [];

  let fullPrompt = '';

  if (systemPrompt) {
    fullPrompt += `System: ${systemPrompt}\n\n`;
  }

  for (const message of messages) {
    fullPrompt += `${message.role}: ${message.content}\n`;
  }

  fullPrompt += `user: ${request.prompt}`;

  return {
    model: request.model ?? OLLAMA_DEFAULT_MODEL,
    prompt: fullPrompt,
    ...OLLAMA_VRAM_EVICTION_PARAMS,
  };
};

/**
 * Parse Ollama's SSE stream into a standardized ReadableStream of text chunks.
 *
 * Ollama returns newline-delimited JSON (`application/x-ndjson`), one chunk
 * per line. Each chunk carries `{ response: "...", done: false }` until the
 * terminal chunk which has `{ done: true }`.
 *
 * Output is formatted as SSE events: `data: {"text":"..."}\n\n` with a
 * terminal `data: [DONE]\n\n` event.
 *
 * @param response — The fetch Response from Ollama's /api/generate endpoint.
 * @param signal — Optional AbortSignal to stop the upstream reader.
 * @returns A ReadableStream of Uint8Array-encoded SSE events.
 */
export const parseOllamaStream = (
  response: Response,
  signal?: AbortSignal,
): ReadableStream<Uint8Array> => {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Ollama response has no readable body');
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
      const lines = text.split('\n').filter(Boolean);

      for (const line of lines) {
        try {
          const chunk = JSON.parse(line) as OllamaGenerateChunk;

          if (chunk.done) {
            controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
          } else {
            const sseEvent = `data: ${JSON.stringify({ text: chunk.response })}\n\n`;
            controller.enqueue(new TextEncoder().encode(sseEvent));
          }
        } catch {
          // Skip non-JSON lines (keepalive pings, empty lines)
        }
      }
    },

    cancel() {
      reader.cancel();
    },
  });
};

/**
 * Create an Ollama text generation stream.
 *
 * POSTs to Ollama's `/api/generate` endpoint with the VRAM eviction parameters
 * forcibly merged into the payload (AC-2). Parses the raw Ollama ndjson stream
 * into standardized SSE events.
 *
 * @param request — The text generation request with prompt and optional history.
 * @param options.baseUrl — Ollama server base URL (default: http://localhost:11434).
 * @param options.signal — AbortSignal to cancel the upstream fetch on client disconnect.
 * @param options._fetch — Inject a mock fetch for testing (not for production use).
 * @returns A ReadableStream of Uint8Array-encoded SSE events.
 */
export const createOllamaStream = async (options: {
  request: TextGenerationRequest;
  baseUrl?: string;
  signal?: AbortSignal;
  _fetch?: typeof fetch;
}): Promise<ReadableStream<Uint8Array>> => {
  const { request, baseUrl, signal, _fetch } = options;
  const fetchImpl = _fetch ?? fetch;
  const url = `${baseUrl ?? OLLAMA_DEFAULT_BASE_URL}/api/generate`;
  const payload = buildOllamaPayload(request);

  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok) {
    throw new Error(`Ollama returned ${response.status}: ${response.statusText}`);
  }

  return parseOllamaStream(response, signal);
};
