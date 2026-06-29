// packages/frontend/engine/src/services/string_registry_service.ts

import { BaseEngineClass, type BaseEngineClassOptions } from '../base_engine_class.ts';

// ---------------------------------------------------------------------------
// StringRegistryService — zero-allocation string↔handle lookup registry
//
// Contract C-195: Centralized uint32 numeric-to-string index stored inside
// the Web Worker thread. Components store purely sequential uint32 handles;
// string resolution happens downstream from system ticks so the execution
// thread handles only flat binary vectors during game frame lookups.
//
// Architecture:
// 1. Flat handle allocation: map strings to sequential uint32 indices.
//    Once registered, the handle is immutable for the lifecycle of the
//    execution instance.
// 2. Unproxied dictionary: raw `Map<number, string>` isolated from
//    Svelte 5 reactive proxy bindings — no $state, no stores.
// 3. resolve() returns a primitive copy — never a reference to internal
//    memory. This guarantees zero proxy traps on the read path.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Raw uint32 handle key into the registry. */
export type RegistryHandle = number;

/**
 * A single row entry fed from the Turso persistence layer or SQL Connect
 * delta stream for bulk hydration.
 */
export type RegistryRow = {
  /** The string value to register. */
  readonly value: string;
};

/**
 * Options for constructing a {@link StringRegistryService}.
 */
export type StringRegistryServiceOptions = BaseEngineClassOptions & {
  /** Optional initial capacity for the internal Map (avoids rehashes). */
  initialCapacity?: number;
};

// ---------------------------------------------------------------------------
// StringRegistryService
// ---------------------------------------------------------------------------

/**
 * Centralized unproxied string registry for the bitECS worker thread.
 *
 * Stores a bi-directional mapping between uint32 handles and string values
 * using raw `Map` objects. Completely isolated from Svelte 5 reactive proxy
 * bindings — the Map lives in the worker heap and is never exposed to the
 * UI layer.
 *
 * Instantiate via {@link StringRegistryService.create}, never with `new`.
 */
export class StringRegistryService extends BaseEngineClass<StringRegistryServiceOptions> {
  // -----------------------------------------------------------------------
  // Internal: unproxied storage (NO $state, NO stores)
  // -----------------------------------------------------------------------

  /** Handle → string lookup. Primary read path for resolve(). */
  private readonly _handleToString = new Map<RegistryHandle, string>();

  /** String → handle reverse lookup for register() deduplication. */
  private readonly _stringToHandle = new Map<string, RegistryHandle>();

  /** Monotonically increasing handle counter (uint32 range). */
  private _nextHandle: RegistryHandle = 1;

  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------

  /**
   * Do NOT use `new StringRegistryService()`. Use
   * {@link StringRegistryService.create} instead.
   */
  constructor(options: StringRegistryServiceOptions) {
    super(options);
    this.debug('constructor', { initialCapacity: options.initialCapacity });
  }

  // -----------------------------------------------------------------------
  // Public: register / resolve
  // -----------------------------------------------------------------------

  /**
   * Registers a string value and returns its unique uint32 handle.
   *
   * If the string is already registered, returns the existing handle
   * without allocating a new one (idempotent). Otherwise, allocates a
   * sequential handle and stores the mapping.
   *
   * Handle allocation is atomic — the counter increments immediately
   * after assignment to prevent reuse collisions.
   *
   * @param value - The string to register.
   * @returns The uint32 handle for the string.
   */
  register(value: string): RegistryHandle {
    // Fast path: already registered
    const existing = this._stringToHandle.get(value);
    if (existing !== undefined) {
      return existing;
    }

    // Allocate new handle
    const handle = this._nextHandle;
    this._nextHandle = handle + 1;

    // Store both directions
    this._handleToString.set(handle, value);
    this._stringToHandle.set(value, handle);

    this.render('register', { handle, value: value.slice(0, 32) });
    return handle;
  }

  /**
   * Resolves a uint32 handle to its string value.
   *
   * Returns `undefined` if the handle is unknown (0 is reserved as the
   * null/empty sentinel and always returns undefined).
   *
   * Returns a primitive string copy — never a reference to internal
   * Map storage. No proxy traps, no allocations on the hot path
   * (Map.get is O(1) amortized).
   *
   * @param handle - The uint32 handle to resolve.
   * @returns The string value, or undefined if not found.
   */
  resolve(handle: RegistryHandle): string | undefined {
    // Sentinel: handle 0 always resolves to undefined (null/empty sentinel)
    if (handle === 0) {
      return undefined;
    }

    const value = this._handleToString.get(handle);

    // Return primitive copy — never expose internal Map reference
    // to prevent accidental proxy wrapping in Svelte 5.
    if (value === undefined) {
      return undefined;
    }

    // String primitives are immutable in JS — returning them directly
    // is safe. No allocation overhead.
    return value;
  }

  /**
   * Returns the total number of registered strings.
   */
  get size(): number {
    return this._handleToString.size;
  }

  /**
   * Returns the next handle value that would be allocated.
   * Useful for capacity planning and testing.
   */
  get nextHandle(): RegistryHandle {
    return this._nextHandle;
  }

  // -----------------------------------------------------------------------
  // Public: bulk hydration (Turso / SQL Connect)
  // -----------------------------------------------------------------------

  /**
   * Bulk-registers strings from a hydration source (Turso rows or SQL
   * Connect deltas).
   *
   * Each row's `value` is registered sequentially. Already-registered
   * strings are silently skipped via register()'s idempotency check.
   *
   * Returns the array of handles assigned (including duplicates which
   * return the existing handle).
   *
   * @param rows - Array of registry rows to ingest.
   * @returns Array of handles in the same order as the input rows.
   */
  bulkRegister(rows: readonly RegistryRow[]): RegistryHandle[] {
    const handles: RegistryHandle[] = [];
    for (const row of rows) {
      handles.push(this.register(row.value));
    }
    this.debug('bulkRegister', { ingested: rows.length, totalSize: this.size });
    return handles;
  }

  /**
   * Clears all registry state. Resets the handle counter to 1.
   *
   * Primarily used for testing or world reset. In production, the
   * registry instance is tied to the worker lifecycle and should
   * never be cleared mid-session.
   */
  clear(): void {
    this._handleToString.clear();
    this._stringToHandle.clear();
    this._nextHandle = 1;
    this.debug('clear');
  }

  /**
   * Returns a snapshot of the handle counter and stored entry count
   * for diagnostics and testing.
   */
  get diagnostics(): { size: number; nextHandle: RegistryHandle } {
    return { size: this.size, nextHandle: this._nextHandle };
  }
}
