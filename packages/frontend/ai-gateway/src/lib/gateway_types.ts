// packages/frontend/ai-gateway/src/lib/gateway_types.ts
//
// The AiProviderGateway call surface and the (capability, mode) adapter
// contracts. Shared data shapes (AiMode, AiCapability, AiGatewayError,
// AiModeResolution, AiDetectionResult) live in @aikami/types per Pillar 2 —
// this file only defines the service-layer function contracts.
// Contract: C-320

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
  /** Cancellation signal — propagated to the upstream provider fetch. */
  signal?: AbortSignal;
  /**
   * Explicit adapter-family override. Used by legacy `service`-mode callers
   * (e.g. the Firebase callable path) that must bypass per-capability
   * resolution. Selecting a mode with no registered adapter raises
   * `mode_unavailable`.
   */
  mode?: AiMode;
  /** Debug hook — receives the resolution computed at the gateway boundary. */
  onResolve?: (resolution: AiModeResolution) => void;
};

/** Result of a gateway text-generation call. */
export type AiTextGenerationResult = {
  /** Full accumulated text. */
  text: string;
  /** Parsed structured object when a schema was provided. */
  structured?: unknown;
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
}) => AiModeResolution;
