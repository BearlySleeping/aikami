// apps/frontend/client/src/lib/views/combat/combat_ai_controller.svelte.ts
//
// Client side of the LLM AI turn (Combat-06, AC-5).
//
// The engine never blocks on a model: it DEFERS an AI actor's turn, emits
// `COMBAT_AI_DECISION_REQUESTED`, and falls back deterministically if no answer
// arrives. This controller provides the answer:
//
//   - PREFETCH: after every committed action (`COMBAT_EVENTS_RESOLVED`) it asks
//     the engine for the live kernel state and plans the next AI actors'
//     decisions ahead of their turns, caching them by `(combatantId, revision)`.
//   - SERVE: when the engine asks, a decision whose revision still matches is
//     submitted immediately — the turn costs no model latency at all.
//   - FETCH-OR-FALLBACK: a cache miss starts a fresh, deadline-bounded call. If
//     it does not resolve in time the controller submits `null`, which the
//     engine reads as "use `chooseV2AiCommand`" — combat never stalls.
//   - DISCARD: a cached decision for a different revision is never submitted
//     (the engine would reject it as `stale` anyway), and a cancelled or
//     superseded request is dropped.
//
// The controller authors nothing mechanical: it passes selectors from the
// service to the engine, which compiles and re-validates every step.
//
// Contract: C-526 AC-3, AC-5, AC-9

import type { EngineBridge } from '@aikami/frontend/engine';
import { buildCombatDecisionContext } from '@aikami/frontend/engine';
import type {
  AiCombatDecision,
  CombatAiDecisionRequest,
  CombatAiDecisionResult,
  CombatState,
} from '@aikami/types';
import { logger } from '$logger';

/** How long the client waits for a decision before submitting the fallback. */
const DEFAULT_RESPONSE_DEADLINE_MS = 2000;

/** How long a kernel-state snapshot request may take. */
const DEFAULT_SNAPSHOT_DEADLINE_MS = 1000;

/** Maximum number of AI actors prefetched from one committed action. */
const DEFAULT_MAX_PREFETCH_ACTORS = 3;

export type CombatAiControllerCapabilities = {
  /**
   * The combat engine bridge (commands out, events in), or `undefined` before
   * the ViewModel's `initialize()` has created it.
   *
   * A getter, not the bridge itself: the bridge is created asynchronously, so
   * the controller resolves it when it needs it (after `attach()`).
   */
  bridge: () => EngineBridge | undefined;
  /** Pinned `PUBLIC_COMBAT_LLM_AGENTS` value for this encounter (AC-9). */
  readonly enabled: boolean;
  /** One decision for one actor. Never throws; degrades to a typed failure. */
  decide(request: CombatAiDecisionRequest): Promise<CombatAiDecisionResult>;
  /** One batched call for a squad (AC-5). */
  decideBatch(requests: readonly CombatAiDecisionRequest[]): Promise<CombatAiDecisionResult[]>;
  /** Cancels one outstanding decision by id. */
  cancel(decisionId: string): void;
  /** Cancels every outstanding decision. */
  cancelAll(): void;
  /** The authored player combatant id — never AI-controlled. */
  readonly playerCombatantId: string;
};

export type CombatAiControllerOptions = CombatAiControllerCapabilities & {
  /** Response deadline before the deterministic fallback; default 2 s. */
  responseDeadlineMs?: number;
  /** Snapshot deadline; default 1 s. */
  snapshotDeadlineMs?: number;
  /** Prefetch AI decisions after each committed action; default true. */
  prefetch?: boolean;
  /** Maximum AI actors prefetched per action; default 3. */
  maxPrefetchActors?: number;
};

export type CombatAiControllerInterface = {
  /** Subscribes to the bridge; returns the disposer. */
  attach(): () => void;
  /** Cancels every outstanding decision and clears the cache. */
  reset(): void;
};

type PendingSnapshot = {
  resolve: (state: CombatState | null) => void;
  timer: ReturnType<typeof setTimeout>;
};

