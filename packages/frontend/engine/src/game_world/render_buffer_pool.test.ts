// packages/frontend/engine/src/game_world/render_buffer_pool.test.ts

import { describe, expect, test } from 'bun:test';
import { FALLBACK_BUFFER_COUNT } from '../config/memory_config.ts';
import type { StateUpdateMessage } from '../worker/worker_protocol.ts';
import { RenderBufferPool } from './render_buffer_pool.ts';

const bufferWith = (...values: number[]): ArrayBuffer => {
  const buffer = new ArrayBuffer(values.length * 4);
  new Float32Array(buffer).set(values);
  return buffer;
};

describe('RenderBufferPool — allocation', () => {
  test('allocates and transfers the initial buffer pool', () => {
    const pool = new RenderBufferPool();
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
    const pool = new RenderBufferPool();
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
    const pool = new RenderBufferPool();
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
    const pool = new RenderBufferPool();
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
    const pool = new RenderBufferPool();
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
    const pool = new RenderBufferPool();
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
    const pool = new RenderBufferPool();
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
