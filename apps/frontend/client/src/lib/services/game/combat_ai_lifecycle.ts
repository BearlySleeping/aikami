// apps/frontend/client/src/lib/services/game/combat_ai_lifecycle.ts
//
// Request lifecycle primitives for the Combat-06 model calls.
//
// Shared by the decision service (`combat_ai_service`) and the narrator
// (`combat_narration_service`) so both obey ONE discipline:
//
//   1. ONE time budget per request group. `createTimeBudget` fixes an absolute
//      deadline; every attempt derives its soft window from what is LEFT of
//      that budget, so a retry can never extend the original budget by
//      starting a fresh full deadline (`combat_2.md` §18).
//   2. ONE transport per provider call, shared by every decision id in a
//      batch. The transport owns the single `AbortController` and the tracked
//      hard-abort timer.
//   3. A soft timeout NEVER clears the only abort timer while the provider
//      call is still running. The caller returns the typed fallback to the
//      engine immediately, marks the transport soft-timed-out, and leaves the
//      hard-abort deadline armed and tracked. When the provider finally
//      settles — or the hard deadline fires — the transport cleans itself up.
//   4. Cancelling ONE batch member releases only that member. The shared
//      transport is aborted when the LAST member releases, so a later batch
//      completion can never overwrite an individually cancelled decision.
//   5. Results are cached in a bounded LRU so a long encounter cannot grow the
//      completed-result map without limit.
//
// Contract: C-526 AC-3, AC-5, AC-11 (lifecycle/cancellation repair)

// ---------------------------------------------------------------------------
// Time budget
// ---------------------------------------------------------------------------

/**
 * One absolute time budget shared by snapshot acquisition, planning, retry and
 * the caller's own fallback decision.
 */
export type TimeBudget = {
  /** Absolute epoch milliseconds at which the whole request must be done. */
  readonly deadlineAt: number;
  /** Milliseconds left before {@link deadlineAt} (never negative). */
  remainingMs(now?: number): number;
  /** Whether the budget is exhausted at `now` (defaults to `Date.now()`). */
  expired(now?: number): boolean;
};

/**
 * Creates the single time budget for one request group.
 *
 * `hardDeadlineMs` is measured from `startedAt`, so retries and worker
 * fallback share the same window instead of each obtaining a fresh deadline.
 */
export const createTimeBudget = (options: {
  startedAt: number;
  hardDeadlineMs: number;
}): TimeBudget => {
  const deadlineAt = options.startedAt + Math.max(0, options.hardDeadlineMs);
  const now = (): number => Date.now();
  return {
    deadlineAt,
    remainingMs(at) {
      return Math.max(0, deadlineAt - (at ?? now()));
    },
    expired(at) {
      return (at ?? now()) >= deadlineAt;
    },
  };
};

/**
 * The soft window for one attempt: the configured soft deadline, capped by
 * whatever is left of the group budget.
 *
 * Returns `0` when the budget is already exhausted — the caller must not start
 * another attempt.
 */
export const attemptWindowMs = (options: {
  softDeadlineMs: number;
  budget: TimeBudget;
  now?: number;
}): number => Math.min(options.softDeadlineMs, options.budget.remainingMs(options.now));

// ---------------------------------------------------------------------------
// Attempt outcomes
// ---------------------------------------------------------------------------

/**
 * Terminal classification of one provider attempt.
 *
 * `soft_timeout` is NOT a failure of the request — it means the answer did not
 * arrive in time for a responsive turn, and the caller falls back while the
 * transport stays armed. `rejected` is retryable; `aborted` is not.
 */
export type AttemptOutcome<T> =
  | { kind: 'value'; value: T }
  | { kind: 'soft_timeout' }
  | { kind: 'aborted' }
  | { kind: 'rejected' };

// ---------------------------------------------------------------------------
// Provider transport
// ---------------------------------------------------------------------------

/**
 * One provider call's transport: its abort signal, its tracked hard-abort
 * deadline, and the set of decision ids still waiting on it.
 */
