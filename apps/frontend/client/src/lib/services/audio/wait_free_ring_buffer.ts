// apps/frontend/client/src/lib/services/audio/wait_free_ring_buffer.ts

/**
 * Lock-free Single-Producer Single-Consumer (SPSC) circular ring buffer
 * backed by `SharedArrayBuffer` and synchronized via the `Atomics` API.
 *
 * Layout (shared memory):
 *   Bytes 0–3:   writeIndex (Uint32, producer-only writes, consumer reads)
 *   Bytes 4–7:   readIndex  (Uint32, consumer-only writes, producer reads)
 *   Bytes 8+:    Float32 PCM sample storage
 *
 * Because only one thread writes each index, `Atomics.store`/`Atomics.load`
 * provides the necessary memory barriers without locks. PCM data copies are
 * safe because producer and consumer operate on disjoint index ranges.
 *
 * Contract: C-211
 */

// ── Header layout constants ──────────────────────────────────────────────

const HEADER_FLOATS = 2; // writeIndex + readIndex, stored as two float32 slots
const HEADER_BYTES = HEADER_FLOATS * Float32Array.BYTES_PER_ELEMENT; // 8 bytes

// ── Public types ──────────────────────────────────────────────────────────

export type WaitFreeRingBuffer = {
  /** Total Float32 slots in the storage region (excluding header). */
  readonly sampleCapacity: number;
  /** Backing SharedArrayBuffer (header + storage). */
  readonly sharedBuffer: SharedArrayBuffer;
  /**
   * Header view: [0] = writeIndex (as float32 bits), [1] = readIndex (as float32 bits).
   * Interpret via `new Uint32Array(indices.buffer)` for atomic ops.
   */
  readonly indices: Float32Array;
  /** Raw PCM sample storage region. */
  readonly storage: Float32Array;
};

// ── Factory ───────────────────────────────────────────────────────────────

/**
 * Creates a lock-free SPSC ring buffer with the given sample capacity.
 *
 * Allocates a single `SharedArrayBuffer` containing a 2-slot header
 * (writeIndex + readIndex) followed by `sampleCapacity` Float32 PCM slots.
 *
 * @param options.sampleCapacity — Number of Float32 samples the buffer can hold.
 */
export const createWaitFreeRingBuffer = (options: {
  sampleCapacity: number;
}): WaitFreeRingBuffer => {
  const { sampleCapacity } = options;
  const totalFloats = HEADER_FLOATS + sampleCapacity;
  const totalBytes = totalFloats * Float32Array.BYTES_PER_ELEMENT;

  const sharedBuffer = new SharedArrayBuffer(totalBytes);
  const indices = new Float32Array(sharedBuffer, 0, HEADER_FLOATS);
  const storage = new Float32Array(sharedBuffer, HEADER_BYTES, sampleCapacity);

  // Initialise both indices to 0
  indices[0] = 0; // writeIndex
  indices[1] = 0; // readIndex

  return { sampleCapacity, sharedBuffer, indices, storage };
};

// ── Index helpers ─────────────────────────────────────────────────────────

/**
 * Reads the writeIndex from shared memory with acquire semantics.
 * Safe for either thread — uses `Atomics.load` for the memory barrier.
 */
const readWriteIndex = (indices: Float32Array): number => {
  const ui32 = new Uint32Array(indices.buffer, indices.byteOffset, HEADER_FLOATS);
  return Atomics.load(ui32, 0);
};

/**
 * Writes the writeIndex to shared memory with release semantics.
 * Only the producer thread should call this.
 */
const storeWriteIndex = (indices: Float32Array, value: number): void => {
  const ui32 = new Uint32Array(indices.buffer, indices.byteOffset, HEADER_FLOATS);
  Atomics.store(ui32, 0, value);
};

/**
 * Reads the readIndex from shared memory with acquire semantics.
 * Safe for either thread.
 */
const readReadIndex = (indices: Float32Array): number => {
  const ui32 = new Uint32Array(indices.buffer, indices.byteOffset, HEADER_FLOATS);
  return Atomics.load(ui32, 1);
};

