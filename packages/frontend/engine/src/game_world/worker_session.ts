// packages/frontend/engine/src/game_world/worker_session.ts
//
// Owns the main thread's side of the simulation-worker transport:
//
// - worker creation (injected factory or the Vite `?worker` bootstrap),
// - typed fire-and-forget posts and correlated requests,
// - exactly-once settlement with timeouts for every pending request,
// - the liveness heartbeat (PING/PONG plus semantic tick-stall recovery),
// - the N-buffer transfer/recycle accounting.
//
// It deliberately knows nothing about PixiJS, scene transitions, or entity
// visuals — those live in the facade and its other collaborators. A request
// settles at most once, and late replies for a settled request are ignored,
// so an out-of-order worker cannot resolve a newer operation.

import {
  asWorkerMessage,
  isWorkerTerminalMessage,
  type WorkerMessage,
  type WorkerTerminalType,
} from '../worker/worker_protocol.ts';

/** Worker constructor produced by the Vite `?worker&type=module` import. */
export type EcsWorkerConstructor = new () => Worker;

/**
 * A main → worker message.
 *
 * This is the outbound boundary: `type` selects the operation and the worker
 * validates the payload fields it reads. It intentionally stays open so the
 * session does not have to import every game-specific payload type.
 */
export type WorkerOutboundMessage = { type: string } & Record<string, unknown>;

/** A worker/session failure the facade should surface + log. */
export type WorkerFailure =
  | { kind: 'error'; message: string; detail: Record<string, unknown> }
  | { kind: 'message-error'; message: string }
  | { kind: 'post'; message: string; detail: Record<string, unknown> };

/** Heartbeat observation emitted for logging (never for control flow). */
export type HeartbeatEvent =
  | {
      kind: 'stall';
      tickCount: number;
      staleCycles: number;
      writableBufferCount: number;
      syncWithBuffer: number;
      syncWithoutBuffer: number;
      recycled: number;
    }
  | { kind: 'missed'; elapsedMs: number; missedCount: number };

