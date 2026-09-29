// packages/frontend/ai-gateway/tests/helpers.ts
//
// Test helpers — synthetic SSE streams and fetch mocks for deterministic
// adapter tests (mirrors the SyntheticSseMock approach from C-056).

import type { AiGatewayModeConfig } from '@aikami/types';

/** Builds an OpenAI-compatible SSE data line for a token. */
export const sseChunk = (text: string): string =>
  `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;

/** SSE end-of-stream signal. */
export const SSE_DONE = 'data: [DONE]\n\n';

/**
 * Builds the trailing OpenAI-compatible token-accounting frame.
 *
 * Providers send it only when asked (`stream_options.include_usage`), which is
 * why its absence must mean "unknown" rather than "zero".
 */
export const sseUsage = (options: {
  promptTokens: number;
  completionTokens: number;
  cachedTokens?: number;
}): string => {
  const usage: Record<string, unknown> = {
    // biome-ignore lint/style/useNamingConvention: OpenAI API contract field name
    prompt_tokens: options.promptTokens,
    // biome-ignore lint/style/useNamingConvention: OpenAI API contract field name
    completion_tokens: options.completionTokens,
  };
  if (options.cachedTokens !== undefined) {
    // biome-ignore lint/style/useNamingConvention: OpenAI API contract field name
    usage.prompt_tokens_details = { cached_tokens: options.cachedTokens };
  }
  return `data: ${JSON.stringify({ usage })}\n\n`;
};

/** Creates a ReadableStream that emits the given SSE lines then closes. */
export const syntheticSseBody = (chunks: string[]): ReadableStream<Uint8Array> => {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller): void {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
};

/** Record of a captured fetch call. */
export type CapturedFetch = {
  url: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
  signal: AbortSignal | undefined;
};

/** Normalize a fetch input (string | URL | Request) to its string href. */
const inputUrl = (input: string | URL | Request): string => {
  if (typeof input === 'string') {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
};

/**
 * Creates a mock fetch that returns a synthetic SSE response and records
 * every call.
 */
export const createSseFetchMock = (options?: {
  chunks?: string[];
  status?: number;
  statusBody?: string;
}): { fetchFn: typeof fetch; calls: CapturedFetch[] } => {
  const { chunks = [sseChunk('Hello'), SSE_DONE], status = 200, statusBody = '' } = options ?? {};
  const calls: CapturedFetch[] = [];

  const fetchFn = ((input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = inputUrl(input);
    let body: Record<string, unknown> = {};
    if (init?.body && typeof init.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        // ignore
      }
    }
    const headers: Record<string, string> = {};
    if (init?.headers) {
      for (const [key, value] of Object.entries(init.headers as Record<string, string>)) {
        headers[key] = value;
      }
    }
    calls.push({ url, body, headers, signal: init?.signal ?? undefined });

    if (status !== 200) {
      return Promise.resolve(new Response(statusBody, { status }));
    }

    return Promise.resolve(
      new Response(syntheticSseBody(chunks), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );
  }) as typeof fetch;

  return { fetchFn, calls };
};

/**
 * Creates a mock fetch that returns a plain JSON response (no streaming/SSE).
 * Used for Ollama native /api/chat tests where the adapter calls response.json()
 * instead of reading an SSE stream.
 */
export const createJsonFetchMock = (options?: {
  content?: string;
  status?: number;
  statusBody?: string;
  /**
   * Token accounting merged into the response body, in each provider's own
   * shape. Omit it to model a provider that reports no accounting at all.
   */
  usage?: {
    /** OpenAI-shaped `{ prompt_tokens, completion_tokens }`. */
    openAi?: { promptTokens: number; completionTokens: number; cachedTokens?: number };
    /** Ollama-native `{ prompt_eval_count, eval_count }`. */
    ollama?: { promptTokens: number; outputTokens: number };
  };
}): { fetchFn: typeof fetch; calls: CapturedFetch[] } => {
  const { content = 'Hello from JSON mock', status = 200, statusBody = '', usage } = options ?? {};
  const calls: CapturedFetch[] = [];

  const fetchFn = ((input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = inputUrl(input);
    let body: Record<string, unknown> = {};
    if (init?.body && typeof init.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        // ignore
      }
    }
    const headers: Record<string, string> = {};
    if (init?.headers) {
      for (const [key, value] of Object.entries(init.headers as Record<string, string>)) {
        headers[key] = value;
      }
    }
    calls.push({ url, body, headers, signal: init?.signal ?? undefined });

    if (status !== 200) {
      return Promise.resolve(new Response(statusBody, { status }));
    }

    return Promise.resolve(
      new Response(JSON.stringify({ message: { content }, ...usageFields(usage) }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  }) as typeof fetch;

  return { fetchFn, calls };
};

/** Serializes a mock's token accounting into each provider's own field names. */
const usageFields = (usage?: {
  openAi?: { promptTokens: number; completionTokens: number; cachedTokens?: number };
  ollama?: { promptTokens: number; outputTokens: number };
}): Record<string, unknown> => {
  const fields: Record<string, unknown> = {};
  if (usage?.openAi !== undefined) {
    const openAi: Record<string, unknown> = {
      // biome-ignore lint/style/useNamingConvention: OpenAI API contract field name
      prompt_tokens: usage.openAi.promptTokens,
      // biome-ignore lint/style/useNamingConvention: OpenAI API contract field name
      completion_tokens: usage.openAi.completionTokens,
    };
    if (usage.openAi.cachedTokens !== undefined) {
      openAi.prompt_tokens_details = {
        // biome-ignore lint/style/useNamingConvention: OpenAI API contract field name
        cached_tokens: usage.openAi.cachedTokens,
      };
    }
    fields.usage = openAi;
  }
  if (usage?.ollama !== undefined) {
    fields.prompt_eval_count = usage.ollama.promptTokens;
    fields.eval_count = usage.ollama.outputTokens;
  }
  return fields;
};

/** A mixed-mode gateway config fixture: text offline + image byok + voice offline. */
export const mixedModeConfig = (): AiGatewayModeConfig => ({
  text: {
    mode: 'offline',
    provider: 'ollama',
    model: 'llama3',
    endpoint: 'http://10.0.0.5:8080/v1',
  },
  image: { mode: 'byok', provider: 'comfyui', endpoint: 'https://images.example.com' },
  voice: { mode: 'offline', provider: 'kokoro' },
  serviceActivated: false,
});
