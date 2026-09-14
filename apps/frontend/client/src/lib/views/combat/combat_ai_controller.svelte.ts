// apps/frontend/client/src/lib/views/combat/combat_ai_controller.svelte.ts
//
// Client side of the LLM AI turn (Combat-06, AC-5).
//
// The engine never blocks on a model: it DEFERS an AI actor's turn, emits
// `COMBAT_AI_DECISION_REQUESTED`, and falls back deterministically if no answer
// arrives. This controller provides the answer:
//
//   - PREFETCH: after every committed action (`COMBAT_EVENTS_RESOLVED`) it asks
//     the engine for the live kernel state and plans the UPCOMING AI actors'
//     decisions ahead of their turns.
//   - SQUAD-SAFE BATCHING: one provider call carries only actors from the same
//     knowledge group (same team, sampled from the live initiative position
//     forward). A companion's private observations must never ride in the same
//     prompt as an enemy's, so mixed-team batching is refused by construction.
//   - SERVE: when the engine asks, a decision whose encounter run and revision
//     still match is submitted immediately — the turn costs no model latency.
//   - FETCH-OR-FALLBACK: a cache miss starts a fresh, deadline-bounded call. If
//     it does not resolve in time the controller submits `null`, which the
//     engine reads as "use `chooseV2AiCommand`" — combat never stalls.
//   - DISCARD: every cache key and every callback is bound to the encounter RUN
//     (authored id + runtime generation). An authored encounter id recurs on
//     retry and a revision repeats across runs, so neither alone is a valid
//     invalidation key; a late result from an old run can never be served or
//     written into the cache of a new one.
//   - TEARDOWN: encounter end, encounter start and disposal cancel outstanding
//     work, clear in-flight bookkeeping and drop cached decisions.
//
// The controller authors nothing mechanical: it passes selectors from the
// service to the engine, which compiles and re-validates every step.
//
// Contract: C-526 AC-3, AC-5, AC-9

import { BASIC_MELEE_ABILITY_ID } from '@aikami/constants';
import type { EngineBridge } from '@aikami/frontend/engine';
import {
  buildCombatDecisionContext,
  type CombatDecisionPolicy,
  chooseV2AiCommand,
} from '@aikami/frontend/engine';
import type {
  AiCombatDecision,
  CombatAiDecisionRequest,
  CombatAiDecisionResult,
  CombatCommand,
  CombatState,
  IntentStep,
} from '@aikami/types';
import {
  createBoundedResultCache,
  type EncounterRunIdentity,
} from '../../services/game/combat_ai_lifecycle';

/** How long the client waits for a decision before submitting the fallback. */
const DEFAULT_RESPONSE_DEADLINE_MS = 2000;

/** How long a kernel-state snapshot request may take. */
const DEFAULT_SNAPSHOT_DEADLINE_MS = 1000;

/** Maximum number of AI actors prefetched from one committed action. */
const DEFAULT_MAX_PREFETCH_ACTORS = 3;

/** Maximum prefetched decisions retained; oldest are evicted (bounded memory). */
const DEFAULT_PREFETCH_CACHE_ENTRIES = 24;

/**
 * A timer length that never fires in a fight.
 *
 * Used as the response deadline for an actor whose decision the PLAYER approves
 * (C-526 AC-6): the turn must wait for a human, so the only bounds are the
 * encounter ending, the turn moving on, or the mode changing. Kept as a real
 * timer (never `Infinity`) so Node's timer limits are respected.
 */
