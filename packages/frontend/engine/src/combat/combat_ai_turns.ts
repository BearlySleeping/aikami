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
  timer: ReturnType<typeof setTimeout>;
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
  const runDeterministicChain = (): void => {
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

  /** Activates the submitted decision through the step-wise pipeline. */
  const activateDecision = (submission: CombatAiDecisionSubmittedCommand): void => {
    const decision = submission.decision;
    if (decision === null) {
      notifyDegraded(submission.combatantId, 'offline');
      resolveActorDeterministically();
      run();
      return;
    }
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
      onDegraded: (event) => notifyDegraded(event.actorId, event.reason),
      ...(options.onRecord === undefined ? {} : { onRecord: options.onRecord }),
    })
      .then((outcome: AiCombatDecisionOutcome) => {
        emitCombatAiOutcome({
          bridge,
          encounterId: state?.encounterId ?? 'unknown',
          actorId: submission.combatantId,
          outcome,
          onDegraded: (event) => notifyDegraded(event.actorId, event.reason),
        });
        // The actor may still hold the turn (a move does not end it) — end it
        // so the chain can advance, then continue with the next actor.
        endTurnIfStillActive(submission.combatantId);
        run();
      })
      .catch((error: unknown) => {
        logger.error('[combat_ai_turns] decision activation failed', {
          combatantId: submission.combatantId,
          error: error instanceof Error ? error.message : String(error),
        });
        notifyDegraded(submission.combatantId, 'invalid');
        resolveActorDeterministically();
        run();
      });
  };

  /** Ends the turn when `combatantId` still holds it (a move does not end it). */
  const endTurnIfStillActive = (combatantId: string): void => {
    const active = getActiveTurn(world);
    if (active === null || active.combatantId !== combatantId) {
      return;
    }
    const state = project();
    if (state === undefined || state.phase === 'ended') {
      return;
    }
    commitV2KernelCommand({
      world,
      bridge,
      state,
      command: { kind: 'endTurn', combatantId },
    });
  };

  /** Arms the deadline and asks the client for a decision. */
  const deferToClient = (request: {
    requestId: string;
    encounterId: string;
    combatantId: string;
    stateRevision: number;
  }): void => {
    const timer = setTimeout(() => {
      pending.delete(request.requestId);
      logger.info('[combat_ai_turns] decision deadline expired', {
        combatantId: request.combatantId,
      });
      notifyDegraded(request.combatantId, 'timeout');
      resolveActorDeterministically();
      run();
    }, hardDeadlineMs);
    pending.set(request.requestId, { ...request, timer });
    bridge.emit({
      type: 'COMBAT_AI_DECISION_REQUESTED',
      requestId: request.requestId,
      encounterId: request.encounterId,
      combatantId: request.combatantId,
      stateRevision: request.stateRevision,
    });
  };

  const run = (): void => {
    if (!options.llmAgentsEnabled) {
      runDeterministicChain();
      return;
    }
    for (let guard = 0; guard < COORDINATOR_TURN_GUARD; guard++) {
      const active = getActiveTurn(world);
      if (active === null || active.entityId === playerEntityId) {
        return;
      }
      const state = project();
      if (state === undefined || state.phase === 'ended') {
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
    clearTimeout(entry.timer);
    pending.delete(command.requestId);

    const state = project();
    const stillActive =
      state !== undefined &&
      state.stateRevision === command.stateRevision &&
      state.initiative.order[state.initiative.activeIndex] === command.combatantId &&
      state.phase !== 'ended';
    if (!stillActive) {
      // A revision change (or a turn that moved on) discards the decision
      // instead of applying it to a different moment of the fight (AC-5).
      notifyDegraded(command.combatantId, 'stale');
      resolveActorDeterministically();
      run();
      return true;
    }
    activateDecision(command);
    return true;
  };

  const cancelAll = (): void => {
    if (pending.size > 0) {
      logger.info('[combat_ai_turns] cancelling outstanding decisions', { count: pending.size });
    }
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
    }
    pending.clear();
  };

  return {
    run,
    submit,
    cancelAll,
    get pendingCount(): number {
      return pending.size;
    },
  };
};
