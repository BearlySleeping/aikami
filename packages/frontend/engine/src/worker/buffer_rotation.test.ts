// packages/frontend/engine/src/worker/buffer_rotation.test.ts
//
// N-buffer rotation deadlock guard.
//
// The worker only increments tickCount after it secures a writable buffer,
// so a simulation frozen at exactly FALLBACK_BUFFER_COUNT ticks means every
// buffer was transferred to the main thread and the rotation never
// recovered. That happened when the next-writable scan ran a full
// FALLBACK_BUFFER_COUNT attempts: the last candidate wraps back to oldIndex
// itself, so the loop selects the very buffer it is about to transfer away.
//
// These tests model the rotation arithmetic directly — the worker module
// has heavy side effects (self.onmessage, bitECS world) that make importing
// it here impractical.

import { describe, expect, test } from 'bun:test';
import { FALLBACK_BUFFER_COUNT } from '../config/memory_config.ts';

/** The fixed-size pool: a live ArrayBuffer, or null once transferred. */
type Pool = (ArrayBuffer | null)[];

/**
 * The next-writable scan as the tick loop runs it. Mirrors the worker's
 * loop bound exactly, so `attempts` reproduces the pre-fix behaviour when
 * set to FALLBACK_BUFFER_COUNT.
 */
const findNextWritable = (options: { pool: Pool; oldIndex: number; attempts: number }): number => {
  const { pool, oldIndex, attempts } = options;
  for (let attempt = 1; attempt < attempts + 1; attempt++) {
    const candidate = (oldIndex + attempt) % FALLBACK_BUFFER_COUNT;
    const buf = pool[candidate];
    if (buf && buf.byteLength > 0) {
      return candidate;
    }
  }
  return -1;
};

/** The shipped scan — stops one short of a full wrap. */
const findNextWritableFixed = (pool: Pool, oldIndex: number): number =>
  findNextWritable({ pool, oldIndex, attempts: FALLBACK_BUFFER_COUNT - 1 });

const makePool = (): Pool =>
  Array.from({ length: FALLBACK_BUFFER_COUNT }, () => new ArrayBuffer(64));

describe('next-writable buffer scan', () => {
  test('never selects the slot being transferred away', () => {
    // Every other slot is awaiting recycle — the starvation case.
    const pool: Pool = makePool().map((buf, i) => (i === FALLBACK_BUFFER_COUNT - 1 ? buf : null));
    const oldIndex = FALLBACK_BUFFER_COUNT - 1;

    expect(findNextWritableFixed(pool, oldIndex)).not.toBe(oldIndex);
    expect(findNextWritableFixed(pool, oldIndex)).toBe(-1);
  });

  test('a full-length scan reproduces the deadlock (regression)', () => {
    const pool: Pool = makePool().map((buf, i) => (i === FALLBACK_BUFFER_COUNT - 1 ? buf : null));
    const oldIndex = FALLBACK_BUFFER_COUNT - 1;

    // The pre-fix bound selects oldIndex itself, which the caller then nulls.
    expect(findNextWritable({ pool, oldIndex, attempts: FALLBACK_BUFFER_COUNT })).toBe(oldIndex);
  });

  test('still rotates normally while free slots remain', () => {
    const pool = makePool();
    expect(findNextWritableFixed(pool, 0)).toBe(1);
    expect(findNextWritableFixed(pool, 1)).toBe(2 % FALLBACK_BUFFER_COUNT);
  });

  test('skips recycled-but-empty slots', () => {
    const pool = makePool();
    pool[1] = null;
    expect(findNextWritableFixed(pool, 0)).toBe(2 % FALLBACK_BUFFER_COUNT);
  });
});

describe('starved tick loop', () => {
  test('an empty view is truthy, so !activeWriteView cannot detect starvation', () => {
    // This is why the RECYCLE_BUFFER resume gate had to stop testing the view.
    const starvedView = new Float32Array(null as unknown as ArrayBuffer);
    expect(starvedView.length).toBe(0);
    expect(Boolean(starvedView)).toBe(true);
  });

  test('pool state distinguishes a writable slot from a starved one', () => {
    const pool: Pool = makePool();
    const activeIsWritable = (p: Pool, index: number): boolean => {
      const buf = p[index];
      return !!buf && buf.byteLength > 0;
    };

    expect(activeIsWritable(pool, 0)).toBe(true);
    pool[0] = null;
    expect(activeIsWritable(pool, 0)).toBe(false);
  });
});

describe('full rotation over many ticks', () => {
  test('survives a main thread that recycles nothing until all buffers are out', () => {
    // Reproduces the Tauri/WebKitGTK boot timing: the main thread is busy
    // loading assets and recycles nothing while the worker drains the pool.
    const pool: Pool = makePool();
    let activeIndex = 0;
    let tickCount = 0;

    for (let tick = 0; tick < 25; tick++) {
      const buffer = pool[activeIndex];
      if (!buffer || buffer.byteLength === 0) {
        continue; // starved — the guard that skips tickCount++
      }
      tickCount++;

      const oldIndex = activeIndex;
      const next = findNextWritableFixed(pool, oldIndex);
      if (next === -1) {
        // Starvation: copy out, retain ownership. Pool slot stays populated.
        continue;
      }
      pool[oldIndex] = null;
      activeIndex = next;
    }

    // Without the fix this freezes at exactly FALLBACK_BUFFER_COUNT.
    expect(tickCount).toBeGreaterThan(FALLBACK_BUFFER_COUNT);
    expect(tickCount).toBe(25);
  });
});
