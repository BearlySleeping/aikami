// packages/shared/utils/src/lib/rules/combat_depth_forecast.ts
//
// Combat-08 forecast: the immediate objective consequences of a proposed action
// and its conditional opportunity-attack risks.
//
// Both projections are PURE, non-mutating and bounded. They exist so a player
// can see what an action would do before committing it — and so a hidden fact
// is never leaked:
//
//   - `objectiveEffects` lists only authored, VISIBLE objectives (a hidden
//     objective is evaluated normally but never forecast);
//   - `reactionRisks` lists only reactors the caller's perception already
//     knows about. The caller supplies `perceivedReactorIds`; an absent or
//     empty set yields no risks, because "we do not know" must never render as
//     "there is no risk" OR as "here is a hidden enemy".
//
// Neither projection is a promise: the commit re-evaluates against committed
// facts, and the kernel is the only authority.
//
// Contract: C-532 AC-1, AC-3

import { compareCombatIds, gridPointKey } from '@aikami/schemas';
import type {
  CombatantState,
  CombatState,
  GridPoint,
  ObjectiveEffectForecast,
  ObjectiveProgress,
  ParticipationState,
  ReactionRiskForecast,
} from '@aikami/types';
import { evaluateObjectives, interactionKey } from './combat_objectives';
import { computeOpportunityTriggers, opportunityReaction } from './combat_reactions';

// ---------------------------------------------------------------------------
// Reaction risks
// ---------------------------------------------------------------------------

/**
 * Known opportunity-attack risks along a proposed voluntary path.
 *
 * `perceivedReactorIds` is the caller's perception result. A reactor absent
 * from it is not disclosed — the risk is simply not previewed, and the reaction
 * is explained when it becomes observable.
 */
export const forecastReactionRisks = (options: {
  state: CombatState;
  moverId: string;
  path: readonly GridPoint[];
  perceivedReactorIds: readonly string[];
}): ReactionRiskForecast[] => {
  if (options.path.length === 0 || options.perceivedReactorIds.length === 0) {
    return [];
  }
  const mover = options.state.combatants[options.moverId];
  if (mover === undefined) {
    return [];
  }
  const perceived = new Set(options.perceivedReactorIds);

  // Restrict the roster to the reactors perception already knows about, so the
  // trigger scan cannot reveal anyone else.
  const combatants: Record<string, CombatantState> = {};
  for (const [combatantId, combatant] of Object.entries(options.state.combatants)) {
    if (combatantId === options.moverId || perceived.has(combatantId)) {
      combatants[combatantId] = combatant;
    }
  }

  const triggers = computeOpportunityTriggers({
    mover,
    path: options.path,
    combatants,
    participation: options.state.participation,
    registry: options.state.reactionRegistry,
    abilityCatalog: options.state.abilityCatalog,
    cause: 'voluntary',
    nested: false,
  });
  const reaction = opportunityReaction(options.state.reactionRegistry);
  if (reaction === null) {
    return [];
  }

  return triggers
    .map((trigger) => ({
      triggerCell: { x: trigger.triggerCell.x, y: trigger.triggerCell.y },
      pathIndex: trigger.pathIndex,
      reactorIds: [...trigger.reactorIds].sort(compareCombatIds),
      reactionId: reaction.reactionId,
      committedCells: options.path
        .slice(0, trigger.pathIndex)
        .map((cell) => ({ x: cell.x, y: cell.y })),
    }))
    .sort((a, b) => a.pathIndex - b.pathIndex);
};

// ---------------------------------------------------------------------------
// Objective effects
// ---------------------------------------------------------------------------

export type ObjectiveForecastInput = {
  state: CombatState;
  /** The acting combatant. */
  actorId: string;
  /** Cells the proposed action would commit, in order (move / retreat). */
  committedCells?: readonly GridPoint[];
  /** Interaction the proposed action would commit (`interactWithObject`). */
  committedInteraction?: { objectId: string; affordanceId: string };
  /** Whether the proposal is a retreat (which moves participation on arrival). */
  declaresRetreat?: boolean;
};

