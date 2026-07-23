// packages/frontend/ai-gateway/src/lib/text_adapter_openai_compatible.ts
//
// OpenAI-compatible chat-completions text adapter. Serves both `offline`
// (Ollama / Ooba / local OpenAI-compatible endpoints) and `byok`
// (OpenRouter / OpenAI / Gemini / DeepSeek / custom) modes — the transport
// is identical; endpoint, API key, and headers come from the resolution
// and injected config.
//
// Relocated from apps/frontend/client text_generation_service internals.
// Contract: C-320 AC-2

import type { AiChatMessage, AiModeResolution } from '@aikami/types';
import { createAiGatewayError, toAiGatewayError } from './errors.ts';
import type { AiTextAdapter, AiTextGenerationResult } from './gateway_types.ts';
import {
  GATEWAY_FETCH_TIMEOUT_MS,
  GATEWAY_FIRST_CHUNK_TIMEOUT_MS,
  GATEWAY_IDLE_TIMEOUT_MS,
  readChatSseStream,
} from './sse.ts';
import { createSchemaCompiler, sanitizeJsonResponse, validateAgainstSchema } from './structured.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Provider requires these headers for ranking/attribution on free models (OpenRouter). */
export const OPENROUTER_ATTRIBUTION_HEADERS = {
  'HTTP-Referer': 'https://aikami.app',
  'X-Title': 'Aikami',
} as const;

/** Well-known chat-completions base URLs for local providers. */
export const DEFAULT_LOCAL_TEXT_ENDPOINTS: Record<string, string> = {
  ollama: 'http://localhost:11434',
  ooba: 'http://localhost:5000/v1',
} as const;

/**
 * Ollama VRAM-eviction payload params (C-056 lesson): release the model
 * immediately after generation so image generation can claim VRAM.
 * Formerly mirrored in @aikami/backend/ai (deleted C-324); this is now
 * the canonical copy. Could be promoted to @aikami/constants later.
 */
export const OLLAMA_VRAM_EVICTION_PARAMS = {
  // biome-ignore lint/style/useNamingConvention: Ollama API contract field name
  keep_alive: 0,
  options: {
    // biome-ignore lint/style/useNamingConvention: Ollama API contract field name
    num_parallel: 1,
  },
} as const;

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** Configuration for the OpenAI-compatible text adapter. */
export type OpenAiCompatibleTextAdapterOptions = {
  /** Reads the API key for a provider (vault/config path). */
  getApiKey?: (provider: string) => string | undefined;
  /** Whether a provider supports native `response_format: json_schema`. */
  supportsStructuredOutput?: (provider: string) => boolean;
  /** Default chat base endpoint per provider, when the resolution has none. */
  getDefaultEndpoint?: (provider: string) => string | undefined;
  /** Extra headers per provider (merged after built-in OpenRouter headers). */
  getExtraHeaders?: (provider: string) => Record<string, string> | undefined;
  /** Debug hook — compiled-schema cache size after each compile. */
  onSchemaCacheSize?: (size: number) => void;
  /** Debug/log hook, e.g. ('streaming', {...}), ('fallback', {...}). */
  onEvent?: (event: string, data?: Record<string, unknown>) => void;
  /** Fetch injection for tests. Defaults to globalThis.fetch. */
  fetchFn?: typeof fetch;
  fetchTimeoutMs?: number;
  firstChunkTimeoutMs?: number;
  idleTimeoutMs?: number;
};

// ---------------------------------------------------------------------------
// Adapter factory
// ---------------------------------------------------------------------------

/**
 * Creates the OpenAI-compatible chat-completions text adapter.
 * Register the same instance for both `offline` and `byok` text modes.
 */
