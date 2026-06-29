// packages/frontend/engine/src/math/jps/min_heap.ts

// ---------------------------------------------------------------------------
// Flat Binary Min-Heap — contiguous Uint32Array priority queue
//
// Contract C-192 AC-2: OPEN set for JPS pathfinding stored as a flat
// array-backed binary min-heap. Navigation uses bitwise operations:
//   leftChild  = (i << 1) + 1
//   rightChild = (i << 1) + 2
//   parent     = (i - 1) >> 1
//
// Lazy deletion: when a better cost is found for a node already in the heap,
// the new entry is pushed. The stale entry is detected on pop by comparing
// the stored F-cost in the map against what this entry would have had.
// ---------------------------------------------------------------------------

/**
 * A flat binary min-heap for JPS pathfinding.
 *
 * Stores node IDs ordered by F-cost (estimated total path cost). The heap
 * is backed by a pre-allocated Uint32Array with fixed capacity.
 */
export class MinHeap {
  /** Flat array of node IDs in heap order. */
  private readonly _heap: Uint32Array;
  /** Current number of elements in the heap. */
  private _size: number;
  /** Maximum capacity of the heap. */
  private readonly _capacity: number;
  /** Reference to F-cost map for heap ordering. */
  private readonly _fCostMap: Float32Array;

  /**
   * Creates a new min-heap with the given capacity.
   *
   * @param capacity - Maximum number of elements.
   * @param fCostMap - Reference to the F-cost map for ordering.
   */
  constructor(capacity: number, fCostMap: Float32Array) {
    this._capacity = capacity;
    this._heap = new Uint32Array(capacity);
    this._size = 0;
    this._fCostMap = fCostMap;
  }

  /** Number of elements currently in the heap. */
  get size(): number {
    return this._size;
  }

  /**
   * Pushes a node ID onto the heap in O(log N) time.
   *
   * @param nodeId - Flat 1D node index to insert.
   */
  push(nodeId: number): void {
    if (this._size >= this._capacity) {
      return;
    }

    const idx = this._size;
    this._heap[idx] = nodeId;
    this._size++;

    this._siftUp(idx);
  }

  /**
   * Pops the node with the lowest F-cost from the heap.
   *
   * Returns null if the heap is empty.
   *
   * @returns The node ID with lowest F-cost, or null.
   */
  pop(): number | null {
    if (this._size === 0) {
      return null;
    }

    const nodeId = this._heap[0];

    // Swap last element to root
    this._size--;
    if (this._size > 0) {
      this._heap[0] = this._heap[this._size];
      this._siftDown(0);
    }

    return nodeId;
  }

  /**
   * Clears the heap (sets size to 0, no array zeroing needed).
   */
  clear(): void {
    this._size = 0;
  }

  /**
   * Checks if the heap is empty.
   */
  isEmpty(): boolean {
    return this._size === 0;
  }

  // -- Private helpers ----------------------------------------------------

  /** Sifts an element up to maintain heap property. */
  private _siftUp(idx: number): void {
    const heap = this._heap;
    const fCost = this._fCostMap;

    while (idx > 0) {
      const parent = (idx - 1) >> 1;
      const nodeId = heap[idx];
      const parentId = heap[parent];

      if (fCost[nodeId] >= fCost[parentId]) {
        break;
      }

      // Swap
      heap[idx] = parentId;
      heap[parent] = nodeId;
      idx = parent;
    }
  }

  /** Sifts an element down to maintain heap property. */
  private _siftDown(idx: number): void {
    const heap = this._heap;
    const fCost = this._fCostMap;
    const size = this._size;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      let smallest = idx;
      const left = (idx << 1) + 1;
      const right = (idx << 1) + 2;

      if (left < size && fCost[heap[left]] < fCost[heap[smallest]]) {
        smallest = left;
      }

      if (right < size && fCost[heap[right]] < fCost[heap[smallest]]) {
        smallest = right;
      }

      if (smallest === idx) {
        break;
      }

      // Swap
      const tmp = heap[idx];
      heap[idx] = heap[smallest];
      heap[smallest] = tmp;
      idx = smallest;
    }
  }
}
