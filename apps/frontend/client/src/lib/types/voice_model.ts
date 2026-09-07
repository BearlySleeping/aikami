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
export type { EngineBackend };
