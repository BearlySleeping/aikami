// packages/frontend/ai-gateway/src/lib/gateway_types.ts
//
// The AiProviderGateway call surface and the (capability, mode) adapter
// contracts. Shared data shapes (AiMode, AiCapability, AiGatewayError,
// AiModeResolution, AiDetectionResult) live in @aikami/types per Pillar 2 —
// this file only defines the service-layer function contracts.
// Contract: C-320

import type { TextTask } from '@aikami/constants';
import type {
  AiCapability,
  AiChatMessage,
  AiDetectionResult,
  AiMode,
  AiModeResolution,
} from '@aikami/types';

// ---------------------------------------------------------------------------
// Request / result shapes (call surface)
// ---------------------------------------------------------------------------

/** Options for a gateway text-generation call. */
export type AiTextGenerationOptions = {
  /** Full conversation history, oldest first. */
  messages: AiChatMessage[];
  /** Streaming token callback; delivery order matches provider order. */
  onChunk?: (text: string) => void;
  /** JSON Schema dictionary for structured extraction. */
  schema?: Record<string, unknown>;
  /** Name for the structured schema (used for caching + provider payloads). */
  schemaName?: string;
  /** Explicit model override. */
  model?: string;
  /** Explicit provider endpoint override. */
  endpoint?: string;
  /**
   * Task type — drives role-based routing and the per-task generation
   * preset (max tokens, temperature). Defaults to `narration`.
   */
  task?: TextTask;
  /** Cancellation signal — propagated to the upstream provider fetch. */
  signal?: AbortSignal;
  /**
   * Explicit adapter-family override. Used by `service`-mode callers
   * (e.g. the Firebase callable path) that must bypass per-capability
   * resolution. Selecting a mode with no registered adapter raises
   * `mode_unavailable`.
   */
  mode?: AiMode;
  /** Debug hook — receives the resolution computed at the gateway boundary. */
  onResolve?: (resolution: AiModeResolution) => void;
  /**
   * Absolute epoch ms by which this logical request must be finished.
   *
   * ADDITIVE and optional, so no existing caller changes. When present it is
   * adopted VERBATIM and becomes the only logical budget: dispatch, headers,
   * first visible content, the idle watchdog, the body read, parse and
   * validation, empty-body backoff and any retry all draw it down. When absent
   * the adapter keeps a finite safety limit for direct callers — that limit is
   * a watchdog, not a budget, and is named as one in its failures.
   *
   * This exists because the transport previously had no way to learn a caller's
   * budget: it minted a fresh timer per request scope, so a 120 s dialogue
   * budget was cut at 90 s and a 4 s combat budget was served for 90 s.
   * Issue #382 P0.
   */
  deadlineAt?: number;
  /**
   * Receives one event per DISPATCHED provider attempt.
   *
   * Fires for every attempt, including empty-body retries, schema-invalid
   * responses and structured fallbacks — the provider billed each of them, and
   * an accounting boundary that only saw the surviving attempt under-reports
   * real spend. Additive and optional; no consumer is required to use it.
   */
  onAttempt?: (event: AiTransportAttemptEvent) => void;
  /**
   * Identity of the LOGICAL request, when the caller already owns one.
   *
   * Supplied by a coalescer so every subscriber waiting on one dispatch shares
   * a single identity — and therefore a single set of attempt events, and a
   * single provider bill in the record. Omitted by an ordinary caller, which
   * then gets a minted one.
   */
  requestId?: string;
};

/**
 * Token usage for one call, with the provenance needed to trust it.
 *
 * `source` is the whole point of this type. `provider` means the numbers came
 * from the provider's own accounting and are what will be billed.
 * `estimated` means they were derived from character counts — useful for
 * budgeting, never a substitute for a bill. A span that reports estimated
 * tokens as if they were provider-reported would make cache savings and cost
 * figures indistinguishable from fiction.
 */
export type AiTextUsage = {
  /** Total input tokens, including any cachedTokens, as reported or estimated. */
  readonly inputTokens: number;
  /** Output tokens, as reported or estimated. */
  readonly outputTokens: number;
  /** Provider-reported cached input tokens; omitted when unknown. */
  readonly cachedTokens?: number;
  /** Whether these numbers came from the provider or from an estimate. */
  readonly source: 'provider' | 'estimated';
  /**
   * Where the cached count came from, stated explicitly.
   *
   * `'unknown'` is a real, recorded value: it means the runtime did not supply
   * the counter, which is a different fact from "this call reused no cache".
   * Ollama 0.34.3 does supply `prompt_eval_cached_count`; a runtime that does
   * not must stay unknown rather than defaulting to zero, because a zero would
   * be read as a measured absence of reuse.
   *
   * Never inferred from latency: a fast prompt can be a cache hit or a tiny
   * prompt, and guessing which is how a fabricated saving enters a report.
   */
  readonly cachedSource?: 'provider' | 'unknown';
  /**
   * These counters do NOT cover the whole dispatched attempt.
   *
   * Set when the stream ended before its completion frame, or when the numbers
   * came from a superseded attempt. Known numbers plus an unknown remainder must
   * be reported as partial — presenting them as a complete total is how a
   * truncated generation looks like a cheap one.
   */
  readonly partial?: boolean;
};

