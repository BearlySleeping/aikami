// apps/frontend/client/src/lib/services/ai/text_request_admission.ts
//
// Priority-aware admission for expensive text inference (issue #382).
//
// THE PROBLEM THIS SOLVES, AS MEASURED
//
// #416 remeasured the real `MAP_LOADED` burst after #415 fixed the envelope
// extraction, on the production path (Ollama 0.34.3, `ornith-1.5:9b` Q4_K_M,
// RTX 4090 Laptop GPU, model fully resident, warm machine):
//
//   background width | dialogue TTFT median
//                 0 |  4 796 ms
//                 1 | 21 449 ms
//                 2 | 37 094 ms
//                 4 | 62 811 ms   (4 of 12 turns failed outright)
//
// 11/12 width-1 samples were slower than the slowest control. Browser frame
// cadence held at ~16.7 ms with zero long tasks in all 48 samples, so this was
// never a rendering problem: it was inference-resource contention. A generic
// concurrency cap cannot fix it, because width 1 is ALREADY harmful.
//
// WHAT ADMISSION IS, AND WHAT IT IS NOT
//
// This is ADMISSION, not PREEMPTION. Aborting an HTTP request does not
// reclaim GPU compute — Ollama keeps generating for an aborted client. So the
// only thing that reliably protects the foreground is never STARTING background
// work while player-visible work is imminent. That is what this does, and the
// residual case (a background request already running when dialogue arrives) is
// a real limitation that admission cannot remove; it is characterised in
// `docs/audits/382-admission-control-report.md` rather than papered over.
//
// THE RACE THAT FORCES DEFERRED ADMISSION
//
// The obvious rule — "queue background while interactive is active" — is not
// sufficient, because the production sequence is:
//
//   MAP_LOADED → background summarization STARTS → dialogue begins
//
// If background were admitted synchronously on arrival, the GPU work would
// already be running when the player opened their mouth, and the measured
// width-1 failure would reproduce exactly. So background never dispatches
// synchronously: it waits out a QUIET WINDOW during which the contention domain
// must stay free of interactive work. A new interactive arrival inside that
// window resets it.
//
// THE POLICY, PRECISELY
//
//   1. Interactive is admitted IMMEDIATELY and is never gated. Admission adds
//      no latency to the foreground — it only declines to start background work
//      under it.
//   2. Background never dispatches synchronously; it always waits out the quiet
//      window (see `quietWindowMs`).
//   3. At most ONE background inference at a time per contention domain.
//   4. Within a priority class, strict FIFO. No LIFO, no randomness, no
//      agent-specific tiers.
//   5. Queued background work stays cancellable, and an expired deadline drops
//      it WITHOUT reaching local inference, the gateway or the provider.
//   6. Running background work is NEVER aborted because interactive work
//      arrived. That is the preemption this module explicitly does not fake.
//   7. Fairness: once interactive activity stops and the domain stays quiet for
//      the window, queued background work DRAINS. Nothing is dropped. Continuous
//      foreground activity may postpone it indefinitely — that tradeoff is
//      deliberate, documented in the report, and NOT papered over with a
//      max-age escape hatch that would reintroduce the foreground contention
//      this module exists to prevent.
//
// THE CONTENTION DOMAIN — AND ITS LIMITS
//
// Scheduling is scoped to the resource that actually contends, not to all AI
// globally. The key is `provider + endpoint ORIGIN`; see
// {@link textContentionDomain}. Model is deliberately NOT part of it: two
// models served by one Ollama endpoint share one GPU, which is the measured
// failure mode. Conversely two providers on different origins are never merged,
// so an independent device is not serialized behind an unrelated one.
//
// This is a heuristic about physical devices, and the boundary it draws is
// stated rather than assumed: same origin ⇒ assumed same process ⇒ assumed
// same compute; different origin ⇒ assumed independent. Two DIFFERENT provider
// ids on the SAME origin are NOT merged, because a provider id names a
// configured route and two routes on one host may be separate daemons.
//
// Contract: issue #382, "Add bounded concurrency and priority queues per
// provider/local device. Interactive work gets precedence".

