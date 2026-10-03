// packages/frontend/engine/src/game_world/render_buffer_pool.test.ts

import { describe, expect, test } from 'bun:test';
import { BUFFER_SIZE, FALLBACK_BUFFER_COUNT } from '../config/memory_config.ts';
import type { StateUpdateMessage } from '../worker/worker_protocol.ts';
import { RenderBufferPool, type RenderBufferPoolHooks } from './render_buffer_pool.ts';

const bufferWith = (...values: number[]): ArrayBuffer => {
  const buffer = new ArrayBuffer(values.length * 4);
  new Float32Array(buffer).set(values);
  return buffer;
};

/** A full-size engine buffer whose first values are `values`. */
const engineBufferWith = (...values: number[]): ArrayBuffer => {
  const buffer = new ArrayBuffer(BUFFER_SIZE);
  new Float32Array(buffer).set(values);
  return buffer;
};

/**
 * Pool that accepts the tiny fixtures the behavioural tests use. Production
 * instances keep the engine-layout default, which is what the boundary
 * validation test below asserts.
 */
const makePool = (overrides: RenderBufferPoolHooks = {}): RenderBufferPool =>
  new RenderBufferPool({ expectedBufferBytes: 8, ...overrides });

describe('RenderBufferPool — allocation', () => {
  test('allocates and transfers the initial buffer pool', () => {
    const pool = makePool();
    pool.allocate();
    expect(pool.activeView).toBeUndefined();

    const buffers = pool.takeInitialBuffers();
    expect(buffers).toHaveLength(FALLBACK_BUFFER_COUNT);
    // Ownership moved out — a second take yields nothing.
    expect(pool.takeInitialBuffers()).toHaveLength(0);
  });
});

describe('RenderBufferPool — state ingestion', () => {
  test('adopts the buffer and records timing, camera, and receive time', () => {
    const pool = makePool();
    const recycled: Array<ArrayBuffer | undefined> = [];

    pool.ingest({
      message: {
        type: 'STATE_UPDATE',
        buffer: bufferWith(1, 2),
        tick: 5,
        simTimeMs: 100,
        stepMs: 16,
        cameraX: 10,
        cameraY: 20,
      },
      previousCamera: { x: 0, y: 0 },
      now: 1000,
      recycle: (buffer) => recycled.push(buffer),
    });

    expect(Array.from(pool.activeView ?? [])).toEqual([1, 2]);
    expect(pool.timing).toEqual({ tick: 5, simTimeMs: 100, stepMs: 16 });
    expect(pool.currentStateReceivedAt).toBe(1000);
    // Nothing to recycle on the first state.
    expect(recycled).toEqual([undefined]);
  });

  test('copies the outgoing state and recycles its buffer on the next update', () => {
    const pool = makePool();
    const first = bufferWith(1, 2);
    pool.ingest({
      message: { type: 'STATE_UPDATE', buffer: first, tick: 1, simTimeMs: 10, stepMs: 16 },
      previousCamera: { x: 0, y: 0 },
      now: 1000,
      recycle: () => {},
    });

    const recycled: Array<ArrayBuffer | undefined> = [];
    pool.ingest({
      message: {
        type: 'STATE_UPDATE',
        buffer: bufferWith(3, 4),
        tick: 2,
        simTimeMs: 26,
        stepMs: 16,
      },
      previousCamera: { x: 5, y: 6 },
      now: 1016,
      recycle: (buffer) => recycled.push(buffer),
    });

    expect(Array.from(pool.previousView ?? [])).toEqual([1, 2]);
    expect(Array.from(pool.activeView ?? [])).toEqual([3, 4]);
    expect(pool.previousCamera).toEqual({ x: 5, y: 6 });
    expect(pool.previousSimTimeMs).toBe(10);
    expect(recycled).toEqual([first]);
  });

  test('a buffer-less SYNC neither swaps nor recycles', () => {
    const pool = makePool();
    const recycled: Array<ArrayBuffer | undefined> = [];
    pool.ingest({
      message: {
        type: 'STATE_UPDATE',
        buffer: bufferWith(1, 2),
        tick: 1,
        simTimeMs: 10,
        stepMs: 16,
      },
      previousCamera: { x: 0, y: 0 },
      now: 1000,
      recycle: () => {},
    });
    const before = pool.activeView;

    pool.ingest({
      message: { type: 'STATE_UPDATE', events: [] },
      previousCamera: { x: 1, y: 1 },
      now: 2000,
      recycle: (buffer) => recycled.push(buffer),
    });

    expect(pool.activeView).toBe(before);
    expect(pool.currentStateReceivedAt).toBe(1000);
    expect(recycled).toHaveLength(0);
  });

  test('ignores a partial timing payload', () => {
    const pool = makePool();
    pool.ingest({
      message: { type: 'STATE_UPDATE', tick: 9 } as StateUpdateMessage,
      previousCamera: { x: 0, y: 0 },
      now: 1000,
      recycle: () => {},
    });
    expect(pool.timing).toBeUndefined();
  });
});