export type ProviderTransport = {
  readonly id: string;
  readonly signal: AbortSignal;
  /** Whether the hard deadline already fired (or the transport was aborted). */
  readonly aborted: boolean;
  /** Whether the response missed the soft deadline while the call continued. */
  readonly softTimedOut: boolean;
  /** Decision ids still subscribed to this transport. */
  memberIds(): string[];
  /** Subscribes a decision id to this transport's answer. */
  retain(decisionId: string): void;
  /**
   * Releases one decision id.
   *
   * Returns `true` when that release emptied the transport (which was then
   * aborted), so the caller can distinguish "shared call cancelled" from
   * "one member left".
   */
  release(decisionId: string): boolean;
  /** Claims ownership of a late settlement so the hard-abort timer is cleared. */
  trackSettlement(promise: Promise<unknown>): void;
  /** Records that the answer missed the soft deadline. */
  markSoftTimedOut(): void;
  /** Marks the transport terminal and clears the tracked hard-abort timer. */
  settle(): void;
  /** Aborts the provider call now and clears the tracked hard-abort timer. */
  abort(): void;
  /**
   * Arms a hard-abort timer that aborts the transport if the caller never
   * settles it. Returns a disposer that clears the timer.
   *
   * Used by the caller's own fallback path so a transport left behind by a
   * soft timeout still has a bounded lifetime.
   */
  armHardAbort(deadlineMs: number, onAbort: () => void): () => void;
};

/** Creates the transport for one provider call. */
export const createProviderTransport = (options: { id: string }): ProviderTransport => {
  const controller = new AbortController();
  const members = new Set<string>();
  let softTimedOut = false;
  let terminal = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();

  const clearTimers = (): void => {
    for (const timer of timers) {
      clearTimeout(timer);
    }
    timers.clear();
  };

  const finish = (): void => {
    if (terminal) {
      return;
    }
    terminal = true;
    clearTimers();
  };

  return {
    id: options.id,
    get signal() {
      return controller.signal;
    },
    get aborted() {
      return controller.signal.aborted;
    },
    get softTimedOut() {
      return softTimedOut;
    },
    memberIds() {
      return [...members];
    },
    retain(decisionId) {
      members.add(decisionId);
    },
    release(decisionId) {
      members.delete(decisionId);
      if (members.size > 0) {
        return false;
      }
      // Last member gone: nobody can consume the answer any more. Abort the
      // shared provider call rather than leaving it running unobserved.
      this.abort();
      return true;
    },
    trackSettlement(promise) {
      void promise.then(
        () => finish(),
        () => finish(),
      );
    },
    markSoftTimedOut() {
      softTimedOut = true;
    },
    settle() {
      finish();
    },
    abort() {
      if (terminal) {
        return;
      }
      terminal = true;
      clearTimers();
      controller.abort();
    },
    armHardAbort(deadlineMs, onAbort) {
      if (terminal) {
        return () => {};
      }
      const timer = setTimeout(
        () => {
          timers.delete(timer);
          if (terminal) {
            return;
          }
          terminal = true;
          controller.abort();
          onAbort();
        },
        Math.max(1, deadlineMs),
      );
      timers.add(timer);
      return () => {
        clearTimeout(timer);
        timers.delete(timer);
      };
    },
  };
};

// ---------------------------------------------------------------------------
// Soft-deadline race
// ---------------------------------------------------------------------------

/**
 * Races one provider call against the soft deadline.
 *
 * A soft timeout resolves as `soft_timeout` while the underlying call keeps
 * running against the transport's signal — the caller owns cleanup through
 * {@link ProviderTransport.trackSettlement} or the armed hard-abort timer.
 */
