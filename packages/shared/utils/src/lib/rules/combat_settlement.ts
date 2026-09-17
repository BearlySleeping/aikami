// packages/shared/utils/src/lib/rules/combat_settlement.ts
//
// Pure, exactly-once encounter settlement — Combat-08.
//
// One ordered pass decides the encounter:
//   1. mandatory loss constraints (protected actor lost, required objective
//      failed, party defeated) win over success at the same boundary;
//   2. authored objective completion;
//   3. party escape;
//   4. the legacy enemy-elimination default — which applies ONLY when no
//      authored required objective is unmet, so a ritual/escape objective can
//      never be bypassed by killing everything.
//
// At most one settlement is produced per encounter. A second call with an
// existing settlement is a no-op that returns the existing record unchanged —
// this is the idempotency guarantee reward/world persistence relies on.
//
// Contract: C-532 AC-5

import { compareCombatIds } from '@aikami/schemas';
import type {
  CombatantState,
  EncounterSettlement,
  ObjectiveProgress,
  ObjectiveRules,
  ParticipationState,
  SettlementReasonCode,
  SettlementResult,
} from '@aikami/types';
import { stillContestsEncounter } from './combat_morale';
import { evaluateObjectives, type ObjectiveEvaluationFacts } from './combat_objectives';

export type SettlementEvaluation = {
  settlement: EncounterSettlement | null;
  /** Objective progress after this evaluation, in authored order. */
  objectiveProgress: ObjectiveProgress[];
  /** True when the settlement was already committed and this call was a no-op. */
  alreadySettled: boolean;
};

/**
 * Deterministic settlement identity — stable across replay, and scoped to one
 * encounter EXECUTION. Including the execution identity means replaying or
 * reloading the same run reuses the same id, while a retry or a new run of the
 * same authored encounter cannot collide at an identical revision/reason.
 * Contract: C-532 AC-5.
 */
export const settlementIdFor = (
  encounterId: string,
  encounterRunId: string,
  stateRevision: number,
  reasonCode: SettlementReasonCode,
): string => `${encounterId}:${encounterRunId}:${stateRevision}:${reasonCode}`;

const partyIds = (
  combatants: Record<string, CombatantState>,
  participation: Record<string, ParticipationState>,
): string[] =>
  Object.values(combatants)
    .filter((combatant) => combatant.team === 'player' || combatant.team === 'ally')
    .map((combatant) => combatant.combatantId)
    .filter((combatantId) => participation[combatantId]?.status !== 'escaped')
    .sort();

const hostileIds = (combatants: Record<string, CombatantState>): string[] =>
  Object.values(combatants)
    .filter((combatant) => combatant.team === 'enemy')
    .map((combatant) => combatant.combatantId)
    .sort();

/**
 * The legacy default: every hostile defeated. Retained as a fallback for
 * encounters that author no required objectives.
 */
const allHostilesDefeated = (combatants: Record<string, CombatantState>): boolean => {
  const hostiles = Object.values(combatants).filter((combatant) => combatant.team === 'enemy');
  return hostiles.length > 0 && hostiles.every((combatant) => combatant.defeated);
};

const partyDefeated = (combatants: Record<string, CombatantState>): boolean => {
  const party = Object.values(combatants).filter(
    (combatant) => combatant.team === 'player' || combatant.team === 'ally',
  );
  return party.length > 0 && party.every((combatant) => combatant.defeated);
};

/** At least one friendly escaped and no friendly still contests the battlefield. */
const partyEscaped = (
  combatants: Record<string, CombatantState>,
  participation: Record<string, ParticipationState>,
): boolean => {
  const party = Object.values(combatants).filter(
    (combatant) => combatant.team === 'player' || combatant.team === 'ally',
  );
  if (party.length === 0) {
    return false;
  }
  const statuses = party.map(
    (combatant) => participation[combatant.combatantId]?.status ?? 'active',
  );
  return (
    statuses.includes('escaped') && statuses.every((status) => !stillContestsEncounter(status))
  );
};

const makeSettlement = (options: {
  encounterId: string;
  encounterRunId: string;
  stateRevision: number;
  round: number;
  result: SettlementResult;
  reasonCode: SettlementReasonCode;
  objectiveResults: ObjectiveProgress[];
}): EncounterSettlement => ({
  settlementId: settlementIdFor(
    options.encounterId,
    options.encounterRunId,
    options.stateRevision,
    options.reasonCode,
  ),
  result: options.result,
  reasonCode: options.reasonCode,
  objectiveResults: [...options.objectiveResults].sort((a, b) =>
    compareCombatIds(a.objectiveId, b.objectiveId),
  ),
  round: options.round,
  rewardApplied: false,
});

/**
 * Decides the encounter's terminal settlement.
 *
 * `existing` is the already-committed settlement (or `null`). When non-null the
 * function returns it untouched — no second settlement, no second reward, no
 * overwritten outcome.
 */
