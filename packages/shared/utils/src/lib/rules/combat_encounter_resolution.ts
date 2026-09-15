// packages/shared/utils/src/lib/rules/combat_encounter_resolution.ts
//
// Combat-08 ordered resolution pass.
//
// This module owns steps 4–6 of the declared ordering (contract
// §"Resolution and settlement"):
//
//   4. Apply resulting participation and morale transitions.
//   5. Evaluate objectives and mandatory loss constraints.
//   6. Produce at most one terminal outcome and settlement identity.
//
// It is deliberately a separate module from the kernel so the ordering lives
// in ONE place and the kernel stays a command dispatcher. It mutates the
// caller's draft state (the kernel's clone) and returns the events the batch
// produced — it never touches the caller's input state and never performs I/O.
//
// Morale and objectives are mutually dependent (a morale break can rout a
// `defeat_or_rout` group; a failed objective lowers morale), so the pass runs
// participation/morale first, evaluates objectives, applies any newly-failed
// objective's morale trigger, and re-evaluates once. The re-evaluation is
// bounded — it runs at most twice — so no unbounded feedback loop exists.
//
// Contract: C-532 AC-1, AC-2, AC-5

import { outcomeFromSettlement } from '@aikami/schemas';
import type {
  CombatEvent,
  CombatEventEnvelope,
  CombatState,
  ObjectiveProgress,
  ParticipationState,
} from '@aikami/types';
import { applyMoraleTrigger, moraleBandFromValue } from './combat_morale';
import {
  evaluateObjectives,
  interactionKey,
  type ObjectiveEvaluationFacts,
  projectObjectiveState,
} from './combat_objectives';
import { settleEncounter } from './combat_settlement';

export type ResolutionBatchInput = {
  /** The kernel's draft state — mutated in place by this pass. */
  state: CombatState;
  envelope: CombatEventEnvelope;
  /** Progress committed by the previous evaluation. */
  previousProgress: readonly ObjectiveProgress[];
  /** Combatants removed (defeated) during this batch, in event order. */
  removedCombatantIds: readonly string[];
  /** Interaction keys (`"<objectId>:<affordanceId>"`) committed in this batch. */
  committedInteractionKeys: readonly string[];
};

export type ResolutionBatchResult = {
  events: CombatEvent[];
  /** True when this batch committed the terminal settlement. */
  settled: boolean;
};

const teamOf = (
  state: CombatState,
  combatantId: string,
): CombatState['combatants'][string]['team'] | undefined => state.combatants[combatantId]?.team;

/** Combatants on the same side as `combatantId`, excluding it, in stable id order. */
const sameTeamPeers = (state: CombatState, combatantId: string): string[] => {
  const team = teamOf(state, combatantId);
  if (team === undefined) {
    return [];
  }
  return Object.values(state.combatants)
    .filter((combatant) => combatant.team === team && combatant.combatantId !== combatantId)
    .map((combatant) => combatant.combatantId)
    .sort();
};

/** The team an objective's named actors belong to — the morale-affected side. */
const objectiveAffectedTeam = (state: CombatState, namedActorIds: readonly string[]): string[] => {
  const counts = new Map<string, string[]>();
  for (const actorId of namedActorIds) {
    const team = teamOf(state, actorId);
    if (team === undefined) {
      continue;
    }
    const bucket = counts.get(team) ?? [];
    bucket.push(actorId);
    counts.set(team, bucket);
  }
  let best: string[] = [];
  for (const bucket of counts.values()) {
    if (bucket.length > best.length) {
      best = bucket;
    }
  }
  if (best.length === 0) {
    return [];
  }
  const team = teamOf(state, best[0]);
  return Object.values(state.combatants)
    .filter((combatant) => combatant.team === team)
    .map((combatant) => combatant.combatantId)
    .sort();
};

const namedActorIdsOf = (state: CombatState, objectiveId: string): string[] => {
  const definition = state.objectiveRules.definitions.find(
    (entry) => entry.objectiveId === objectiveId,
  );
  if (definition === undefined) {
    return [];
  }
  switch (definition.rule.kind) {
    case 'defeat_or_rout':
      return [...definition.rule.hostileIds];
    case 'survive_rounds':
    case 'reach_zone':
    case 'interact_before_deadline':
      return [...definition.rule.requiredActorIds];
  }
};

