// packages/frontend/engine/src/config/memory_config.ts

// ---------------------------------------------------------------------------
// Memory buffer configuration for worker ↔ main-thread entity state exchange
//
// Layout: [eid*3 + 0] = x, [eid*3 + 1] = y, [eid*3 + 2] = rotation
// ---------------------------------------------------------------------------

/** Maximum number of entities that can be stored in a single buffer. */
export const MAX_ENTITIES = 10000;

/**
 * Number of Float32 values per entity in the buffer.
 *
 * - index 0: world-space x position (pixels)
 * - index 1: world-space y position (pixels)
 * - index 2: rotation (radians)
 */
export const COMPONENT_STRIDE = 3;

/** Byte size of the full entity state buffer. */
export const BUFFER_SIZE = MAX_ENTITIES * COMPONENT_STRIDE * Float32Array.BYTES_PER_ELEMENT;

// ---------------------------------------------------------------------------
// String registry capacity (Contract C-195)
// ---------------------------------------------------------------------------

/**
 * Maximum number of unique strings that can be registered in the
 * StringRegistryService. This is a soft ceiling — the Map grows
 * dynamically, but pre-sizing the capacity hint avoids rehashes.
 */
export const MAX_REGISTRY_STRINGS = 50000;

/**
 * Initial capacity hint for the StringRegistryService internal Map.
 * Set to 2048 to cover the typical NPC names + dialogue block count
 * without triggering early Map rehashes.
 */
export const REGISTRY_INITIAL_CAPACITY = 2048;

/**
 * Number of buffers to allocate for the N-buffer fallback when
 * SharedArrayBuffer is unavailable.
 *
 * Three buffers are enough for a stable producer-consumer cycle:
 * 1 active (worker writing), 1 rendering (main reading), 1 recycling.
 */
export const FALLBACK_BUFFER_COUNT = 3;

/**
 * Creates a buffer suitable for exchanging entity state between the
 * worker and the main thread.
 *
 * When the execution context is cross-origin isolated (SharedArrayBuffer
 * is available as a constructor), returns a SharedArrayBuffer for
 * zero-copy synchronization.
 *
 * When cross-origin isolation is not available, falls back to a standard
 * ArrayBuffer. The caller must use the N-buffer protocol with Transferable
 * postMessage to avoid data races.
 *
 * @param size - Byte size of the buffer to allocate.
 * @returns A SharedArrayBuffer or ArrayBuffer of the requested size.
 */
export const createEngineBuffer = (size: number): SharedArrayBuffer | ArrayBuffer => {
  // Check for cross-origin isolation: `self.crossOriginIsolated` is true
  // in secure contexts with COOP+COEP headers. When the flag is present
  // AND SharedArrayBuffer is exposed, use shared memory.
  const isCrossOriginIsolated =
    typeof self !== 'undefined' &&
    self.crossOriginIsolated &&
    typeof SharedArrayBuffer !== 'undefined';

  if (isCrossOriginIsolated) {
    return new SharedArrayBuffer(size);
  }

  return new ArrayBuffer(size);
};