export const raceSoftDeadline = async <T>(options: {
  call: () => Promise<T>;
  transport: ProviderTransport;
  softDeadlineMs: number;
}): Promise<AttemptOutcome<T>> => {
  if (options.transport.aborted) {
    return { kind: 'aborted' };
  }
  if (options.softDeadlineMs <= 0) {
    // Budget exhausted before the attempt could be given any window.
    return { kind: 'soft_timeout' };
  }
  const call = options.call();
  return await new Promise<AttemptOutcome<T>>((resolve) => {
    let settled = false;
    const finish = (outcome: AttemptOutcome<T>): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      options.transport.signal.removeEventListener('abort', onAbort);
      resolve(outcome);
    };
    const timer = setTimeout(() => finish({ kind: 'soft_timeout' }), options.softDeadlineMs);
    const onAbort = (): void => finish({ kind: 'aborted' });
    options.transport.signal.addEventListener('abort', onAbort, { once: true });
    call.then(
      (value) => finish(options.transport.aborted ? { kind: 'aborted' } : { kind: 'value', value }),
      () => finish(options.transport.aborted ? { kind: 'aborted' } : { kind: 'rejected' }),
    );
  });
};

// ---------------------------------------------------------------------------
// Bounded result cache
// ---------------------------------------------------------------------------

/**
 * A bounded LRU cache of terminal results.
 *
 * Idempotency only needs to survive the lifetime of a turn; an unbounded map
 * would grow for the whole encounter. Least-recently-used entries are evicted
 * once `maxEntries` is exceeded.
 */
export type BoundedResultCache<Key, Value> = {
  get(key: Key): Value | undefined;
  has(key: Key): boolean;
  set(key: Key, value: Value): Value;
  delete(key: Key): void;
  clear(): void;
  readonly size: number;
};

/** Creates the bounded LRU membership cache used for terminal results. */
export const createBoundedResultCache = <Key, Value>(options: {
  maxEntries: number;
}): BoundedResultCache<Key, Value> => {
  const entries = new Map<Key, Value>();
  const maxEntries = Math.max(1, options.maxEntries);
  return {
    get(key) {
      const value = entries.get(key);
      if (value === undefined) {
        return undefined;
      }
      // Re-insert so the most recently used key is last in insertion order.
      entries.delete(key);
      entries.set(key, value);
      return value;
    },
    has(key) {
      return entries.has(key);
    },
    set(key, value) {
      if (entries.has(key)) {
        entries.delete(key);
      }
      entries.set(key, value);
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next();
        if (oldest.done === true) {
          break;
        }
        entries.delete(oldest.value);
      }
      return value;
    },
    delete(key) {
      entries.delete(key);
    },
    clear() {
      entries.clear();
    },
    get size() {
      return entries.size;
    },
  };
};

// ---------------------------------------------------------------------------
// Encounter-run identity
// ---------------------------------------------------------------------------

/**
 * Monotonic runtime generation for one authored encounter id.
 *
 * An authored encounter id recurs on retry (architecture §8.1: "an authored
 * encounter ID can recur on retry"), and a v2 `stateRevision` can repeat
 * across runs, so `(encounterId, stateRevision)` is NOT a sufficient
 * invalidation key for cached decisions, snapshots or proposals. The run
 * identity pairs the authored id with a monotonic generation minted by the
 * runtime. It is deliberately NOT wall-clock state that could reach the
 * deterministic rules — it only ever guards client-side caches and callbacks.
 */
export type EncounterRunIdentity = {
  readonly encounterId: string;
  readonly generation: number;
};

/** Mints encounter-run identities and compares them. */
export type EncounterRunTracker = {
  /** Starts a new run for `encounterId` and returns its identity. */
  begin(encounterId: string): EncounterRunIdentity;
  /** The active run, or `undefined` before the first `begin`. */
  current(): EncounterRunIdentity | undefined;
  /** Ends the active run; all its identities become stale. */
  end(): void;
  /** Whether an identity still belongs to the active run. */
  isCurrent(identity: EncounterRunIdentity | undefined): boolean;
};

/** Creates the encounter-run tracker (default for the combat AI layer). */
export const createEncounterRunTracker = (): EncounterRunTracker => {
  let generation = 0;
  let active: EncounterRunIdentity | undefined;
  return {
    begin(encounterId) {
      generation += 1;
      active = { encounterId, generation };
      return active;
    },
    current() {
      return active;
    },
    end() {
      active = undefined;
    },
    isCurrent(identity) {
      return (
        identity !== undefined &&
        active !== undefined &&
        identity.generation === active.generation &&
        identity.encounterId === active.encounterId
      );
    },
  };
};