/** Builds the evaluator's fact set from committed kernel state. */
export const buildEvaluationFacts = (options: {
  state: CombatState;
  committedInteractionKeys: readonly string[];
}): ObjectiveEvaluationFacts => {
  const completedInteractions = new Set<string>([...options.committedInteractionKeys]);
  // Interactions committed earlier in the encounter are recovered from the
  // objective records themselves: an objective already complete on an
  // interaction stays complete, and the evaluator only needs the *current*
  // batch's keys to detect a fresh completion.
  return {
    combatants: options.state.combatants,
    participation: options.state.participation,
    completedInteractions,
    completedRounds: Math.max(0, options.state.round - 1),
    round: options.state.round,
  };
};

/**
 * Interaction keys committed by a completed objective are re-added so a later
 * evaluation in the same encounter does not "forget" the interaction.
 */
const carriedInteractionKeys = (state: CombatState): string[] => {
  const keys: string[] = [];
  for (const definition of state.objectiveRules.definitions) {
    if (definition.rule.kind !== 'interact_before_deadline') {
      continue;
    }
    const record = state.objectives.find((entry) => entry.objectiveId === definition.objectiveId);
    if (record?.status === 'complete') {
      keys.push(interactionKey(definition.rule.objectId, definition.rule.affordanceId));
    }
  }
  return keys;
};

/**
 * Runs steps 4–6 for one committed batch.
 *
 * When a settlement already exists the pass is a no-op: no second settlement,
 * no second reward, no overwritten outcome. Remaining continuations are
 * invalidated by the caller.
 */
