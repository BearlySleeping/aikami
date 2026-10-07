// apps/frontend/client/src/lib/services/npc/npc_memory_lifecycle.ts
//
// Generation-scoped background work for per-NPC conversational memory.
//
// THE DEFECT THIS PREVENTS
//
// `npc_memory_service.svelte.ts` used a bare promise chain per NPC. Four
// consequences, all observed in today's code:
//
//   - Work QUEUED for a superseded conversation, a torn-down campaign or a
//     reset still ran, and still paid a provider call for an answer nobody could
//     use.
//   - A prefetch marker (`_prefetching`) was deleted in a `finally` keyed only
//     by NPC id, so an OLD attempt's cleanup removed a NEWER attempt's marker
//     and unblocked a duplicate; and the set was never cleared by
//     `reset()`/`hydrate()`, so after a reset those NPCs could not prefetch at
//     all.
//   - A deferred opener was stamped `generatedAt: Date.now()` on COMPLETION, so
//     an opener generated against world state that had since changed read as
//     fresh for another full `NPC_MEMORY_OPENER_MAX_AGE_MS`.
//   - Nothing bounded pending work. A burst of `MAP_LOADED` events queued a
//     refresh per remembered NPC with no global ceiling.
//
// THE MODEL
//
// A GENERATION. `reset`, `hydrate`, a campaign switch and `dispose` each bump
// it. Every enqueued task carries the generation it was queued under and checks
// it BEFORE it dispatches, so obsolete queued work makes zero provider calls —
// not "a call whose answer is thrown away".
//
// A TICKET. Bookkeeping is keyed by ticket rather than by NPC id, so one task's
// cleanup can never remove another's state. That is the "old `finally` must not
// remove a new generation's marker" property, enforced by construction instead
// of by remembering to compare first.
//
// TWO KINDS, TWO POLICIES — and the asymmetry is the point:
//
//   - `refresh` (opener regeneration) is REPLACEABLE. A newer refresh for the
//     same NPC supersedes an older one, and the pending set is bounded. Latest
//     -only is correct here: an opener is a greeting, not a fact.
//   - `digest` is NOT replaceable. It carries the conversation's durable notes
//     and promises, and dropping one loses player content permanently. Digests
//     are therefore never dropped for being late; they are serialised per NPC
//     and supersession is handled by the caller carrying unsummarized lines
//     forward, not by discarding them.
//
// NO CLOCK IS IMPORTED. `now` is injected, so the timing behaviour is testable
// at minutes of virtual time without a single real sleep.
//
// WHAT IS NOT CLAIMED
//
// Aborting a request here aborts the HTTP exchange and the local admission
// queue entry. It does NOT stop provider-side compute: an in-flight generation
// may keep running on a remote provider, and this module makes no claim that it
// does.
//
// Contract: issue #382

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** What kind of background work this is. The two have OPPOSITE drop policies. */
export type NpcBackgroundKind = 'digest' | 'refresh';

/**
 * The honest terminal state of one unit of background work.
 *
 * Every branch is a distinct outcome on purpose. Reporting a superseded or
 * cancelled refresh as "applied", or as nothing at all, is how discarded work
 * turns into an invisible success in the telemetry.
 */
export type NpcBackgroundOutcome =
  /** Accepted and queued. */
  | 'requested'
  /** Dropped before dispatch because its generation had moved on. */
  | 'superseded-before-dispatch'
  /** Dropped because the bounded pending set was full (refresh only). */
  | 'overloaded'
  /** Its own generation was invalidated while it was running. */
  | 'cancelled'
  /** The call returned, but the world moved on before it could be applied. */
  | 'invalidated-after-completion'
  /** Applied to the record. */
  | 'applied'
  /** The provider call failed; deterministic memory is untouched. */
  | 'failed';

/** One lifecycle transition, for the diagnostic recorder. */
export type NpcBackgroundEvent = {
  npcId: string;
  kind: NpcBackgroundKind;
  outcome: NpcBackgroundOutcome;
  /** Milliseconds from enqueue to this outcome, by the injected clock. */
  ageMs: number;
};

/** The lifecycle's diagnostic snapshot. Content-free: ids, counts, ages. */
export type NpcMemoryLifecycleResult = {
  generation: number;
  requested: number;
  supersededBeforeDispatch: number;
  overloaded: number;
  cancelled: number;
  invalidatedAfterCompletion: number;
  applied: number;
  failed: number;
  /** Units queued or running right now. */
  pending: number;
  /** The largest `pending` ever observed. */
  pendingHighWaterMark: number;
  /** Age of the oldest still-pending unit, by the injected clock. */
  oldestPendingAgeMs: number;
};

/** What a running task is handed. */
export type NpcBackgroundContext = {
  /** The generation this task was queued under. */
  generation: number;
  /** Aborted when this generation is invalidated. */
  signal: AbortSignal;
  /**
   * True once this task's generation is no longer current.
   *
   * Called BEFORE dispatch and again at apply time. The second check is the one
   * that matters: a task that already paid for its call must still be refused
   * when the record it was going to write is gone.
   */
  isStale: () => boolean;
};