/** Which wire shape actually carried a generation. */
export type AiTransportShape =
  /** Ollama native `/api/chat` with `stream:true` — newline-delimited JSON. */
  | 'ndjson-stream'
  /** OpenAI-compatible SSE. */
  | 'sse-stream'
  /**
   * A whole body awaited before any content existed.
   *
   * No first-content time is definable on this shape. It is named explicitly
   * so a buffered completion can never be presented as a first-token
   * measurement — the two are different quantities and only the first one is a
   * latency the player experiences.
   */
  | 'buffered-json';

/** How one dispatched attempt ended. */
export type AiAttemptOutcome =
  | 'completed'
  /** Reached its completion signal with usable content. */
  | 'empty'
  /** Completed, but produced no content. */
  | 'invalid'
  /** Content arrived and failed the original schema. */
  | 'unsupported'
  /** The provider rejected the request shape. */
  | 'error'
  | 'cancelled'
  | 'timeout';

/**
 * What an ADAPTER reports about one dispatched attempt.
 *
 * The same facts as {@link AiTransportAttemptEvent} minus identity, because
 * identity is assigned by the gateway. Splitting the two is what makes "one
 * provider bill, N subscribers" expressible: the adapter reports the attempt
 * once per dispatch, and the gateway stamps the logical request's identity onto
 * every consumer of it.
 */
export type AiTransportAttemptDraft = Omit<AiTransportAttemptEvent, 'attemptId' | 'requestId'>;

/**
 * One dispatched provider attempt, from dispatch to settlement.
 *
 * The unit of real spend. A logical request may dispatch several of these —
 * an empty-body retry, a structured fallback, a plain-text rescue — and they
 * are ONE provider bill shared by however many callers were waiting on it. A
 * per-subscriber view of this event would multiply measured spend by the number
 * of consumers, so `attemptId` is the identity that deduplicates.
 */
export type AiTransportAttemptEvent = {
  /** Unique per dispatched attempt, including retries within one request. */
  readonly attemptId: string;
  /** Identity of the LOGICAL request this attempt belongs to, when known. */
  readonly requestId?: string;
  readonly provider: string;
  /**
   * Resolved model, or absent when the resolution carried none.
   *
   * Optional rather than defaulted: an unresolved model is a real state, and
   * substituting a placeholder string would put a fabricated model name into a
   * pricing lookup.
   */
  readonly model?: string;
  readonly mode: string;
  /** Whether this attempt asked for narrative or a schema-constrained object. */
  readonly kind: 'narrative' | 'structured';
  /** Which wire shape carried it. */
  readonly transport: AiTransportShape;
  /** Epoch ms the attempt was dispatched. */
  readonly startedAt: number;
  /** Present once the attempt settles. Absent while in flight. */
  readonly outcome?: AiAttemptOutcome;
  /** Milliseconds to the first VISIBLE content fragment. Absent if none came. */
  readonly firstContentMs?: number;
  /** Milliseconds from dispatch to settlement. */
  readonly totalMs?: number;
  /** Token accounting for THIS attempt, including a discarded one. */
  readonly usage?: AiTextUsage;
  /** The provider's own termination reason, e.g. `stop` or `length`. */
  readonly doneReason?: string;
  /** Content arrived but the stream ended before its completion frame. */
  readonly truncated?: boolean;
};

/** Result of a gateway text-generation call. */
export type AiTextGenerationResult = {
  /** Full accumulated text. */
  text: string;
  /** Parsed structured object when a schema was provided. */
  structured?: unknown;
  /** Token usage, when the provider reported it or an estimate was derived. */
  usage?: AiTextUsage;
};

/** Options for a gateway image-generation call. */
export type AiImageGenerationOptions = {
  prompt: string;
  checkpoint?: string;
  signal?: AbortSignal;
  /** Debug hook — receives the resolution computed at the gateway boundary. */
  onResolve?: (resolution: AiModeResolution) => void;
};

/** Result of a gateway image-generation call. */
export type AiImageGenerationResult = {
  url: string;
};

/** Options for a gateway voice-synthesis call. */
export type AiVoiceGenerationOptions = {
  text: string;
  voiceId?: string;
  signal?: AbortSignal;
  /** Debug hook — receives the resolution computed at the gateway boundary. */
  onResolve?: (resolution: AiModeResolution) => void;
};

