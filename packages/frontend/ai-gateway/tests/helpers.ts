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
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
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
}): { fetchFn: typeof fetch; calls: CapturedFetch[] } => {
  const {
    content = 'Hello from JSON mock',
    status = 200,
    statusBody = '',
  } = options ?? {};
  const calls: CapturedFetch[] = [];

  const fetchFn = ((input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
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
      new Response(JSON.stringify({ message: { content } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  }) as typeof fetch;

  return { fetchFn, calls };
};

/** A mixed-mode gateway config fixture: text offline + image byok + voice offline. */
export const mixedModeConfig = (): AiGatewayModeConfig => ({
  text: { mode: 'offline', provider: 'ollama', model: 'llama3' },
  image: { mode: 'byok', provider: 'comfyui', endpoint: 'https://images.example.com' },
  voice: { mode: 'offline', provider: 'kokoro' },
  serviceActivated: false,
});
