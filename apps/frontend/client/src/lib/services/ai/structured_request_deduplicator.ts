// apps/frontend/client/src/lib/services/ai/structured_request_deduplicator.ts
//
// In-flight coalescing for identical structured requests (issue #382, P1
// "In-flight deduplication").
//
// The defect this prevents: the same micro-task is frequently issued more than
// once before any of them finishes. A player who taps the same dialogue chip
// twice, a panel that mounts twice, two post-agents that happen to share a
// prompt — each issues its own provider call for a byte-identical request.
// Every duplicate is a real spend against a real latency budget, and the
// provider sees N identical requests where one would do.
//
// The rule that makes this safe, and is the whole reason the deduplicator is
// reference-counted rather than "first caller wins":
//
//   Cancelling ONE consumer must never cancel work another consumer is still
//   waiting for.
//
// So a shared attempt is torn down only when its LAST subscriber releases it.
// A single cancelled consumer gets its own typed cancellation and nobody else's
// request is disturbed — which is the failure mode that made naive
// deduplication unsafe to ship.
//
// Deliberately NOT a result cache. This only ever coalesces calls that are
// *simultaneously* in flight; once the attempt settles, its entry is dropped and
// the next identical call goes to the provider again. Persisting results across
// calls is a separate decision with separate correctness requirements
// (state fingerprinting, content-pack versioning, campaign scope) and is not
// taken here.
//
// Contract: issue #382 P1

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Stable identity of one coalescable request. */
export type StructuredRequestKey = {
  /** Task, so two different tasks never collide even with the same prompt. */
  task: string | undefined;
  /** Schema identity — a different schema is a different request. */
  schemaName: string;
  /** The compiled/normalized schema, hashed by the caller. */
  schemaFingerprint: string;
  /** System prompt; distinct system prompts are distinct requests. */
  systemPrompt: string;
  /** The user-facing prompt. */
  prompt: string;
  /** Explicit model override, when the caller pinned one. */
  model: string | undefined;
};

/** One coalesced attempt and its subscriber count. */
type SharedAttempt<T> = {
  promise: Promise<T>;
  /** Subscribers still waiting. The attempt is torn down at zero. */
  subscribers: number;
  /** Whether the underlying call has produced its answer. */
  settled: boolean;
  /** Aborts the underlying call; owned by the attempt, not by a subscriber. */
  abort: () => void;
  /**
   * Detaches every waiting consumer, so a force-cancelled attempt never leaves
   * a caller awaiting a promise nothing will resolve.
   */
  detachAll: () => void;
  /** Detach callbacks for the consumers still attached. */
  waiters: Set<() => void>;
};

/** Outcome handed back to a subscriber. */
export type DeduplicatedResult<T> = {
  /** The coalesced value, or `undefined` when the attempt produced none. */
  value?: T;
  /** Whether this consumer joined an already-running attempt. */
  coalesced: boolean;
  /** Whether the attempt ended without a value. */
  failed: boolean;
  /** Whether THIS consumer cancelled its own wait. */
  cancelled: boolean;
  /** Subscribers sharing this attempt, including this one. */
  subscriberCount: number;
  /**
   * The caller's own abort reason, when it was the one that cancelled.
   *
   * Preserved so the consumer can rethrow the reason the caller actually
   * aborted with, rather than a synthesised `AbortError` that loses it.
   */
  cancelledReason?: unknown;
  /**
   * The attempt's own failure, preserved.
   *
   * Every subscriber gets the SAME error instance the underlying call threw,
   * which is what lets each caller run its own error handling — a gateway error
   * code, a cancellation, a timeout — instead of receiving a generic
   * "something went wrong" that destroys the distinction the caller needs.
   */
  error?: unknown;
};

/** The deduplicator's public surface. */
export type StructuredRequestDeduplicator = {
  /**
   * Subscribes to the attempt for `key`, starting one when none is in flight.
   *
   * `run` receives the ATTEMPT's signal — not the subscriber's. That is the
   * whole point: only the attempt may abort the shared call, and only when its
   * last subscriber leaves. Handing `run` the subscriber's signal instead would
   * let one consumer's cancellation kill everybody's work.
   */
  run<T>(options: {
    key: StructuredRequestKey;
    signal?: AbortSignal;
    run: (signal: AbortSignal) => Promise<T>;
  }): Promise<DeduplicatedResult<T>>;
  /** Number of attempts currently in flight. */
  readonly inFlightCount: number;
  /** Total consumers served by an already-running attempt. */
  readonly coalescedCount: number;
  /** Aborts every attempt and drops every subscriber. */
  cancelAll(): void;
  /** Clears the counters. Does not disturb live attempts. */
  reset(): void;
  /**
   * Diagnostics hook, called when the map is at capacity and a request is
   * therefore not coalescable. Injected rather than logged here so this module
   * stays a pure, dependency-free primitive.
   */
  debug?: (label: string, detail: Record<string, unknown>) => void;
};