export const settleEncounter = (options: {
  encounterId: string;
  encounterRunId: string;
  stateRevision: number;
  round: number;
  rules: ObjectiveRules;
  previousProgress: readonly ObjectiveProgress[];
  facts: ObjectiveEvaluationFacts;
  existing: EncounterSettlement | null;
}): SettlementEvaluation => {
  const evaluation = evaluateObjectives({
    rules: options.rules,
    previous: options.previousProgress,
    facts: options.facts,
  });

  if (options.existing !== null) {
    return {
      settlement: options.existing,
      objectiveProgress: evaluation.progress,
      alreadySettled: true,
    };
  }

  const { combatants, participation } = options.facts;

  if (
    partyIds(combatants, participation).length === 0 &&
    !partyEscaped(combatants, participation)
  ) {
    return {
      settlement: makeSettlement({
        encounterId: options.encounterId,
        encounterRunId: options.encounterRunId,
        stateRevision: options.stateRevision,
        round: options.round,
        result: 'defeat',
        reasonCode: 'no_combatants',
        objectiveResults: evaluation.progress,
      }),
      objectiveProgress: evaluation.progress,
      alreadySettled: false,
    };
  }

  // 1. Mandatory loss constraints — precedence over any success below.
  if (partyDefeated(combatants)) {
    return {
      settlement: makeSettlement({
        encounterId: options.encounterId,
        encounterRunId: options.encounterRunId,
        stateRevision: options.stateRevision,
        round: options.round,
        result: 'defeat',
        reasonCode: 'party_defeated',
        objectiveResults: evaluation.progress,
      }),
      objectiveProgress: evaluation.progress,
      alreadySettled: false,
    };
  }

  if (evaluation.lostProtectedActorIds.length > 0) {
    return {
      settlement: makeSettlement({
        encounterId: options.encounterId,
        encounterRunId: options.encounterRunId,
        stateRevision: options.stateRevision,
        round: options.round,
        result: 'defeat',
        reasonCode: 'protected_actor_lost',
        objectiveResults: evaluation.progress,
      }),
      objectiveProgress: evaluation.progress,
      alreadySettled: false,
    };
  }

  // Settlement reads the CURRENT objective statuses, not this boundary's
  // transitions: the ordered resolution pass evaluates objectives before it
  // settles, so a transition-only view would miss the completion it just
  // committed.
  const failedNow = evaluation.progress
    .filter((entry) => entry.status === 'failed')
    .map((entry) => entry.objectiveId);

  const failedRequiredIds = failedNow.filter((objectiveId) =>
    options.rules.definitions.some(
      (definition) => definition.objectiveId === objectiveId && definition.required,
    ),
  );
  if (failedRequiredIds.length > 0) {
    const deadlineBound = options.rules.definitions.some(
      (definition) =>
        failedRequiredIds.includes(definition.objectiveId) &&
        definition.rule.kind === 'interact_before_deadline',
    );
    return {
      settlement: makeSettlement({
        encounterId: options.encounterId,
        encounterRunId: options.encounterRunId,
        stateRevision: options.stateRevision,
        round: options.round,
        result: 'defeat',
        reasonCode: deadlineBound ? 'deadline_expired' : 'objective_failed',
        objectiveResults: evaluation.progress,
      }),
      objectiveProgress: evaluation.progress,
      alreadySettled: false,
    };
  }

  // 2. Party escape — a successful disengagement, distinct from defeat.
  if (partyEscaped(combatants, participation)) {
    return {
      settlement: makeSettlement({
        encounterId: options.encounterId,
        encounterRunId: options.encounterRunId,
        stateRevision: options.stateRevision,
        round: options.round,
        result: 'escape',
        reasonCode: 'escaped_encounter',
        objectiveResults: evaluation.progress,
      }),
      objectiveProgress: evaluation.progress,
      alreadySettled: false,
    };
  }

  // 3. Authored objective completion. Optional objectives never settle the
  // encounter by themselves; every authored required objective must complete.
  const requiredDefinitions = options.rules.definitions.filter((definition) => definition.required);
  const allRequiredComplete =
    requiredDefinitions.length > 0 &&
    requiredDefinitions.every((definition) =>
      evaluation.progress.some(
        (entry) => entry.objectiveId === definition.objectiveId && entry.status === 'complete',
      ),
    );
  if (allRequiredComplete) {
    const routed = requiredDefinitions.some(
      (definition) => definition.rule.kind === 'defeat_or_rout',
    );
    return {
      settlement: makeSettlement({
        encounterId: options.encounterId,
        encounterRunId: options.encounterRunId,
        stateRevision: options.stateRevision,
        round: options.round,
        result: 'victory',
        reasonCode: routed ? 'hostile_group_routed' : 'objective_completed',
        objectiveResults: evaluation.progress,
      }),
      objectiveProgress: evaluation.progress,
      alreadySettled: false,
    };
  }

  // 4. Legacy enemy-elimination default. Only reachable when no authored
  //    required objective is unmet — a ritual/escape objective blocks it.
  if (evaluation.unmetRequiredObjectiveIds.length > 0) {
    return {
      settlement: null,
      objectiveProgress: evaluation.progress,
      alreadySettled: false,
    };
  }

  if (allHostilesDefeated(combatants)) {
    return {
      settlement: makeSettlement({
        encounterId: options.encounterId,
        encounterRunId: options.encounterRunId,
        stateRevision: options.stateRevision,
        round: options.round,
        result: 'victory',
        reasonCode: 'all_enemies_defeated',
        objectiveResults: evaluation.progress,
      }),
      objectiveProgress: evaluation.progress,
      alreadySettled: false,
    };
  }

  return {
    settlement: null,
    objectiveProgress: evaluation.progress,
    alreadySettled: false,
  };
};

/** Number of hostiles that no longer contest the encounter. */
export const routedHostileCount = (options: {
  hostileIds: readonly string[];
  combatants: Record<string, CombatantState>;
  participation: Record<string, ParticipationState>;
}): number =>
  options.hostileIds.filter((hostileId) => {
    const combatant = options.combatants[hostileId];
    const participation = options.participation[hostileId];
    return (
      combatant === undefined ||
      combatant.defeated ||
      participation?.status === 'escaped' ||
      participation?.status === 'surrendered'
    );
  }).length;

/** Convenience re-export so settlement consumers import one module. */
export { hostileIds as hostileCombatantIds };
