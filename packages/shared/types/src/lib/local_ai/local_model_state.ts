// packages/shared/types/src/lib/local_ai/local_model_state.ts
//
// Modality-agnostic local model lifecycle state (C-427).
// Promoted from VoiceModelState in apps/frontend/client/src/lib/types/voice_model.ts.

/** Lifecycle of an on-demand local model download. */
export type LocalModelState =
  | { readonly status: 'not-downloaded'; readonly bytes: number }
  | {
      readonly status: 'downloading';
      readonly receivedBytes: number;
      readonly totalBytes: number;
    }
  | { readonly status: 'verifying' }
  | { readonly status: 'loading' }
  | { readonly status: 'ready' }
  | { readonly status: 'error'; readonly message: string; readonly retryable: boolean };

/** Backend the engine actually loaded (honest degraded state, not assumed WebGPU). */
export type EngineBackendKind = 'webgpu' | 'wasm' | 'unavailable';

/** Engine instance returned by the loader — must be disposable. */
export type EngineBackend = {
  readonly kind: EngineBackendKind;
  dispose(): Promise<void>;
};

/** Engine lifecycle status. */
export type LocalEngineStatus =
  | 'uninitialized'
  | 'initializing'
  | 'ready'
  | 'error'
  | 'not-downloaded';
