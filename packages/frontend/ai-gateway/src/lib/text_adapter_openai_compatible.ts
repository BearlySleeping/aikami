// packages/frontend/ai-gateway/src/lib/text_adapter_openai_compatible.ts
//
// The OpenAI-compatible chat-completions text adapter: configuration, shared
// per-call collaborators, and dispatch. It serves both `offline` (Ollama / Ooba /
// local OpenAI-compatible endpoints) and `byok` (OpenRouter / OpenAI / Gemini /
// DeepSeek / custom) modes — the transport is identical; endpoint, API key, and
// headers come from the resolution and injected config.
//
// 🔴 THE NATIVE ROUTE IS NO LONGER BUFFERED
//
// Ollama's `/api/chat` used to be sent with `stream: false`, the whole body was
// awaited, and a single `onChunk` fired at the end. Measured on Ollama 0.34.3
// (`docs/research/audits/382-native-transport-plan.md`), warm and uncontended: response
// headers at 6 386 ms against a total of 6 387 ms. That route had NO
// first-content time at all — not a slow one, none — and no tuning could
// produce one, because no byte of the answer existed before the byte that ended
// it. The same run over NDJSON put the first VISIBLE character at 2 410 ms.
//
// Plain narrative now streams over the native NDJSON surface. The distinctions
// that make this honest rather than merely fast:
//
//   - only `message.content` is delivered. `message.thinking` is a separate
//     channel; on the measured model the first frames carried only thinking, so
//     "first frame" and "first visible content" are different instants. That run
//     observed 22 895 thinking characters and discarded every one of them —
//     publishing the frame time as time-to-first-token would have hidden all of
//     them behind a 94 ms number.
//   - structured extraction stays BUFFERED. See `text_structured.ts`.
//
// This file holds CONFIGURATION and DISPATCH. What goes on the wire lives in
// `text_body.ts`; what a failure means in `text_outcome.ts`; the two generation
// paths in `text_narrative.ts` and `text_structured.ts`; the bounded readers in
// `ndjson.ts` and `sse.ts`; the budget in `deadline.ts`.
//
// Contract: C-320 AC-2, issue #382

import type { AiChatMessage, AiModeResolution } from '@aikami/types';
import {
  createGatewayDeadline,
  type GatewayClock,
  type GatewayDeadline,
  type GatewayPhaseLimits,
} from './deadline.ts';
import { toAiGatewayError } from './errors.ts';
import type {
  AiTextAdapter,
  AiTextGenerationResult,
  AiTransportAttemptDraft,
} from './gateway_types.ts';
import type { NativeFormatCapability } from './native_format.ts';
import type { ReasoningControl } from './reasoning_control.ts';
import {
  GATEWAY_FETCH_TIMEOUT_MS,
  GATEWAY_FIRST_CHUNK_TIMEOUT_MS,
  GATEWAY_IDLE_TIMEOUT_MS,
} from './sse.ts';
import { createSchemaCompiler } from './structured.ts';
import { dispatchFetch } from './text_body.ts';
import { generatePlain, type PlainDeps } from './text_narrative.ts';
import type { AttemptHook } from './text_outcome.ts';
import {
  abortOnEither,
  cancelledError,
  classifyFetchRejection,
  timeoutError,
} from './text_outcome.ts';
import { generateStructured, type StructuredDeps } from './text_structured.ts';

export { DEFAULT_LOCAL_TEXT_ENDPOINTS, OPENROUTER_ATTRIBUTION_HEADERS } from './text_body.ts';
export { EMPTY_RETRY_BACKOFF_MS, OLLAMA_VRAM_EVICTION_PARAMS } from './text_constants.ts';

