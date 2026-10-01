// packages/frontend/ai-gateway/src/lib/text_body.ts
//
// Constructing — and reading whole — the provider request body.
//
// Split out of `text_adapter_openai_compatible.ts` because "what bytes go on the
// wire" is a distinct responsibility from "when do we stop waiting", and the two
// had grown into one 1 100-line file in which neither could be read on its own.
// Two properties in here are the ones the wire evidence turned on:
//
//   - Native generation options go under Ollama's own `options` key. Spreading
//     the map flat puts `temperature` beside `model` and `messages`, where the
//     provider silently ignores it — the "configured but not honoured" state
//     #382 set out to eliminate.
//   - Only a whole-body response can be read by `readJsonCompletion`. The
//     streaming narrative path reads its accounting off the terminating NDJSON
//     frame through `native_usage.ts` instead, so this stays a whole-body-only
//     reader rather than becoming a second usage path.

import type { AiChatMessage, AiModeResolution } from '@aikami/types';
import { createAiGatewayError } from './errors.ts';
import type { AiTextUsage } from './gateway_types.ts';
import { buildNativeOptions, type NativeOptionsReport } from './native_options.ts';
import { readNativeUsage } from './native_usage.ts';
import {
  buildReasoningParams,
  type ReasoningControl,
  resolveChatSurface,
} from './reasoning_control.ts';
import { readOpenAiUsage } from './structured.ts';

/** Provider requires these headers for ranking/attribution on free models (OpenRouter). */
export const OPENROUTER_ATTRIBUTION_HEADERS = {
  'HTTP-Referer': 'https://aikami.app',
  'X-Title': 'Aikami',
} as const;

/** Well-known chat-completions base URLs for local providers.
 *  Kept empty: local endpoints resolve at runtime from config.json (C-389)
 *  via the `getDefaultEndpoint` option — the bundle never embeds a
 *  hardcoded engine URL.
 */
export const DEFAULT_LOCAL_TEXT_ENDPOINTS: Record<string, string> = {} as const;

/**
 * An OpenAI-compatible base URL typed as a bare host ("https://api.example.com")
 * carries no version segment, and `<host>/chat/completions` is a 404 there. The
 * editor's model test already probes `<root>/v1/chat/completions`, so the runtime
 * has to agree — otherwise a custom endpoint can pass its own test and then fail
 * the moment the game calls it. A base that already names a path is used
 * verbatim; only a host-root base gains `/v1`.
 */
const withOpenAiVersionSegment = (base: string): string => {
  const trimmed = base.replace(/\/+$/, '');
  try {
    const { pathname } = new URL(trimmed);
    return pathname === '/' || pathname === '' ? `${trimmed}/v1` : trimmed;
  } catch {
    return trimmed;
  }
};

/** Resolves the chat completions URL for a resolution. */
export const resolveChatUrl = (options: {
  resolution: AiModeResolution;
  getDefaultEndpoint?: (provider: string) => string | undefined;
}): string => {
  const { resolution, getDefaultEndpoint } = options;
  const endpoint =
    resolution.endpoint && resolution.endpoint.length > 0
      ? resolution.endpoint
      : getDefaultEndpoint?.(resolution.provider);

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
  if (resolveChatSurface(resolution) === 'ollama-native') {
    const base = endpoint.replace(/\/v1\/?$/, '').replace(/\/$/, '');
    return `${base}/api/chat`;
  }

  const base = withOpenAiVersionSegment(endpoint);
  return base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
};

/** Builds request headers for a resolution. */
export const buildHeaders = (options: {
  resolution: AiModeResolution;
  getApiKey?: (provider: string) => string | undefined;
  getExtraHeaders?: (provider: string) => Record<string, string> | undefined;
}): Record<string, string> => {
  const { resolution, getApiKey, getExtraHeaders } = options;
  const apiKey = getApiKey?.(resolution.provider);
  return {
    'Content-Type': 'application/json',
    // biome-ignore lint/style/useNamingConvention: HTTP header field name
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    ...(resolution.provider === 'openrouter' ? OPENROUTER_ATTRIBUTION_HEADERS : {}),
    ...(getExtraHeaders?.(resolution.provider) ?? {}),
  };
};

/**
 * Maps the resolved connection's TextParams onto OpenAI-compatible fields.
 *
 * Native Ollama requests do NOT come through here — they use
 * `buildNativeOptions`, whose allow-list is derived from measured fields rather
 * than from field-name similarity.
 */
const buildGenerationParams = (resolution: AiModeResolution): Record<string, unknown> => {
  const { params, provider } = resolution;
  if (!params || provider === 'ollama') {
    return {};
  }
  return {
    temperature: params.temperature,
    // biome-ignore lint/style/useNamingConvention: OpenAI API contract field name
    top_p: params.topP,
    // biome-ignore lint/style/useNamingConvention: OpenAI API contract field name
    max_tokens: params.maxTokens,
    // biome-ignore lint/style/useNamingConvention: OpenAI API contract field name
    presence_penalty: params.presencePenalty,
  };
};

/**
 * Builds the native Ollama `options` block, and records what did not map.
 *
 * The unmapped/rejected lists are reported through `onEvent` rather than
 * dropped, because Ollama answers 200 to options it does not understand: a
 * field that is silently absent and a field that is silently ignored are
 * indistinguishable on the wire, so the only place the difference can exist is
 * here.
 */
