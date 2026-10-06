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
// Deep import, not the barrel: this worker bundle is inlined with
// `inlineDynamicImports` and size-checked by `check_bundle.ts`, and the
// utils barrel drags in the API client + logger. The probe itself is the
// single source of truth shared with the text LLM worker and the start menu.
import { isWebGPUSupported } from '@aikami/frontend/utils/browser/webgpu';
import { env, PreTrainedTokenizer, StyleTextToSpeech2Model } from '@huggingface/transformers';
import { createKokoroFetch, kokoroLoadPlan } from './kokoro_runtime.ts';
import type {
  ErrorResponse,
  InitializeMessage,
  InitializeResponse,
  KokoroDevice,
  SynthesizeResponse,
  WorkerErrorPayload,
  WorkerMessage,
} from './kokoro_worker_protocol.ts';

// Model files resolve through their canonical HuggingFace URLs, pinned to the
// same revision the download control caches under. local_files_only forbids
// model network requests, including optional tokenizer_config.json.
configurePinnedRemoteModelResolution(env as OrtConfigurableEnv, {
  revision: KOKORO_REVISION,
});
// Transformers requires this flag with local_files_only. The owned cache still
// refuses relative keys; only canonical pinned remote cache keys can answer.
env.allowLocalModels = true;
globalThis.fetch = createKokoroFetch({
  fetch: globalThis.fetch.bind(globalThis),
  match: async (cache, key) => (await caches.open(cache)).match(key),
});
// Transformers 4 captures fetch at import time; Kokoro's voice loader uses
// the global instead. Both must enforce the same cache-only boundary.
env.fetch = globalThis.fetch;

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
let activeBackend: KokoroDevice = 'wasm';

/**
 * Identifies this module instance, so a response can prove which worker
 * produced it. `session` lives in module scope, so "session not initialized"
 * can only mean the request reached an instance whose handleInitialize never
 * finished — two live instances, not a lost session.
 */
const INSTANCE_ID = `w${Math.random().toString(36).slice(2, 8)}`;

/**
 * Tripwire for a re-evaluated worker entry.
 *
 * A code-split worker whose module graph closes a cycle through a dynamic
 * import can evaluate this module twice inside one worker global. The second
 * pass would install a fresh `self.onmessage` over the first, bound to an
 * empty `session` — so the worker that reported `ready` is no longer the one
 * answering requests, and every synthesis fails with "Kokoro session not
 * initialized". WebKitGTK (Linux Tauri) does not dedupe the re-imported entry;
 * Chromium does, so this only ever bit the Linux desktop build.
 *
 * The bundling is fixed by `worker.rolldownOptions.output.inlineDynamicImports`
 * and enforced by `check_bundle.ts`. This guard exists so that if the shape
 * ever comes back, it fails LOUDLY and leaves the first (working) instance in
 * charge instead of silently hijacking the message router.
 */
const PRIOR_INSTANCE = (globalThis as { __aikamiKokoroWorker?: string }).__aikamiKokoroWorker;
(globalThis as { __aikamiKokoroWorker?: string }).__aikamiKokoroWorker = INSTANCE_ID;

const duplicateEvaluation = (): boolean => {
  if (PRIOR_INSTANCE === undefined) {
    return false;
  }
  self.postMessage({
    type: 'error',
    name: 'DuplicateModuleEvaluation',
    instanceId: INSTANCE_ID,
    message:
      `kokoro_worker entry evaluated twice in one worker global ` +
      `(${PRIOR_INSTANCE} then ${INSTANCE_ID}). This means the worker bundle ` +
      'was code-split into a cyclic module graph; keep every worker ' +
      'self-contained (vite.config.ts → worker.rolldownOptions.output.inlineDynamicImports).',
  });
  return true;
};

// ---------------------------------------------------------------------------
// Message types
// ---------------------------------------------------------------------------

/**
 * Flattens a thrown value into text that survives structured cloning.
 *
 * `error.message` alone is routinely useless for a failure inside
 * transformers/onnxruntime ("null function or function signature mismatch"
 * names neither the model nor the tensor). ORT failures in particular are
 * frequently `null` rejections, where there is no message at all. Keeping the
 * name and the first stack frames is what makes the cause identifiable.
 */
const describeError = (error: unknown): WorkerErrorPayload => {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message || `${error.name} (no message)`,
      stack: error.stack?.split('\n').slice(0, 6).join(' | '),
    };
  }
  if (error === null) {
    return { name: 'NullRejection', message: 'Rejected with null (no error object thrown)' };
  }
  if (typeof error === 'object') {
    try {
      return { name: 'NonError', message: JSON.stringify(error) };
    } catch {
      return { name: 'NonError', message: String(error) };
    }
  }
  return { name: 'Primitive', message: String(error) };
};

// ---------------------------------------------------------------------------
// Backend detection
// ---------------------------------------------------------------------------

// The adapter probe lives in `@aikami/frontend/utils` (`isWebGPUSupported`) —
// this worker's context is the one that matters, so it is decided here, but
// the probe itself is never re-implemented.

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/**
 * True once a load has been started, successful or not.
 *
 * Makes 'initialize' idempotent: the main thread resolves its in-flight
 * promise against a single 'ready', but a duplicate message (a retrying
 * client, a second lifecycle owner) must not pay for a second 92 MB load.
 * `handleInitialize` handles its own failures, so the promise itself is not
 * retained.
 */
let initStarted = false;
/**
 * Serialized synthesis queue.
 *
 * Two concurrent `session.generate` calls on one ORT session interleave
 * tensor writes and produce garbage; running them one at a time also means a
 * superseded utterance can be dropped before it costs a forward pass.
 */