/** Configuration for the OpenAI-compatible text adapter. */
export type OpenAiCompatibleTextAdapterOptions = {
  /** Reads the API key for a provider (vault/config path). */
  getApiKey?: (provider: string) => string | undefined;
  /** Whether a provider supports native `response_format: json_schema`. */
  supportsStructuredOutput?: (provider: string) => boolean;
  /**
   * Whether a provider accepts a JSON Schema as Ollama's native `format`.
   *
   * Separate from `supportsStructuredOutput` because they are different
   * capabilities on different surfaces: the first is OpenAI's
   * `response_format: json_schema`, the second is Ollama's `format`. Measured
   * separately because a provider can have either, both or neither, and
   * assuming one implies the other is how a schema-constrained request silently
   * degrades into unconstrained prose.
   */
  supportsNativeFormat?: NativeFormatCapability;
  /** Default chat base endpoint per provider, when the resolution has none. */
  getDefaultEndpoint?: (provider: string) => string | undefined;
  /** Extra headers per provider (merged after built-in OpenRouter headers). */
  getExtraHeaders?: (provider: string) => Record<string, string> | undefined;
  /** Debug hook — compiled-schema cache size after each compile. */
  onSchemaCacheSize?: (size: number) => void;
  /**
   * Which reasoning control this provider honours, if any.
   *
   * Injected rather than imported so the gateway package keeps no dependency on
   * the client that owns the provider registry, and so a test can declare a
   * provider's capability without a registry. Absent means "no provider
   * declares one", which disables the request field entirely.
   */
  getReasoningControl?: (provider: string) => ReasoningControl | undefined;
  /** Debug/log hook, e.g. ('streaming', {...}), ('fallback', {...}). */
  onEvent?: (event: string, data?: Record<string, unknown>) => void;
  /** Fetch injection for tests. Defaults to globalThis.fetch. */
  fetchFn?: typeof fetch;
  fetchTimeoutMs?: number;
  firstChunkTimeoutMs?: number;
  idleTimeoutMs?: number;
  /** Phase watchdog limits. Defaults mirror the historical constants. */
  phaseLimits?: Partial<GatewayPhaseLimits>;
  /** Injectable clock, so deadline behaviour is testable without real time. */
  clock?: GatewayClock;
  /**
   * Whether plain narrative on the native route may stream.
   *
   * Defaults to `true`. A caller can turn it off to reproduce the old buffered
   * behaviour, which is how the before/after comparison in the #382 report was
   * produced on ONE build rather than two.
   */
  nativeStreamingEnabled?: boolean;
  /**
   * Whether to send native generation `options` for Ollama.
   *
   * Defaults to `true`. Turning them on makes configured limits take effect for
   * the first time, which can truncate a reasoning model that was previously
   * unbounded — a real behaviour change, so it is separately switchable.
   */
  nativeOptionsEnabled?: boolean;
  /** Whether to send a native `format` schema for structured extraction. */
  nativeStructuredFormatEnabled?: boolean;
};

/**
 * Waits `ms` with backoff, drawing on the SHARED budget.
 *
 * The wait is `min(backoff, remaining budget)`, and the ONLY things that can
 * interrupt it are the total budget and a cancellation. A phase watchdog is
 * deliberately not used: its timer would fire at the same instant as this one
 * and the race would turn a routine backoff into a spurious `total_budget`.
 */
const waitWithBackoff = (options: {
  ms: number;
  deadline: GatewayDeadline;
  resolution: AiModeResolution;
}): Promise<void> => {
  const { ms, deadline, resolution } = options;
  const remaining = deadline.remainingMs();
  if (remaining <= 0) {
    return Promise.reject(timeoutError({ kind: 'total_budget', resolution }));
  }
  return new Promise<void>((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timer);
      deadline.signal.removeEventListener('abort', onAbort);
    };
    const onAbort = (): void => {
      cleanup();
      reject(
        deadline.stopReason() === 'caller-abort'
          ? cancelledError(resolution)
          : timeoutError({ kind: 'total_budget', resolution }),
      );
    };
    const timer = setTimeout(
      () => {
        cleanup();
        resolve();
      },
      Math.min(ms, remaining),
    );
    if (deadline.signal.aborted) {
      onAbort();
      return;
    }
    deadline.signal.addEventListener('abort', onAbort, { once: true });
  });
};

/**
 * Stamps routing onto an attempt the adapter reported.
 *
 * Identity is the GATEWAY's to assign. An adapter that minted its own would let
 * two layers number the same attempt differently, and the mismatch is invisible
 * in the output.
 */
const scopeAttemptHook = (
  onAttempt: ((event: AiTransportAttemptDraft) => void) | undefined,
  resolution: AiModeResolution,
): AttemptHook | undefined =>
  onAttempt
    ? (event): void => {
        const full: AiTransportAttemptDraft = {
          ...event,
          provider: resolution.provider,
          ...(resolution.model === undefined ? {} : { model: resolution.model }),
          mode: resolution.mode,
        };
        onAttempt(full);
      }
    : undefined;

/**
 * Picks the generation path for one call.
 *
 * A named function rather than a ternary inside `generateText`, because which
 * path runs is the single most consequential decision the adapter makes and it
 * deserves to be readable on one line of real estate.
 */
const dispatchText = async (options: {
  resolution: AiModeResolution;
  messages: AiChatMessage[];
  schema?: Record<string, unknown>;
  schemaName?: string;
  deadline: GatewayDeadline;
  plainDeps: PlainDeps;
  structuredDeps: StructuredDeps;
  onChunk?: (text: string) => void;
  scoped?: AttemptHook;
}): Promise<AiTextGenerationResult> => {
  const { resolution, messages, schema, schemaName, deadline, plainDeps, structuredDeps } = options;
  const shared = {
    resolution,
    messages,
    deadline,
    ...(options.onChunk === undefined ? {} : { onChunk: options.onChunk }),
    ...(options.scoped === undefined ? {} : { onAttempt: options.scoped }),
  };
  return schema && schemaName
    ? await generateStructured({ ...shared, schema, schemaName, deps: structuredDeps })
    : await generatePlain({ ...shared, deps: plainDeps });
};

