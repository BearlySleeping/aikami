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

import { BUFFER_SIZE, createEngineBuffer, FALLBACK_BUFFER_COUNT } from '../config/memory_config.ts';
import { copyRenderState } from '../frame_pacing.ts';
import type { StateUpdateMessage } from '../worker/worker_protocol.ts';

/** Fixed-step timing carried on STATE_UPDATE for interpolation. */
export type StateTiming = { tick: number; simTimeMs: number; stepMs: number };

/** World-space camera position. */
export type CameraSnapshot = { x: number; y: number };

export class RenderBufferPool {
  private _pool: ArrayBuffer[] = [];
  private _activeView: Float32Array | undefined;
  private _previousView: Float32Array | undefined;
  private _timing: StateTiming | undefined;
  private _previousSimTimeMs = 0;
  private _currentStateReceivedAt = 0;
  private _previousCamera: CameraSnapshot = { x: 0, y: 0 };

  /** Allocates the N-buffer pool for a fresh engine session. */
  allocate(): void {
    this._pool = [];
    for (let i = 0; i < FALLBACK_BUFFER_COUNT; i++) {
      this._pool.push(createEngineBuffer(BUFFER_SIZE));
    }
    this._activeView = undefined;
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
    return this._previousView;
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

    if (newBuffer && this._activeView) {
      this._previousCamera = previousCamera;
      this._previousSimTimeMs = this._timing?.simTimeMs ?? 0;
      this._previousView = copyRenderState(this._activeView);
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
    }
  }

  /**
   * Drops cross-scene interpolation history and reseeds the camera snapshot
   * from `current`, so a map switch/restore cannot blend two scenes.
   */
  resetHistory(current: CameraSnapshot): void {
    this._previousView = undefined;
    this._timing = undefined;
    this._previousSimTimeMs = 0;
    this._currentStateReceivedAt = 0;
    this._previousCamera = { x: current.x, y: current.y };
  }

  /** Releases every retained view/buffer reference (teardown). */
  clear(): void {
    this._pool = [];
    this._activeView = undefined;
    this._previousView = undefined;
    this._timing = undefined;
    this._previousSimTimeMs = 0;
    this._currentStateReceivedAt = 0;
  }
}
