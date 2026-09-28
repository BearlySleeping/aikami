// apps/frontend/client/src/lib/types/voice_model.ts
//
// Client-local TTS state types (C-389). Re-exports LocalModelState from
// @aikami/types for backward compatibility during the C-427 migration.

import type { EngineBackend, LocalModelState } from '@aikami/types';

/** Reported by the TTS service so the UI can explain degraded speech. */
export type TtsBackend = 'webgpu' | 'wasm' | 'server' | 'unavailable';

/** Lifecycle status of the TTS runtime (native Kokoro engine or server-mode probe). */
export type TtsStatus =
  | 'uninitialized'
  | 'initializing'
  | 'ready'
  | 'error'
  | 'not-downloaded'
  | 'disabled';

/** Lifecycle of the on-demand voice model download. Type alias for backward compat. */
export type VoiceModelState = LocalModelState;

/**
 * Result of a speech request.
 *
 * `speak()` used to resolve `void` for four materially different situations
 * — audio scheduled, cancelled by a newer request, no engine installed, and
 * merely accepted — so callers reported "queued" for a request that then
 * failed. Expected non-play states are values here; only a genuine failure
 * rejects.
 */
export type SpeakOutcome =
  /** Audio is scheduled on the AudioContext. */
  | { readonly kind: 'scheduled' }
  /** Superseded by a newer request, or stopped by the user. Not an error. */
  | { readonly kind: 'cancelled' }
  /** No engine could run it (model not installed, TTS off, still loading). */
  | { readonly kind: 'unavailable'; readonly status: TtsStatus };

export type { EngineBackend };