/** Applies a proposal's immediate facts to a copy of the roster. */
const projectFacts = (input: ObjectiveForecastInput) => {
  const combatants: Record<string, CombatantState> = {};
  for (const [combatantId, combatant] of Object.entries(input.state.combatants)) {
    combatants[combatantId] = { ...combatant, position: { ...combatant.position } };
  }
  const cells = input.committedCells ?? [];
  const destination = cells[cells.length - 1];
  if (destination !== undefined && combatants[input.actorId] !== undefined) {
    combatants[input.actorId] = {
      ...combatants[input.actorId],
      position: { x: destination.x, y: destination.y },
    };
  }
  const participation: Record<string, ParticipationState> = { ...input.state.participation };
  const completedInteractions = new Set<string>();
  if (input.committedInteraction !== undefined) {
    completedInteractions.add(
      interactionKey(input.committedInteraction.objectId, input.committedInteraction.affordanceId),
    );
  }
  // A retreat that lands inside the authored exit zone escapes immediately.
  if (input.declaresRetreat && destination !== undefined) {
    const response = input.state.moraleRules.responses.find(
      (entry) => entry.responseKind === 'retreat',
    );
    const zone =
      response?.exitZoneId === null || response?.exitZoneId === undefined
        ? undefined
        : input.state.moraleRules.exitZones.find((entry) => entry.zoneId === response.exitZoneId);
    const arrived = (zone?.cells ?? []).some(
      (cell) => gridPointKey(cell) === gridPointKey(destination),
    );
    if (arrived && participation[input.actorId] !== undefined) {
      participation[input.actorId] = { ...participation[input.actorId], status: 'escaped' };
    }
  }
  return { combatants, participation, completedInteractions };
};

/**
 * The immediate objective consequences of a proposed action.
 *
 * Hidden objectives are never listed. An objective whose status would not
 * change is still listed when the action moves its progress, so the player can
 * see partial progress.
 */
export const forecastObjectiveEffects = (
  input: ObjectiveForecastInput,
): ObjectiveEffectForecast[] => {
  const definitions = input.state.objectiveRules.definitions;
  if (definitions.length === 0) {
    return [];
  }
  const before = input.state.objectives;
  const beforeById = new Map(before.map((entry) => [entry.objectiveId, entry]));
  const projected = projectFacts(input);

  const after = evaluateObjectives({
    rules: input.state.objectiveRules,
    previous: before,
    facts: {
      combatants: projected.combatants,
      participation: projected.participation,
      completedInteractions: projected.completedInteractions,
      completedRounds: Math.max(0, input.state.round - 1),
      round: input.state.round,
    },
  });

  const effects: ObjectiveEffectForecast[] = [];
  for (const definition of definitions) {
    if (definition.hidden) {
      continue;
    }
    const record = after.progress.find((entry) => entry.objectiveId === definition.objectiveId);
    if (record === undefined) {
      continue;
    }
    const previous = beforeById.get(definition.objectiveId);
    const statusBefore: ObjectiveProgress['status'] = previous?.status ?? 'pending';
    const progressBefore = previous?.progress ?? 0;
    const completes = record.status === 'complete' && statusBefore !== 'complete';
    const failsDeadline =
      record.status === 'failed' &&
      statusBefore !== 'failed' &&
      definition.rule.kind === 'interact_before_deadline';
    if (!completes && !failsDeadline && record.progress === progressBefore) {
      continue;
    }
    effects.push({
      objectiveId: definition.objectiveId,
      objectiveKind: definition.kind,
      statusBefore,
      statusAfter: record.status,
      progressAfter: record.progress,
      completes,
      failsDeadline,
    });
  }
  return effects.sort((a, b) => compareCombatIds(a.objectiveId, b.objectiveId));
};
