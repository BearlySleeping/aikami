// apps/frontend/client/src/lib/services/audio/wait_free_ring_buffer.test.ts

import { describe, expect, it } from 'bun:test';
import {
  createWaitFreeRingBuffer,
  ringBufferAvailable,
  ringBufferClear,
  ringBufferFree,
  ringBufferPop,
  ringBufferPush,
} from './wait_free_ring_buffer';

describe('WaitFreeRingBuffer', () => {
  const Capacity = 1024;

  const makeBuffer = () => createWaitFreeRingBuffer({ sampleCapacity: Capacity });

  // ── Initial state ─────────────────────────────────────────────────────

  it('starts empty', () => {
    const buf = makeBuffer();
    expect(ringBufferAvailable(buf)).toBe(0);
    expect(ringBufferFree(buf)).toBe(Capacity);
  });

  // ── Push / Pop basic ──────────────────────────────────────────────────

  it('push → pop round-trips data correctly', () => {
    const buf = makeBuffer();
    const input = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5]);

    const written = ringBufferPush(buf, input);
    expect(written).toBe(5);
    expect(ringBufferAvailable(buf)).toBe(5);

    const output = new Float32Array(5);
    const read = ringBufferPop(buf, output);
    expect(read).toBe(5);
    expect(Array.from(output)).toEqual(Array.from(input));
    expect(ringBufferAvailable(buf)).toBe(0);
  });

  // ── Partial read ──────────────────────────────────────────────────────

  it('pop reads only as many samples as requested', () => {
    const buf = makeBuffer();
    ringBufferPush(buf, new Float32Array([1, 2, 3, 4, 5]));

    const out = new Float32Array(2);
    const read = ringBufferPop(buf, out);
    expect(read).toBe(2);
    expect(Array.from(out)).toEqual([1, 2]);
    expect(ringBufferAvailable(buf)).toBe(3);
  });

  // ── Wraparound at capacity boundary ───────────────────────────────────

  it('handles wraparound when write passes capacity', () => {
    const smallBuf = createWaitFreeRingBuffer({ sampleCapacity: 8 });
    // Write 5 samples, read 3, write another 6 — forces wraparound
    ringBufferPush(smallBuf, new Float32Array([10, 20, 30, 40, 50]));
    ringBufferPop(smallBuf, new Float32Array(3)); // consume first 3
    ringBufferPush(smallBuf, new Float32Array([60, 70, 80, 90, 100, 110]));

    expect(ringBufferAvailable(smallBuf)).toBe(8);

    const out = new Float32Array(8);
    const read = ringBufferPop(smallBuf, out);
    expect(read).toBe(8);
    // Should be: [40, 50, 60, 70, 80, 90, 100, 110]
    expect(Array.from(out)).toEqual([40, 50, 60, 70, 80, 90, 100, 110]);
  });

  // ── Underrun (pop when empty) ─────────────────────────────────────────

  it('pop returns 0 when buffer is empty', () => {
    const buf = makeBuffer();
    const out = new Float32Array(8);
    const read = ringBufferPop(buf, out);
    expect(read).toBe(0);
    expect(out.every((v) => v === 0)).toBe(true);
  });

  // ── Overflow (push when full) ─────────────────────────────────────────

  it('push returns 0 when buffer is full', () => {
    const smallBuf = createWaitFreeRingBuffer({ sampleCapacity: 3 });
    ringBufferPush(smallBuf, new Float32Array([1, 2, 3]));
    expect(ringBufferFree(smallBuf)).toBe(0);

    const written = ringBufferPush(smallBuf, new Float32Array([4, 5]));
    expect(written).toBe(0);
    expect(ringBufferAvailable(smallBuf)).toBe(3);
  });

  // ── Partial overflow ──────────────────────────────────────────────────

  it('push writes partial when less free space than input', () => {
    const smallBuf = createWaitFreeRingBuffer({ sampleCapacity: 5 });
    ringBufferPush(smallBuf, new Float32Array([1, 2, 3]));
    // 2 free slots; try to push 4 → only 2 should write
    const written = ringBufferPush(smallBuf, new Float32Array([4, 5, 6, 7]));
    expect(written).toBe(2);
    expect(ringBufferAvailable(smallBuf)).toBe(5);
  });

  // ── Clear ─────────────────────────────────────────────────────────────

  it('clear discards all buffered data', () => {
    const buf = makeBuffer();
    ringBufferPush(buf, new Float32Array([1, 2, 3, 4, 5]));
    expect(ringBufferAvailable(buf)).toBe(5);

    ringBufferClear(buf);
    expect(ringBufferAvailable(buf)).toBe(0);
    expect(ringBufferFree(buf)).toBe(Capacity);
  });

  // ── Large capacity ────────────────────────────────────────────────────

  it('handles large buffers at kokoro sample rate (24kHz * 2s = 48000 samples)', () => {
    const largeBuf = createWaitFreeRingBuffer({ sampleCapacity: 96000 }); // 4s buffer
    const input = new Float32Array(48000);
    input.fill(0.5);

    const written = ringBufferPush(largeBuf, input);
    expect(written).toBe(48000);
    expect(ringBufferAvailable(largeBuf)).toBe(48000);
  });

  // ── Zero-size push/pop ────────────────────────────────────────────────

  it('push with empty array writes 0', () => {
    const buf = makeBuffer();
    const written = ringBufferPush(buf, new Float32Array(0));
    expect(written).toBe(0);
  });

  it('pop with zero-length output reads 0', () => {
    const buf = makeBuffer();
    ringBufferPush(buf, new Float32Array([1, 2, 3]));
    const read = ringBufferPop(buf, new Float32Array(0));
    expect(read).toBe(0);
  });
});