import { type TextTask, textTaskPriority } from '@aikami/constants';
import type { AiModeResolution } from '@aikami/types';

// ---------------------------------------------------------------------------
// Contention domain
// ---------------------------------------------------------------------------

/**
 * Reduces an endpoint URL to its ORIGIN — scheme, host and port.
 *
 * Path and query are dropped on purpose. `/api/chat` and
 * `/v1/chat/completions` on the same host are two request shapes into ONE
 * server process, and one server process owns one set of accelerators. Treating
 * them as different domains would let a background request on one surface and
 * an interactive request on the other run concurrently against the same GPU —
 * which is precisely the collision #416 measured.
 *
 * The port is KEPT: two Ollama daemons on one host on different ports are two
 * devices with two pools, and serializing them would be the "unnecessarily
 * serialized independent domains" failure.
 */
const endpointOrigin = (endpoint: string | undefined): string => {
  const trimmed = (endpoint ?? '').trim();
  if (trimmed.length === 0) {
    // No HTTP surface: the route is the in-process/on-device pool, which names
    // itself through its provider id and has no origin to add.
    return 'in-process';
  }
  try {
    const url = new URL(trimmed);
    return `${url.protocol}//${url.host}`;
  } catch {
    // An endpoint that is not a URL is still a stable identity string; using it
    // verbatim is better than collapsing it into everyone else's key.
    return trimmed.replace(/\/+$/, '').toLowerCase();
  }
};

/**
 * The contention domain key for a resolved text route.
 *
 * The SMALLEST stable key derived from the effective routing that still names
 * the contended resource. Content-free: a provider id and an origin, never a
 * prompt, a model or any player data.
 */
const textContentionDomain = (resolution: AiModeResolution): string => {
  const provider = resolution.provider.trim().toLowerCase();
  return `${provider.length > 0 ? provider : 'unknown'}|${endpointOrigin(resolution.endpoint)}`;
};

// ---------------------------------------------------------------------------
// Lease
// ---------------------------------------------------------------------------

/**
 * Proof that a request was admitted to expensive inference.
 *
 * Holding a lease is what makes a request VISIBLE to the gate, and it is
 * released in a `finally`, so a provider throw, a parse failure or a
 * cancellation all release it by construction rather than by remembering to.
 */
export type TextAdmissionLease = {
  /** The domain this request was admitted into. */
  readonly domain: string;
  /** Milliseconds spent waiting for admission; `0` when admitted immediately. */
  readonly queueMs: number;
  /** Requests ahead of this one when it joined the queue. */
  readonly queueDepth: number;
  /** Releases the slot. Idempotent. */
  release(): void;
};

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

/** Content-free counters, for diagnostics and for the #382 measurement. */
export type TextAdmissionStats = {
  /** Interactive requests currently admitted and running. */
  readonly interactiveActive: number;
  /** Background requests currently admitted and running (at most 1 per domain). */
  readonly backgroundActive: number;
  /** Background requests waiting for admission right now. */
  readonly backgroundQueued: number;
  /** Deepest background queue observed in any domain. */
  readonly peakQueueDepth: number;
  /** Most interactive requests ever simultaneously active in one domain. */
  readonly peakInteractiveActive: number;
  /** Background requests admitted to the provider since construction. */
  readonly backgroundAdmitted: number;
  /** Interactive requests admitted since construction. */
  readonly interactiveAdmitted: number;
  /** Background requests dropped from the queue without dispatch. */
  readonly backgroundDropped: number;
  /** Contention domains currently tracked. */
  readonly domains: number;
};

/**
 * The clock and timer the gate runs on.
 *
 * Injected rather than reached for directly so the quiet window can be tested
 * DETERMINISTICALLY: `advance(999)` then assert nothing was admitted, without
 * sleeping and without a flake. Production uses the default, which is the
 * platform clock.
 */
