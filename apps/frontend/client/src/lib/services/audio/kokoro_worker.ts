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
};

type SynthesizeMessage = {
  action: 'synthesize';
  text: string;
  voice: string;
  /**
   * Correlates this request with its response. The main thread starts a new
   * synthesis before the previous one finishes (every speak() calls stop()
   * first), so an untagged 'complete' cannot be told apart from a stale one.
   */
  requestId: number;
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
  /** Echoes the requesting {@link SynthesizeMessage.requestId}. */
  requestId: number;
};

type ErrorResponse = {
  type: 'error';
  message: string;
  /** Echoes the requesting {@link SynthesizeMessage.requestId}, when the failure belongs to one. */
  requestId?: number;
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
    const { wasmPath, device, modelId } = message;

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

/** Joins RawAudio's chunk list into the single PCM buffer we post back. */
const concatChunks = (chunks: Float32Array[]): Float32Array => {
  const [first] = chunks;
  if (chunks.length === 1 && first) {
    return first;
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
};

const handleSynthesize = async (options: {
  text: string;
  voice: string;
  requestId: number;
}): Promise<void> => {
  const { text, voice, requestId } = options;

  if (!session) {
    const response: ErrorResponse = {
      type: 'error',
      message: 'Kokoro session not initialized. Call initialize first.',
      requestId,
    };
    self.postMessage(response);
    return;
  }

  if (!text.trim()) {
    const response: ErrorResponse = {
      type: 'error',
      message: 'Empty text — nothing to synthesize.',
      requestId,
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

    // @huggingface/transformers 4.x widened RawAudio.audio to
    // `Float32Array | Float32Array[]` (a single chunk, or several). 3.x typed
    // it as a bare Float32Array, so which one we see depends on the resolved
    // transitive version — flatten both shapes rather than depend on that.
    const rawAudio: Float32Array | Float32Array[] = result.audio;
    const pcmData = Array.isArray(rawAudio) ? concatChunks(rawAudio) : rawAudio;
    const sampleRate = result.sampling_rate;

    const response: SynthesizeResponse = { type: 'complete', pcmData, sampleRate, requestId };
    self.postMessage(response, { transfer: [pcmData.buffer] });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Synthesis failed';
    const response: ErrorResponse = { type: 'error', message, requestId };
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
      handleSynthesize({ text: data.text, voice: data.voice, requestId: data.requestId });
      break;

    default:
      break;
  }
};