/** Timer indirection so tests can drive time deterministically. */
export type WorkerSessionTimers = {
  setInterval: (handler: () => void, ms: number) => ReturnType<typeof setInterval>;
  clearInterval: (handle: ReturnType<typeof setInterval>) => void;
  setTimeout: (handler: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (handle: ReturnType<typeof setTimeout>) => void;
};

/** Options for {@link WorkerSession.start}. */
export type WorkerStartOptions = {
  canvasWidth: number;
  canvasHeight: number;
  buffers: ArrayBuffer[];
  loadPayload?: string;
  playerData?: unknown;
  collisionGrid?: unknown;
  lpcCatalog?: unknown;
};

export type WorkerSessionOptions = {
  /** Receives every inbound worker message after correlation handling. */
  onMessage: (message: WorkerMessage) => void;
  /** Receives transport failures (crash, serialization, postMessage throw). */
  onFailure: (failure: WorkerFailure) => void;
  /** Optional heartbeat observation sink for logging. */
  onHeartbeat?: (event: HeartbeatEvent) => void;
  /** Injected worker factory (tests, Vite `?worker` at the call site). */
  workerFactory?: () => Worker;
  /** Loads the default Vite worker constructor lazily. */
  loadWorkerConstructor?: () => Promise<EcsWorkerConstructor>;
  /** Heartbeat period in ms (default 2000). */
  heartbeatIntervalMs?: number;
  /** Default correlated-request timeout in ms (default 15000). */
  requestTimeoutMs?: number;
  /** When `false` (e.g. input is locked), skip semantic stall escalation. */
  shouldCheckStall?: () => boolean;
  /** Monotonic clock, injectable for tests. */
  now?: () => number;
  /** Timer implementation, injectable for tests. */
  timers?: WorkerSessionTimers;
};

/** Internal bookkeeping for one in-flight correlated request. */
type PendingRequest = {
  timer: ReturnType<typeof setTimeout>;
  expects: ReadonlySet<WorkerTerminalType>;
  resolve: (message: WorkerMessage) => void;
  reject: (reason: Error) => void;
};

/** Milliseconds before a correlated request is considered lost. */
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

/** Milliseconds between heartbeat PINGs. */
const DEFAULT_HEARTBEAT_INTERVAL_MS = 2_000;

/** Consecutive stale ticks before the session asks the worker to reset. */
const STALE_TICK_THRESHOLD = 3;

/** Default loader for the Vite worker constructor (lazy, non-Vite safe). */
const defaultLoadWorkerConstructor = async (): Promise<EcsWorkerConstructor> => {
  const workerModule = await import('../worker/ecs_worker_bootstrap.ts?worker&type=module');
  return workerModule.default as EcsWorkerConstructor;
};

const defaultTimers: WorkerSessionTimers = {
  setInterval: (handler, ms) => setInterval(handler, ms),
  clearInterval: (handle) => clearInterval(handle),
  setTimeout: (handler, ms) => setTimeout(handler, ms),
  clearTimeout: (handle) => clearTimeout(handle),
};

export class WorkerSession {
  private readonly _onMessage: (message: WorkerMessage) => void;
  private readonly _onFailure: (failure: WorkerFailure) => void;
  private readonly _onHeartbeat: ((event: HeartbeatEvent) => void) | undefined;
  private readonly _workerFactory: (() => Worker) | undefined;
  private readonly _loadWorkerConstructor: () => Promise<EcsWorkerConstructor>;
  private readonly _heartbeatIntervalMs: number;
  private readonly _requestTimeoutMs: number;
  private readonly _shouldCheckStall: (() => boolean) | undefined;
  private readonly _now: () => number;
  private readonly _timers: WorkerSessionTimers;

  private _worker: Worker | undefined;
  private _workerConstructor: EcsWorkerConstructor | undefined;
  private _starting: Promise<void> | undefined;
  private _disposed = false;

  private _pending = new Map<number, PendingRequest>();
  private _nextRequestId = 1;

  private _heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private _lastPongMs = 0;
  private _missedHeartbeats = 0;
  private _lastKnownTickCount = 0;
  private _lastCheckedTickCount = 0;
  private _staleTickCycles = 0;
  private _lastWritableBufferCount = -1;

  private _syncWithBufferCount = 0;
  private _syncWithoutBufferCount = 0;
  private _recycledBufferCount = 0;

  constructor(options: WorkerSessionOptions) {
    this._onMessage = options.onMessage;
    this._onFailure = options.onFailure;
    this._onHeartbeat = options.onHeartbeat;
    this._workerFactory = options.workerFactory;
    this._loadWorkerConstructor = options.loadWorkerConstructor ?? defaultLoadWorkerConstructor;
    this._heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
    this._requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this._shouldCheckStall = options.shouldCheckStall;
    this._now = options.now ?? (() => performance.now());
    this._timers = options.timers ?? defaultTimers;
  }

  /** The live worker, or `undefined` before start / after terminate. */
  get worker(): Worker | undefined {
    return this._worker;
  }

  /** True once {@link terminate} has run. */
  get isDisposed(): boolean {
    return this._disposed;
  }

  /**
   * Creates the worker and posts INITIALIZE_ENGINE with the buffer pool
   * transferred to the worker.
   *
   * Concurrent calls share one start promise; a call after
   * {@link terminate} rejects instead of resurrecting a worker.
   */
  async start(options: WorkerStartOptions): Promise<void> {
    if (this._disposed) {
      throw new Error('WorkerSession disposed — cannot start');
    }
    if (this._worker) {
      return;
    }
    if (this._starting) {
      return this._starting;
    }
    this._starting = this._createAndInitialize(options).finally(() => {
      this._starting = undefined;
    });
    return this._starting;
  }

  /**
   * Posts a fire-and-forget message. Returns `false` when there is no live
   * worker or postMessage threw (reported through `onFailure`).
   */
  post(message: WorkerOutboundMessage, transfer?: Transferable[]): boolean {
    const worker = this._worker;
    if (this._disposed || !worker) {
      return false;
    }
    return this._postMessage(worker, message, transfer);
  }

  /**
   * Posts `message` with a correlation id and resolves with the matching
   * terminal reply.
   *
   * Settles exactly once. Timeout, worker crash, serialization failure, and
   * disposal each reject every affected request. A reply whose id no longer
   * has a pending entry (a late reply) is ignored.
   */
  request<TType extends WorkerTerminalType>(options: {
    message: WorkerOutboundMessage;
    expect: TType | readonly TType[];
    timeoutMs?: number;
    transfer?: Transferable[];
  }): Promise<Extract<WorkerMessage, { type: TType }>> {
    const worker = this._worker;
    if (this._disposed || !worker) {
      return Promise.reject(new Error('Worker not running — cannot send request'));
    }

    const requestId = this._nextRequestId++;
    const expects = new Set<WorkerTerminalType>(
      Array.isArray(options.expect) ? options.expect : [options.expect],
    );
    const timeoutMs = options.timeoutMs ?? this._requestTimeoutMs;

    return new Promise<Extract<WorkerMessage, { type: TType }>>((resolve, reject) => {
      const timer = this._timers.setTimeout(() => {
        const pending = this._pending.get(requestId);
        if (!pending) {
          return;
        }
        this._pending.delete(requestId);
        reject(
          new Error(
            `Worker did not respond to ${options.message.type} within ${timeoutMs}ms — worker may have crashed`,
          ),
        );
      }, timeoutMs);

      this._pending.set(requestId, {
        timer,
        expects,
        resolve: resolve as (message: WorkerMessage) => void,
        reject,
      });

      if (!this._postMessage(worker, { ...options.message, requestId }, options.transfer)) {
        this._pending.delete(requestId);
        this._timers.clearTimeout(timer);
        reject(new Error(`Failed to post ${options.message.type} to worker`));
      }
    });
  }

  /**
   * Returns a transferred buffer to the worker and records the recycle.
   *
   * No-op when the buffer is empty/detached or the worker is gone.
   */
  recycleBuffer(buffer: ArrayBuffer | undefined): void {
    if (!buffer || buffer.byteLength === 0) {
      return;
    }
    if (this.post({ type: 'RECYCLE_BUFFER', buffer }, [buffer])) {
      this._recycledBufferCount++;
    }
  }

  /** Starts the PING/PONG + semantic-tick heartbeat. Idempotent. */
  startHeartbeat(): void {
    if (this._disposed || this._heartbeatTimer) {
      return;
    }
    this._lastPongMs = this._now();
    this._missedHeartbeats = 0;
    this._lastKnownTickCount = 0;
    this._lastCheckedTickCount = 0;
    this._staleTickCycles = 0;

    this._heartbeatTimer = this._timers.setInterval(() => {
      this._heartbeatTick();
    }, this._heartbeatIntervalMs);
  }

  /** Stops the heartbeat. Idempotent. */
  stopHeartbeat(): void {
    if (!this._heartbeatTimer) {
      return;
    }
    this._timers.clearInterval(this._heartbeatTimer);
    this._heartbeatTimer = undefined;
  }

  /**
   * Tears the session down: rejects pending requests exactly once, stops
   * the heartbeat, detaches handlers, and terminates the worker.
   *
   * Idempotent; a terminated session never posts again.
   */
  terminate(): void {
    if (this._disposed) {
      return;
    }
    this._disposed = true;
    this.stopHeartbeat();
    this._rejectAllPending(new Error('WorkerSession disposed during pending operation'));

    const worker = this._worker;
    this._worker = undefined;
    if (worker) {
      worker.onerror = null;
      worker.onmessage = null;
      worker.onmessageerror = null;
      worker.terminate();
    }
  }

  // ── Internal ────────────────────────────────────────────────────────

  private async _createAndInitialize(options: WorkerStartOptions): Promise<void> {
    let worker: Worker;
    if (this._workerFactory) {
      worker = this._workerFactory();
    } else {
      if (!this._workerConstructor) {
        try {
          this._workerConstructor = await this._loadWorkerConstructor();
        } catch (error) {
          this._workerConstructor = undefined;
          throw error;
        }
      }
      if (this._disposed) {
        return;
      }
      worker = new this._workerConstructor();
    }

    if (this._disposed) {
      worker.terminate();
      return;
    }

    this._worker = worker;
    worker.onerror = (event: ErrorEvent): void => {
      this._handleWorkerError(event);
    };
    worker.onmessageerror = (): void => {
      this._handleMessageError();
    };
    worker.onmessage = (event: MessageEvent): void => {
      this._handleInbound(event.data);
    };

    // Handlers are registered before the first post so a synchronous
    // module-evaluation error in the worker is still captured.
    if (
      !this._postMessage(
        worker,
        {
          type: 'INITIALIZE_ENGINE',
          canvasWidth: options.canvasWidth,
          canvasHeight: options.canvasHeight,
          loadPayload: options.loadPayload,
          playerData: options.playerData,
          collisionGrid: options.collisionGrid,
          lpcCatalog: options.lpcCatalog,
        },
        [...options.buffers],
      )
    ) {
      throw new Error('Failed to post INITIALIZE_ENGINE to worker');
    }
  }

  /** Posts and converts a throw into a reported failure. */
  private _postMessage(
    worker: Worker,
    message: WorkerOutboundMessage,
    transfer?: Transferable[],
  ): boolean {
    try {
      if (transfer && transfer.length > 0) {
        worker.postMessage(message, transfer);
      } else {
        worker.postMessage(message);
      }
      return true;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this._onFailure({
        kind: 'post',
        message: `postMessage failed: ${detail}`,
        detail: { type: message.type },
      });
      return false;
    }
  }

  private _handleInbound(data: unknown): void {
    const message = asWorkerMessage(data);
    if (!message) {
      return;
    }
    this._observeLiveness(message);
    if (
      'requestId' in message &&
      typeof message.requestId === 'number' &&
      isWorkerTerminalMessage(message)
    ) {
      this._settle(message.requestId, message);
    }
    this._onMessage(message);
  }

  /** Updates heartbeat/buffer bookkeeping from an inbound message. */
  private _observeLiveness(message: WorkerMessage): void {
    if (message.type === 'PONG') {
      this._lastPongMs = this._now();
      this._missedHeartbeats = 0;
      return;
    }
    if (message.type !== 'STATE_UPDATE') {
      return;
    }
    if (message.buffer) {
      this._syncWithBufferCount++;
    } else {
      this._syncWithoutBufferCount++;
    }
    const ack = message.ack;
    if (typeof ack?.tickCount === 'number') {
      this._lastKnownTickCount = ack.tickCount;
    }
    if (typeof ack?.writableBufferCount === 'number') {
      this._lastWritableBufferCount = ack.writableBufferCount;
    }
  }

  /** Settles the pending request for `requestId`, if any, exactly once. */
  private _settle(
    requestId: number,
    message: Extract<WorkerMessage, { type: WorkerTerminalType }>,
  ): void {
    const pending = this._pending.get(requestId);
    if (!pending?.expects.has(message.type)) {
      return;
    }
    this._pending.delete(requestId);
    this._timers.clearTimeout(pending.timer);

    if (message.type === 'ENGINE_ERROR') {
      pending.reject(new Error(message.message ?? 'Worker operation failed'));
      return;
    }
    if (message.type === 'SNAPSHOT_RESPONSE' && message.error) {
      pending.reject(new Error(message.error));
      return;
    }
    pending.resolve(message);
  }

  private _rejectAllPending(reason: Error): void {
    for (const pending of this._pending.values()) {
      this._timers.clearTimeout(pending.timer);
      pending.reject(reason);
    }
    this._pending.clear();
  }

  private _handleWorkerError(event: ErrorEvent): void {
    const detail = {
      message: event.message || '(no message)',
      filename: event.filename || '(unknown)',
      lineno: event.lineno,
      colno: event.colno,
      errorMessage:
        event.error instanceof Error ? event.error.message : String(event.error ?? 'none'),
      errorStack: event.error instanceof Error ? event.error.stack : undefined,
      errorConstructor: event.error?.constructor?.name ?? 'none',
    };
    this._rejectAllPending(
      new Error(`Worker crashed: ${detail.message} @ ${detail.filename}:${detail.lineno}`),
    );
    this._onFailure({ kind: 'error', message: detail.message, detail });
  }

  private _handleMessageError(): void {
    this._rejectAllPending(
      new Error('Worker message serialization error — data could not be deserialized'),
    );
    this._onFailure({
      kind: 'message-error',
      message: 'Worker message serialization error — data could not be deserialized',
    });
  }

  private _heartbeatTick(): void {
    if (!this._worker) {
      return;
    }

    const currentTick = this._lastKnownTickCount;
    if (currentTick > 0 && (this._shouldCheckStall?.() ?? true)) {
      if (currentTick === this._lastCheckedTickCount) {
        this._staleTickCycles++;
      } else {
        this._staleTickCycles = 0;
      }
      if (this._staleTickCycles >= STALE_TICK_THRESHOLD) {
        this._onHeartbeat?.({
          kind: 'stall',
          tickCount: currentTick,
          staleCycles: this._staleTickCycles,
          writableBufferCount: this._lastWritableBufferCount,
          syncWithBuffer: this._syncWithBufferCount,
          syncWithoutBuffer: this._syncWithoutBufferCount,
          recycled: this._recycledBufferCount,
        });
        this.post({ type: 'RESET_TICK_LOOP' });
        this._staleTickCycles = 0;
      }
      this._lastCheckedTickCount = currentTick;
    }

    const elapsed = this._now() - this._lastPongMs;
    if (elapsed > this._heartbeatIntervalMs * STALE_TICK_THRESHOLD) {
      this._missedHeartbeats++;
      this._onHeartbeat?.({
        kind: 'missed',
        elapsedMs: Math.round(elapsed),
        missedCount: this._missedHeartbeats,
      });
      this._lastPongMs = this._now();
    }

    this.post({ type: 'PING', timestamp: this._now() });
  }
}