// ---------------------------------------------------------------------------
// Key
// ---------------------------------------------------------------------------

/**
 * Builds the lookup key for a request.
 *
 * Length-prefixed so a boundary can never be forged: with plain concatenation,
 * `("ab", "c")` and `("a", "bc")` would produce the same key and one request's
 * prompt would be served another's answer. The schema fingerprint participates
 * because the same prompt under a different schema is a different question.
 *
 * Module-private: callers supply the fields, not the key. A caller that built
 * its own key string would have to re-derive these rules, and a divergence would
 * silently merge requests that must stay apart.
 */
const structuredRequestKey = (key: StructuredRequestKey): string =>
  [
    key.task ?? '',
    key.schemaName,
    key.schemaFingerprint,
    key.systemPrompt,
    key.prompt,
    key.model ?? '',
  ]
    .map((part) => `${part.length}:${part}`)
    .join('|');

// ---------------------------------------------------------------------------
// Subscriber
// ---------------------------------------------------------------------------

/**
 * Attaches one consumer to an attempt and resolves when the attempt settles.
 *
 * Returns a `release` so the caller controls teardown, plus a `settled` flag the
 * caller checks before acting on the outcome — two sources of truth about the
 * same question is how a "resolved" result ends up delivered to a consumer that
 * already gave up.
 */
type Subscription<T> = {
  outcome: Promise<DeduplicatedResult<T>>;
  settled: () => boolean;
  /**
   * Detaches this consumer, resolving it as cancelled. Idempotent: a second
   * call after the consumer settled is a no-op.
   */
  release: () => void;
};

/**
 * Wires one consumer onto a shared attempt.
 *
 * The consumer's own abort detaches ONLY that consumer. The attempt is torn
 * down when the count reaches zero, and only then.
 */