export type TextAdmissionClock = {
  /** Schedules `callback` after `ms`. Returns an opaque handle. */
  setTimer(callback: () => void, ms: number): unknown;
  /** Cancels a handle from {@link setTimer}. Must tolerate an unknown one. */
  clearTimer(handle: unknown): void;
  /** Monotonic milliseconds, used only to measure queue wait. */
  now(): number;
};

const systemClock: TextAdmissionClock = {
  setTimer: (callback, ms) => setTimeout(callback, ms),
  clearTimer: (handle) => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
  now: () => performance.now(),
};

export type TextRequestAdmission = {
  /**
   * Reserves the right to run expensive inference in `domain`.
   *
   * Interactive resolves immediately. Background may wait out the quiet
   * window; the returned promise resolves when it is admitted, and rejects
   * without dispatching anything if `signal` aborts first.
   */
  acquire(options: {
    domain: string;
    priority: 'interactive' | 'background';
    /** Caller + deadline signal; an abort while queued drops the request. */
    signal: AbortSignal;
  }): Promise<TextAdmissionLease>;
  /** Rejects every queued request, clears timers and drops all domain state. */
  cancelAll(): void;
  /** Content-free counters. */
  readonly stats: TextAdmissionStats;
  /** The quiet window, in ms. Exposed so tests can assert the policy. */
  readonly quietWindowMs: number;
};

/** How a request left the admission queue. */
export type QueueExit = {
  /** Milliseconds spent in the queue, admitted or not. */
  readonly queueMs: number;
  /** Requests ahead of it on entry. */
  readonly queueDepth: number;
  /** Whether it reached the provider, as opposed to being dropped. */
  readonly admitted: boolean;
};

/** One request waiting for admission. */
type QueuedRequest = {
  readonly domain: string;
  readonly signal: AbortSignal;
  readonly queuedAt: number;
  /** Requests ahead of this one when it joined. */
  readonly queueDepth: number;
  readonly admit: (lease: TextAdmissionLease) => void;
  readonly reject: (reason: unknown) => void;
};

/** Per-domain state. */
type DomainState = {
  interactiveActive: number;
  backgroundActive: number;
  /** Strict FIFO. Index 0 is next. */
  queue: QueuedRequest[];
  /** Armed while the domain is waiting out the quiet window. */
  graceTimer: unknown;
  /** Whether that handle is still live, so `clearTimer` runs only once. */
  graceArmed: boolean;
};

// ---------------------------------------------------------------------------
// Quiet window
// ---------------------------------------------------------------------------

/**
 * How long a contention domain must stay free of interactive work before
 * background inference may start.
 *
 * WHY A WINDOW AND NOT "NOT WHILE INTERACTIVE IS ACTIVE"
 *
 * The defect is a RACE, not an overlap. At `MAP_LOADED` nothing interactive is
 * running yet, so an "is interactive active?" test admits the burst
 * synchronously and the collision still happens. The window is what converts
 * that instantaneous check into a statement about the near future.
 *
 * WHY NOT A GAME-EVENT FLAG
 *
 * A `MAP_LOADED`/dialogue flag would be a tighter signal than a timer, but it
 * puts map/turn knowledge inside the AI service and still misses every other
 * interactive onset (combat, persona creation, a panel that mounts). A quiet
 * window is driven by inference activity itself, so it covers every consumer
 * without naming one of them.
 *
 * THE VALUE IS MEASURED, NOT PICKED
 *
 * It has to exceed the observed gap between the background burst being
 * dispatched and the player's first interactive call in the production
 * scenario, or it would not have prevented the measured collision. It must not
 * be so long that idle background refresh is starved. Both bounds are
 * measured in `docs/audits/382-admission-control-report.md`; this constant is
 * the value those measurements selected.
 */
const DEFAULT_QUIET_WINDOW_MS = 1_500;

/**
 * The abort thrown at a queued request that was dropped rather than run.
 *
 * A dropped request never reached the provider, so it must not surface as a
 * provider failure or as a success with an empty result. It carries the
 * caller's own reason when there is one.
 */
