// packages/frontend/engine/src/rendering/deferred_loads.ts
//
// Single-flight registry for asynchronous production by key.
//
// Without it, N concurrent callers that miss the cache each run their own
// loader: the same asset is decoded N times, the same atlas is parsed N times,
// and the accounting is inflated by N-1 phantom entries. The registry makes
// the miss path a single-flight operation — the first caller starts the work,
// everyone else awaits the SAME promise.
//
// It also owns the "the owner went away mid-flight" rule. {@link invalidate}
// (called from `destroy`) drops the in-flight map, so a load that completes
// afterwards still resolves for its original caller — the texture genuinely
// exists — but its `commit` callback is never invoked. A torn-down cache can
// therefore never be repopulated by a request that started before teardown.

/** Handle returned by {@link createDeferredLoadRegistry}. */
export type DeferredLoadRegistry<TKey, TValue> = {
  /**
   * Awaits the in-flight load for `key`, or starts one.
   *
   * @param options.key - Identity of the work; concurrent calls with the same
   *   key share a single load.
   * @param options.load - Produces the value. Runs at most once per key at a
   *   time; a rejection clears the entry so the next caller retries.
   * @param options.commit - Publishes the value into whatever cache the
   *   caller owns. Skipped entirely after {@link DeferredLoadRegistry.invalidate}.
   */
  run(options: {
    key: TKey;
    load: () => Promise<TValue>;
    commit: (value: TValue) => void;
  }): Promise<TValue>;
  /** Drops every in-flight entry; later completions never commit. */
  invalidate(): void;
  /** Number of loads currently in flight (diagnostics/tests). */
  readonly inFlightCount: number;
};

/**
 * Creates an isolated single-flight registry.
 *
 * One registry per cache: keys are per-cache by construction, so two caches
 * can never collide on a numeric asset id.
 */
export const createDeferredLoadRegistry = <TKey, TValue>(): DeferredLoadRegistry<TKey, TValue> => {
  const inFlight = new Map<TKey, Promise<TValue>>();
  let invalidated = false;

  return {
    run(options) {
      const existing = inFlight.get(options.key);
      if (existing) {
        return existing;
      }

      const pending = (async () => {
        const value = await options.load();
        if (!invalidated) {
          options.commit(value);
        }
        return value;
      })().finally(() => {
        // A pre-invalidation load must not remove a newer load for this key.
        if (inFlight.get(options.key) === pending) {
          inFlight.delete(options.key);
        }
      });

      inFlight.set(options.key, pending);
      return pending;
    },

    invalidate() {
      invalidated = true;
      inFlight.clear();
    },

    get inFlightCount() {
      return inFlight.size;
    },
  };
};
