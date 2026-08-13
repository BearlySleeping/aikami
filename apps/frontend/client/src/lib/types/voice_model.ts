// apps/frontend/client/src/lib/types/voice_model.ts
//
// Client-local TTS state types (C-389). TtsBackend reports which synthesis
// path is active; VoiceModelState drives the explicit voice-model download
// control in settings (AC-4b / AC-4c).

/** Reported by the TTS service so the UI can explain degraded speech. */
export type TtsBackend = 'webgpu' | 'wasm' | 'server' | 'unavailable';

/** Lifecycle of the on-demand voice model download. */
export type VoiceModelState =
  | { readonly status: 'not-downloaded'; readonly bytes: number }
  | {
      readonly status: 'downloading';
      readonly receivedBytes: number;
      readonly totalBytes: number;
    }
  | { readonly status: 'verifying' }
  | { readonly status: 'ready' }
  | { readonly status: 'error'; readonly message: string; readonly retryable: boolean };