const NEVER_MS = 2_147_000_000;

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
  /**
   * The active encounter run, or `undefined` before the encounter started.
   *
   * Cache keys, snapshot reuse and late callbacks are all bound to this, so a
   * retry of the same authored encounter can never consume leftover work.
   */
  currentRun: () => EncounterRunIdentity | undefined;
  /**
   * Whether a produced decision for this actor must be approved by the player
   * (C-526 AC-6). `direct` companions never reach this layer.
   *
   * An approval-required actor has NO response deadline: player deliberation is
   * not an AI timeout, so the engine waits on the player instead of on a clock.
   */
  requiresApproval?: (combatantId: string) => boolean;
  /**
   * Hands a produced decision to the approval surface instead of committing it.
   *
   * The decision is NOT submitted here — the player approves, edits or declines
   * it, and only then does anything reach the engine.
   */
  deliverProposal?: (input: {
    requestId: string;
    combatantId: string;
    basedOnRevision: number;
    state: CombatState;
    steps: readonly IntentStep[];
    fallback?: readonly IntentStep[];
  }) => void;
  /**
   * The character policy for one actor (C-526 AC-8/AC-6).
   *
   * The ViewModel supplies the authored role/personality AND a companion's
   * standing goal, so the snapshot the model reads carries real character data
   * instead of neutral placeholders.
   */
  policyFor?: (combatantId: string) => CombatDecisionPolicy | undefined;
  /** The authored player combatant id — never AI-controlled. */
  readonly playerCombatantId: string;
  /** Owner-provided logging keeps this controller independent of global services. */
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
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
  resolve: (state: CombatState | undefined) => void;
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

  /** Prefetched decisions, keyed `<generation>:<combatantId>:<revision>` (AC-5). */
  const cache = createBoundedResultCache<string, AiCombatDecision>({
    maxEntries: DEFAULT_PREFETCH_CACHE_ENTRIES,
  });
  /** Cache keys currently being planned, so one actor is never planned twice. */
  const inFlight = new Set<string>();
  const pendingSnapshots = new Map<string, PendingSnapshot>();
  /** Set by `reset()` so an in-flight async chain abandons its work. */
  let disposed = false;
  let counter = 0;

  const runKey = (run: EncounterRunIdentity | undefined): string =>
    run === undefined ? 'no-run' : `${run.encounterId}#${run.generation}`;

  const cacheKey = (
    run: EncounterRunIdentity | undefined,
    combatantId: string,
    revision: number,
  ): string => `${runKey(run)}:${combatantId}:${revision}`;

  const nextId = (run: EncounterRunIdentity | undefined, prefix: string): string => {
    counter += 1;
    return `${prefix}:${runKey(run)}:${counter}`;
  };

  // ── Kernel state round-trip ──────────────────────────────────────────────

  const requestSnapshot = (): Promise<CombatState | undefined> => {
    const requestId = nextId(options.currentRun(), 'ai-snapshot');
    if (disposed) {
      return Promise.resolve(undefined);
    }
    return new Promise<CombatState | undefined>((resolve) => {
      const timer = setTimeout(() => {
        pendingSnapshots.delete(requestId);
        resolve(undefined);
      }, snapshotDeadlineMs);
      pendingSnapshots.set(requestId, { resolve, timer });
      const active = bridge();
      const run = options.currentRun();
      if (active === undefined || run === undefined) {
        return;
      }
      active.send({
        type: 'COMBAT_STATE_SNAPSHOT_REQUESTED',
        requestId,
        encounterId: run.encounterId,
      });
    });
  };

  const resolveSnapshot = (requestId: string, state: CombatState | undefined): void => {
    const entry = pendingSnapshots.get(requestId);
    if (entry === undefined) {
      return;
    }
    clearTimeout(entry.timer);
    pendingSnapshots.delete(requestId);
    entry.resolve(state);
  };

  // ── Planning ────────────────────────────────────────────────────────────

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
    const runAtRequest = options.currentRun();
    if (runAtRequest === undefined || runAtRequest.encounterId !== event.encounterId) {
      options.debug('[combat_ai_controller] request for an inactive encounter run — fallback', {
        encounterId: event.encounterId,
      });
      submit({ ...event, decision: null });
      return;
    }
    if (!options.enabled) {
      // The engine only asks when the layer is pinned on, but an explicit
      // `null` keeps the fallback path unambiguous if that ever changes.
      submit({ ...event, decision: null });
      return;
    }

    const cached = cache.get(cacheKey(runAtRequest, event.combatantId, event.stateRevision));
    if (cached !== undefined) {
      options.debug('[combat_ai_controller] serving prefetched decision', {
        combatantId: event.combatantId,
        stateRevision: event.stateRevision,
      });
      submit({ ...event, decision: cached });
      return;
    }

    // A miss: plan now. An actor whose decision the PLAYER approves has no
    // deadline at all — the wait is bounded by the encounter, not by a clock
    // (C-526 AC-6: deliberation is not an AI timeout).
    const needsApproval = options.requiresApproval?.(event.combatantId) === true;
    let settled = false;
    const finish = (decision: AiCombatDecision | null, state?: CombatState): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      // A run that changed while we waited must not answer for the old one.
      if (runKey(options.currentRun()) !== runKey(runAtRequest)) {
        return;
      }
      if (needsApproval) {
        if (state === undefined) {
          submit({ ...event, decision: null });
          return;
        }
        // C-526 AC-6: "the deterministic fallback must be able to propose a
        // Suggest-mode plan, otherwise AC-6/AC-10 are unverifiable without a
        // model". With no model reply the proposal is derived from the SAME
        // deterministic planner the engine falls back to, expressed as intent
        // steps so it is compiled and re-validated exactly like a model
        // decision — a proposal, never a commit.
        const steps =
          decision === null
            ? deterministicStepsFor({ state, combatantId: event.combatantId })
            : decision.intent;
        const fallback = decision === null ? [] : decision.fallback;
        options.deliverProposal?.({
          requestId: event.requestId,
          combatantId: event.combatantId,
          basedOnRevision: state.stateRevision,
          state,
          steps,
          fallback,
        });
        return;
      }
      submit({ ...event, decision });
    };
    const timer = setTimeout(
      () => {
        if (settled) {
          return;
        }
        options.cancel(event.requestId);
        options.info('[combat_ai_controller] response deadline — submitting fallback', {
          combatantId: event.combatantId,
        });
        finish(null);
      },
      needsApproval ? NEVER_MS : responseDeadlineMs,
    );

    void (async () => {
      try {
        const state = await resolveStateSnapshot({
          runAtRequest,
          event,
          readCurrentState,
          requestSnapshot,
        });
        if (state === undefined) {
          return;
        }
        if (runKey(options.currentRun()) !== runKey(runAtRequest)) {
          return;
        }
        const policy = options.policyFor?.(event.combatantId);
        const context = buildCombatDecisionContext({
          state,
          combatantId: event.combatantId,
          ...(policy === undefined ? {} : { policy }),
        });
        if (context === undefined) {
          return;
        }
        const result = await options.decide({
          decisionId: event.requestId,
          encounterId: state.encounterId,
          actorId: event.combatantId,
          basedOnRevision: state.stateRevision,
          context,
        });
        if (runKey(options.currentRun()) !== runKey(runAtRequest)) {
          return;
        }
        finish(result.ok ? result.decision : null, state);
      } catch (error: unknown) {
        options.info('[combat_ai_controller] plan failed', { error: String(error) });
        finish(null);
      }
    })();
  };

  /** Cached kernel state for the current run, or a fresh snapshot. */
  let currentState: CombatState | undefined;
  let currentStateRun = 'no-run';

  const readCurrentState = (event: {
    encounterId: string;
    stateRevision: number;
  }): CombatState | undefined => {
    if (currentState === undefined) {
      return undefined;
    }
    if (currentStateRun !== runKey(options.currentRun())) {
      return undefined;
    }
    if (currentState.encounterId !== event.encounterId) {
      return undefined;
    }
    return currentState.stateRevision === event.stateRevision ? currentState : undefined;
  };

  /**
   * Plans the next AI actors ahead of their turns (AC-5 prefetch).
   *
   * Only actors from ONE knowledge group (the team of the first upcoming AI
   * actor) are batched, so a companion's private observations can never reach
   * an enemy prompt.
   */
  const prefetch = (): void => {
    if (!options.enabled || !prefetchEnabled || disposed) {
      return;
    }
    const runAtPlan = options.currentRun();
    if (runAtPlan === undefined) {
      return;
    }
    void (async () => {
      const state = await requestSnapshot();
      if (state === undefined || state.phase === 'ended') {
        return;
      }
      if (runKey(options.currentRun()) !== runKey(runAtPlan)) {
        return;
      }
      currentState = state;
      currentStateRun = runKey(runAtPlan);

      const upcoming = upcomingAiActors({
        state,
        playerCombatantId: options.playerCombatantId,
        maxActors: maxPrefetchActors,
      });
      if (upcoming.length === 0) {
        return;
      }
      const requests: CombatAiDecisionRequest[] = [];
      const reserved: string[] = [];
      for (const actor of upcoming) {
        const key = cacheKey(runAtPlan, actor.combatantId, state.stateRevision);
        if (cache.has(key) || inFlight.has(key)) {
          continue;
        }
        inFlight.add(key);
        reserved.push(key);
        const actorPolicy = options.policyFor?.(actor.combatantId);
        const context = buildCombatDecisionContext({
          state,
          combatantId: actor.combatantId,
          ...(actorPolicy === undefined ? {} : { policy: actorPolicy }),
        });
        if (context === undefined) {
          continue;
        }
        requests.push({
          decisionId: nextId(runAtPlan, `ai-prefetch:${actor.combatantId}`),
          encounterId: state.encounterId,
          actorId: actor.combatantId,
          basedOnRevision: state.stateRevision,
          context,
        });
      }
      try {
        if (requests.length === 0) {
          return;
        }
        // One call for the squad; `decideBatch` falls back to a single call
        // when only one member survived context construction.
        const results = await options.decideBatch(requests);
        // A run that changed while the model worked must not populate the cache.
        if (runKey(options.currentRun()) !== runKey(runAtPlan)) {
          return;
        }
        for (const [index, request] of requests.entries()) {
          const result = results[index];
          if (result?.ok === true) {
            cache.set(
              cacheKey(runAtPlan, request.actorId, request.basedOnRevision),
              result.decision,
            );
          }
        }
        options.debug('[combat_ai_controller] prefetch complete', {
          planned: requests.length,
          cached: cache.size,
        });
      } finally {
        // Always release in-flight bookkeeping — including when context
        // construction failed, `decideBatch` rejected, or the run changed.
        for (const key of reserved) {
          inFlight.delete(key);
        }
      }
    })();
  };

  const reset = (): void => {
    disposed = true;
    for (const entry of pendingSnapshots.values()) {
      clearTimeout(entry.timer);
      entry.resolve(undefined);
    }
    pendingSnapshots.clear();
    inFlight.clear();
    cache.clear();
    currentState = undefined;
    currentStateRun = 'no-run';
    options.cancelAll();
    disposed = false;
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
        resolveSnapshot(event.requestId, undefined);
      }),
    );
    disposers.push(
      active.on('COMBAT_EVENTS_RESOLVED', () => {
        prefetch();
      }),
    );
    disposers.push(
      active.on('COMBAT_STARTED', () => {
        reset();
      }),
    );
    disposers.push(
      active.on('COMBAT_ENDED', () => {
        // An encounter that ended must not leave decisions in flight, and its
        // cached decisions must not be served to a later run.
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Turns the deterministic planner's next command into intent STEPS.
 *
 * The companion flow needs an intent, not a command: proposing a command would
 * bypass the compiler the player's own plans go through, and would make the
 * proposal a different kind of object from every other plan in the UI. The
 * mapping is deliberately selector-based, so the proposal is re-grounded against
 * the live state when the player approves it.
 */
const deterministicStepsFor = (options: {
  state: CombatState;
  combatantId: string;
}): IntentStep[] => {
  const command: CombatCommand = chooseV2AiCommand({
    state: options.state,
    combatantId: options.combatantId,
    abilityCatalog: options.state.abilityCatalog,
    basicAttackAbilityId: BASIC_MELEE_ABILITY_ID,
  });
  switch (command.kind) {
    case 'useAbility':
      return [
        {
          kind: 'use_ability',
          ability: { kind: 'tag', value: command.abilityId },
          target: { kind: 'nearest_hostile' },
        },
      ];
    case 'move':
      return [
        {
          kind: 'move',
          destination: {
            kind: 'relative',
            relativeTo: { kind: 'nearest_hostile' },
            band: 'melee',
          },
        },
      ];
    case 'defend':
      return [{ kind: 'defend' }];
    case 'wait':
      return [{ kind: 'wait' }];
    default:
      return [{ kind: 'end_turn' }];
  }
};

/**
 * Resolves the kernel snapshot for a request: the cached state when it still
 * matches the run and revision, otherwise a fresh bounded snapshot.
 */
const resolveStateSnapshot = async (options: {
  runAtRequest: EncounterRunIdentity;
  event: { encounterId: string; stateRevision: number };
  readCurrentState: (event: {
    encounterId: string;
    stateRevision: number;
  }) => CombatState | undefined;
  requestSnapshot: () => Promise<CombatState | undefined>;
}): Promise<CombatState | undefined> => {
  const cached = options.readCurrentState(options.event);
  const state = cached ?? (await options.requestSnapshot());
  if (state === undefined) {
    return undefined;
  }
  if (state.encounterId !== options.runAtRequest.encounterId) {
    return undefined;
  }
  if (state.encounterId !== options.event.encounterId) {
    return undefined;
  }
  return state.stateRevision === options.event.stateRevision ? state : undefined;
};

/**
 * The upcoming AI-controlled actors in initiative order, starting AFTER the
 * active position — never a fixed "first three non-player actors".
 *
 * Only the knowledge group of the first upcoming AI actor is returned, so a
 * batch never mixes companions with enemies (AC-5, AC-2).
 */
const upcomingAiActors = (options: {
  state: CombatState;
  playerCombatantId: string;
  maxActors: number;
}): Array<{ combatantId: string; team: string }> => {
  const { state } = options;
  const order = state.initiative.order;
  const found: Array<{ combatantId: string; team: string }> = [];
  for (let step = 1; step <= order.length && found.length < options.maxActors; step++) {
    const index = (state.initiative.activeIndex + step) % order.length;
    const combatantId = order[index];
    if (combatantId === undefined || combatantId === options.playerCombatantId) {
      continue;
    }
    const combatant = state.combatants[combatantId];
    if (combatant === undefined || combatant.defeated) {
      continue;
    }
    found.push({ combatantId, team: combatant.team });
  }
  const lead = found[0];
  if (lead === undefined) {
    return [];
  }
  return found.filter((actor) => actor.team === lead.team);
};

export type { EncounterRunIdentity };
