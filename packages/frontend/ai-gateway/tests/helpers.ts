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

/**
 * Builds one Ollama-native NDJSON frame.
 *
 * `content` and `thinking` are separate channels on the same surface: a
 * reasoning model emits `thinking` frames for seconds before any `content`
 * exists, and a fixture that only ever sets `content` cannot exercise the case
 * that matters most.
 */
export const ndjsonFrame = (options: {
  content?: string;
  thinking?: string;
  done?: boolean;
  doneReason?: string;
  usage?: { promptTokens: number; evalTokens: number; cachedTokens?: number };
}): string => {
  const message: Record<string, unknown> = { role: 'assistant' };
  if (options.content !== undefined) {
    message.content = options.content;
  }
  if (options.thinking !== undefined) {
    message.thinking = options.thinking;
  }
  const frame: Record<string, unknown> = { model: 'mock', message, done: options.done === true };
  if (options.done === true) {
    frame.done_reason = options.doneReason ?? 'stop';
    const usage = options.usage;
    if (usage !== undefined) {
      frame.prompt_eval_count = usage.promptTokens;
      frame.eval_count = usage.evalTokens;
      if (usage.cachedTokens !== undefined) {
        frame.prompt_eval_cached_count = usage.cachedTokens;
      }
    }
  }
  return `${JSON.stringify(frame)}\n`;
};

/** The terminating Ollama-native frame, with its own accounting counters. */
export const NATIVE_DONE = (options?: {
  doneReason?: string;
  usage?: { promptTokens: number; evalTokens: number; cachedTokens?: number };
}): string =>
  ndjsonFrame({
    content: '',
    done: true,
    ...(options?.doneReason === undefined ? {} : { doneReason: options.doneReason }),
    ...(options?.usage === undefined ? {} : { usage: options.usage }),
  });

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
 * Wraps a payload in a ReadableStream, optionally sliced into fixed byte groups.
 *
 * Byte slicing is how a split inside a multi-byte UTF-8 character and a split
 * inside a JSON object are produced: the test controls the boundaries, so both
 * are reachable without a real provider.
 */
export const syntheticGroupedBody = (
  payload: string,
  grouping?: number,
): ReadableStream<Uint8Array> => {
  const bytes = new TextEncoder().encode(payload);
  if (grouping === undefined || grouping <= 0) {
    return new ReadableStream({
      start(controller): void {
        controller.enqueue(bytes);
        controller.close();
      },
    });
  }
  return new ReadableStream({
    start(controller): void {
      for (let offset = 0; offset < bytes.length; offset += grouping) {
        controller.enqueue(bytes.slice(offset, offset + grouping));
      }
      controller.close();
    },
  });
};

/**
 * A mock fetch for Ollama's NATIVE NDJSON surface.
 *
 * Separate from `createSseFetchMock` on purpose: the two wire formats are
 * different protocols, and a fixture shared between them would let a test pass
 * against an SSE body while the code is on the NDJSON path — which is exactly
 * the substitution that made the old buffered route look streaming.
 */
export const createNativeNdjsonFetchMock = (options?: {
  /** Raw lines, already newline-terminated unless `trailingNewline` is false. */
  lines?: string[];
  /** Emit lines in fixed byte groups, to exercise split frames. */
  byteGrouping?: number;
  /** Omit the newline after the final line. */
  trailingNewline?: boolean;
  status?: number;
  statusBody?: string;
}): { fetchFn: typeof fetch; calls: CapturedFetch[] } => {
  const {
    lines = [ndjsonFrame({ content: 'Hello' }), NATIVE_DONE()],
    byteGrouping,
    trailingNewline = true,
    status = 200,
    statusBody = '',
  } = options ?? {};
  const calls: CapturedFetch[] = [];
  const payload = trailingNewline ? lines.join('') : lines.join('').replace(/\n$/, '');

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
      new Response(syntheticGroupedBody(payload, byteGrouping), {
        status: 200,
        headers: { 'Content-Type': 'application/x-ndjson' },
      }),
    );
  }) as typeof fetch;

  return { fetchFn, calls };
};

/**
 * Creates a mock fetch that returns a whole JSON body.
 * Used for BUFFERED native /api/chat requests — the structured path, and the
 * opt-in buffered narrative path.
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
    ollama?: { promptTokens: number; outputTokens: number; cachedTokens?: number };
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
  ollama?: { promptTokens: number; outputTokens: number; cachedTokens?: number };
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
    if (usage.ollama.cachedTokens !== undefined) {
      fields.prompt_eval_cached_count = usage.ollama.cachedTokens;
    }
  }
  return fields;
};

/**
 * A read-window factory that counts how many windows were created and how many
 * are still undisposed.
 *
 * Exists for the timer-leak regression: before, each `reader.read()` minted a
 * `setTimeout` and threw the handle away when a chunk won the race, so a long
 * stream left one live timer per chunk behind it. `live` returning 0 after a
 * completed read is the assertion that they are released on EVERY path.
 */
export const createLocalWindowProbe = (): {
  window: (requestedMs: number) => { signal: AbortSignal; dispose: () => void };
  created: number;
  live: () => number;
} => {
  let created = 0;
  let liveWindows = 0;
  return {
    window: () => {
      created += 1;
      liveWindows += 1;
      const controller = new AbortController();
      return {
        signal: controller.signal,
        dispose: () => {
          liveWindows -= 1;
        },
      };
    },
    get created(): number {
      return created;
    },
    live: () => liveWindows,
  };
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