const queuedAbortError = (reason: unknown): Error => {
  if (reason instanceof Error && reason.name === 'AbortError') {
    return reason;
  }
  // Always an AbortError even when the caller cancelled with an arbitrary
  // reason: the caller's error handling distinguishes "the user cancelled"
  // from "the provider failed" by name, and a dropped request is the former.
  // Dropping the original reason would lose the caller's own error, so it is
  // carried as the cause.
  const error = new Error('Request dropped before admission to inference');
  error.name = 'AbortError';
  if (reason !== undefined) {
    (error as { cause?: unknown }).cause = reason;
  }
  return error;
};

/** Creates the admission gate. */
const createTextRequestAdmission = (options?: {
  /**
   * The quiet window, or a function returning it.
   *
   * A FUNCTION is read on every arm rather than once at construction, so the
   * value can be swept without rebuilding the gate. That is what lets the #382
   * harness compare candidate windows in one run, and lets a unit test drive the
   * timer without caring when the module happened to be imported.
   */
  quietWindowMs?: number | (() => number);
  clock?: TextAdmissionClock;
}): TextRequestAdmission => {
  const resolveQuietWindow = (): number => {
    const value =
      typeof options?.quietWindowMs === 'function'
        ? options.quietWindowMs()
        : options?.quietWindowMs;
    const resolved = value ?? DEFAULT_QUIET_WINDOW_MS;
    return Number.isFinite(resolved) ? Math.max(0, resolved) : DEFAULT_QUIET_WINDOW_MS;
  };
  const clock = options?.clock ?? systemClock;
  const now = clock.now;
  const domains = new Map<string, DomainState>();

  const stats = {
    interactiveActive: 0,
    backgroundActive: 0,
    backgroundQueued: 0,
    peakQueueDepth: 0,
    peakInteractiveActive: 0,
    backgroundAdmitted: 0,
    interactiveAdmitted: 0,
    backgroundDropped: 0,
    domains: 0,
  };

  const stateFor = (domain: string): DomainState => {
    const existing = domains.get(domain);
    if (existing !== undefined) {
      return existing;
    }
    const created: DomainState = {
      interactiveActive: 0,
      backgroundActive: 0,
      queue: [],
      graceTimer: undefined,
      graceArmed: false,
    };
    domains.set(domain, created);
    return created;
  };

  const clearGrace = (state: DomainState): void => {
    if (!state.graceArmed) {
      return;
    }
    clock.clearTimer(state.graceTimer);
    state.graceArmed = false;
    state.graceTimer = undefined;
  };

  const recountTotals = (): void => {
    let interactive = 0;
    let background = 0;
    let queued = 0;
    for (const state of domains.values()) {
      interactive += state.interactiveActive;
      background += state.backgroundActive;
      queued += state.queue.length;
    }
    stats.interactiveActive = interactive;
    stats.backgroundActive = background;
    stats.backgroundQueued = queued;
    stats.domains = domains.size;
  };

  /**
   * Admits the head of the queue, but only if the domain is genuinely quiet.
   *
   * Reached only when the quiet window has elapsed, so the quiet check here is
   * a guard against a window that fired into a foreground request rather than
   * the primary policy.
   */
  const admitIfQuiet = (domain: string, state: DomainState): void => {
    clearGrace(state);
    if (state.queue.length === 0 || state.interactiveActive > 0 || state.backgroundActive > 0) {
      return;
    }
    const next = state.queue.shift();
    if (next === undefined) {
      return;
    }
    // Claim the domain's single background slot. Without this the "at most one
    // background inference per domain" rule is not enforced at all, and the
    // next request would arm another window while this one is still running —
    // which is precisely the 4-way burst #416 measured.
    state.backgroundActive = 1;
    stats.backgroundAdmitted += 1;
    recountTotals();
    next.admit(buildLease(domain, 'background', next.queuedAt, next.queueDepth));
  };

  /**
   * Arms the quiet window, unless something is already running or already
   * armed.
   *
   * 🔴 THE ONE RULE THAT CLOSES THE MEASURED RACE: a background request NEVER
   * reaches {@link admitIfQuiet} directly. Its only path in is through this
   * timer. Admitting on arrival — even behind an "is interactive active?" test
   * — is what lets a `MAP_LOADED` burst start on the GPU microseconds before
   * the player opens a conversation, which is exactly the width-1 failure
   * #416 measured.
   *
   * The window is also re-armed after every settle rather than reused, so
   * "quiet" means `quietWindowMs` since the last interactive activity ended,
   * not "quietWindowMs since something happened to be enqueued".
   */
  const armGrace = (domain: string, state: DomainState): void => {
    if (state.graceArmed || state.queue.length === 0) {
      return;
    }
    if (state.interactiveActive > 0 || state.backgroundActive > 0) {
      return;
    }
    state.graceArmed = true;
    state.graceTimer = clock.setTimer(() => {
      state.graceArmed = false;
      state.graceTimer = undefined;
      admitIfQuiet(domain, state);
      // Either something is now running (nothing more to admit this instant) or
      // more is queued behind it; whichever, the next window is armed by the
      // release that follows.
      armGrace(domain, state);
    }, resolveQuietWindow());
  };

  const buildLease = (
    domain: string,
    priority: 'interactive' | 'background',
    queuedAt: number,
    queueDepth: number,
  ): TextAdmissionLease => {
    const state = stateFor(domain);
    let released = false;
    return {
      domain,
      queueMs: Math.max(0, Math.round(now() - queuedAt)),
      queueDepth,
      release(): void {
        if (released) {
          return;
        }
        released = true;
        if (priority === 'interactive') {
          state.interactiveActive = Math.max(0, state.interactiveActive - 1);
        } else {
          state.backgroundActive = Math.max(0, state.backgroundActive - 1);
        }
        recountTotals();
        // Both outcomes re-open the domain, so both must re-evaluate the queue.
        armGrace(domain, state);
        // 🔴 RECLAIM THE DOMAIN once nothing is left in it. Without this the
        // map is keyed by user-controlled provider/endpoint strings and grows
        // for the lifetime of the session, while `recountTotals` — which runs
        // on every acquire and every release — scans all of it. A user who edits
        // connections, or an agent that uses custom endpoints, pays that scan
        // forever.
        //
        // Safe because every outstanding claim on a domain is counted: active
        // leases in `interactiveActive`/`backgroundActive`, waiters in `queue`,
        // and an armed window in `graceArmed`. All four at zero means nothing
        // holds this state. A lease from an already-replaced generation keeps
        // its own reference to the ORPHANED object, so it cannot decrement a
        // replacement's counters.
        if (
          state.interactiveActive === 0 &&
          state.backgroundActive === 0 &&
          state.queue.length === 0 &&
          !state.graceArmed &&
          domains.get(domain) === state
        ) {
          domains.delete(domain);
        }
      },
    };
  };

  /**
   * Detaches a queued request without dispatching it.
   *
   * Used by every drop path — caller abort, deadline expiry, `cancelAll` — so
   * a request that never ran is never counted as having run, and is never left
   * in the queue holding a slot.
   */
  const dropQueued = (domain: string, request: QueuedRequest, reason: unknown): void => {
    const state = domains.get(domain);
    if (state === undefined) {
      return;
    }
    const index = state.queue.indexOf(request);
    if (index === -1) {
      return;
    }
    state.queue.splice(index, 1);
    stats.backgroundDropped += 1;
    recountTotals();
    request.reject(queuedAbortError(reason));
    if (state.queue.length === 0) {
      clearGrace(state);
      if (state.interactiveActive === 0 && state.backgroundActive === 0) {
        // Nothing running and nothing waiting: the domain has no state worth
        // keeping, and leaving it would leak an entry per domain per session.
        domains.delete(domain);
      }
      return;
    }
    armGrace(domain, state);
  };

  return {
    get quietWindowMs(): number {
      return resolveQuietWindow();
    },

    get stats(): TextAdmissionStats {
      recountTotals();
      return { ...stats };
    },

    async acquire(input: {
      domain: string;
      priority: 'interactive' | 'background';
      signal: AbortSignal;
      onExit?: (observation: QueueExit) => void;
    }): Promise<TextAdmissionLease> {
      const { domain, priority, signal } = input;
      const state = stateFor(domain);

      // A pre-aborted caller never joins a queue: attaching it would inflate
      // the queue depth every other request reports and let it occupy a slot
      // nobody is waiting on.
      if (signal.aborted) {
        throw queuedAbortError(signal.reason);
      }

      if (priority === 'interactive') {
        // Interactive is NEVER queued and NEVER gated. It is admitted on the
        // spot, and its arrival RESETS any pending background admission, which
        // is the half of the policy that closes the MAP_LOADED race.
        clearGrace(state);
        state.interactiveActive += 1;
        stats.interactiveAdmitted += 1;
        stats.peakInteractiveActive = Math.max(
          stats.peakInteractiveActive,
          state.interactiveActive,
        );
        recountTotals();
        // Reported like any other queue exit, with a MEASURED zero. Interactive
        // work is admitted immediately, so `queueMs: 0` is a fact about this
        // call — not an absence of one — and it is what makes `queueMs > 0`
        // mean something.
        input.onExit?.({ queueMs: 0, queueDepth: 0, admitted: true });
        return buildLease(domain, 'interactive', now(), 0);
      }

      // Background. Requests AHEAD of this one: the one running, plus the ones
      // already waiting. Snapshot on entry, never re-sampled — a depth that
      // drifted as the queue drained would describe a moment that never was.
      const ahead = state.backgroundActive + state.queue.length;
      stats.peakQueueDepth = Math.max(stats.peakQueueDepth, ahead);
      const queuedAt = now();

      return await new Promise<TextAdmissionLease>((resolve, reject) => {
        let settled = false;
        // `request` and `onAbort` are mutually referential (the abort handler
        // needs the request; the request's settle paths need to detach the
        // handler), so one is declared first and assigned immediately. Both are
        // only READ after assignment.
        let request: QueuedRequest;
        const forget = (): void => signal.removeEventListener('abort', onAbort);
        const onAbort = (): void => dropQueued(domain, request, signal.reason);
        /**
         * Reports how the request LEFT the queue, on EITHER path.
         *
         * Both exits report, because a request that waited eight seconds in a
         * queue and was then cancelled still waited eight seconds. Recording
         * only the admitted path would make every cancelled-while-queued call
         * report no queue time at all, which reads as "it never queued" rather
         * than "it queued and was dropped".
         */
        const exitWith = (admitted: boolean): boolean => {
          if (settled) {
            return false;
          }
          settled = true;
          forget();
          input.onExit?.({
            queueMs: Math.max(0, Math.round(now() - queuedAt)),
            queueDepth: ahead,
            admitted,
          });
          return true;
        };
        request = {
          domain,
          signal,
          queuedAt,
          queueDepth: ahead,
          // `exitWith` owns the one-shot guard, so the queue report and the
          // promise settlement can never disagree about which happened first.
          admit: (lease) => {
            if (exitWith(true)) {
              resolve(lease);
            }
          },
          reject: (reason) => {
            if (exitWith(false)) {
              reject(reason);
            }
          },
        };
        signal.addEventListener('abort', onAbort, { once: true });
        state.queue.push(request);
        recountTotals();
        // NOT `admitIfQuiet`: a background request always waits out the window,
        // even into a completely idle domain. See `armGrace`.
        armGrace(domain, state);
      });
    },

    cancelAll(): void {
      for (const [domain, state] of [...domains.entries()]) {
        clearGrace(state);
        const queued = [...state.queue];
        state.queue = [];
        for (const request of queued) {
          stats.backgroundDropped += 1;
          // Rejecting is what stops a caller awaiting a promise nothing will
          // fulfil, and what guarantees no dispatch can happen after this.
          request.reject(queuedAbortError(undefined));
        }
        // State is dropped wholesale rather than zeroed. A lease still running
        // from this generation holds a reference to the ORPHANED state, so its
        // eventual release cannot decrement a fresh domain's counters into a
        // negative value.
        domains.delete(domain);
      }
      recountTotals();
    },
  };
};

