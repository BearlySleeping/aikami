// packages/frontend/engine/src/math/spatial_hash_grid.ts

// ---------------------------------------------------------------------------
// SpatialHashGrid — dense spatial hash for O(1) neighborhood queries
//
// Uses a 3-pass counting sort (Count → Prefix Sum → Distribute) to bucket
// entities into a fixed-capacity hash table. Each tick, entities are
// re-bucketed by their spatial cell, and neighborhood queries return
// candidate entity IDs from the 3×3 grid around a query point.
//
// This replaces the O(N) per-tick iteration over all context-bearing
// entities with an amortized O(1) lookup bounded by the constant number
// of cells in the 9-cell neighborhood.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Module-level constants
// ---------------------------------------------------------------------------

/** Maximum number of results a neighborhood query can return. */
const RESULT_BUFFER_CAPACITY = 1024;

// ---------------------------------------------------------------------------
// Module-level pre-allocated buffers (reused across all instances)
// ---------------------------------------------------------------------------

/**
 * Pre-allocated result buffer for queryNeighborhood.
 *
 * Module-level scope allows reuse across multiple grid instances and avoids
 * per-call allocation overhead in the hot tick loop.
 */
const resultBuffer = new Int32Array(RESULT_BUFFER_CAPACITY);

// ---------------------------------------------------------------------------
// SpatialHashGrid
// ---------------------------------------------------------------------------

/**
 * Dense spatial hash grid for accelerating proximity-based entity lookups.
 *
 * Entities are bucketed into cells using a hash of their grid coordinates.
 * The grid supports populating from interleaved position + entity ID arrays
 * and querying the 3×3 cell neighborhood around an arbitrary point.
 */
class SpatialHashGrid {
  /** Size of each grid cell in world-space units. */
  private readonly _cellSize: number;

  /** Maximum number of hash buckets (and total entity slots). */
  private readonly _capacity: number;

  /** Per-bucket entity count from the COUNT pass. */
  private readonly _count: Int32Array;

  /** Per-bucket start offset (from the PREFIX SUM pass). After DISTRIBUTE, these are the start offsets for each bucket. */
  private readonly _offset: Int32Array;

  /**
   * Flat array of entity IDs sorted by bucket.
   *
   * After `populate()`, entities in bucket `h` live at
   * `_particleMap[_offset[h]]` through `_particleMap[_offset[h] + _count[h] - 1]`.
   */
  private readonly _particleMap: Int32Array;

  /** Number of entities passed to the last `populate()` call. */
  private _entityCount: number;

  /** Current number of valid entries in the result buffer after a query. */
  private _resultCount: number;

  /**
   * Creates a new spatial hash grid.
   *
   * @param options.cellSize - Width/height of each grid cell in world units.
   * @param options.capacity - Maximum number of hash buckets. Should be
   *   greater than or equal to the maximum expected entity count to
   *   minimize hash collisions.
   */
  constructor(options: { cellSize: number; capacity: number }) {
    this._cellSize = options.cellSize;
    this._capacity = options.capacity;
    this._entityCount = 0;
    this._resultCount = 0;

    this._count = new Int32Array(this._capacity);
    this._offset = new Int32Array(this._capacity);
    this._particleMap = new Int32Array(this._capacity);
  }

  // -- Public API -----------------------------------------------------------

  /**
   * Populates the grid from a flat interleaved position array and entity IDs.
   *
   * Uses the 3-pass counting sort algorithm:
   * 1. **COUNT** — count entities per hash bucket
   * 2. **PREFIX SUM** — compute start offset for each bucket
   * 3. **DISTRIBUTE** — place entity IDs into the sorted particleMap
   *
   * @param positions - Flat Float32Array where `positions[i * 2] = x` and
   *   `positions[i * 2 + 1] = y` for entity index `i`.
   * @param entityIds - Array of entity IDs, parallel to `positions`.
   *   `entityIds[i]` is the entity at position index `i`.
   */
  populate(positions: Float32Array, entityIds: number[]): void {
    this._entityCount = entityIds.length;

    // Zero out internal arrays
    this._count.fill(0);
    this._offset.fill(0);
    this._particleMap.fill(0);

    if (this._entityCount === 0) {
      return;
    }

    // --- PASS 1: COUNT ----------------------------------------------------
    for (let i = 0; i < this._entityCount; i++) {
      const x = positions[i * 2];
      const y = positions[i * 2 + 1];
      const cx = Math.floor(x / this._cellSize);
      const cy = Math.floor(y / this._cellSize);
      const h = this._hashCell(cx, cy);
      this._count[h]++;
    }

    // --- PASS 2: PREFIX SUM -----------------------------------------------
    let sum = 0;
    for (let i = 0; i < this._capacity; i++) {
      const c = this._count[i];
      this._offset[i] = sum;
      sum += c;
    }

    // --- PASS 3: DISTRIBUTE -----------------------------------------------
    // Working copy of offsets — mutated during distribution to track the
    // next insertion slot for each bucket.
    const workingOffsets = new Int32Array(this._offset);

    for (let i = 0; i < this._entityCount; i++) {
      const x = positions[i * 2];
      const y = positions[i * 2 + 1];
      const cx = Math.floor(x / this._cellSize);
      const cy = Math.floor(y / this._cellSize);
      const h = this._hashCell(cx, cy);
      const dest = workingOffsets[h]++;
      this._particleMap[dest] = entityIds[i];
    }
    // After this loop: _offset[h] = start of bucket h, _count[h] = bucket size,
    // _particleMap[_offset[h] ... _offset[h] + _count[h] - 1] = eids in bucket h.
  }

  /**
   * Queries the 3×3 spatial neighborhood around `(x, y)` and returns all
   * entity IDs found in those 9 cells.
   *
   * Results are returned as a new `number[]` allocated from the internal
   * pre-sized buffer. The same buffer is reused across calls; the returned
   * array is a snapshot copy.
   *
   * @param x - World-space x coordinate.
   * @param y - World-space y coordinate.
   * @returns Entity IDs of all entities in the 3×3 cell neighborhood.
   */
  queryNeighborhood(x: number, y: number): number[] {
    this._resultCount = 0;

    const centerCx = Math.floor(x / this._cellSize);
    const centerCy = Math.floor(y / this._cellSize);

    // Iterate the 3×3 grid centered on (centerCx, centerCy)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const h = this._hashCell(centerCx + dx, centerCy + dy);
        const start = this._offset[h];
        const bucketSize = this._count[h];

        for (let i = 0; i < bucketSize && this._resultCount < RESULT_BUFFER_CAPACITY; i++) {
          resultBuffer[this._resultCount++] = this._particleMap[start + i];
        }
      }
    }

    // Return a copy so callers don't mutate the shared buffer
    return Array.from(resultBuffer.slice(0, this._resultCount));
  }

  // -- Private helpers ------------------------------------------------------

  /**
   * Hashes 2D cell coordinates to a flat bucket index.
   *
   * Uses large prime multipliers and bitwise XOR for good distribution
   * across the hash table even when coordinates are structured or sequential.
   *
   * @param cx - Cell x coordinate.
   * @param cy - Cell y coordinate.
   * @returns Bucket index in `[0, capacity)`.
   */
  private _hashCell(cx: number, cy: number): number {
    // Large primes for spatial hashing — these produce good avalanche
    // properties for typical game-world coordinate ranges.
    let h = (cx * 0x58c7d3e5) ^ (cy * 0x29a1f371);
    // Force unsigned (>>> 0) before modulo to avoid negative indices
    h = h >>> 0;
    return h % this._capacity;
  }
}

export { SpatialHashGrid };
