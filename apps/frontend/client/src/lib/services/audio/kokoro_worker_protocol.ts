// apps/frontend/client/src/lib/services/audio/kokoro_worker_protocol.ts
//
// The message contract between `tts_service.svelte.ts` and
// `kokoro_worker.ts`.
//
// Both sides previously hand-rolled their own copy of these types, which is
// how the error payload quietly drifted: the worker grew `name`/`stack`
// fields for diagnosis while the service still typed the response without
// them, so the extra detail was dropped at the boundary and every synthesis
// failure surfaced as an unusable collapsed "Object" in the console.
//
// One shared definition keeps the wire format honest, and `formatWorkerError`
// renders a failure as a single flat string that survives console collapse.

import { KOKORO_MODEL_ID, KOKORO_REVISION } from '@aikami/constants';

/** Backend the worker actually loaded, as reported in `ready`. */
export type KokoroDevice = 'webgpu' | 'wasm';

/**
 * Backend the caller asks for.
 *
 * `auto` lets the worker decide, which is the only correct place to probe:
 * the main thread and the worker are different contexts, and probing on the
 * critical path cost up to 2s in front of a 7-second model load for a
 * decision the worker was going to re-make anyway.
 */
export type KokoroDevicePreference = 'auto' | KokoroDevice;

/** The model this runtime speaks. Shared so the two sides cannot drift. */
export const KOKORO_WORKER_MODEL = {
  modelId: KOKORO_MODEL_ID,
  revision: KOKORO_REVISION,
} as const;

export type InitializeMessage = {
  action: 'initialize';
  /**
   * Optional override for the ORT runtime base URL (ends in '/'). Normally
   * omitted — the shared ORT seam resolves the version-pinned distribution URL.
   */
  wasmPath?: string;
  device: KokoroDevicePreference;
  /** HF model id — pinned by the shared constant, not restated per caller. */
  modelId: string;
  /** Pinned revision; the worker must resolve URLs against this exact value. */
  revision: string;
};

export type SynthesizeMessage = {
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

/**
 * Drops a queued request before it is synthesized.
 *
 * Without this a superseded utterance is fully generated and then thrown
 * away — the model is still loaded, so the cost is a wasted forward pass.
 */
export type CancelMessage = {
  action: 'cancel';
  requestId: number;
};

export type WorkerMessage = InitializeMessage | SynthesizeMessage | CancelMessage;

export type InitializeResponse = {
  type: 'ready';
  /** Which backend actually loaded. */
  backend: KokoroDevice;
  /**
   * Identifies the worker module instance that loaded the model.
   *
   * `session` is module state, so a 'synthesize' answered with
   * "Kokoro session not initialized" means the request reached an instance
   * whose `handleInitialize` never completed. Echoing this id on every
   * response makes that distinguishable from a single instance losing its
   * session, which no code path can do.
   */
  instanceId: string;
};

export type SynthesizeResponse = {
  type: 'complete';
  pcmData: Float32Array;
  sampleRate: number;
  /** Echoes the requesting {@link SynthesizeMessage.requestId}. */
  requestId: number;
  instanceId: string;
};

export type ErrorResponse = {
  type: 'error';
  message: string;
  /** Error class name (e.g. 'RangeError') — usually more diagnostic than the message. */
  name?: string;
  /** First stack frames, when the engine provides them. */
  stack?: string;
  /** The worker module instance reporting this failure. */
  instanceId?: string;
  /**
   * Echoes the requesting {@link SynthesizeMessage.requestId} when the
   * failure belongs to ONE request. Absent means the engine itself is
   * unusable (init failure, crash, bad module shape) — the caller must fail
   * the whole engine rather than just this utterance.
   */
  requestId?: number;
};

export type WorkerResponse = InitializeResponse | SynthesizeResponse | ErrorResponse;

/** The subset of {@link ErrorResponse} the client renders for logs. */
export type WorkerErrorPayload = Pick<ErrorResponse, 'message' | 'name' | 'stack' | 'instanceId'>;

/** A completed utterance, transferred out of the worker. */
export type SynthResult = { pcmData: Float32Array; sampleRate: number };

/**
 * Renders a worker's 'ready' as one flat, console-safe string.
 *
 * Reported as text rather than a structured payload for the same reason as
 * {@link formatWorkerError}: a `{ backend }` object collapses to `Object` in
 * the devtools console.
 */
export const formatWorkerReady = (payload: InitializeResponse): string =>
  `initialize:ready worker=${payload.instanceId ?? '?'} backend=${payload.backend}`;

/**
 * Renders a worker failure as one flat, console-safe string.
 *
 * A structured `{ message }` payload renders as a collapsed `Object` in the
 * devtools console, which hid the cause of every synthesis failure. The name
 * and stack are what identify a fault inside transformers/onnxruntime, where
 * the message alone ("null function or function signature mismatch") names
 * neither the model nor the tensor.
 *
 * The worker id is printed on every response, so a module that evaluated
 * twice is visible by comparing two log lines.
 */
export const formatWorkerError = (payload: WorkerErrorPayload): string =>
  `kokoro:worker-error [worker ${payload.instanceId ?? '?'}] ` +
  `${payload.name ?? 'Error'}: ${payload.message}` +
  (payload.stack ? ` | ${payload.stack}` : '');

/**
 * How long `KokoroWorkerClient.start` waits for `ready` before giving up.
 *
 * A cold Kokoro 82M load is ~7s, so this is generous; it exists to convert a
 * worker that silently never reports into an explicit failure instead of an
 * engine stuck in `initializing` forever.
 */
export const KOKORO_INIT_TIMEOUT_MS = 90_000;