export const createOpenAiCompatibleTextAdapter = (
  options?: OpenAiCompatibleTextAdapterOptions,
): AiTextAdapter => {
  const {
    getApiKey,
    supportsStructuredOutput,
    getDefaultEndpoint,
    getExtraHeaders,
    onSchemaCacheSize,
    onEvent,
    fetchFn,
    fetchTimeoutMs = GATEWAY_FETCH_TIMEOUT_MS,
    firstChunkTimeoutMs = GATEWAY_FIRST_CHUNK_TIMEOUT_MS,
    idleTimeoutMs = GATEWAY_IDLE_TIMEOUT_MS,
  } = options ?? {};

  const compiler = createSchemaCompiler({ onCacheSize: onSchemaCacheSize });

  /** Resolves the chat completions URL for the resolution. */
  const resolveChatUrl = (resolution: AiModeResolution): string => {
    const endpoint =
      resolution.endpoint && resolution.endpoint.length > 0
        ? resolution.endpoint
        : (getDefaultEndpoint?.(resolution.provider) ??
          DEFAULT_LOCAL_TEXT_ENDPOINTS[resolution.provider]);

    if (!endpoint) {
      throw createAiGatewayError({
        code: 'not_configured',
        capability: 'text',
        mode: resolution.mode,
        provider: resolution.provider,
        message:
          `No endpoint configured for provider "${resolution.provider}". ` +
          'Create a Connection in Settings or configure a provider endpoint.',
      });
    }

    // Ollama uses its native /api/chat endpoint; strip any OpenAI-compatible
    // /v1 suffix that may be stored in the connection baseUrl.
    if (resolution.provider === 'ollama') {
      const base = endpoint.replace(/\/v1\/?$/, '').replace(/\/$/, '');
      return `${base}/api/chat`;
    }

    const base = endpoint.replace(/\/$/, '');
    return base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
  };

  /** Builds request headers for the resolution. */
  const buildHeaders = (resolution: AiModeResolution): Record<string, string> => {
    const apiKey = getApiKey?.(resolution.provider);
    return {
      'Content-Type': 'application/json',
      // biome-ignore lint/style/useNamingConvention: HTTP header field name
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      ...(resolution.provider === 'openrouter' ? OPENROUTER_ATTRIBUTION_HEADERS : {}),
      ...(getExtraHeaders?.(resolution.provider) ?? {}),
    };
  };

  /** Builds the chat completion body. */
  const buildBody = (options2: {
    resolution: AiModeResolution;
    messages: AiChatMessage[];
  }): Record<string, unknown> => {
    const { resolution, messages } = options2;
    // Ollama native /api/chat works best with stream: false.
    // stream: true returns NDJSON which the SSE parser can't handle.
    const stream = resolution.provider !== 'ollama';
    return {
      model: resolution.model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream,
    };
  };

  /** Performs the streaming fetch and reads the SSE body. */
  const streamCompletion = async (options2: {
    resolution: AiModeResolution;
    body: Record<string, unknown>;
    requestSignal: AbortSignal;
  }): Promise<Response> => {
    const { resolution, body, requestSignal } = options2;
    const doFetch = fetchFn ?? globalThis.fetch;
    const chatUrl = resolveChatUrl(resolution);

    return doFetch(chatUrl, {
      method: 'POST',
      headers: buildHeaders(resolution),
      body: JSON.stringify(body),
      signal: requestSignal,
    });
  };

  /**
   * Runs a request scope with a controller linked to the caller signal for
   * the WHOLE request lifetime (fetch + SSE read) plus the overall fetch
   * timeout. Client disconnect must abort the upstream stream immediately
   * (C-056 VRAM lesson).
   */
  const withRequestScope = async <T>(options2: {
    signal: AbortSignal;
    run: (requestSignal: AbortSignal) => Promise<T>;
  }): Promise<T> => {
    const { signal, run } = options2;
    const requestController = new AbortController();
    const onAbort = (): void => requestController.abort(signal.reason);
    if (signal.aborted) {
      requestController.abort(signal.reason);
    } else {
      signal.addEventListener('abort', onAbort, { once: true });
    }
    const timeoutId = setTimeout(
      () => requestController.abort(new Error('Fetch timed out')),
      fetchTimeoutMs,
    );
    try {
      return await run(requestController.signal);
    } finally {
      clearTimeout(timeoutId);
      signal.removeEventListener('abort', onAbort);
    }
  };

  /** Streams a plain chat completion, accumulating text. */
  const generatePlain = async (options2: {
    resolution: AiModeResolution;
    messages: AiChatMessage[];
    signal: AbortSignal;
    onChunk?: (text: string) => void;
  }): Promise<AiTextGenerationResult> => {
    const { resolution, messages, signal, onChunk } = options2;

    let accumulated = '';
    const deliver = (text: string): void => {
      accumulated += text;
      onChunk?.(text);
    };

    const body = buildBody({ resolution, messages });

    // Ollama native /api/chat with stream: false returns a plain JSON
    // response, not SSE. Parse it directly instead of streaming.
    if (resolution.provider === 'ollama') {
      return withRequestScope({
        signal,
        run: async (requestSignal) => {
          const response = await streamCompletion({ resolution, body, requestSignal });

          if (!response.ok) {
            const errorText = await response.text().catch(() => 'Unknown error');
            onEvent?.('fetch-failed', { status: response.status });
            throw new Error(`Provider HTTP ${response.status}: ${errorText}`);
          }

          onEvent?.('fetch-ok', { status: response.status, stream: false });

          const data = (await response.json()) as {
            message?: { content?: string };
          };
          const text = data.message?.content ?? '';
          onChunk?.(text);
          onEvent?.('done', { chunkCount: text.length > 0 ? 1 : 0 });
          return { text };
        },
      });
    }

    await withRequestScope({
      signal,
      run: async (requestSignal) => {
        const response = await streamCompletion({ resolution, body, requestSignal });

        if (!response.ok) {
          const errorText = await response.text().catch(() => 'Unknown error');
          onEvent?.('fetch-failed', { status: response.status });
          throw new Error(`Provider HTTP ${response.status}: ${errorText}`);
        }

        onEvent?.('fetch-ok', { status: response.status, stream: body.stream });

        if (!response.body) {
          throw new Error(`No response body from provider "${resolution.provider}"`);
        }

        await readChatSseStream({
          body: response.body,
          signal: requestSignal,
          onChunk: deliver,
          firstChunkTimeoutMs,
          idleTimeoutMs,
          onEvent,
        });
      },
    });

    return { text: accumulated };
  };

  /** Structured extraction with native response_format + system-prompt fallback. */
  const generateStructured = async (options2: {
    resolution: AiModeResolution;
    messages: AiChatMessage[];
    schema: Record<string, unknown>;
    schemaName: string;
    signal: AbortSignal;
    onChunk?: (text: string) => void;
  }): Promise<AiTextGenerationResult> => {
    const { resolution, messages, schema, schemaName, signal, onChunk } = options2;

    const compiledSchema = compiler.compile({ schema, schemaName });

    const schemaInstruction = [
      'You are a structured data extraction tool.',
      'Your response MUST be valid JSON that conforms to the following JSON Schema:',
      '```json',
      JSON.stringify(compiledSchema, null, 2),
      '```',
      'Respond ONLY with the JSON object. No markdown fences, no explanations.',
      'Do not include any properties not defined in the schema.',
    ].join('\n');

    // Insert the schema instruction before the final user message,
    // preserving any caller-provided system prompt ordering.
    const structuredMessages: AiChatMessage[] = [
      ...messages.slice(0, -1),
      { role: 'system', content: schemaInstruction },
      ...messages.slice(-1),
    ];

    const providerSupportsStructured = supportsStructuredOutput?.(resolution.provider) ?? false;

    const body = buildBody({ resolution, messages: structuredMessages });

    // Only send response_format for providers that support OpenAI-compatible
    // structured output. Local providers (Ollama, Ooba) ignore it and return
    // plain text.
    if (providerSupportsStructured) {
      body.response_format = {
        type: 'json_schema',
        // biome-ignore lint/style/useNamingConvention: OpenAI API contract field name
        json_schema: {
          name: schemaName,
          schema: compiledSchema,
          strict: true,
        },
      };
    }

    let accumulated = '';
    const deliver = (text: string): void => {
      accumulated += text;
      onChunk?.(text);
    };

    const outcome = await withRequestScope({
      signal,
      run: async (requestSignal): Promise<{ fallback: 'http-400' } | { fallback?: undefined }> => {
        const response = await streamCompletion({ resolution, body, requestSignal });

        if (!response.ok) {
          const errorText = await response.text().catch(() => 'Unknown error');
          onEvent?.('fetch-failed', { status: response.status });

          // Provider rejected structured output — fall back to the
          // system-prompt approach via a plain streaming completion.
          if (response.status === 400) {
            return { fallback: 'http-400' };
          }

          throw new Error(`Provider HTTP ${response.status}: ${errorText}`);
        }

        if (!response.body) {
          throw new Error(`No response body from provider "${resolution.provider}"`);
        }

        await readChatSseStream({
          body: response.body,
          signal: requestSignal,
          onChunk: deliver,
          firstChunkTimeoutMs,
          idleTimeoutMs,
          onEvent,
        });
        return {};
      },
    });

    if (outcome.fallback === 'http-400') {
      onEvent?.('structured-fallback', { reason: 'http-400' });
      const fallback = await generatePlain({
        resolution,
        messages: structuredMessages,
        signal,
      });
      return parseStructured({ accumulated: fallback.text, schema, schemaName });
    }

    try {
      return parseStructured({ accumulated, schema, schemaName });
    } catch (parseError) {
      // Provider returned 200 but the output wasn't valid JSON — likely a
      // provider that doesn't support structured output. Fall back to the
      // system-prompt approach via a plain streaming completion.
      onEvent?.('structured-fallback', { reason: String(parseError) });
      const fallback = await generatePlain({ resolution, messages: structuredMessages, signal });
      return parseStructured({ accumulated: fallback.text, schema, schemaName });
    }
  };

  /** Parses + validates accumulated structured output. */
  const parseStructured = (options2: {
    accumulated: string;
    schema: Record<string, unknown>;
    schemaName: string;
  }): AiTextGenerationResult => {
    const { accumulated, schema, schemaName } = options2;
    const cleaned = sanitizeJsonResponse(accumulated);
    const parsed = JSON.parse(cleaned);
    const isValid = validateAgainstSchema({ schema, parsed });
    if (!isValid) {
      onEvent?.('validation-failed', { schemaName });
    }
    return { text: accumulated, structured: parsed };
  };

  return {
    provider: 'openai_compatible',
    async generateText(request): Promise<AiTextGenerationResult> {
      const { resolution, signal, messages, onChunk, schema, schemaName } = request;

      if (signal.aborted) {
        throw createAiGatewayError({
          code: 'cancelled',
          capability: 'text',
          mode: resolution.mode,
          provider: resolution.provider,
          message: 'Aborted',
        });
      }

      try {
        if (schema && schemaName) {
          return await generateStructured({
            resolution,
            messages,
            schema,
            schemaName,
            signal,
            onChunk,
          });
        }
        return await generatePlain({ resolution, messages, signal, onChunk });
      } catch (error) {
        throw toAiGatewayError({
          error,
          capability: 'text',
          mode: resolution.mode,
          provider: resolution.provider,
        });
      }
    },
  };
};