export type NpcMemoryLifecycle = {
  /**
   * Queues one unit of work behind any work already queued for the same NPC.
   *
   * The returned promise settles when THIS unit has run or been dropped, so a
   * test (or a caller awaiting `recordConversation`) can wait for its own unit
   * without waiting for the whole chain.
   */
  enqueue(options: {
    npcId: string;
    kind: NpcBackgroundKind;
    run: (context: NpcBackgroundContext) => Promise<NpcBackgroundOutcome>;
  }): Promise<void>;
  /**
   * Invalidates the current generation: queued work is dropped before dispatch
   * and running work is signalled.
   *
   * Bookkeeping for the OLD generation is released here; nothing belonging to a
   * newer generation can be removed by this call, because a newer generation
   * does not exist until this one is bumped again.
   */
  invalidate(): void;
  /** Whether `generation` is still current. */
  isCurrent(generation: number): boolean;
  /** Resolves once every currently queued unit has settled. */
  drain(): Promise<void>;
  /** The diagnostic snapshot. */
  snapshot(): NpcMemoryLifecycleResult;
  /**
   * Zeroes the counters and clears recorded events, without disturbing pending
   * work or the generation.
   *
   * Used by the save-registry `reset`, so a new game starts from a clean
   * diagnostic baseline rather than reporting the previous campaign's discards.
   */
  resetDiagnostics(): void;
  /** Diagnostic events, most recent last. */
  events(): readonly NpcBackgroundEvent[];
  /** Clears recorded events. Counters and pending work are untouched. */
  clearEvents(): void;
};

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/**
 * Ceiling on REFRESH work pending at any moment, across all NPCs.
 *
 * Bounded rather than unbounded because the trigger is a map load, and a map
 * load repeats. Measured limits do not exist for this path — the existing
 * policy (`NPC_MEMORY_MAP_PREFETCH_LIMIT` per load, a per-NPC cooldown) is what
 * this reuses and extends globally. A refresh is replaceable, so exceeding the
 * ceiling costs a greeting that will be regenerated on the next proximity, and
 * never costs a fact.
 */
const DEFAULT_MAX_PENDING_REFRESHES = 8;

