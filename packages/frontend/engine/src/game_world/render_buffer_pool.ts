// packages/frontend/engine/src/game_world/render_buffer_pool.ts
//
// Ownership of the N transferable entity-state buffers plus the retained
// interpolation history (previous view, timing, camera, receive timestamp).
//
// The worker transfers a buffer on every STATE_UPDATE; this pool adopts it,
// hands the outgoing buffer back through an injected recycle callback, and
// keeps one previous render state so the frame renderer can interpolate.
// Keeping the transfer/recycle and history state in one place makes the
// buffer lifecycle explicit and unit-testable without a worker or PixiJS.
//
// Two invariants the rest of the engine relies on:
//
// 1. **A discontinuity snaps.** `resetHistory` marks the next adopted state as
//    a discontinuity. Without that mark the first state after a map switch
//    copied the OLD scene's still-active view into the history slot, and the
//    renderer then interpolated every reused entity id from stale coordinates
//    (alpha 0 — the player snapped back to where they were before the switch).
// 2. **The adopted buffer is sized.** A buffer whose byteLength disagrees with
//    the engine layout is handed straight back to the recycle pool instead of
//    being adopted, so a malformed message cannot make the renderer read
//    `undefined` (NaN) coordinates out of bounds.

import { BUFFER_SIZE, createEngineBuffer, FALLBACK_BUFFER_COUNT } from '../config/memory_config.ts';
import type { StateUpdateMessage } from '../worker/worker_protocol.ts';

/** Fixed-step timing carried on STATE_UPDATE for interpolation. */
export type StateTiming = { tick: number; simTimeMs: number; stepMs: number };

/** World-space camera position. */
export type CameraSnapshot = { x: number; y: number };

/** Injection points for observing pool decisions in tests and diagnostics. */
export type RenderBufferPoolHooks = {
  /** Called when a state message is discarded at the ingestion boundary. */
  onRejectedState?: (detail: { reason: string; byteLength?: number }) => void;
  /**
   * Byte length an adopted buffer must have. Defaults to the engine layout
   * ({@link BUFFER_SIZE}); tests override it to drive tiny fixtures.
   */
  expectedBufferBytes?: number;
};

/** Why a STATE_UPDATE was not adopted. */
type RejectionReason = 'wrong-buffer-size' | 'non-finite-timing';

const isFiniteTiming = (message: StateUpdateMessage): boolean =>
  (typeof message.tick !== 'number' || Number.isFinite(message.tick)) &&
  (typeof message.simTimeMs !== 'number' || Number.isFinite(message.simTimeMs)) &&
  (typeof message.stepMs !== 'number' || Number.isFinite(message.stepMs));

export class RenderBufferPool {
  private readonly _hooks: RenderBufferPoolHooks;
  private readonly _expectedBufferBytes: number;

  private _pool: ArrayBuffer[] = [];
  private _activeView: Float32Array | undefined;
  /**
   * Independently owned interpolation history. Allocated once per distinct
   * length and refilled in place — the outgoing state is always copied BEFORE
   * its buffer is recycled, so the history never reads a detached buffer.
   */
  private _historyView: Float32Array | undefined;
  private _timing: StateTiming | undefined;
  private _previousSimTimeMs = 0;
  private _currentStateReceivedAt = 0;
  private _previousCamera: CameraSnapshot = { x: 0, y: 0 };
  /** True while the next adopted buffer must become the new interpolation origin. */
  private _snapNextState = true;
  private _rejectedStateCount = 0;

  constructor(hooks: RenderBufferPoolHooks = {}) {
    this._hooks = hooks;
    this._expectedBufferBytes = hooks.expectedBufferBytes ?? BUFFER_SIZE;
  }

  /** Allocates the N-buffer pool for a fresh engine session. */
  allocate(): void {
    this._pool = [];
    for (let i = 0; i < FALLBACK_BUFFER_COUNT; i++) {
      this._pool.push(createEngineBuffer(BUFFER_SIZE));
    }
    this._activeView = undefined;
    this._snapNextState = true;
  }

  /**
   * Returns the initial buffers and clears the pool.
   *
   * Ownership moves to the worker when these are passed as transferables to
   * INITIALIZE_ENGINE; the main thread must not retain references.
   */
  takeInitialBuffers(): ArrayBuffer[] {
    const buffers = this._pool;
    this._pool = [];
    this._activeView = undefined;
    return buffers;
  }

  /** The Float32Array view of the most recent state, if any. */
  get activeView(): Float32Array | undefined {
    return this._activeView;
  }

  /** The copied previous state used for interpolation, if any. */
  get previousView(): Float32Array | undefined {
    return this._historyView;
  }

