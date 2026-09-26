// apps/frontend/client/src/lib/services/audio/kokoro_worker.ts

/**
 * Dedicated Web Worker wrapping the 82M Kokoro TTS model for native,
 * zero-setup text-to-speech in the browser via WebGPU or WASM.
 *
 * C-389 changes:
 * - Model files resolve through canonical HuggingFace URLs pinned to
 *   `KOKORO_REVISION`. The explicit voice-model download pre-warms the
 *   transformers Cache Storage under exactly those keys, so initialization
 *   loads from cache without re-downloading (see
 *   `configurePinnedRemoteModelResolution`).
 * - The worker owns that cache through `env.customCache`. transformers always
 *   probes the document-relative `/models/...` key BEFORE the canonical URL,
 *   whatever `allowLocalModels` says, so a WebView2-persisted entry holding
 *   `index.html` (written when the app answered that path) kept shadowing the
 *   real bytes and failed with `Unexpected token '<'`. The owned cache refuses
 *   every non-canonical key, which makes that failure unreachable.
 * - ORT WASM binaries are fetched from the `aikami-dist` distribution plane
 *   under a version-pinned path instead of being bundled (see
 *   `packages/frontend/local-runtime/src/lib/ort_runtime.ts`), so no ORT
 *   binary is ever emitted into the Cloudflare client build.
 * - The worker reports which backend it actually used (`webgpu` | `wasm`)
 *   so the TTS service can surface honest degraded-speech state (AC-6).
 *
 * Communicates with the main thread through postMessage actions:
 * - `initialize` — configure ONNX runtime and load the Kokoro model
 * - `synthesize` — run text through the tokenizer + forward pass, return PCM
 *
 * Contracts: C-131, C-389
 */

import { KOKORO_MODEL_ID, KOKORO_REVISION } from '@aikami/constants';
import {
  configureOrtRuntime,
  configurePinnedRemoteModelResolution,
  createCacheStorageBackend,
  createPinnedModelCache,
  MODEL_ORIGIN,
  type OrtConfigurableEnv,
} from '@aikami/frontend/local-runtime';
import { env } from '@huggingface/transformers';

// Model files resolve through their canonical HuggingFace URLs, pinned to the
// same revision the download control caches under. The bytes still come from
// the app-controlled Cache Storage — a network fetch only happens for files
// the bundle does not carry (e.g. tokenizer_config.json).
configurePinnedRemoteModelResolution(env as OrtConfigurableEnv, {
  revision: KOKORO_REVISION,
});

// Own the cache. `useCustomCache` is only consulted when `useBrowserCache` is
// off, so both are set; without this the relative `/models/...` lookup hits
// WebView2's persisted (HTML) entry before the canonical key is ever tried.
const pinnedEnv = env as OrtConfigurableEnv & {
  useBrowserCache?: boolean;
  useCustomCache?: boolean;
  customCache?: unknown;
};
pinnedEnv.useBrowserCache = false;
pinnedEnv.useCustomCache = true;
/**
 * Cache keys the owned cache refused, newest last.
 *
 * Surfaced with the initialization error so a future model-load failure names
 * the URL that was rejected instead of only reporting a parse error deep in a
 * third-party bundle.
 */
const rejectedCacheKeys: string[] = [];

pinnedEnv.customCache = createPinnedModelCache(createCacheStorageBackend(), {
  origin: MODEL_ORIGIN,
  repos: [KOKORO_MODEL_ID],
  revision: KOKORO_REVISION,
  onReject: (url) => {
    if (rejectedCacheKeys.length < 10 && !rejectedCacheKeys.includes(url)) {
      rejectedCacheKeys.push(url);
    }
  },
});

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
  /**
   * Optional override for the ORT runtime base URL (ends in '/'). Normally
   * omitted — the shared seam resolves the version-pinned distribution URL.
   */
  wasmPath?: string;
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

    // Configure the ONNX runtime through the single shared seam before Kokoro
    // creates its session. This sets the explicit, version-pinned
    // `wasmPaths` mapping and guarantees the WASM/MJS pair is fetched from
    // the distribution plane — never a hashed `_app/immutable` path.
    const { wasmPaths } = configureOrtRuntime(env as OrtConfigurableEnv, wasmPath);

    // The standalone `onnxruntime-web` instance the Worker controls directly
    // must agree with the transformers env. Importing it here (rather than
    // relying on transformers' inlined copy) lets us pin its env as well.
    const ort = await import('onnxruntime-web/webgpu');
    ort.env.wasm.wasmPaths = wasmPaths;

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
    const base = error instanceof Error ? error.message : 'Unknown initialization error';
    const rejected =
      rejectedCacheKeys.length > 0 ? ` (refused cache keys: ${rejectedCacheKeys.join(', ')})` : '';
    const response: ErrorResponse = { type: 'error', message: `${base}${rejected}` };
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
