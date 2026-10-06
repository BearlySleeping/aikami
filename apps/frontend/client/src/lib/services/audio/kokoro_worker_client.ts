// apps/frontend/client/src/lib/services/audio/kokoro_worker_client.ts

/**
 * Owns the Kokoro Web Worker: its lifetime, its message routing, and the
 * correlation of requests to responses.
 *
 * Why this exists
 * ---------------
 * The service used to hold a raw `Worker` plus a generation counter, a
 * `_workerReady` boolean, an `_activeWorkerRequest` slot and a ~95-line
 * `onmessage` switch. That arrangement could not express the invariant that
 * actually matters: *a request may only be sent to the worker that reported
 * ready, and only while it is still that worker*. `status` lived on the
 * service, so a `ready` from a replaced worker could mark a different,
 * session-less one as usable — the symptom being every synthesis failing
 * with "Kokoro session not initialized".
 *
 * The client object IS the key. Identity is `===` on the client, so readiness
 * cannot outlive the worker it belongs to, and a superseded worker is
 * unreachable by construction.
 *
 * It also turns a module that evaluated twice (a code-split worker whose
 * module graph closes a cycle — see `check_bundle.ts`) into one precise
 * fatal error instead of a silent router hijack.
 */

import { logger } from '$logger';
import {
  type ErrorResponse,
  formatWorkerError,
  formatWorkerReady,
  KOKORO_INIT_TIMEOUT_MS,
  KOKORO_WORKER_MODEL,
  type KokoroDevice,
  type SynthResult,
  type WorkerErrorPayload,
  type WorkerResponse,
} from './kokoro_worker_protocol.ts';

type Pending = {
  resolve: (result: SynthResult) => void;
  reject: (error: Error) => void;
  detach: () => void;
};

/** Reported when the engine is unusable, not merely this one request. */
export type KokoroEngineFailure = {
  readonly client: KokoroWorkerClient;
  readonly error: Error;
  /** False once the failure is an ordinary per-request error. */
  readonly fatal: boolean;
};

export type StartOptions = {
  /** Version-pinned ORT distribution base, already resolved by the shared seam. */
  readonly wasmPath: string;
  /**
   * Governs the worker's whole lifetime. Aborting terminates the worker at
   * any point, including mid-load — this is what makes `reset()` during a
   * 7-second model load safe.
   */
  readonly signal: AbortSignal;
  readonly onFailure: (failure: KokoroEngineFailure) => void;
  readonly timeoutMs?: number;
};

export type StartResult = {
  readonly client: KokoroWorkerClient;
  readonly backend: KokoroDevice;
};