// ---------------------------------------------------------------------------
// Service-facing facade
// ---------------------------------------------------------------------------

/**
 * Reads an override for the admission quiet window, in ms.
 *
 * 🔴 TEST/MEASUREMENT SEAM ONLY. There is deliberately no user-facing setting
 * for this: #382 measures the window on real hardware and picks one internal
 * value, and a knob nobody can choose well would invite configurations the
 * measurements never covered. It exists so a unit test can drive the timer
 * deterministically instead of sleeping, and so the #382 harness can sweep
 * candidate values in one run without a rebuild.
 *
 * Unset in production, where the module default applies.
 */
const quietWindowOverride = (): number | undefined => {
  const override = (globalThis as Record<string, unknown>).__text_admission_quiet_window_ms;
  return typeof override === 'number' && Number.isFinite(override) ? override : undefined;
};

/** The gate as `TextGenerationService` uses it. */
export type ServiceInferenceAdmission = {
  /**
   * Reserves the contended resource for one call.
   *
   * `onQueueExit` fires when this call LEAVES the queue — admitted or dropped,
   * not only the first. A coalesced subscriber never enters the gate, so it
   * reports nothing rather than reporting someone else's wait.
   */
  acquire(input: {
    routing: AiModeResolution;
    task?: TextTask;
    signal: AbortSignal;
    onQueueExit?: (observation: QueueExit) => void;
  }): Promise<TextAdmissionLease>;
  /** Content-free counters. */
  readonly stats: TextAdmissionStats;
  /** Rejects queued work and clears timers. */
  cancelAll(): void;
};