export const resolveEncounterBatch = (input: ResolutionBatchInput): ResolutionBatchResult => {
  const { state } = input;
  const events: CombatEvent[] = [];
  const envelope = input.envelope;

  if (state.settlement !== null) {
    return { events, settled: true };
  }

  // --- Step 4: participation and morale transitions -------------------------
  // A lethal removal is already carried by `combatantDefeated`; the
  // participation record is synced SILENTLY so the event stream does not
  // duplicate the same fact. Only nonlethal transitions (retreat, escape,
  // surrender) emit `participationChanged`. Contract: C-532 AC-2.
  for (const combatantId of [...input.removedCombatantIds].sort()) {
    const current = state.participation[combatantId];
    if (current === undefined || current.status === 'defeated') {
      continue;
    }
    state.participation[combatantId] = { ...current, status: 'defeated' };
  }

  for (const combatantId of [...input.removedCombatantIds].sort()) {
    const peers = sameTeamPeers(state, combatantId);
    if (peers.length === 0) {
      continue;
    }
    const isLeader = state.moraleRules.leaderIds.includes(combatantId);
    const triggerEvents: {
      kind: 'leader_defeated' | 'ally_removed';
      sourceId: string;
    }[] = isLeader
      ? [
          { kind: 'leader_defeated', sourceId: combatantId },
          { kind: 'ally_removed', sourceId: combatantId },
        ]
      : [{ kind: 'ally_removed', sourceId: combatantId }];

    for (const trigger of triggerEvents) {
      const before = { ...state.participation };
      const application = applyMoraleTrigger({
        rules: state.moraleRules,
        participation: state.participation,
        event:
          trigger.kind === 'leader_defeated'
            ? { kind: 'leader_defeated', leaderId: trigger.sourceId }
            : { kind: 'ally_removed', removedId: trigger.sourceId },
        affectedCombatantIds: peers,
      });
      state.participation = application.participation;
      for (const changedId of application.changedCombatantIds) {
        const previous = before[changedId];
        const next: ParticipationState | undefined = state.participation[changedId];
        if (previous === undefined || next === undefined) {
          continue;
        }
        events.push({
          ...envelope,
          kind: 'moraleChanged',
          combatantId: changedId,
          triggerId: `${trigger.kind}:${trigger.sourceId}`,
          moraleBefore: previous.morale,
          moraleAfter: next.morale,
          band: moraleBandFromValue(next.morale),
        });
      }
    }
  }

  // --- Step 5: objectives ------------------------------------------------
  const interactionKeys = [...carriedInteractionKeys(state), ...input.committedInteractionKeys];

  let previous = input.previousProgress;
  let evaluation = evaluateObjectives({
    rules: state.objectiveRules,
    previous,
    facts: buildEvaluationFacts({ state, committedInteractionKeys: interactionKeys }),
  });

  // A newly failed objective fires its morale trigger; the re-evaluation is
  // bounded to one extra pass so morale→objective feedback cannot loop.
  for (const failedId of evaluation.failedObjectiveIds) {
    const affected = objectiveAffectedTeam(state, namedActorIdsOf(state, failedId));
    if (affected.length === 0) {
      continue;
    }
    const before = { ...state.participation };
    const application = applyMoraleTrigger({
      rules: state.moraleRules,
      participation: state.participation,
      event: { kind: 'objective_failed', objectiveId: failedId },
      affectedCombatantIds: affected,
    });
    state.participation = application.participation;
    for (const changedId of application.changedCombatantIds) {
      const prior = before[changedId];
      const next = state.participation[changedId];
      if (prior === undefined || next === undefined) {
        continue;
      }
      events.push({
        ...envelope,
        kind: 'moraleChanged',
        combatantId: changedId,
        triggerId: `objective_failed:${failedId}`,
        moraleBefore: prior.morale,
        moraleAfter: next.morale,
        band: moraleBandFromValue(next.morale),
      });
    }
  }

  evaluation = evaluateObjectives({
    rules: state.objectiveRules,
    previous,
    facts: buildEvaluationFacts({ state, committedInteractionKeys: interactionKeys }),
  });
  previous = evaluation.progress;

  state.objectives = projectObjectiveState({
    rules: state.objectiveRules,
    previous: state.objectives,
    evaluation,
  });

  for (const objectiveId of evaluation.completedObjectiveIds) {
    const definition = state.objectiveRules.definitions.find(
      (entry) => entry.objectiveId === objectiveId,
    );
    events.push({
      ...envelope,
      kind: 'objectiveCompleted',
      objectiveId,
      objectiveKind: definition?.kind ?? 'unknown',
    });
  }
  for (const objectiveId of evaluation.failedObjectiveIds) {
    const definition = state.objectiveRules.definitions.find(
      (entry) => entry.objectiveId === objectiveId,
    );
    events.push({
      ...envelope,
      kind: 'objectiveFailed',
      objectiveId,
      objectiveKind: definition?.kind ?? 'unknown',
      reasonCode:
        definition?.rule.kind === 'interact_before_deadline'
          ? 'deadline_expired'
          : 'condition_broken',
    });
  }

  // --- Step 6: one terminal settlement -----------------------------------
  const settlementEvaluation = settleEncounter({
    encounterId: state.encounterId,
    stateRevision: state.stateRevision,
    round: state.round,
    rules: state.objectiveRules,
    previousProgress: previous,
    facts: buildEvaluationFacts({ state, committedInteractionKeys: interactionKeys }),
    existing: state.settlement,
  });

  if (settlementEvaluation.settlement === null) {
    return { events, settled: false };
  }

  const settlement = settlementEvaluation.settlement;
  state.settlement = settlement;
  state.outcome = outcomeFromSettlement(settlement);
  state.phase = 'ended';
  // Terminal settlement invalidates all remaining continuations.
  state.reaction = { windows: [] };

  events.push({
    ...envelope,
    kind: 'combatEnded',
    victory: settlement.result !== 'defeat',
    reason: settlement.reasonCode,
  });
  events.push({
    ...envelope,
    kind: 'encounterSettled',
    settlementId: settlement.settlementId,
    result: settlement.result,
    reasonCode: settlement.reasonCode,
    victory: settlement.result !== 'defeat',
    objectiveResults: settlement.objectiveResults.map((entry) => ({
      objectiveId: entry.objectiveId,
      status: entry.status,
      progress: entry.progress,
    })),
  });

  return { events, settled: true };
};

/**
 * Marks the settlement's reward/world persistence as acknowledged. Keyed by
 * `settlementId`, so a replayed acknowledgement is a no-op.
 */
export const acknowledgeSettlementReward = (state: CombatState, settlementId: string): boolean => {
  if (state.settlement === null || state.settlement.settlementId !== settlementId) {
    return false;
  }
  if (state.settlement.rewardApplied) {
    return false;
  }
  state.settlement = { ...state.settlement, rewardApplied: true };
  return true;
};
