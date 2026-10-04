// packages/frontend/engine/src/rendering/spritesheet_registry.ts
//
// Lease-counted cache of parsed PixiJS `Spritesheet` objects.
//
// A spritesheet is not a private allocation: `sheet.textures` is a live map
// that the per-frame appearance path indexes on every tick
// (`layer.spritesheet.textures['walk_0_3']`). `Spritesheet.destroy()` nulls
// that map, so evicting a sheet that a live actor still holds turns the next
// animation frame into a `TypeError: Cannot read properties of null`. FIFO
// eviction past the 128-entry budget was enough to hit this with more than
// 128 distinct actor sheets.
//
// The registry therefore counts LEASES, not lookups. A consumer takes a lease
// for exactly as long as it holds the sheet and drops it on teardown;
// eviction only ever considers unleased sheets, so a pinned actor cannot be
// evicted no matter how many sheets come and go around it. Over-budget is a
// correct outcome while every entry is pinned — better than a crash.

import type { Spritesheet } from 'pixi.js';
import { createDeferredLoadRegistry } from './deferred_loads.ts';

/** A borrowed sheet plus the release that ends the borrow. */
export type SpritesheetLease = {
  /** The cached sheet. Valid only while the lease is held. */
  readonly spritesheet: Spritesheet;
  /**
   * Ends the borrow. Idempotent: a second call is a no-op, so a consumer can
   * release from both a teardown path and an error path without bookkeeping.
   */
  release: () => void;
};

/** One cached sheet plus its pin state. */
type SheetEntry = {
  key: string;
  sheet: Spritesheet;
  leases: number;
  lastAccessedAt: number;
  /** Destroyed logically; awaiting the last release before the real destroy. */
  retired: boolean;
};

/** Default cache budget for parsed sheets. */
export const DEFAULT_MAX_SPRITESHEETS = 128;

/**
 * How long a borrowed sheet stays pinned.
 *
 * `0` schedules a MACROtask, which is the whole point: `queueMicrotask` would
 * run BEFORE the awaiting caller's continuation and hand back a sheet that
 * eviction had already nulled. One macrotask turn outlives every microtask
 * continuation of the borrow, so the caller can read it, and no longer.
 */
const BORROW_TURN_MS = 0;

/**
 * Releases a sheet's per-frame textures.
 *
 * `destroyBase` is deliberately left at its `false` default: the base texture
 * comes from `Assets.load()` and is owned by the PixiJS asset system (and by
 * the texture manager's own caches). Destroying it here would free a GPU
 * resource that other consumers still hold.
 */
const destroySheet = (sheet: Spritesheet): void => {
  sheet.destroy(false);
};

export class SpritesheetRegistry {
  private readonly _entries = new Map<string, SheetEntry>();
  private readonly _pending = createDeferredLoadRegistry<string, Spritesheet>();
  /**
   * Unpooled sheets handed to holders after the registry was destroyed, with
   * the number of holders sharing each one. A single parse can be observed by
   * several concurrent acquirers; without counting, the first release would
   * destroy a sheet the others are still holding.
   */
  private readonly _orphans = new Map<Spritesheet, number>();
  private readonly _maxEntries: number;
  private _tick = 0;
  private _destroyed = false;

  constructor(options?: { maxEntries?: number }) {
    this._maxEntries = options?.maxEntries ?? DEFAULT_MAX_SPRITESHEETS;
  }

  /** Number of cached sheets, pinned or not. */
  get count(): number {
    return this._entries.size;
  }

  /** Number of sheets currently pinned by at least one live lease. */
  get pinnedCount(): number {
    let pinned = 0;
    for (const entry of this._entries.values()) {
      if (entry.leases > 0) {
        pinned++;
      }
    }
    return pinned;
  }

  /**
   * Returns a lease on the cached sheet for `cacheKey`, parsing one first if
   * this is the first request. Concurrent requests for the same key share one
   * parse; each still receives its own lease, so N holders mean N releases.
   *
   * @param options.cacheKey - Stable identity of the sheet (URL + geometry).
   * @param options.create - Builds and parses the sheet. Runs at most once per
   *   key while a parse is in flight.
   */
  async acquire(options: {
    cacheKey: string;
    create: () => Promise<Spritesheet>;
  }): Promise<SpritesheetLease> {
    const cached = this._entries.get(options.cacheKey);
    if (cached && !cached.retired) {
      return this._lease(cached);
    }

    const created = await this._pending.run({
      key: options.cacheKey,
      load: options.create,
      commit: (sheet) => this._insert(options.cacheKey, sheet),
    });

    // The winner is whatever the cache holds now: a concurrent acquire may
    // have inserted first, and after `destroy()` nothing is inserted at all.
    const entry = this._entries.get(options.cacheKey);
    if (!entry || entry.retired) {
      return this._orphanLease(created);
    }
    const lease = this._lease(entry);
    // Evict AFTER the lease exists: a fresh entry starts unpinned, so
    // evicting before pinning could select the sheet just handed out.
    this._evictIfNeeded();
    return lease;
  }

