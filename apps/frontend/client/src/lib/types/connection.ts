// apps/frontend/client/src/lib/types/connection.ts
//
// Connection data model types (C-230). Client-local — not shared across
// project boundaries since connections are only persisted in localStorage.

import type { GenParamPreset } from '@aikami/constants';

/** Unique connection identifier. */
export type ConnectionId = string;

/** How a connection was sourced — used for indicator badges in the UI. */
export type ConnectionSource = 'env' | 'stored' | 'detected';

/** AI capability category. */
export type ConnectionCapability = 'text' | 'image' | 'voice';

/** Image-generation-specific connection options. */
export type ImageConnectionOptions = {
  /** Checkpoint/model ID (e.g. 'sd_xl_base_1.0'). */
  checkpoint: string;
  /** Image width in pixels. */
  width: number;
  /** Image height in pixels. */
  height: number;
  /** Number of denoising steps. */
  steps: number;
  /** CFG scale (classifier-free guidance). */
  cfg: number;
};

/** Voice/TTS-specific connection options. */
export type VoiceConnectionOptions = {
  /** Voice identifier (e.g. 'af_heart'). */
  voiceId: string;
  /** Speech rate multiplier (0.5–2.0). */
  speed: number;
  /** Pitch adjustment (-20–20). */
  pitch: number;
};

// DEFAULT_IMAGE_OPTIONS and DEFAULT_VOICE_OPTIONS moved to $lib/data/connection_defaults.ts

/**
 * Named provider+model+parameter profile that can be assigned per-chat
 * or used as a global default. API keys are encrypted at rest via
 * crypto_vault.
 */
export type Connection = {
  /** Unique identifier (crypto.randomUUID()). */
  id: ConnectionId;
  /** Human-readable name (e.g. "Claude Opus (Work)", "Local Ollama"). */
  name: string;
  /** AI capability this connection serves. Defaults to 'text'. */
  capability: ConnectionCapability;
  /** Provider identifier matching the capability's provider registry. */
  provider: string;
  /** API key for the provider (encrypted at rest). */
  apiKey: string;
  /** Custom endpoint override (empty = provider default). */
  baseUrl: string;
  /** Model identifier (e.g. "anthropic/claude-3-opus", "sd_xl_base_1.0"). */
  model: string;
  /** Generation parameter overrides for this connection (text only). */
  generationParams: GenParamPreset['params'];
  /** Image-specific options (populated when capability === 'image'). */
  imageOptions?: ImageConnectionOptions;
  /** Voice-specific options (populated when capability === 'voice'). */
  voiceOptions?: VoiceConnectionOptions;
  /** Whether this is the default connection. */
  isDefault: boolean;
  /** How this connection was sourced. Controls indicator badges in Settings. */
  source?: ConnectionSource;
  /** ISO timestamp of creation. */
  createdAt: string;
  /** ISO timestamp of last update. */
  updatedAt: string;
};

/** Result of a connection test request. */
export type ConnectionTestResult = {
  /** Whether the connection succeeded. */
  ok: boolean;
  /** Round-trip latency in milliseconds. */
  latencyMs: number;
  /** Number of available models (if returned by the endpoint). */
  modelCount?: number;
  /** Error message if the test failed. */
  error?: string;
};