let queue: Promise<void> = Promise.resolve();
/** Requests cancelled before they were dequeued. */
const cancelled = new Set<number>();

const handleInitialize = async (message: InitializeMessage): Promise<void> => {
  try {
    const { wasmPath, device, modelId } = message;

    // Configure the ONNX runtime through the single shared seam before Kokoro
    // creates its session. This sets the explicit, version-pinned
    // `wasmPaths` mapping and guarantees the WASM/MJS pair is fetched from
    // the distribution plane — never a hashed `_app/immutable` path.
    const { wasmPaths } = configureOrtRuntime(env as OrtConfigurableEnv, wasmPath);

    // The two heavy imports and the adapter probe all run concurrently: the
    // probe used to sit on the caller's critical path for up to 3s before
    // the imports even started. Deciding the backend here (rather than on the
    // main thread) is also the only correct place — it is the worker's own
    // context that matters.
    const [ort, { KokoroTTS }, gpuOk] = await Promise.all([
      import('onnxruntime-web/webgpu'),
      import('kokoro-js'),
      device === 'wasm' ? Promise.resolve(false) : isWebGPUSupported(),
    ]);
    // The standalone `onnxruntime-web` instance the Worker controls directly
    // must agree with the transformers env.
    ort.env.wasm.wasmPaths = wasmPaths;

    if (modelId !== KOKORO_MODEL_ID || message.revision !== KOKORO_REVISION) {
      throw new Error('Kokoro model/revision does not match the downloaded bundle.');
    }
    const plan = kokoroLoadPlan({ device, gpuSupported: gpuOk });
    // Kokoro 1.2.1's from_pretrained drops revision/local_files_only options.
    // Its public constructor accepts explicitly loaded model and tokenizer.
    const [model, tokenizerJson] = await Promise.all([
      StyleTextToSpeech2Model.from_pretrained(modelId, plan.model),
      (await fetch(plan.tokenizer.key)).json(),
    ]);
    // Transformers 4's AutoTokenizer probes tokenizer_config.json before
    // forwarding local_files_only. This bundle predates that required file;
    // use its public constructor and the pinned metadata shipped in the plan.
    session = new KokoroTTS(model, new PreTrainedTokenizer(tokenizerJson, plan.tokenizer.config));
    activeBackend = plan.model.device;

    const response: InitializeResponse = {
      type: 'ready',
      backend: activeBackend,
      fallbackReason: plan.fallbackReason,
      instanceId: INSTANCE_ID,
    };
    self.postMessage(response);
  } catch (error: unknown) {
    const base = error instanceof Error ? error.message : 'Unknown initialization error';
    const detail = describeError(error);
    const rejected =
      rejectedCacheKeys.length > 0 ? ` (refused cache keys: ${rejectedCacheKeys.join(', ')})` : '';
    const response: ErrorResponse = {
      type: 'error',
      ...detail,
      instanceId: INSTANCE_ID,
      message: `${base}${rejected}`,
    };
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
      instanceId: INSTANCE_ID,
      requestId,
    };
    self.postMessage(response);
    return;
  }

  if (!text.trim()) {
    const response: ErrorResponse = {
      type: 'error',
      name: 'EmptyText',
      message: 'Empty text — nothing to synthesize.',
      instanceId: INSTANCE_ID,
      requestId,
    };
    self.postMessage(response);
    return;
  }

  try {
    // `session.generate()` is one opaque call that hides four distinct
    // failure modes: voice validation, espeak phonemization, the voice
    // embedding load, and the ONNX forward pass. The active backend is
    // attached to the failure because the forward pass is the one that
    // differs per platform (WebGPU vs WASM).
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

    const response: SynthesizeResponse = {
      type: 'complete',
      pcmData,
      sampleRate,
      requestId,
      instanceId: INSTANCE_ID,
    };
    self.postMessage(response, { transfer: [pcmData.buffer] });
  } catch (error: unknown) {
    const detail = describeError(error);
    // The backend prefix is the single most useful discriminator here: a
    // WASM-only failure on a machine where WebGPU was selected points at the
    // graph-capture/ORT path, not at the model or the voice.
    const response: ErrorResponse = {
      type: 'error',
      ...detail,
      instanceId: INSTANCE_ID,
      message: `[${activeBackend}] ${detail.message}`,
      requestId,
    };
    self.postMessage(response);
  }
};

// ---------------------------------------------------------------------------
// Message router
// ---------------------------------------------------------------------------

// A second evaluation must NOT take over the router: the first instance owns
// a fully-initialized `session`, and replacing it is what breaks synthesis.
if (duplicateEvaluation()) {
  // Module intentionally inert — see `duplicateEvaluation`.
} else {
  self.onmessage = (event: MessageEvent<WorkerMessage>) => {
    const { data } = event;

    switch (data.action) {
      case 'initialize':
        // Idempotent: a duplicate joins the first load rather than paying for
        // the 92 MB model twice.
        if (!initStarted) {
          initStarted = true;
          void handleInitialize(data);
        }
        break;

      case 'synthesize':
        queue = queue.then(() =>
          cancelled.delete(data.requestId)
            ? undefined
            : handleSynthesize({ text: data.text, voice: data.voice, requestId: data.requestId }),
        );
        break;

      case 'cancel':
        // Recorded even when the request is still queued, so a superseded
        // utterance is never generated just to be thrown away.
        cancelled.add(data.requestId);
        break;

      default:
        break;
    }
  };
}