describe('RenderBufferPool — discontinuity and teardown', () => {
  test('resetHistory drops interpolation history and reseeds the camera', () => {
    const pool = makePool();
    pool.ingest({
      message: {
        type: 'STATE_UPDATE',
        buffer: bufferWith(1, 2),
        tick: 1,
        simTimeMs: 10,
        stepMs: 16,
      },
      previousCamera: { x: 0, y: 0 },
      now: 1000,
      recycle: () => {},
    });
    pool.ingest({
      message: {
        type: 'STATE_UPDATE',
        buffer: bufferWith(3, 4),
        tick: 2,
        simTimeMs: 26,
        stepMs: 16,
      },
      previousCamera: { x: 5, y: 6 },
      now: 1016,
      recycle: () => {},
    });

    pool.resetHistory({ x: 99, y: 88 });

    expect(pool.previousView).toBeUndefined();
    expect(pool.timing).toBeUndefined();
    expect(pool.previousSimTimeMs).toBe(0);
    expect(pool.currentStateReceivedAt).toBe(0);
    expect(pool.previousCamera).toEqual({ x: 99, y: 88 });
    // The active view survives a history reset.
    expect(Array.from(pool.activeView ?? [])).toEqual([3, 4]);
  });

  test('clear releases every retained reference', () => {
    const pool = makePool();
    pool.ingest({
      message: {
        type: 'STATE_UPDATE',
        buffer: bufferWith(1, 2),
        tick: 1,
        simTimeMs: 10,
        stepMs: 16,
      },
      previousCamera: { x: 0, y: 0 },
      now: 1000,
      recycle: () => {},
    });
    pool.clear();
    expect(pool.activeView).toBeUndefined();
    expect(pool.previousView).toBeUndefined();
    expect(pool.timing).toBeUndefined();
  });
});

