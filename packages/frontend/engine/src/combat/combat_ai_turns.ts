// packages/frontend/engine/src/combat/combat_ai_turns.ts
//
// LLM-aware AI turn coordinator (Combat-06).
//
// The deterministic runner (`combat_v2_ai.ts#runV2AiTurns`) resolves an AI turn
// synchronously and cannot wait for a model. This coordinator adds the async
// layer WITHOUT ever blocking the engine:
//
//   1. With the LLM layer pinned OFF it simply delegates to `runV2AiTurns`
//      (plus the kill-switch degradation report) — byte-for-byte the shipped
//      behaviour (AC-9).
//   2. With the LLM layer ON it DEFERS one AI actor's turn at a time: it emits
//      `COMBAT_AI_DECISION_REQUESTED` and returns immediately, arming a hard
//      deadline. The client answers with `COMBAT_AI_DECISION_SUBMITTED` — from
//      a decision it prefetched for this revision, a fresh call, or `null` for
//      "use the fallback".
//   3. If no answer arrives before the deadline, the actor's turn is resolved
//      deterministically and the chain continues — an encounter can never
//      stall on a client that is absent, slow or broken.
//
// A submission whose revision no longer matches the live state, or whose actor
// is no longer active, is discarded as `stale` (never applied to a different
// turn) — the prefetch discipline of AC-5.
//
// Contract: C-526 AC-4, AC-5, AC-7, AC-9

import type {
  CombatAbilityDefinition,
  CombatAiDecisionRecord,
  CombatAiDegradedReason,
  CombatEvent,
} from '@aikami/types';
import type { World } from 'bitecs';
import { logger } from '$logger';
import type { EngineBridge } from '../engine_bridge.ts';
import {
  type AiCombatDecisionOutcome,
  emitCombatAiOutcome,
  produceAiCombatDecision,
} from './combat_ai_decision.ts';
import type { CombatDecisionPolicy } from './combat_ai_perception.ts';
import type { CombatAiDecisionSubmittedCommand } from './combat_bridge_types.ts';
import { isPlayerControlled } from './combat_roster.ts';
import { getCombatIdentityRegistry } from './combat_state_adapter.ts';
import { getActiveTurn } from './combat_turn_driver.ts';
import { runV2AiTurns } from './combat_v2_ai.ts';
import { buildV2CombatState, commitV2KernelCommand } from './combat_v2_resolver.ts';

/** Default hard deadline for one client-supplied decision (architecture §18). */
const DEFAULT_HARD_DEADLINE_MS = 4000;

/** Outer guard mirroring `combat_v2_ai.ts` — a chain can never run forever. */
const COORDINATOR_TURN_GUARD = 64;

type PendingDecision = {
  requestId: string;
  encounterId: string;
  combatantId: string;
  stateRevision: number;
  /**
   * The hard-deadline timer — ABSENT for a companion awaiting player approval.
   *
   * A companion in Suggest/Intent/Autonomous mode commits nothing until the
   * player confirms (C-526 AC-6), and player deliberation is not an AI timeout.
   * Such a turn is bounded instead by the encounter ending, the turn moving on,
   * or the player switching the companion back to `direct` — never by a clock.
   */
  timer?: ReturnType<typeof setTimeout>;
};

export type CombatAiTurnCoordinatorOptions = {
  world: World;
  bridge: EngineBridge;
  abilityCatalog: Record<string, CombatAbilityDefinition>;
  playerEntityId: number;
  abilityIdsByCombatant?: Record<string, string[]>;
  basicAttackAbilityId?: string;
  /** The pinned `PUBLIC_COMBAT_LLM_AGENTS` value (AC-9). */
  llmAgentsEnabled: boolean;
  /** Character policy applied to every AI actor (AC-8). */
  policy?: CombatDecisionPolicy;
  /** Per-combatant policy overrides (AC-8). */
  policyByCombatant?: Record<string, CombatDecisionPolicy>;
  /** Resolved kernel events handed to the perception snapshot. */
  recentEvents?: readonly CombatEvent[];
  /** Hard deadline for a client decision; defaults to 4 s. */
  hardDeadlineMs?: number;
  /** Telemetry sink for each produced decision (AC-3). */
  onRecord?: (record: CombatAiDecisionRecord) => void;
  /** Degradation sink; defaults to the `COMBAT_AI_DEGRADED` bridge event. */
  onDegraded?: (event: { combatantId: string; reason: CombatAiDegradedReason }) => void;
};