/** Builds the client AI turn controller for one combat ViewModel. */
export const createCombatAiController = (
  options: CombatAiControllerOptions,
): CombatAiControllerInterface => {
  const responseDeadlineMs = options.responseDeadlineMs ?? DEFAULT_RESPONSE_DEADLINE_MS;
  const snapshotDeadlineMs = options.snapshotDeadlineMs ?? DEFAULT_SNAPSHOT_DEADLINE_MS;
  const maxPrefetchActors = options.maxPrefetchActors ?? DEFAULT_MAX_PREFETCH_ACTORS;
  const prefetchEnabled = options.prefetch ?? true;
  const bridge = (): EngineBridge | undefined => options.bridge();

  /** Prefetched decisions, keyed `combatantId:revision` (AC-5). */
  const cache = new Map<string, AiCombatDecision>();
  /** Requests currently being planned, so the same actor is never planned twice. */
  const inFlight = new Set<string>();
  const pendingSnapshots = new Map<string, PendingSnapshot>();
  let counter = 0;
  let encounterId = 'encounter';
  let currentState: CombatState | undefined;

  const cacheKey = (combatantId: string, stateRevision: number): string =>
    `${combatantId}:${stateRevision}`;

  const nextId = (prefix: string): string => {
    counter += 1;
    return `${prefix}:${encounterId}:${counter}`;
  };

  // ── Kernel state round-trip ──────────────────────────────────────────────

  const requestSnapshot = (): Promise<CombatState | null> => {
    const requestId = nextId('ai-snapshot');
    return new Promise<CombatState | null>((resolve) => {
      const timer = setTimeout(() => {
        pendingSnapshots.delete(requestId);
        resolve(null);
      }, snapshotDeadlineMs);
      pendingSnapshots.set(requestId, { resolve, timer });
      const active = bridge();
      if (active === undefined) {
        return;
      }
      active.send({ type: 'COMBAT_STATE_SNAPSHOT_REQUESTED', requestId, encounterId });
    });
  };

  const resolveSnapshot = (requestId: string, state: CombatState | null): void => {
    const entry = pendingSnapshots.get(requestId);
    if (entry === undefined) {
      return;
    }
    clearTimeout(entry.timer);
    pendingSnapshots.delete(requestId);
    entry.resolve(state);
  };

  // ── Planning ────────────────────────────────────────────────────────────

  const planActor = async (options_: {
    combatantId: string;
    decisionId: string;
    state: CombatState;
  }): Promise<CombatAiDecisionResult | undefined> => {
    const { combatantId, decisionId, state } = options_;
    const context = buildCombatDecisionContext({
      state,
      combatantId,
    });
    if (context === undefined) {
      return undefined;
    }
    return await options.decide({
      decisionId,
      encounterId: state.encounterId,
      actorId: combatantId,
      basedOnRevision: state.stateRevision,
      context,
    });
  };

  const submit = (options_: {
    requestId: string;
    encounterId: string;
    combatantId: string;
    stateRevision: number;
    decision: AiCombatDecision | null;
  }): void => {
    const active = bridge();
    if (active === undefined) {
      return;
    }
    active.send({
      type: 'COMBAT_AI_DECISION_SUBMITTED',
      requestId: options_.requestId,
      encounterId: options_.encounterId,
      combatantId: options_.combatantId,
      stateRevision: options_.stateRevision,
      decision: options_.decision,
    });
  };

  /** Answers the engine's request from the cache, or with a bounded call. */
  const serveRequest = (event: {
    requestId: string;
    encounterId: string;
    combatantId: string;
    stateRevision: number;
  }): void => {
    encounterId = event.encounterId;

    if (!options.enabled) {
      // The engine only asks when the layer is pinned on, but an explicit
      // `null` keeps the fallback path unambiguous if that ever changes.
      submit({ ...event, decision: null });
      return;
    }

    const cached = cache.get(cacheKey(event.combatantId, event.stateRevision));
    if (cached !== undefined) {
      logger.debug('[combat_ai_controller] serving prefetched decision', {
        combatantId: event.combatantId,
        stateRevision: event.stateRevision,
      });
      submit({ ...event, decision: cached });
      return;
    }

    // A miss: plan now, but never keep the engine waiting past the deadline.
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      options.cancel(event.requestId);
      logger.info('[combat_ai_controller] response deadline — submitting fallback', {
        combatantId: event.combatantId,
      });
      submit({ ...event, decision: null });
    }, responseDeadlineMs);

    void (async () => {
      const state = currentState ?? (await requestSnapshot());
      if (state === undefined || state === null) {
        return;
      }
      currentState = state;
      const result = await planActor({
        combatantId: event.combatantId,
        decisionId: event.requestId,
        state,
      });
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      const decision = result?.ok === true ? result.decision : null;
      submit({ ...event, decision });
    })();
  };

  /** Plans the next AI actors ahead of their turns (AC-5 prefetch). */
  const prefetch = (): void => {
    if (!options.enabled || !prefetchEnabled) {
      return;
    }
    void (async () => {
      const state = await requestSnapshot();
      if (state === null || state.phase === 'ended') {
        return;
      }
      currentState = state;
      const actors = state.initiative.order
        .filter((combatantId) => combatantId !== options.playerCombatantId)
        .map((combatantId) => state.combatants[combatantId])
        .filter((combatant) => combatant !== undefined && !combatant.defeated)
        .slice(0, maxPrefetchActors);
      if (actors.length === 0) {
        return;
      }
      // Skip actors already planned or planned for this revision, so a burst of
      // resolved events cannot queue duplicate model calls.
      const pendingActors = actors.filter(
        (actor) =>
          actor !== undefined &&
          !cache.has(cacheKey(actor.combatantId, state.stateRevision)) &&
          !inFlight.has(cacheKey(actor.combatantId, state.stateRevision)),
      );
      if (pendingActors.length === 0) {
        return;
      }
      for (const actor of pendingActors) {
        if (actor !== undefined) {
          inFlight.add(cacheKey(actor.combatantId, state.stateRevision));
        }
      }
      const requests: CombatAiDecisionRequest[] = [];
      for (const actor of pendingActors) {
        if (actor === undefined) {
          continue;
        }
        const context = buildCombatDecisionContext({
          state,
          combatantId: actor.combatantId,
        });
        if (context === undefined) {
          continue;
        }
        requests.push({
          decisionId: nextId(`ai-prefetch:${actor.combatantId}`),
          encounterId: state.encounterId,
          actorId: actor.combatantId,
          basedOnRevision: state.stateRevision,
          context,
        });
      }
      if (requests.length === 0) {
        return;
      }
      const results = await options.decideBatch(requests);
      for (const [index, request] of requests.entries()) {
        inFlight.delete(cacheKey(request.actorId, request.basedOnRevision));
        const result = results[index];
        if (result?.ok === true) {
          cache.set(cacheKey(request.actorId, request.basedOnRevision), result.decision);
        }
      }
      logger.debug('[combat_ai_controller] prefetch complete', {
        planned: requests.length,
        cached: cache.size,
      });
    })();
  };

  const reset = (): void => {
    for (const entry of pendingSnapshots.values()) {
      clearTimeout(entry.timer);
      entry.resolve(null);
    }
    pendingSnapshots.clear();
    inFlight.clear();
    cache.clear();
    currentState = undefined;
    options.cancelAll();
  };

  const attach = (): (() => void) => {
    const disposers: Array<() => void> = [];
    const active = bridge();
    if (active === undefined) {
      // The bridge does not exist yet — nothing to subscribe to. The ViewModel
      // attaches after `initialize()`, so this is defensive only.
      return () => {};
    }
    disposers.push(
      active.on('COMBAT_AI_DECISION_REQUESTED', (event) => {
        serveRequest(event);
      }),
    );
    disposers.push(
      active.on('COMBAT_STATE_SNAPSHOT', (event) => {
        resolveSnapshot(event.requestId, event.state);
      }),
    );
    disposers.push(
      active.on('COMBAT_STATE_SNAPSHOT_REJECTED', (event) => {
        resolveSnapshot(event.requestId, null);
      }),
    );
    disposers.push(
      active.on('COMBAT_EVENTS_RESOLVED', () => {
        prefetch();
      }),
    );
    disposers.push(
      active.on('COMBAT_STARTED', (event) => {
        encounterId = event.encounterId ?? 'encounter';
        reset();
      }),
    );
    return () => {
      for (const dispose of disposers) {
        dispose();
      }
      reset();
    };
  };

  return { attach, reset };
};