/** Ceiling on events retained for diagnostics. Bounded: it is a debug surface. */
const DEFAULT_MAX_EVENTS = 256;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export const createNpcMemoryLifecycle = (options?: {
  now?: () => number;
  maxPendingRefreshes?: number;
  maxEvents?: number;
  onEvent?: (event: NpcBackgroundEvent) => void;
  /**
   * A unit released its bookkeeping — its `pending` slot is free again.
   *
   * Separate from {@link onEvent} because `onEvent` fires BEFORE the release:
   * without this hook a consumer that republishes on every event would keep
   * reporting a non-zero `pending` forever, and "nothing is left running" would
   * be unobservable from outside.
   */
  onSettled?: () => void;
  /**
   * A unit threw something its own body did not handle.
   *
   * Injected rather than logged here so this module stays a pure, dependency-
   * free primitive and the service keeps its one logger.
   */
  onError?: (detail: { npcId: string; kind: NpcBackgroundKind; error: unknown }) => void;
}): NpcMemoryLifecycle => {
  const now = options?.now ?? (() => Date.now());
  const maxPendingRefreshes = Math.max(
    1,
    options?.maxPendingRefreshes ?? DEFAULT_MAX_PENDING_REFRESHES,
  );
  const maxEvents = Math.max(1, options?.maxEvents ?? DEFAULT_MAX_EVENTS);

  let generation = 0;
  let ticketSeq = 0;
  let pending = 0;
  let pendingRefreshes = 0;
  let pendingHighWaterMark = 0;
  /** Enqueue time per TICKET, never per NPC — see the ticket note in the header. */
  const enqueuedAt = new Map<number, number>();
  /** Per-NPC serial chains, keyed by NPC id. */
  const chains = new Map<string, Promise<void>>();
  /** The controller for each running unit, keyed by ticket. */
  const running = new Map<number, AbortController>();
  const recorded: NpcBackgroundEvent[] = [];

  const counters = {
    requested: 0,
    supersededBeforeDispatch: 0,
    overloaded: 0,
    cancelled: 0,
    invalidatedAfterCompletion: 0,
    applied: 0,
    failed: 0,
  };

  const record = (
    npcId: string,
    kind: NpcBackgroundKind,
    outcome: NpcBackgroundOutcome,
    enqueueAt: number,
    at: number,
  ): void => {
    switch (outcome) {
      case 'superseded-before-dispatch':
        counters.supersededBeforeDispatch += 1;
        break;
      case 'overloaded':
        counters.overloaded += 1;
        break;
      case 'cancelled':
        counters.cancelled += 1;
        break;
      case 'invalidated-after-completion':
        counters.invalidatedAfterCompletion += 1;
        break;
      case 'applied':
        counters.applied += 1;
        break;
      case 'failed':
        counters.failed += 1;
        break;
      case 'requested':
        break;
    }
    const event: NpcBackgroundEvent = { npcId, kind, outcome, ageMs: Math.max(0, at - enqueueAt) };
    recorded.push(event);
    if (recorded.length > maxEvents) {
      recorded.shift();
    }
    options?.onEvent?.(event);
  };

  /** Detaches a unit's own bookkeeping. Never touches another unit's. */
  const release = (
    npcId: string,
    kind: NpcBackgroundKind,
    ticket: number,
    chain: Promise<void>,
  ): void => {
    pending = Math.max(0, pending - 1);
    if (kind === 'refresh') {
      pendingRefreshes = Math.max(0, pendingRefreshes - 1);
    }
    enqueuedAt.delete(ticket);
    running.delete(ticket);
    // Identity-compared: an older chain settling must not delete the newer
    // chain that has already replaced it in the map.
    if (chains.get(npcId) === chain) {
      chains.delete(npcId);
    }
    options?.onSettled?.();
  };

  return {
    enqueue({ npcId, kind, run }): Promise<void> {
      const myGeneration = generation;
      ticketSeq += 1;
      const ticket = ticketSeq;
      const at = now();

      if (kind === 'refresh' && pendingRefreshes >= maxPendingRefreshes) {
        // Replaceable work, dropped with an explicit outcome rather than
        // queued behind an unbounded backlog.
        record(npcId, kind, 'overloaded', at, at);
        return Promise.resolve();
      }

      // The unit is PENDING from the moment it is accepted, so the counter and
      // the high-water mark move BEFORE the `requested` event is recorded.
      // Publishing first would make every freshly-accepted unit report
      // `pending: 0`, and "nothing is left running" would be indistinguishable
      // from "nothing has started".
      pending += 1;
      if (kind === 'refresh') {
        pendingRefreshes += 1;
      }
      pendingHighWaterMark = Math.max(pendingHighWaterMark, pending);
      enqueuedAt.set(ticket, at);
      counters.requested += 1;
      record(npcId, kind, 'requested', at, at);

      const controller = new AbortController();
      let chain: Promise<void>;
      const task = async (): Promise<void> => {
        if (myGeneration !== generation) {
          // Zero provider calls: the check happens BEFORE `run` is invoked, so
          // an obsolete unit never reaches the transport at all.
          record(npcId, kind, 'superseded-before-dispatch', at, now());
          return;
        }
        running.set(ticket, controller);
        if (controller.signal.aborted) {
          record(npcId, kind, 'cancelled', at, now());
          return;
        }
        const context: NpcBackgroundContext = {
          generation: myGeneration,
          signal: controller.signal,
          isStale: () => myGeneration !== generation || controller.signal.aborted,
        };
        try {
          const outcome = await run(context);
          record(npcId, kind, outcome, at, now());
        } catch (error: unknown) {
          // The unit owns its own failure reporting; the chain must not break.
          record(npcId, kind, 'failed', at, now());
          options?.onError?.({ npcId, kind, error });
        }
      };

      const previous = chains.get(npcId) ?? Promise.resolve();
      chain = previous.then(task).catch(() => undefined);
      chains.set(npcId, chain);
      const settled = chain.finally(() => {
        release(npcId, kind, ticket, chain);
      });
      return settled;
    },

    invalidate(): void {
      generation += 1;
      // Signal every RUNNING unit of the generation being retired. Queued units
      // are dropped by the pre-dispatch generation check instead, so they are
      // not signalled here — signalling them would report them as `cancelled`
      // when the truthful outcome is `superseded-before-dispatch`.
      for (const controller of running.values()) {
        controller.abort();
      }
    },

    isCurrent(candidate: number): boolean {
      return candidate === generation;
    },

    async drain(): Promise<void> {
      // Loops: a unit can enqueue a successor, so one pass is not enough.
      for (let i = 0; i < 1000; i += 1) {
        if (pending === 0) {
          return;
        }
        await Promise.allSettled([...chains.values()]);
      }
    },

    snapshot(): NpcMemoryLifecycleResult {
      let oldest = 0;
      if (pending > 0) {
        // MIN, not max: the oldest pending unit is the one whose age matters.
        oldest = Math.min(...enqueuedAt.values());
      }
      return {
        generation,
        ...counters,
        pending,
        pendingHighWaterMark,
        oldestPendingAgeMs: pending > 0 ? Math.max(0, now() - oldest) : 0,
      };
    },

    events(): readonly NpcBackgroundEvent[] {
      return recorded;
    },
    resetDiagnostics(): void {
      counters.requested = 0;
      counters.supersededBeforeDispatch = 0;
      counters.overloaded = 0;
      counters.cancelled = 0;
      counters.invalidatedAfterCompletion = 0;
      counters.applied = 0;
      counters.failed = 0;
      pendingHighWaterMark = pending;
      recorded.length = 0;
    },

    clearEvents(): void {
      recorded.length = 0;
    },
  };
};