export type CombatAiTurnCoordinator = {
  /** Resolves or defers AI turns until a player-owned turn or the encounter end. */
  run(): void;
  /**
   * Re-reads turn ownership after a control-mode change (C-526 AC-6).
   *
   * Withdraws a pending companion decision that the player now owns, then runs
   * the chain so a companion switched AWAY from `direct` takes its turn.
   */
  refresh(): void;
  /**
   * Handles one client submission.
   *
   * @returns `true` when the submission was accepted (or explicitly discarded
   * as stale), `false` when it matched no outstanding request.
   */
  submit(command: CombatAiDecisionSubmittedCommand): boolean;
  /** Clears every outstanding request (encounter ended / worker disposed). */
  cancelAll(): void;
  /** Number of decisions currently awaited from the client. */
  readonly pendingCount: number;
};

/**
 * Builds the coordinator for one encounter.
 *
 * The caller owns the lifetime: `cancelAll()` on encounter end/dispose.
 */
export const createCombatAiTurnCoordinator = (
  options: CombatAiTurnCoordinatorOptions,
): CombatAiTurnCoordinator => {
  const { world, bridge, abilityCatalog, playerEntityId } = options;
  const hardDeadlineMs = options.hardDeadlineMs ?? DEFAULT_HARD_DEADLINE_MS;
  const pending = new Map<string, PendingDecision>();
  /** Once-per-(actor, reason) de-duplication for degradation reporting (AC-7). */
  const degradedSeen = new Set<string>();
  /**
   * Generation token for the coordinator's lifetime (C-526 lifecycle repair).
   *
   * `cancelAll()` bumps this and clears the pending map; every asynchronous
   * activation captures the token it started under and abandons its work if the
   * coordinator was cancelled (or rebuilt for a retry) while it was in flight.
   * Without it a late model/activation completion from the previous encounter
   * could commit a command, end a turn, or emit narration into the new one.
   */
  let generation = 0;

  const project = () =>
    buildV2CombatState({
      world,
      abilityCatalog,
      ...(options.abilityIdsByCombatant === undefined
        ? {}
        : { abilityIdsByCombatant: options.abilityIdsByCombatant }),
    }) ?? undefined;

  const policyFor = (combatantId: string): CombatDecisionPolicy | undefined =>
    options.policyByCombatant?.[combatantId] ?? options.policy;

  const notifyDegraded = (combatantId: string, reason: CombatAiDegradedReason): void => {
    const key = `${combatantId}:${reason}`;
    if (degradedSeen.has(key)) {
      return;
    }
    degradedSeen.add(key);
    if (options.onDegraded !== undefined) {
      options.onDegraded({ combatantId, reason });
      return;
    }
    const state = project();
    bridge.emit({
      type: 'COMBAT_AI_DEGRADED',
      encounterId: state?.encounterId ?? 'unknown',
      actorId: combatantId,
      reason,
    });
  };

  const emitTelegraph = (options_: { combatantId: string; line: string }): void => {
    const state = project();
    bridge.emit({
      type: 'COMBAT_INTENT_TELEGRAPHED',
      encounterId: state?.encounterId ?? 'unknown',
      actorId: options_.combatantId,
      line: options_.line,
    });
  };

  /**
   * Resolves exactly one AI actor's turn with the deterministic planner.
   *
   * `llmAgentsEnabled: undefined` suppresses the kill-switch `'disabled'`
   * report — the reason for a fallback is reported by the caller instead.
   */
  const resolveActorDeterministically = (): void => {
    runV2AiTurns({
      world,
      bridge,
      abilityCatalog,
      playerEntityId,
      maxAiTurns: 1,
      ...(options.abilityIdsByCombatant === undefined
        ? {}
        : { abilityIdsByCombatant: options.abilityIdsByCombatant }),
      ...(options.basicAttackAbilityId === undefined
        ? {}
        : { basicAttackAbilityId: options.basicAttackAbilityId }),
      onDegraded: (event) => notifyDegraded(event.combatantId, event.reason),
      onTelegraph: emitTelegraph,
    });
  };

  /** The flag-off path: the deterministic planner owns every AI turn. */
  /**
   * Whether the encounter is suspended on an open reaction window.
   *
   * Read from the authoritative projection, never from a client flag: the
   * engine is the only authority on whether a window is pending.
   */
  const reactionIsPending = (): boolean => project()?.phase === 'reaction';

  const runDeterministicChain = (): void => {
    // Review F8: the deterministic chain must not run through a suspension
    // either. `runV2AiTurns` has its own guard; this keeps the coordinator's
    // single entry point honest about the same rule.
    if (reactionIsPending()) {
      return;
    }
    runV2AiTurns({
      world,
      bridge,
      abilityCatalog,
      playerEntityId,
      llmAgentsEnabled: false,
      ...(options.abilityIdsByCombatant === undefined
        ? {}
        : { abilityIdsByCombatant: options.abilityIdsByCombatant }),
      ...(options.basicAttackAbilityId === undefined
        ? {}
        : { basicAttackAbilityId: options.basicAttackAbilityId }),
      onDegraded: (event) => notifyDegraded(event.combatantId, event.reason),
      onTelegraph: emitTelegraph,
    });
  };

  /**
   * Ends the turn when `combatantId` still holds it (a move does not end it).
   *
   * Review F8: a pending reaction window suspends the turn, so forcing an
   * `endTurn` through it is a `reactionPending` rejection — never a state
   * change the player asked for.
   */
  const endTurnIfStillActive = (combatantId: string): void => {
    const active = getActiveTurn(world);
    if (active === null || active.combatantId !== combatantId) {
      return;
    }
    const state = project();
    if (state === undefined || state.phase === 'ended' || state.phase === 'reaction') {
      return;
    }
    commitV2KernelCommand({
      world,
      bridge,
      state,
      command: { kind: 'endTurn', combatantId },
    });
  };

  /** Whether `combatantId` is the active, living actor of a live encounter. */
  const stillActive = (combatantId: string): boolean => {
    const state = project();
    if (state === undefined || state.phase === 'ended' || state.phase === 'reaction') {
      return false;
    }
    const active = getActiveTurn(world);
    return active !== null && active.combatantId === combatantId;
  };

  /**
   * Handles a submission that carries no decision.
   *
   * The resolution is explicit (C-526 AC-6): a decline/end-turn spends nothing
   * and executes nothing, a stale plan asks for a fresh one instead of
   * authorising the fallback, and only `fallback` (or an absent resolution)
   * hands the turn to the deterministic planner.
   */
  const resolveWithoutDecision = (command: CombatAiDecisionSubmittedCommand): void => {
    const resolution = command.resolution;
    if (resolution === 'decline' || resolution === 'end_turn') {
      endTurnIfStillActive(command.combatantId);
      run();
      return;
    }
    if (resolution === 'stale') {
      // The plan no longer matches the live revision: do NOT act, just ask for
      // a decision grounded against the current state.
      run();
      return;
    }
    notifyDegraded(command.combatantId, 'offline');
    resolveActorDeterministically();
    run();
  };

  /** Activates the submitted decision through the step-wise pipeline. */
  const activateDecision = (submission: CombatAiDecisionSubmittedCommand): void => {
    const decision = submission.decision;
    if (decision === null) {
      resolveWithoutDecision(submission);
      return;
    }
    const started = generation;
    const state = project();
    void produceAiCombatDecision({
      world,
      bridge,
      abilityCatalog,
      combatantId: submission.combatantId,
      playerEntityId,
      llmEnabled: true,
      decisionId: submission.requestId,
      requireRevision: submission.stateRevision,
      ...(options.abilityIdsByCombatant === undefined
        ? {}
        : { abilityIdsByCombatant: options.abilityIdsByCombatant }),
      ...(options.basicAttackAbilityId === undefined
        ? {}
        : { basicAttackAbilityId: options.basicAttackAbilityId }),
      ...(policyFor(submission.combatantId) === undefined
        ? {}
        : { policy: policyFor(submission.combatantId) }),
      ...(options.recentEvents === undefined ? {} : { recentEvents: options.recentEvents }),
      decide: async () => ({ ok: true, decision, latencyMs: 0 }),
      isCancelled: () => generation !== started,
      onDegraded: (event) => notifyDegraded(event.actorId, event.reason),
      ...(options.onRecord === undefined ? {} : { onRecord: options.onRecord }),
    })
      .then((outcome: AiCombatDecisionOutcome) => {
        // A retry/teardown replaced this coordinator while the step was
        // activating: its result must not touch the new encounter.
        if (generation !== started) {
          return;
        }
        emitCombatAiOutcome({
          bridge,
          encounterId: state?.encounterId ?? 'unknown',
          actorId: submission.combatantId,
          outcome,
          onDegraded: (event) => notifyDegraded(event.actorId, event.reason),
        });
        const current = project();
        // The turn stays open only after a cleanly committed step-wise submission
        // whose actor still owns a live turn (a move does not end it; an attack may).
        const continues =
          submission.stepwise === true &&
          outcome.commands.length > 0 &&
          !outcome.partial &&
          stillActive(submission.combatantId);
        bridge.emit({
          type: 'COMBAT_AI_STEP_RESOLVED',
          requestId: submission.requestId,
          encounterId: current?.encounterId ?? state?.encounterId ?? 'unknown',
          actorId: submission.combatantId,
          revision: current?.stateRevision ?? submission.stateRevision,
          committed: outcome.commands.length > 0,
          stepsExecuted: outcome.stepsExecuted,
          partial: outcome.partial,
          continues,
          ...(outcome.degradedReason === undefined
            ? {}
            : { degradedReason: outcome.degradedReason }),
        });
        if (continues) {
          // Re-request the next step at the new revision. The actor keeps its
          // remaining turn budget; the client presents the next step for
          // approval before anything else commits.
          run();
          return;
        }
        endTurnIfStillActive(submission.combatantId);
        run();
      })
      .catch((error: unknown) => {
        if (generation !== started) {
          return;
        }
        logger.error('[combat_ai_turns] decision activation failed', {
          combatantId: submission.combatantId,
          error: error instanceof Error ? error.message : String(error),
        });
        notifyDegraded(submission.combatantId, 'invalid');
        resolveActorDeterministically();
        run();
      });
  };

  /**
   * Whether this combatant's decision waits for the PLAYER rather than a clock.
   *
   * A recruited companion always confirms its plan in this release (C-526 AC-6
   * / C-525 Q1: no auto-commit rule), so its turn has no model deadline: the
   * player may deliberate for as long as they like, and `cancelAll()` plus the
   * turn-ownership checks keep the wait bounded by the encounter, not by time.
   */
  const awaitsPlayerApproval = (combatantId: string): boolean => {
    // `deferToClient` is only reached for a NON-player-controlled actor, so an
    // ally here is a recruited companion whose plan the player confirms.
    return allyCombatantIds().has(combatantId);
  };

  /** Combatant ids of the recruited allies in this encounter. */
  const allyCombatantIds = (): Set<string> => {
    const state = project();
    const allies = new Set<string>();
    if (state === undefined) {
      return allies;
    }
    for (const combatant of Object.values(state.combatants)) {
      if (combatant.team === 'ally') {
        allies.add(combatant.combatantId);
      }
    }
    return allies;
  };

  /** Arms the deadline and asks the client for a decision. */
  const deferToClient = (request: {
    requestId: string;
    encounterId: string;
    combatantId: string;
    stateRevision: number;
  }): void => {
    const waitsForPlayer = awaitsPlayerApproval(request.combatantId);
    const timer = waitsForPlayer
      ? undefined
      : setTimeout(() => {
          pending.delete(request.requestId);
          logger.info('[combat_ai_turns] decision deadline expired', {
            combatantId: request.combatantId,
          });
          notifyDegraded(request.combatantId, 'timeout');
          resolveActorDeterministically();
          run();
        }, hardDeadlineMs);
    pending.set(request.requestId, {
      ...request,
      ...(timer === undefined ? {} : { timer }),
    });
    bridge.emit({
      type: 'COMBAT_AI_DECISION_REQUESTED',
      requestId: request.requestId,
      encounterId: request.encounterId,
      combatantId: request.combatantId,
      stateRevision: request.stateRevision,
    });
  };

  const run = (): void => {
    // Review F8: a reaction window OWNS the encounter until it resolves. No AI
    // scheduling may run while one is pending — the kernel would refuse every
    // command with `reactionPending`, and this coordinator would surface those
    // refusals to the player as spurious command errors. The engine-owned
    // reaction policy resolves the window; normal continuation resumes after.
    if (reactionIsPending()) {
      return;
    }
    if (!options.llmAgentsEnabled) {
      runDeterministicChain();
      return;
    }
    for (let guard = 0; guard < COORDINATOR_TURN_GUARD; guard++) {
      const active = getActiveTurn(world);
      // A `direct`-mode companion is player-owned too (C-526 §12.5).
      if (active === null || isPlayerControlled(active.entityId, playerEntityId)) {
        return;
      }
      const state = project();
      if (state === undefined || state.phase === 'ended' || state.phase === 'reaction') {
        return;
      }
      const actorId = state.initiative.order[state.initiative.activeIndex];
      if (actorId === undefined) {
        return;
      }
      const actor = state.combatants[actorId];
      if (actor === undefined || actor.defeated) {
        resolveActorDeterministically();
        continue;
      }
      const requestId = `${state.encounterId}:ai:${actorId}:${state.stateRevision}`;
      if (pending.has(requestId)) {
        // Already awaiting this actor's decision — never duplicate the request.
        return;
      }
      deferToClient({
        requestId,
        encounterId: state.encounterId,
        combatantId: actorId,
        stateRevision: state.stateRevision,
      });
      return;
    }
    logger.warn('[combat_ai_turns] coordinator turn guard reached');
  };

  const submit = (command: CombatAiDecisionSubmittedCommand): boolean => {
    const entry = pending.get(command.requestId);
    if (entry === undefined || entry.combatantId !== command.combatantId) {
      // A duplicate, superseded or unknown submission is ignored — a decision
      // commits at most once.
      logger.info('[combat_ai_turns] stale decision submission ignored', {
        requestId: command.requestId,
      });
      return false;
    }
    // A cancellation (decline / stale / end-turn) is a control message, not a
    // decision: it may be answered after the revision moved on, and it must
    // never authorise the deterministic fallback. Only a real decision is
    // validated against the live revision/actor BEFORE it consumes the request
    // or clears its fallback timer.
    const resolution = command.decision === null ? command.resolution : undefined;
    const isCancellation =
      resolution === 'stale' || resolution === 'decline' || resolution === 'end_turn';
    if (!isCancellation) {
      const state = project();
      const active = getActiveTurn(world);
      const valid =
        state !== undefined &&
        state.phase !== 'ended' &&
        state.stateRevision === command.stateRevision &&
        active !== null &&
        active.combatantId === command.combatantId;
      if (!valid) {
        // The submission answers a superseded moment. Leave the request (and
        // its deadline) intact so a valid answer or the fallback timer still
        // decides the turn; never apply it to a different revision/actor.
        logger.info('[combat_ai_turns] stale decision submission ignored', {
          requestId: command.requestId,
        });
        return true;
      }
    }
    if (entry.timer !== undefined) {
      clearTimeout(entry.timer);
    }
    pending.delete(command.requestId);
    activateDecision(command);
    return true;
  };

  const cancelAll = (): void => {
    if (pending.size > 0) {
      logger.info('[combat_ai_turns] cancelling outstanding decisions', { count: pending.size });
    }
    // Invalidate in-flight activations as well as pending timers: bumping the
    // generation makes every outstanding `produceAiCombatDecision` completion a
    // no-op, so a late step cannot commit into (or narrate over) a new run.
    generation += 1;
    for (const entry of pending.values()) {
      if (entry.timer !== undefined) {
        clearTimeout(entry.timer);
      }
    }
    pending.clear();
  };

  /**
   * Re-reads turn ownership after a control-mode change (C-526 AC-6).
   *
   * Switching a companion to `direct` must hand its pending turn to the player
   * instead of leaving a plan awaiting approval that the player can no longer
   * see a reason for; switching away from `direct` must let the coordinator pick
   * the turn up again. Timers are (re)armed from the mode, not from the clock.
   */
  const refresh = (): void => {
    const registry = getCombatIdentityRegistry(world);
    registry.sync(world);
    for (const [requestId, entry] of [...pending.entries()]) {
      const entityId = registry.toEntityId(entry.combatantId);
      if (entityId === null || isPlayerControlled(entityId, playerEntityId)) {
        // No longer an AI-owned decision (mode changed to `direct`, or the
        // pending actor left the live roster).
        if (entry.timer !== undefined) {
          clearTimeout(entry.timer);
        }
        pending.delete(requestId);
        bridge.emit({
          type: 'COMBAT_AI_DECISION_WITHDRAWN',
          requestId,
          encounterId: entry.encounterId,
          combatantId: entry.combatantId,
        });
        logger.info('[combat_ai_turns] decision withdrawn for player-owned turn', {
          combatantId: entry.combatantId,
        });
      }
    }
    run();
  };

  return {
    run,
    refresh,
    submit,
    cancelAll,
    get pendingCount(): number {
      return pending.size;
    },
  };
};