/** Every failure leaves the adapter as an `AiGatewayException`, never a raw Error. */
const normalizeAdapterFailure = (error: unknown, resolution: AiModeResolution): Error =>
  toAiGatewayError({
    error,
    capability: 'text',
    mode: resolution.mode,
    provider: resolution.provider,
  });

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
    supportsNativeFormat,
    getDefaultEndpoint,
    getExtraHeaders,
    onSchemaCacheSize,
    getReasoningControl = () => undefined,
    onEvent,
    fetchFn,
    fetchTimeoutMs = GATEWAY_FETCH_TIMEOUT_MS,
    firstChunkTimeoutMs = GATEWAY_FIRST_CHUNK_TIMEOUT_MS,
    idleTimeoutMs = GATEWAY_IDLE_TIMEOUT_MS,
    phaseLimits,
    clock,
    nativeStreamingEnabled = true,
    nativeOptionsEnabled = true,
    nativeStructuredFormatEnabled = true,
  } = options ?? {};

  const compiler = createSchemaCompiler({ onCacheSize: onSchemaCacheSize });
  const now = (): number => clock?.now() ?? Date.now();

  /** Effective phase watchdogs. Explicit options win over the phase block. */
  const phases: GatewayPhaseLimits = {
    headersMs: phaseLimits?.headersMs ?? fetchTimeoutMs,
    firstContentMs: phaseLimits?.firstContentMs ?? firstChunkTimeoutMs,
    idleMs: phaseLimits?.idleMs ?? idleTimeoutMs,
  };

  /** Posts one body, with the headers window and the shared budget applied. */
  const post = async (options2: {
    resolution: AiModeResolution;
    body: Record<string, unknown>;
    deadline: GatewayDeadline;
  }): Promise<Response> => {
    const { resolution, body, deadline } = options2;
    if (deadline.expired()) {
      // An exhausted budget must not buy a provider call. Reported as a
      // timeout, because nobody waited — a cancellation would be a lie.
      throw timeoutError({ kind: 'total_budget', resolution, elapsedMs: 0 });
    }
    const headerPhase = deadline.phaseWindow(phases.headersMs);
    try {
      return await dispatchFetch({
        resolution,
        body,
        requestSignal: abortOnEither(deadline.signal, headerPhase.signal),
        ...transportOptions,
      });
    } catch (error) {
      throw classifyFetchRejection({ error, resolution, deadline, phase: headerPhase });
    } finally {
      headerPhase.dispose();
    }
  };

  /** Per-adapter transport collaborators, assembled once. */
  const transportOptions = {
    fetchFn,
    ...(getApiKey === undefined ? {} : { getApiKey }),
    ...(getExtraHeaders === undefined ? {} : { getExtraHeaders }),
    ...(getDefaultEndpoint === undefined ? {} : { getDefaultEndpoint }),
  };

  const sharedDeps = {
    onEvent,
    getReasoningControl,
    nativeOptionsEnabled,
    now,
    post,
  };
  const plainDeps: PlainDeps = { phases, ...sharedDeps, nativeStreamingEnabled };
  const structuredDeps: StructuredDeps = {
    compiler,
    supportsStructuredOutput,
    supportsNativeFormat,
    nativeStructuredFormatEnabled,
    waitWithBackoff,
    generatePlain: (args) => generatePlain({ ...args, deps: plainDeps }),
    ...sharedDeps,
  };

  return {
    provider: 'openai_compatible',
    async generateText(request): Promise<AiTextGenerationResult> {
      const { resolution, signal, messages, onChunk, schema, schemaName } = request;
      const { deadlineAt, onAttempt } = request;
      if (signal.aborted) {
        throw cancelledError(resolution);
      }
      // ONE deadline for the whole logical request: dispatch, headers, content,
      // the idle watchdog, the body read, parse, backoff and retry all draw it
      // down.
      const deadline = createGatewayDeadline({
        ...(deadlineAt === undefined ? {} : { deadlineAt }),
        callerSignal: signal,
        watchdogMs: fetchTimeoutMs,
        ...(clock === undefined ? {} : { clock }),
      });
      const scoped = scopeAttemptHook(onAttempt, resolution);

      try {
        return await dispatchText({
          resolution,
          messages,
          schema,
          schemaName,
          deadline,
          plainDeps,
          structuredDeps,
          onChunk,
          scoped,
        });
      } catch (error) {
        throw normalizeAdapterFailure(error, resolution);
      } finally {
        // Releases the total timer. Never aborts — a settled request's signal
        // must stay un-aborted so a late observer sees the truth.
        deadline.dispose();
      }
    },
  };
};