  /** Timing of the most recent state, if any. */
  get timing(): StateTiming | undefined {
    return this._timing;
  }

  /** `simTimeMs` of the previous state. */
  get previousSimTimeMs(): number {
    return this._previousSimTimeMs;
  }

  /** Wall-clock timestamp when the current state was received. */
  get currentStateReceivedAt(): number {
    return this._currentStateReceivedAt;
  }

  /** Camera position captured with the previous state. */
  get previousCamera(): CameraSnapshot {
    return this._previousCamera;
  }

  /** How many state messages were discarded at the ingestion boundary. */
  get rejectedStateCount(): number {
    return this._rejectedStateCount;
  }

  /**
   * Applies a STATE_UPDATE message.
   *
   * Snapshots the outgoing state for interpolation using `previousCamera`
   * (the camera position *before* the message's camera is applied), stores
   * the message timing, recycles the outgoing buffer, and adopts the new one.
   * A buffer-less SYNC never swaps or recycles.
   */
  ingest(options: {
    message: StateUpdateMessage;
    previousCamera: CameraSnapshot;
    now: number;
    recycle: (buffer: ArrayBuffer | undefined) => void;
  }): void {
    const { message, previousCamera, now, recycle } = options;
    const newBuffer = message.buffer;

    const rejection = this._rejectionReason(message);
    if (rejection) {
      this._rejectedStateCount++;
      this._hooks.onRejectedState?.({
        reason: rejection,
        ...(newBuffer ? { byteLength: newBuffer.byteLength } : {}),
      });
      // The buffer is DROPPED, not recycled: handing a wrong-sized buffer back
      // would let the worker adopt it and emit the same malformed state again.
      // A rejected state is a protocol violation and is meant to be loud.
      return;
    }

    if (newBuffer && this._activeView && !this._snapNextState) {
      this._previousCamera = previousCamera;
      this._previousSimTimeMs = this._timing?.simTimeMs ?? 0;
      this._snapshotHistory(this._activeView);
    }
    if (
      typeof message.tick === 'number' &&
      typeof message.simTimeMs === 'number' &&
      typeof message.stepMs === 'number'
    ) {
      this._timing = {
        tick: message.tick,
        simTimeMs: message.simTimeMs,
        stepMs: message.stepMs,
      };
    }

    if (newBuffer) {
      const outgoing = this._activeView?.buffer as ArrayBuffer | undefined;
      recycle(outgoing);
      this._activeView = new Float32Array(newBuffer);
      this._currentStateReceivedAt = now;
      // Only an ADOPTED state consumes the snap: a buffer-less SYNC carries
      // no positions and must not arm the following adoption's history.
      this._snapNextState = false;
    }
  }

  /**
   * Drops cross-scene interpolation history and reseeds the camera snapshot
   * from `current`, so a map switch/restore cannot blend two scenes.
   *
   * The ACTIVE view survives, so the very next adopted state would otherwise
   * inherit it as its interpolation origin. That is the cross-scene blend this
   * method exists to prevent, so the next adoption is marked as a snap.
   */
  resetHistory(current: CameraSnapshot): void {
    this._historyView = undefined;
    this._timing = undefined;
    this._previousSimTimeMs = 0;
    this._currentStateReceivedAt = 0;
    this._previousCamera = { x: current.x, y: current.y };
    this._snapNextState = true;
  }

  /** Releases every retained view/buffer reference (teardown). */
  clear(): void {
    this._pool = [];
    this._activeView = undefined;
    this._historyView = undefined;
    this._timing = undefined;
    this._previousSimTimeMs = 0;
    this._currentStateReceivedAt = 0;
    this._snapNextState = true;
  }

  /**
   * Validates a state message at the ingestion boundary: the transferred
   * buffer must match the engine layout, and any timing it does carry must be
   * finite. A partial (buffer-less) timing payload is tolerated — SYNC relies
   * on it — so only non-finite values are rejected.
   */
  private _rejectionReason(message: StateUpdateMessage): RejectionReason | undefined {
    if (message.buffer && message.buffer.byteLength !== this._expectedBufferBytes) {
      return 'wrong-buffer-size';
    }
    if (!isFiniteTiming(message)) {
      return 'non-finite-timing';
    }
    return undefined;
  }

  /**
   * Copies `source` into the retained history slot, reallocating only when the
   * element count actually changed. Runs before the source buffer is recycled
   * so the copy never observes a detached ArrayBuffer.
   */
  private _snapshotHistory(source: Float32Array): void {
    const retained = this._historyView;
    if (retained && retained.length === source.length) {
      retained.set(source);
      return;
    }
    const next = new Float32Array(source.length);
    next.set(source);
    this._historyView = next;
  }
}