/**
 * The admission gate the text service holds, with the diagnostics publication
 * that belongs beside it.
 *
 * Kept as one object rather than three collaborators because publishing the
 * counters is not separable from the gate: the interesting state for a
 * background request is being QUEUED, and a snapshot taken anywhere else would
 * always miss it.
 */
export const createServiceInferenceAdmission = (options?: {
  /**
   * The clock the gate runs on. Injectable so the quiet window can be tested
   * deterministically — see {@link TextAdmissionClock}.
   */
  clock?: TextAdmissionClock;
}): ServiceInferenceAdmission => {
  const gate = createTextRequestAdmission({
    quietWindowMs: () => quietWindowOverride() ?? DEFAULT_QUIET_WINDOW_MS,
    ...(options?.clock === undefined ? {} : { clock: options.clock }),
  });

  /**
   * Content-free counters for the #382 measurement harness.
   *
   * Deliberately SEPARATE from `__text_service_active_stream_count`. That
   * counter counts logical requests the service is managing, and a request
   * WAITING for admission is not provider-in-flight — merging the two would
   * let a queued request look like running work and hide the effect being
   * measured.
   */
  const publish = (): void => {
    (globalThis as Record<string, unknown>).__text_service_admission_stats = { ...gate.stats };
  };

  return {
    get stats(): TextAdmissionStats {
      return gate.stats;
    },
    cancelAll(): void {
      gate.cancelAll();
      publish();
    },
    async acquire(input: {
      routing: AiModeResolution;
      task?: TextTask;
      signal: AbortSignal;
      onQueueExit?: (observation: QueueExit) => void;
    }): Promise<TextAdmissionLease> {
      const pending = gate.acquire({
        domain: textContentionDomain(input.routing),
        priority: textTaskPriority(input.task),
        signal: input.signal,
        ...(input.onQueueExit === undefined ? {} : { onExit: input.onQueueExit }),
      });
      // Published BEFORE awaiting, because the state worth measuring for a
      // background request is being QUEUED — and that happens synchronously
      // inside `acquire`. Publishing only after admission would leave the
      // measurement blind for exactly the window this slice is about.
      publish();
      const lease = await pending;
      publish();
      // Release republishes too. A lease is held for the WHOLE call, so without
      // this the published counters would keep showing it as active after the
      // call settled — and a domain that looks permanently busy is
      // indistinguishable, from the outside, from one being starved.
      return {
        ...lease,
        release(): void {
          lease.release();
          publish();
        },
      };
    },
  };
};
