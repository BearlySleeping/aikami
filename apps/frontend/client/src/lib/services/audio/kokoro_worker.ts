// apps/frontend/client/src/lib/services/audio/kokoro_worker.ts

/**
 * Dedicated Web Worker wrapping the 82M Kokoro TTS model for native,
 * zero-setup text-to-speech in the browser via WebGPU or WASM.
 *
 * C-389 changes:
 * - `env.allowLocalModels` is inverted to `true` and `localModelPath` points
 *   at `/models/` — the explicit voice-model download pre-warms the
 *   transformers Cache Storage under those keys, so initialization loads
 *   fully offline (no HuggingFace request after the first explicit download).
 * - ORT WASM binaries are vendored into the app's static assets (`/ort/`)
 *   instead of a CDN, so no network is required for the WASM fallback and
 *   the Tauri CSP never needs a CDN entry.
 * - The worker reports which backend it actually used (`webgpu` | `wasm`)
 *   so the TTS service can surface honest degraded-speech state (AC-6).
 *
 * Communicates with the main thread through postMessage actions:
 * - `initialize` — configure ONNX runtime and load the Kokoro model
 * - `synthesize` — run text through the tokenizer + forward pass, return PCM
 *
 * Contracts: C-131, C-389
 */

import { env } from '@huggingface/transformers';

// Local models enabled — weights come from the app-controlled cache
// (pre-warmed by the explicit download control), not the HF CDN.
env.allowLocalModels = true;
// transformers.js resolves `/models/{repo}/{file}` cache keys first.
env.localModelPath = '/models/';

// ---------------------------------------------------------------------------
// Worker-scoped state
// ---------------------------------------------------------------------------

type KokoroSession = Awaited<ReturnType<typeof import('kokoro-js').KokoroTTS.from_pretrained>>;
let session: KokoroSession | null = null;
let activeBackend: 'webgpu' | 'wasm' = 'wasm';

// ---------------------------------------------------------------------------
// Message types
// ---------------------------------------------------------------------------

type InitializeMessage = {
  action: 'initialize';
  /** Absolute URL prefix for the vendored ORT WASM binaries (ends in '/'). */
  wasmPath: string;
  /** Preferred device; WebGPU falls back to WASM when unavailable. */
  device: 'webgpu' | 'wasm';
  /** HF model id — pinned by the main thread. */
  modelId: string;
  /** Pinned revision, never `main`. */
  revision: string;
};

type SynthesizeMessage = {
  action: 'synthesize';
  text: string;
  voice: string;
};

type WorkerMessage = InitializeMessage | SynthesizeMessage;

type InitializeResponse = {
  type: 'ready';
  /** Which backend actually loaded. */
  backend: 'webgpu' | 'wasm';
};

type SynthesizeResponse = {
  type: 'complete';
  pcmData: Float32Array;
  sampleRate: number;
};

type ErrorResponse = {
  type: 'error';
  message: string;
};

// ---------------------------------------------------------------------------
// Backend detection
// ---------------------------------------------------------------------------

/** True when a WebGPU adapter can actually be requested. */
const hasWebGpu = async (): Promise<boolean> => {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter?: () => Promise<unknown> } })
      .gpu;
    if (!gpu?.requestAdapter) {
      return false;
    }
    const adapter = await Promise.race([
      gpu.requestAdapter(),
      new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 3000)),
    ]);
    return adapter !== undefined && adapter !== null;
  } catch {
    // Headless CI, blocklisted driver, or adapter request failure — treat
    // WebGPU as absent rather than letting the promise hang.
    return false;
  }
};

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

const handleInitialize = async (message: InitializeMessage): Promise<void> => {
  try {
    const { wasmPath, device, modelId, revision } = message;

    // Configure the ONNX runtime WebGPU backend before Kokoro creates its
    // session. WASM binaries are vendored (C-389) — never a CDN.
    const ort = await import('onnxruntime-web/webgpu');
    ort.env.wasm.wasmPaths = wasmPath;

    // Decide the effective backend: WebGPU when requested and available,
    // WASM otherwise (single-threaded since COEP was dropped — C-389).
    const useWebGpu = device === 'webgpu' && (await hasWebGpu());

    const { KokoroTTS } = await import('kokoro-js');

    session = await KokoroTTS.from_pretrained(modelId, {
      dtype: 'q8',
      device: useWebGpu ? 'webgpu' : 'wasm',
      revision,
      // @ts-expect-error — enableGraphCapture is passed through to ONNX
      // runtime but may not be in kokoro-js TS types.
      ...(useWebGpu ? { enableGraphCapture: true } : {}),
    });
    activeBackend = useWebGpu ? 'webgpu' : 'wasm';

    const response: InitializeResponse = { type: 'ready', backend: activeBackend };
    self.postMessage(response);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown initialization error';
    const response: ErrorResponse = { type: 'error', message: errorMessage };
    self.postMessage(response);
  }
};

const handleSynthesize = async (options: { text: string; voice: string }): Promise<void> => {
  const { text, voice } = options;

  if (!session) {
    const response: ErrorResponse = {
      type: 'error',
      message: 'Kokoro session not initialized. Call initialize first.',
    };
    self.postMessage(response);
    return;
  }

  if (!text.trim()) {
    const response: ErrorResponse = {
      type: 'error',
      message: 'Empty text — nothing to synthesize.',
    };
    self.postMessage(response);
    return;
  }

  try {
    const result = await session.generate(
      text,
      // kokoro-js voice type is a union of known presets; cast the
      // incoming string to satisfy the narrow union constraint.
      { voice } as Parameters<typeof session.generate>[1],
    );

    // Transfer the PCM buffer ownership to the main thread for zero-copy
    // postMessage. The buffer is no longer usable in the worker afterwards.
    const pcmData = result.audio;
    const sampleRate = result.sampling_rate;

    const response: SynthesizeResponse = { type: 'complete', pcmData, sampleRate };
    self.postMessage(response, { transfer: [pcmData.buffer] });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Synthesis failed';
    const response: ErrorResponse = { type: 'error', message };
    self.postMessage(response);
  }
};

// ---------------------------------------------------------------------------
// Message router
// ---------------------------------------------------------------------------

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const { data } = event;

  switch (data.action) {
    case 'initialize':
      handleInitialize(data);
      break;

    case 'synthesize':
      handleSynthesize({ text: data.text, voice: data.voice });
      break;

    default:
      break;
  }
};