  /**
   * Borrows a sheet for ONE TURN for a caller that only reads a frame once.
   *
   * Unlike {@link SpritesheetRegistry.acquire} the pin is released
   * automatically on the next macrotask, so a one-shot accessor can never
   * leak a permanent pin — and never hands back a dead object. Releasing
   * immediately is NOT equivalent: the caller resumes as a microtask, and a
   * sheet that is the only unleased candidate (every other entry pinned) is
   * evicted by its own release before the caller ever looks at it.
   *
   * The pin is deliberately scheduled at creation rather than on `release()`,
   * so a caller that forgets to release still cannot leak.
   */
  async borrow(options: {
    cacheKey: string;
    create: () => Promise<Spritesheet>;
  }): Promise<SpritesheetLease> {
    const lease = await this.acquire(options);

    let scheduled = false;
    const schedule = (): void => {
      if (scheduled) {
        return;
      }
      scheduled = true;
      // Survives `destroy()`: the release path frees a retired entry, so a
      // borrow outstanding at teardown is still reclaimed, never leaked.
      setTimeout(() => {
        lease.release();
      }, BORROW_TURN_MS);
    };

    schedule();
    return {
      spritesheet: lease.spritesheet,
      release: schedule,
    };
  }

  /**
   * Retires every sheet. Leased sheets are marked and destroyed when their
   * last lease drops; unleased sheets go immediately. In-flight parses are
   * detached so nothing new lands in the cache afterwards.
   */
  destroy(): void {
    if (this._destroyed) {
      return;
    }
    this._destroyed = true;
    this._pending.invalidate();

    for (const [key, entry] of this._entries) {
      if (entry.leases > 0) {
        entry.retired = true;
        continue;
      }
      destroySheet(entry.sheet);
      this._entries.delete(key);
    }
  }

  /** Number of unpooled sheets currently handed out (diagnostics/tests). */
  get orphanCount(): number {
    return this._orphans.size;
  }

  /**
   * Hands out a sheet that is no longer pooled (the registry was destroyed
   * mid-parse). Holders are counted so the sheet is destroyed exactly once,
   * by the LAST of them — never twice on the same object.
   */
  private _orphanLease(sheet: Spritesheet): SpritesheetLease {
    this._orphans.set(sheet, (this._orphans.get(sheet) ?? 0) + 1);

    let released = false;
    return {
      spritesheet: sheet,
      release: () => {
        if (released) {
          return;
        }
        released = true;
        const holders = (this._orphans.get(sheet) ?? 1) - 1;
        if (holders <= 0) {
          this._orphans.delete(sheet);
          destroySheet(sheet);
          return;
        }
        this._orphans.set(sheet, holders);
      },
    };
  }

  /** Registers a freshly parsed sheet as the cache entry for `key`. */
  private _insert(key: string, sheet: Spritesheet): void {
    if (this._destroyed || this._entries.has(key)) {
      return;
    }
    this._entries.set(key, {
      key,
      sheet,
      leases: 0,
      lastAccessedAt: ++this._tick,
      retired: false,
    });
  }

  /** Takes a lease on `entry`, refreshing its LRU position. */
  private _lease(entry: SheetEntry): SpritesheetLease {
    entry.leases++;
    entry.lastAccessedAt = ++this._tick;

    let released = false;
    return {
      spritesheet: entry.sheet,
      release: () => {
        if (released) {
          return;
        }
        released = true;
        this._release(entry);
      },
    };
  }

  /** Drops one lease and evicts if that leaves the sheet collectable. */
  private _release(entry: SheetEntry): void {
    entry.leases = Math.max(0, entry.leases - 1);

    if (entry.retired && entry.leases === 0) {
      destroySheet(entry.sheet);
      this._entries.delete(entry.key);
      return;
    }
    this._evictIfNeeded();
  }

  /**
   * Evicts least-recently-used UNLEASED sheets until the budget is met. Stops
   * early when everything left is pinned — evicting those is exactly the crash
   * this registry exists to prevent.
   */
  private _evictIfNeeded(): void {
    while (this._entries.size > this._maxEntries) {
      let victimKey: string | undefined;
      let oldest = Number.POSITIVE_INFINITY;

      for (const [key, entry] of this._entries) {
        if (entry.leases > 0 || entry.retired) {
          continue;
        }
        if (entry.lastAccessedAt < oldest) {
          oldest = entry.lastAccessedAt;
          victimKey = key;
        }
      }

      if (victimKey === undefined) {
        return;
      }
      const victim = this._entries.get(victimKey);
      if (victim) {
        destroySheet(victim.sheet);
      }
      this._entries.delete(victimKey);
    }
  }
}