const subscribeToAttempt = <T>(options: {
  attempt: SharedAttempt<T>;
  key: string;
  attempts: Map<string, SharedAttempt<unknown>>;
  signal?: AbortSignal;
  coalesced: boolean;
}): Subscription<T> => {
  const { attempt, key, attempts, signal, coalesced } = options;
  attempt.subscribers += 1;
  const startCount = attempt.subscribers;

  let settled = false;
  let resolveOutcome: (result: DeduplicatedResult<T>) => void = () => {};

  const outcome = new Promise<DeduplicatedResult<T>>((resolve) => {
    resolveOutcome = resolve;
  });

  /**
   * Detaches this consumer and resolves its outcome in one step.
   *
   * Resolution lives here rather than at the call sites so that EVERY detach
   * path resolves — a force-cancelled attempt, a subscriber abort, a settle, a
   * rejection. A detach that forgot to resolve would leave a caller awaiting a
   * promise nothing will ever fulfil.
   */
  const detachWith = (result: DeduplicatedResult<T>): boolean => {
    if (settled) {
      return false;
    }
    settled = true;
    signal?.removeEventListener('abort', onAbort);
    attempt.subscribers -= 1;
    // Deregister from the waiters set, so a force-cancel iterating that set
    // cannot detach this consumer a second time.
    attempt.waiters.delete(cancel);
    if (attempt.subscribers === 0 && !attempt.settled) {
      // The LAST consumer left while the call is still running. Nobody can
      // consume this answer, so abort the provider call rather than leaving it
      // running unobserved. A SETTLED attempt is not aborted: its work is done,
      // and flipping its signal afterwards would misreport a completed call as
      // cancelled to anything still holding the signal.
      attempt.abort();
    }
    if (attempts.get(key) === attempt) {
      attempts.delete(key);
    }
    resolveOutcome(result);
    return true;
  };

  /**
   * The parameterless cancellation this consumer registers with the attempt, so
   * a force-cancel (`cancelAll`) can detach it through the same path a
   * subscriber's own abort takes.
   */
  const cancel = (): void => {
    detachWith({
      coalesced,
      failed: true,
      cancelled: true,
      subscriberCount: 0,
      // Carried through so a consumer can rethrow the caller's real reason
      // instead of a synthesised one that drops it.
      ...(signal?.reason === undefined ? {} : { cancelledReason: signal.reason }),
    });
  };

  attempt.waiters.add(cancel);

  function onAbort(): void {
    cancel();
  }

  if (signal) {
    if (signal.aborted) {
      onAbort();
      return { outcome, settled: () => settled, release: cancel };
    }
    signal.addEventListener('abort', onAbort, { once: true });
  }

  // Marked settled before any detach runs, so the "last consumer left" check
  // knows the call has already produced its answer.
  attempt.promise.then(
    (value) => {
      attempt.settled = true;
      detachWith({
        value,
        coalesced,
        failed: false,
        cancelled: false,
        subscriberCount: startCount,
      });
    },
    (error: unknown) => {
      attempt.settled = true;
      // The original error travels to every subscriber: a caller that needs to
      // tell a timeout from a cancellation from a refusal must see the error the
      // call actually produced, not a generic one invented here.
      detachWith({
        coalesced,
        failed: true,
        cancelled: false,
        subscriberCount: startCount,
        error,
      });
    },
  );

  return { outcome, settled: () => settled, release: cancel };
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Creates a reference-counted in-flight deduplicator.
 *
 * `maxEntries` bounds how many distinct attempts may be in flight at once. An
 * unbounded map would let a burst of distinct prompts grow it for the session's
 * lifetime; the bound keeps the memory cost predictable while leaving far more
 * headroom than real simultaneous duplicates need.
 */
export const createStructuredRequestDeduplicator = (options?: {
  maxEntries?: number;
  debug?: (label: string, detail: Record<string, unknown>) => void;
}): StructuredRequestDeduplicator => {
  const attempts = new Map<string, SharedAttempt<unknown>>();
  const maxEntries = Math.max(1, options?.maxEntries ?? 64);
  const debug = options?.debug;
  let coalesced = 0;

  return {
    get inFlightCount(): number {
      return attempts.size;
    },

    get coalescedCount(): number {
      return coalesced;
    },

    async run<T>(input: {
      key: StructuredRequestKey;
      signal?: AbortSignal;
      run: (signal: AbortSignal) => Promise<T>;
    }): Promise<DeduplicatedResult<T>> {
      const { key, signal, run } = input;

      // A pre-cancelled consumer never starts work. Attaching it to a live
      // attempt would inflate that attempt's subscriber count with someone who
      // is already gone.
      if (signal?.aborted === true) {
        return { coalesced: false, failed: true, cancelled: true, subscriberCount: 0 };
      }

      const cacheKey = structuredRequestKey(key);
      const existing = attempts.get(cacheKey) as SharedAttempt<T> | undefined;

      if (existing !== undefined) {
        coalesced += 1;
        const subscription = subscribeToAttempt({
          attempt: existing,
          key: cacheKey,
          attempts,
          ...(signal === undefined ? {} : { signal }),
          coalesced: true,
        });
        return await subscription.outcome;
      }

      // A full map is not an error: the new request simply is not coalescable,
      // because evicting a LIVE attempt would abort a call somebody is waiting
      // on. Bounded memory is enforced by dropping the entry on settle, which is
      // where the map already returns to its resting size.
      if (attempts.size >= maxEntries) {
        debug?.('dedup:at-capacity', { inFlight: attempts.size, maxEntries });
      }

      const controller = new AbortController();
      const waiters = new Set<() => void>();
      const attempt: SharedAttempt<T> = {
        subscribers: 0,
        settled: false,
        waiters,
        abort: () => controller.abort(),
        // Detaching every waiter resolves each of them as cancelled, so a
        // force-cancelled attempt cannot strand a caller on a promise that
        // nothing will ever fulfil.
        detachAll: () => {
          for (const detach of [...waiters]) {
            detach();
          }
        },
        // The attempt's signal, so the shared call's lifetime is owned by the
        // attempt rather than by whichever consumer happened to start it.
        promise: run(controller.signal),
      };
      // The attempt's own promise is always observed by its subscribers; the
      // catch here only exists so a rejection can never surface as an unhandled
      // rejection in the window before the first subscriber attaches.
      attempt.promise.catch(() => undefined);

      if (attempts.size < maxEntries) {
        attempts.set(cacheKey, attempt as SharedAttempt<unknown>);
      }

      const subscription = subscribeToAttempt({
        attempt,
        key: cacheKey,
        attempts,
        ...(signal === undefined ? {} : { signal }),
        coalesced: false,
      });
      return await subscription.outcome;
    },

    cancelAll(): void {
      // Detach first, then abort: detaching is what resolves the waiting
      // consumers, and doing it in this order means a consumer is never left
      // awaiting an aborted attempt.
      for (const attempt of [...attempts.values()]) {
        attempt.detachAll();
        attempt.abort();
      }
      attempts.clear();
    },

    reset(): void {
      coalesced = 0;
    },
    ...(debug === undefined ? {} : { debug }),
  };
};