describe('RenderBufferPool — cross-scene discontinuity', () => {
  test('the first state after a reset snaps instead of interpolating the old scene', () => {
    // The classic map-switch smear: entity ids are reused, so the OLD scene's
    // still-active view (1,2) was copied into the history slot and the next
    // state (3,4) was rendered interpolated from it — alpha 0 with a fresh
    // receive timestamp, i.e. the player visibly snapped back.
    const pool = makePool();
    pool.ingest({
      message: {
        type: 'STATE_UPDATE',
        buffer: bufferWith(1, 2),
        tick: 1,
        simTimeMs: 10,
        stepMs: 16,
      },
      previousCamera: { x: 0, y: 0 },
      now: 1000,
      recycle: () => {},
    });

    pool.resetHistory({ x: 500, y: 500 });

    pool.ingest({
      message: {
        type: 'STATE_UPDATE',
        buffer: bufferWith(3, 4),
        tick: 1,
        simTimeMs: 10,
        stepMs: 16,
      },
      previousCamera: { x: 500, y: 500 },
      now: 1016,
      recycle: () => {},
    });

    // No history at all on the first adopted state after the discontinuity.
    expect(pool.previousView).toBeUndefined();
    expect(pool.previousSimTimeMs).toBe(0);
    expect(Array.from(pool.activeView ?? [])).toEqual([3, 4]);

    // Interpolation resumes from the SECOND state onwards.
    pool.ingest({
      message: {
        type: 'STATE_UPDATE',
        buffer: bufferWith(5, 6),
        tick: 2,
        simTimeMs: 26,
        stepMs: 16,
      },
      previousCamera: { x: 500, y: 500 },
      now: 1032,
      recycle: () => {},
    });
    expect(Array.from(pool.previousView ?? [])).toEqual([3, 4]);
  });

  test('a buffer-less SYNC after a reset does not consume the snap', () => {
    const pool = makePool();
    pool.ingest({
      message: { type: 'STATE_UPDATE', buffer: bufferWith(1, 2), tick: 1, simTimeMs: 1 },
      previousCamera: { x: 0, y: 0 },
      now: 1000,
      recycle: () => {},
    });
    pool.resetHistory({ x: 0, y: 0 });

    pool.ingest({
      message: { type: 'STATE_UPDATE', events: [] },
      previousCamera: { x: 0, y: 0 },
      now: 1005,
      recycle: () => {},
    });
    pool.ingest({
      message: { type: 'STATE_UPDATE', buffer: bufferWith(3, 4), tick: 1, simTimeMs: 1 },
      previousCamera: { x: 0, y: 0 },
      now: 1010,
      recycle: () => {},
    });

    expect(pool.previousView).toBeUndefined();
  });

  test('a fresh allocate snaps the first state of the new session', () => {
    const pool = makePool();
    pool.allocate();
    pool.ingest({
      message: { type: 'STATE_UPDATE', buffer: bufferWith(1, 2), tick: 1, simTimeMs: 1 },
      previousCamera: { x: 0, y: 0 },
      now: 1000,
      recycle: () => {},
    });
    pool.ingest({
      message: { type: 'STATE_UPDATE', buffer: bufferWith(3, 4), tick: 2, simTimeMs: 20 },
      previousCamera: { x: 0, y: 0 },
      now: 1016,
      recycle: () => {},
    });
    expect(Array.from(pool.previousView ?? [])).toEqual([1, 2]);
  });

  test('history allocation is reused for equal sizes and reallocated on resize', () => {
    const pool = makePool();
    pool.ingest({
      message: { type: 'STATE_UPDATE', buffer: bufferWith(1, 2), tick: 1, simTimeMs: 1 },
      previousCamera: { x: 0, y: 0 },
      now: 1000,
      recycle: () => {},
    });
    pool.ingest({
      message: { type: 'STATE_UPDATE', buffer: bufferWith(3, 4), tick: 2, simTimeMs: 20 },
      previousCamera: { x: 0, y: 0 },
      now: 1016,
      recycle: () => {},
    });
    const firstSlot = pool.previousView;

    pool.ingest({
      message: { type: 'STATE_UPDATE', buffer: bufferWith(5, 6), tick: 3, simTimeMs: 40 },
      previousCamera: { x: 0, y: 0 },
      now: 1032,
      recycle: () => {},
    });
    // Same shape → the retained slot is refilled, not reallocated.
    expect(pool.previousView).toBe(firstSlot);
    expect(Array.from(pool.previousView ?? [])).toEqual([3, 4]);

    const wide = makePool({ expectedBufferBytes: 16 });
    wide.ingest({
      message: { type: 'STATE_UPDATE', buffer: bufferWith(1, 2, 3, 4), tick: 1, simTimeMs: 1 },
      previousCamera: { x: 0, y: 0 },
      now: 1000,
      recycle: () => {},
    });
    wide.ingest({
      message: { type: 'STATE_UPDATE', buffer: bufferWith(5, 6, 7, 8), tick: 2, simTimeMs: 20 },
      previousCamera: { x: 0, y: 0 },
      now: 1016,
      recycle: () => {},
    });
    expect(Array.from(wide.previousView ?? [])).toEqual([1, 2, 3, 4]);
  });

  test('the history copy happens before the outgoing buffer is recycled', () => {
    const pool = makePool();
    const outgoing = bufferWith(1, 2);
    pool.ingest({
      message: { type: 'STATE_UPDATE', buffer: outgoing, tick: 1, simTimeMs: 1 },
      previousCamera: { x: 0, y: 0 },
      now: 1000,
      recycle: () => {},
    });

    let historyAtRecycle: Array<number> | undefined;
    pool.ingest({
      message: { type: 'STATE_UPDATE', buffer: bufferWith(3, 4), tick: 2, simTimeMs: 20 },
      previousCamera: { x: 0, y: 0 },
      now: 1016,
      recycle: (buffer) => {
        historyAtRecycle = buffer ? Array.from(new Float32Array(buffer)) : undefined;
      },
    });

    expect(historyAtRecycle).toEqual([1, 2]);
    expect(Array.from(pool.previousView ?? [])).toEqual([1, 2]);
  });
});