export class KokoroWorkerClient {
  readonly #worker: Worker;
  readonly #pending = new Map<number, Pending>();
  readonly #ready: {
    promise: Promise<KokoroDevice>;
    resolve: (device: KokoroDevice) => void;
    reject: (error: Error) => void;
  };
  #seq = 0;
  #instanceId: string | undefined;
  #dead: Error | undefined;
  readonly #onFailure: (failure: KokoroEngineFailure) => void;

  private constructor(onFailure: (failure: KokoroEngineFailure) => void) {
    this.#onFailure = onFailure;
    // Keep this literal form: it is how Vite detects and bundles a worker.
    this.#worker = new Worker(new URL('./kokoro_worker.ts', import.meta.url), { type: 'module' });
    this.#worker.onmessage = (event: MessageEvent) => this.#route(event.data as WorkerResponse);
    this.#worker.onerror = (event: ErrorEvent) => {
      event.preventDefault();
      this.#die(new Error(event.message || 'Kokoro worker crashed'), true);
    };
    this.#worker.onmessageerror = () =>
      this.#die(new Error('Kokoro worker message could not be deserialized'), true);

    let resolveReady: (device: KokoroDevice) => void = () => {};
    let rejectReady: (error: Error) => void = () => {};
    const promise = new Promise<KokoroDevice>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    this.#ready = { promise, resolve: resolveReady, reject: rejectReady };
    // #die() rejects this on failure; nobody may be awaiting it yet.
    void promise.catch(() => {});
  }

  /** The worker module instance, once it has identified itself. */
  get instanceId(): string | undefined {
    return this.#instanceId;
  }

  /**
   * Spawns a worker and resolves when it has loaded the model.
   *
   * Rejects if the load fails, the timeout elapses, or `signal` aborts. The
   * caller owns the signal, so an abort always terminates the worker.
   */
  static async start(options: StartOptions): Promise<StartResult> {
    options.signal.throwIfAborted();
    const client = new KokoroWorkerClient(options.onFailure);
    const { signal } = options;
    const onAbort = (): void => client.#die(signal.reason as Error, false);
    signal.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(
      () => client.#die(new Error('Kokoro model load timed out'), true),
      options.timeoutMs ?? KOKORO_INIT_TIMEOUT_MS,
    );
    client.#worker.postMessage({
      action: 'initialize',
      wasmPath: options.wasmPath,
      device: 'auto',
      modelId: KOKORO_WORKER_MODEL.modelId,
      revision: KOKORO_WORKER_MODEL.revision,
    });
    try {
      return { client, backend: await client.#ready.promise };
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    }
  }

  /**
   * Synthesizes one utterance.
   *
   * Rejects on a genuine failure and with the abort reason when `signal`
   * fires; the worker is told to skip the request so a superseded utterance
   * is never generated and discarded.
   */
  synthesize(options: { text: string; voice: string; signal: AbortSignal }): Promise<SynthResult> {
    if (this.#dead) {
      return Promise.reject(this.#dead);
    }
    if (options.signal.aborted) {
      return Promise.reject(options.signal.reason as Error);
    }
    const requestId = ++this.#seq;
    return new Promise<SynthResult>((resolve, reject) => {
      const onAbort = (): void => {
        if (this.#pending.delete(requestId)) {
          this.#worker.postMessage({ action: 'cancel', requestId });
          reject(options.signal.reason as Error);
        }
      };
      options.signal.addEventListener('abort', onAbort, { once: true });
      const detach = (): void => options.signal.removeEventListener('abort', onAbort);
      this.#pending.set(requestId, {
        resolve: (result) => {
          detach();
          resolve(result);
        },
        reject: (error) => {
          detach();
          reject(error);
        },
        detach,
      });
      this.#worker.postMessage({
        action: 'synthesize',
        text: options.text,
        voice: options.voice,
        requestId,
      });
    });
  }

  /** Cancels one in-flight request without killing the engine. */
  cancel(requestId: number): void {
    if (this.#dead) {
      return;
    }
    this.#pending.get(requestId)?.reject(new DOMException('cancelled', 'AbortError'));
    this.#worker.postMessage({ action: 'cancel', requestId });
  }

  dispose(): void {
    this.#die(new DOMException('disposed', 'AbortError'), false);
  }

  #route(message: WorkerResponse): void {
    // Pin the instance on first contact. A change means the worker entry
    // module was evaluated twice, which silently replaces the message router
    // with one bound to empty module state — unrecoverable, so fail loudly.
    if (message.instanceId !== undefined) {
      this.#instanceId ??= message.instanceId;
      if (message.instanceId !== this.#instanceId) {
        const changed: WorkerErrorPayload = {
          instanceId: message.instanceId,
          name: 'WorkerInstanceChanged',
          message:
            `Kokoro worker module instance changed (${this.#instanceId} → ` +
            `${message.instanceId}); the worker entry was evaluated twice. ` +
            'Keep every worker self-contained.',
        };
        this.#die(new Error(formatWorkerError(changed)), true);
        return;
      }
    }

    if (message.type === 'ready') {
      logger.info(formatWorkerReady(message));
      this.#ready.resolve(message.backend);
      return;
    }
    if (message.type === 'complete') {
      this.#settle(message.requestId)?.resolve({
        pcmData: message.pcmData,
        sampleRate: message.sampleRate,
      });
      return;
    }
    this.#routeError(message);
  }

  #routeError(message: ErrorResponse): void {
    const error = new Error(message.message);
    logger.error(formatWorkerError(message));
    // A requestId means the failure belongs to ONE utterance. Its absence
    // means the engine itself is unusable.
    if (message.requestId === undefined) {
      this.#die(error, true);
      return;
    }
    // No matching request: a superseded utterance reporting late. It must
    // not fail the engine the caller is still using.
    this.#settle(message.requestId)?.reject(error);
  }

  #settle(requestId: number): Pending | undefined {
    const pending = this.#pending.get(requestId);
    if (!pending) {
      // Superseded or already settled — the worker finishing late must not
      // disturb the engine or emit audio the user cancelled.
      return undefined;
    }
    this.#pending.delete(requestId);
    pending.detach();
    return pending;
  }

  #die(error: Error, fatal: boolean): void {
    if (this.#dead) {
      return;
    }
    this.#dead = error;
    this.#worker.terminate();
    this.#ready.reject(error);
    const rejected = [...this.#pending.values()];
    this.#pending.clear();
    for (const pending of rejected) {
      pending.detach();
      pending.reject(error);
    }
    if (fatal) {
      this.#onFailure({ client: this, error, fatal: true });
    }
  }
}