const buildNativeOptionsFor = (options: {
  resolution: AiModeResolution;
  enabled: boolean;
  onEvent?: (event: string, data?: Record<string, unknown>) => void;
}): NativeOptionsReport => {
  const { resolution, enabled, onEvent } = options;
  if (!enabled || resolution.params === undefined) {
    return { options: {}, mapped: [], unmapped: [], rejected: [] };
  }
  const report = buildNativeOptions({ params: resolution.params });
  if (report.unmapped.length > 0) {
    onEvent?.('native-options-unmapped', {
      provider: resolution.provider,
      fields: [...report.unmapped],
    });
  }
  if (report.rejected.length > 0) {
    onEvent?.('native-options-rejected', {
      provider: resolution.provider,
      fields: [...report.rejected],
    });
  }
  return report;
};

/** Builds the chat completion body. */
export const buildBody = (options: {
  resolution: AiModeResolution;
  messages: AiChatMessage[];
  /** Whether to ask the provider for a trailing token-accounting frame. */
  requestUsage?: boolean;
  /** Overrides the transport default. Structured requests force `false`. */
  stream?: boolean;
  nativeOptionsEnabled: boolean;
  getReasoningControl: (provider: string) => ReasoningControl | undefined;
  onEvent?: (event: string, data?: Record<string, unknown>) => void;
}): Record<string, unknown> => {
  const { resolution, messages, requestUsage = false, stream: streamOverride } = options;
  const native = resolveChatSurface(resolution) === 'ollama-native';
  // Ollama native /api/chat takes `stream` directly; every other provider is
  // reached through OpenAI's compatible surface, where streaming also needs
  // `stream_options` to be asked for accounting.
  const stream = streamOverride ?? native;
  const nativeOptions = native
    ? buildNativeOptionsFor({
        resolution,
        enabled: options.nativeOptionsEnabled,
        ...(options.onEvent === undefined ? {} : { onEvent: options.onEvent }),
      }).options
    : undefined;
  return {
    model: resolution.model,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    stream,
    ...(stream && requestUsage && !native
      ? {
          // biome-ignore lint/style/useNamingConvention: OpenAI API contract field name
          stream_options: { include_usage: true },
        }
      : {}),
    ...(nativeOptions === undefined || Object.keys(nativeOptions).length === 0
      ? {}
      : { options: nativeOptions }),
    ...(native ? {} : buildGenerationParams(resolution)),
    ...buildReasoningParams({ resolution, getReasoningControl: options.getReasoningControl }),
  };
};

/** Performs the fetch for one attempt. */
export const dispatchFetch = async (options: {
  resolution: AiModeResolution;
  body: Record<string, unknown>;
  requestSignal: AbortSignal;
  fetchFn?: typeof fetch;
  getApiKey?: (provider: string) => string | undefined;
  getExtraHeaders?: (provider: string) => Record<string, string> | undefined;
  getDefaultEndpoint?: (provider: string) => string | undefined;
}): Promise<Response> => {
  const { resolution, body, requestSignal, fetchFn } = options;
  const doFetch = fetchFn ?? globalThis.fetch;
  return doFetch(
    resolveChatUrl({
      resolution,
      ...(options.getDefaultEndpoint === undefined
        ? {}
        : { getDefaultEndpoint: options.getDefaultEndpoint }),
    }),
    {
      method: 'POST',
      headers: buildHeaders({
        resolution,
        ...(options.getApiKey === undefined ? {} : { getApiKey: options.getApiKey }),
        ...(options.getExtraHeaders === undefined
          ? {}
          : { getExtraHeaders: options.getExtraHeaders }),
      }),
      body: JSON.stringify(body),
      signal: requestSignal,
    },
  );
};

/** Reads whole-body Ollama accounting with the same validation as streamed frames. */
const readBufferedOllamaUsage = (payload: object): AiTextUsage | undefined =>
  readNativeUsage(payload);

/**
 * Reads token accounting off a non-streaming body.
 *
 * Two shapes exist in the wild: the OpenAI `{ usage: { … } }` block, and
 * Ollama's native `{ prompt_eval_count, eval_count }`. Both are the provider's
 * own accounting; neither is our estimate. A body carrying neither reports
 * nothing, so an absent count stays unknown instead of becoming zero.
 */
export const readBodyUsage = (payload: unknown): AiTextUsage | undefined => {
  if (typeof payload !== 'object' || payload === null) {
    return undefined;
  }
  return readOpenAiUsage(payload) ?? readBufferedOllamaUsage(payload);
};

/** The outcome of reading a non-streaming completion body. */
export type JsonCompletionRead =
  | { kind: 'ok'; text: string; usage?: AiTextUsage }
  | { kind: 'non-json' }
  | { kind: 'aborted'; error: unknown };

/**
 * Reads the text and any token accounting off a non-streaming completion body.
 *
 * Cancellation is distinguished from a non-JSON body because they call for
 * opposite responses: an abort must propagate, while a 200 the provider filled
 * with prose it should not have is a recoverable shape mismatch. Conflating them
 * would either swallow a cancellation or retry one.
 */
export const readJsonCompletion = async (response: Response): Promise<JsonCompletionRead> => {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === 'AbortError' || error.message.includes('aborted'))
    ) {
      return { kind: 'aborted', error };
    }
    return { kind: 'non-json' };
  }
  const data = payload as {
    choices?: Array<{ message?: { content?: string } }>;
    message?: { content?: string };
  };
  const reported = readBodyUsage(payload);
  return {
    kind: 'ok',
    text: data.choices?.[0]?.message?.content ?? data.message?.content ?? '',
    ...(reported === undefined ? {} : { usage: reported }),
  };
};