/**
 * Writes the readIndex to shared memory with release semantics.
 * Only the consumer thread should call this.
 */
const storeReadIndex = (indices: Float32Array, value: number): void => {
  const ui32 = new Uint32Array(indices.buffer, indices.byteOffset, HEADER_FLOATS);
  Atomics.store(ui32, 1, value);
};

// ── Public operations ─────────────────────────────────────────────────────

/**
 * Returns the number of readable samples currently in the buffer.
 *
 * Call from either thread — reads both indices with acquire semantics
 * and returns the monotonic difference.
 */
export const ringBufferAvailable = (buf: WaitFreeRingBuffer): number => {
  const write = readWriteIndex(buf.indices);
  const read = readReadIndex(buf.indices);
  return write - read;
};

/**
 * Returns the number of free slots available for writing.
 */
export const ringBufferFree = (buf: WaitFreeRingBuffer): number => {
  return buf.sampleCapacity - ringBufferAvailable(buf);
};

/**
 * Producer: pushes PCM samples into the ring buffer.
 *
 * Writes as many samples as possible given available free space.
 * Returns the number of samples actually written (may be less than
 * `samples.length` if the buffer is nearly full).
 *
 * @param buf — The shared ring buffer.
 * @param samples — Source PCM data to copy into the buffer.
 * @returns Number of samples successfully written.
 */
export const ringBufferPush = (buf: WaitFreeRingBuffer, samples: Float32Array): number => {
  const free = ringBufferFree(buf);
  if (free === 0) {
    return 0;
  }

  const writeCount = Math.min(free, samples.length);
  const writeIdx = readWriteIndex(buf.indices) % buf.sampleCapacity;
  const cap = buf.sampleCapacity;

  // Copy data into storage, handling wraparound
  const firstChunk = Math.min(writeCount, cap - writeIdx);
  buf.storage.set(samples.subarray(0, firstChunk), writeIdx);

  if (writeCount > firstChunk) {
    // Wraparound: remaining samples go to the beginning
    const remaining = writeCount - firstChunk;
    buf.storage.set(samples.subarray(firstChunk, firstChunk + remaining), 0);
  }

  // Advance write index with release semantics
  storeWriteIndex(buf.indices, readWriteIndex(buf.indices) + writeCount);

  return writeCount;
};

/**
 * Consumer: reads PCM samples from the ring buffer.
 *
 * Reads as many samples as available into `out`, up to `out.length`.
 * Returns the number of samples actually read (may be 0 if buffer is empty).
 *
 * @param buf — The shared ring buffer.
 * @param out — Destination array to fill with PCM data.
 * @returns Number of samples successfully read.
 */
export const ringBufferPop = (buf: WaitFreeRingBuffer, out: Float32Array): number => {
  const available = ringBufferAvailable(buf);
  if (available === 0) {
    return 0;
  }

  const readCount = Math.min(available, out.length);
  const readIdx = readReadIndex(buf.indices) % buf.sampleCapacity;
  const cap = buf.sampleCapacity;

  // Copy data from storage, handling wraparound
  const firstChunk = Math.min(readCount, cap - readIdx);
  out.set(buf.storage.subarray(readIdx, readIdx + firstChunk), 0);

  if (readCount > firstChunk) {
    // Wraparound: remaining samples come from the beginning
    const remaining = readCount - firstChunk;
    out.set(buf.storage.subarray(0, remaining), firstChunk);
  }

  // Advance read index with release semantics
  storeReadIndex(buf.indices, readReadIndex(buf.indices) + readCount);

  return readCount;
};

/**
 * Consumer: resets the ring buffer by advancing readIndex to match writeIndex.
 *
 * All buffered data is discarded. Safe to call from either thread but
 * typically used by the consumer on stream start/stop.
 */
export const ringBufferClear = (buf: WaitFreeRingBuffer): void => {
  const write = readWriteIndex(buf.indices);
  storeReadIndex(buf.indices, write);
};
