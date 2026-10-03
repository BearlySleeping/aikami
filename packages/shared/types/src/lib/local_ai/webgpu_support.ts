// packages/shared/types/src/lib/local_ai/webgpu_support.ts
//
// Browser WebGPU availability, as the rest of the app consumes it.
//
// Deliberately narrow: this says nothing about the *quality* of an adapter,
// only whether one could be handed out. The probe itself lives in
// `@aikami/frontend/utils` (`isWebGPUSupported`) so the workers and the UI
// share one implementation.

/** What is currently known about WebGPU availability in this context. */
export type WebGpuSupportStatus =
  /** No probe has completed yet — nothing may be claimed about WebGPU. */
  | 'unknown'
  /** An adapter was handed out: local models run on the GPU. */
  | 'supported'
  /** No adapter: local models fall back to the (slower) WASM backend. */
  | 'unsupported';