describe('RenderBufferPool — ingestion boundary', () => {
  test('rejects a buffer that disagrees with the engine layout', () => {
    const rejected: string[] = [];
    const pool = new RenderBufferPool({
      onRejectedState: (detail) => rejected.push(detail.reason),
    });
    const recycled: Array<ArrayBuffer | undefined> = [];

    pool.ingest({
      message: {
        type: 'STATE_UPDATE',
        buffer: engineBufferWith(1, 2),
        tick: 1,
        simTimeMs: 10,
        stepMs: 16,
      },
      previousCamera: { x: 0, y: 0 },
      now: 1000,
      recycle: (buffer) => recycled.push(buffer),
    });

    // A short buffer is a protocol violation: adopting it would make the
    // renderer read out of bounds. It must not be adopted, and it must not
    // be handed back for the worker to re-emit.
    pool.ingest({
      message: {
        type: 'STATE_UPDATE',
        buffer: bufferWith(1, 2),
        tick: 2,
        simTimeMs: 20,
        stepMs: 16,
      },
      previousCamera: { x: 0, y: 0 },
      now: 1016,
      recycle: (buffer) => recycled.push(buffer),
    });

    expect(rejected).toEqual(['wrong-buffer-size']);
    expect(pool.rejectedStateCount).toBe(1);
    expect(Array.from((pool.activeView ?? []).slice(0, 2))).toEqual([1, 2]);
    expect(pool.timing?.tick).toBe(1);
    // Only the first (undefined) outgoing slot — the malformed buffer is dropped.
    expect(recycled).toEqual([undefined]);
  });

  test('rejects non-finite timing without disturbing the adopted state', () => {
    const rejected: string[] = [];
    const pool = new RenderBufferPool({ onRejectedState: (d) => rejected.push(d.reason) });
    const recycled: Array<ArrayBuffer | undefined> = [];

    pool.ingest({
      message: {
        type: 'STATE_UPDATE',
        buffer: engineBufferWith(1, 2),
        tick: 1,
        simTimeMs: 10,
        stepMs: 16,
      },
      previousCamera: { x: 0, y: 0 },
      now: 1000,
      recycle: (buffer) => recycled.push(buffer),
    });
    pool.ingest({
      message: {
        type: 'STATE_UPDATE',
        buffer: engineBufferWith(3, 4),
        tick: Number.NaN,
        simTimeMs: 20,
        stepMs: 16,
      } as StateUpdateMessage,
      previousCamera: { x: 0, y: 0 },
      now: 1016,
      recycle: (buffer) => recycled.push(buffer),
    });

    expect(rejected).toEqual(['non-finite-timing']);
    expect(pool.timing?.tick).toBe(1);
    expect(Array.from((pool.activeView ?? []).slice(0, 2))).toEqual([1, 2]);
    // A rejected state leaves the previous state as the interpolation origin.
    expect(pool.previousView).toBeUndefined();
    expect(recycled).toEqual([undefined]);
  });

  test('a finite partial timing payload is still accepted', () => {
    const pool = makePool();
    pool.ingest({
      message: { type: 'STATE_UPDATE', events: [] },
      previousCamera: { x: 0, y: 0 },
      now: 1000,
      recycle: () => {},
    });
    expect(pool.rejectedStateCount).toBe(0);
  });
});