/**
 * Result of a gateway voice-synthesis call.
 *
 * `audio` is optional: the current Kokoro delegation plays audio through
 * the client's streaming pipeline and does not expose raw buffers. Adapters
 * that do produce raw audio return it here.
 */
export type AiVoiceGenerationResult = {
  audio?: ArrayBuffer | ReadableStream<Uint8Array>;
};

// ---------------------------------------------------------------------------
// Adapter contracts
// ---------------------------------------------------------------------------

/** Context injected into every adapter call by the gateway. */
export type AiAdapterContext = {
  /** Resolution computed once at the gateway boundary. */
  resolution: AiModeResolution;
  /** Combined cancellation signal (caller signal + gateway cancelAll). */
  signal: AbortSignal;
  /**
   * The caller's absolute end-to-end instant, forwarded unchanged.
   *
   * Optional so an existing adapter signature keeps compiling; a field a
   * transport cannot see is a budget it cannot honour.
   */
  deadlineAt?: number;
  /**
   * Optional per-attempt accounting hook, forwarded unchanged.
   *
   * Typed WITHOUT `attemptId`/`requestId` on purpose: identity belongs to the
   * gateway, which counts one ordinal per dispatch within one logical request.
   * An adapter that minted its own identity would let two layers number the
   * same attempt differently, and the mismatch is invisible in the output.
   */
  onAttempt?: (event: AiTransportAttemptDraft) => void;
};

/** Adapter contract for text generation. */
export type AiTextAdapter = {
  /** Provider label used when constructing override resolutions. */
  readonly provider?: string;
  generateText(
    options: AiAdapterContext & {
      messages: AiChatMessage[];
      onChunk?: (text: string) => void;
      schema?: Record<string, unknown>;
      schemaName?: string;
    },
  ): Promise<AiTextGenerationResult>;
};

/** Adapter contract for image generation. */
export type AiImageAdapter = {
  readonly provider?: string;
  generateImage(
    options: AiAdapterContext & { prompt: string; checkpoint?: string },
  ): Promise<AiImageGenerationResult>;
};

/** Adapter contract for voice synthesis. */
export type AiVoiceAdapter = {
  readonly provider?: string;
  generateVoice(
    options: AiAdapterContext & { text: string; voiceId?: string },
  ): Promise<AiVoiceGenerationResult>;
};

/** Union of all adapter families. */
export type AiAdapter = AiTextAdapter | AiImageAdapter | AiVoiceAdapter;

/** Capability detector — must resolve within the gateway detection budget. */
export type AiDetector = (options: { signal: AbortSignal }) => Promise<AiDetectionResult>;

// ---------------------------------------------------------------------------
// Gateway call surface
// ---------------------------------------------------------------------------

/**
 * The single call surface for AI capabilities. Mode (`offline` / `byok` /
 * `service`) is resolved once per capability at the gateway boundary —
 * callers never re-check providers.
 */
export type AiProviderGateway = {
  /** Resolves which (mode, provider) serves a capability right now. */
  resolveMode(capability: AiCapability): AiModeResolution;
  /**
   * Resolves text routing WITHOUT dispatching a call.
   *
   * A caller that must decide something before it spends a call — whether an
   * on-device attempt is allowed for this task, or which connection a request
   * would reach — needs the same resolution `generateText` would compute, not a
   * re-derivation of its own. The two must not disagree, so this is the exact
   * resolution the dispatch path uses, including task role routing and explicit
   * model/endpoint overrides. Resolver failures throw a typed AiGatewayException,
   * exactly as they would on the dispatch path.
   */
  resolveText(options?: { model?: string; endpoint?: string; task?: TextTask }): AiModeResolution;
  /** Detects capability availability with a bounded timeout. Never throws. */
  detect(capability: AiCapability): Promise<AiDetectionResult>;
  /** Generates text (streaming via onChunk, structured via schema). */
  generateText(options: AiTextGenerationOptions): Promise<AiTextGenerationResult>;
  /** Generates an image via the resolved image adapter. */
  generateImage(options: AiImageGenerationOptions): Promise<AiImageGenerationResult>;
  /** Synthesizes speech via the resolved voice adapter. */
  generateVoice(options: AiVoiceGenerationOptions): Promise<AiVoiceGenerationResult>;
  /** Aborts all in-flight gateway calls across all capabilities. */
  cancelAll(): void;
};

/** Resolver function computed from provided config — one resolution per call. */
export type AiModeResolver = (options: {
  capability: AiCapability;
  model?: string;
  endpoint?: string;
  task?: TextTask;
}) => AiModeResolution;
