// packages/shared/utils/src/lib/rules/combat_objectives.ts
//
// Pure, deterministic objective evaluator — Combat-08.
//
// The evaluator reads the PINNED authored rules plus observable kernel facts.
// It never reads narration, renderer ticks, model output, or the latest
// mutable content pack. Every result is a kernel fact the caller commits.
//
// Ordering guarantees (contract §"Authored objectives"):
//   - Mandatory loss constraints have precedence over success at the same
//     evaluation boundary.
//   - A protected actor lost at a boundary fails the encounter regardless of
//     what else completed.
//   - A required objective that is not complete prevents an ordinary
//     enemy-elimination victory from being selected.
//   - An objective that is already complete stays complete unless its rule
//     declares a maintained condition (`defeat_or_rout` is maintained).
//
// Contract: C-532 AC-1

import { compareCombatIds, compareGridPoints, gridPointKey } from '@aikami/schemas';
import type {
  CombatantState,
  GridPoint,
  ObjectiveDefinition,
  ObjectiveProgress,
  ObjectiveRules,
  ParticipationState,
  RegisteredObjectiveRule,
} from '@aikami/types';

// ---------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------

/**
 * Everything the objective evaluator is allowed to read.
 *
 * Callers build this from committed kernel state plus the event batch being
 * applied — never from prose. `completedInteractions` is the set of
 * `"<objectId>:<affordanceId>"` pairs that have been committed.
 */
export type ObjectiveEvaluationFacts = {
  /** Live combatants, keyed by combatantId. */
  combatants: Record<string, CombatantState>;
  /** Participation records, keyed by combatantId. */
  participation: Record<string, ParticipationState>;
  /** Committed interaction keys (`"<objectId>:<affordanceId>"`). */
  completedInteractions: ReadonlySet<string>;
  /** Completed rounds — the current round minus one. Starting a round does not count. */
  completedRounds: number;
  /** Current round number (1-based). */
  round: number;
};

/** Builds the canonical interaction key. */
export const interactionKey = (objectId: string, affordanceId: string): string =>
  `${objectId}:${affordanceId}`;

// ---------------------------------------------------------------------------
// Individual primitives
// ---------------------------------------------------------------------------

/** True when an actor still contests the encounter. */
const stillContests = (participation: ParticipationState | undefined): boolean =>
  participation === undefined ||
  participation.status === 'active' ||
  participation.status === 'retreating';

/** Reads morale, defaulting to the steady maximum when no record exists. */
const moraleOf = (participation: ParticipationState | undefined): number =>
  participation === undefined ? 100 : participation.morale;

const requiredActorsEligible = (
  facts: ObjectiveEvaluationFacts,
  actorIds: readonly string[],
): boolean =>
  actorIds.every((actorId) => {
    const combatant = facts.combatants[actorId];
    if (combatant === undefined || combatant.defeated) {
      return false;
    }
    const participation = facts.participation[actorId];
    return participation === undefined || participation.status === 'active';
  });

const zoneContains = (cells: readonly GridPoint[], position: GridPoint): boolean => {
  const key = gridPointKey(position);
  return cells.some((cell) => gridPointKey(cell) === key);
};

/** Per-primitive evaluation: `{ satisfied, progress, maintained }`. */
type PrimitiveEvaluation = {
  satisfied: boolean;
  progress: number;
  /**
   * Whether the primitive may *un*-satisfy itself on a later boundary. Only
   * `defeat_or_rout` is maintained; the other three latch complete.
   */
  maintained: boolean;
};

const evaluateDefeatOrRout = (
  rule: Extract<RegisteredObjectiveRule, { kind: 'defeat_or_rout' }>,
  facts: ObjectiveEvaluationFacts,
): PrimitiveEvaluation => {
  let routed = 0;
  for (const hostileId of rule.hostileIds) {
    const participation = facts.participation[hostileId];
    const combatant = facts.combatants[hostileId];
    const moraleRouted =
      rule.routMoraleThreshold !== null && moraleOf(participation) <= rule.routMoraleThreshold;
    const gone =
      combatant === undefined ||
      combatant.defeated ||
      participation?.status === 'escaped' ||
      participation?.status === 'surrendered';
    if (gone || moraleRouted || !stillContests(participation)) {
      routed += 1;
    }
  }
  return {
    satisfied: rule.hostileIds.length > 0 && routed >= rule.hostileIds.length,
    progress: routed,
    maintained: true,
  };
};

const evaluateSurviveRounds = (
  rule: Extract<RegisteredObjectiveRule, { kind: 'survive_rounds' }>,
  facts: ObjectiveEvaluationFacts,
): PrimitiveEvaluation => {
  const eligible = requiredActorsEligible(facts, rule.requiredActorIds);
  // Starting a round does not count as surviving it: only *completed* rounds
  // advance the objective.
  const survived = Math.min(facts.completedRounds, rule.rounds);
  return {
    satisfied: eligible && facts.completedRounds >= rule.rounds,
    progress: eligible ? survived : 0,
    maintained: false,
  };
};

const evaluateInteractBeforeDeadline = (
  rule: Extract<RegisteredObjectiveRule, { kind: 'interact_before_deadline' }>,
  facts: ObjectiveEvaluationFacts,
): PrimitiveEvaluation => {
  const done = facts.completedInteractions.has(interactionKey(rule.objectId, rule.affordanceId));
  return {
    satisfied: done,
    progress: done ? 1 : 0,
    maintained: false,
  };
};

const evaluateReachZone = (
  rule: Extract<RegisteredObjectiveRule, { kind: 'reach_zone' }>,
  facts: ObjectiveEvaluationFacts,
): PrimitiveEvaluation => {
  let arrived = 0;
  for (const actorId of rule.requiredActorIds) {
    const combatant = facts.combatants[actorId];
    if (combatant === undefined || combatant.defeated) {
      continue;
    }
    const participation = facts.participation[actorId];
    if (participation !== undefined && participation.status !== 'active') {
      continue;
    }
    if (zoneContains(rule.cells, combatant.position)) {
      arrived += 1;
    }
  }
  return {
    satisfied: rule.requiredActorIds.length > 0 && arrived >= rule.requiredActorIds.length,
    progress: arrived,
    maintained: false,
  };
};

const evaluatePrimitive = (
  rule: RegisteredObjectiveRule,
  facts: ObjectiveEvaluationFacts,
): PrimitiveEvaluation => {
  switch (rule.kind) {
    case 'defeat_or_rout':
      return evaluateDefeatOrRout(rule, facts);
    case 'survive_rounds':
      return evaluateSurviveRounds(rule, facts);
    case 'interact_before_deadline':
      return evaluateInteractBeforeDeadline(rule, facts);
    case 'reach_zone':
      return evaluateReachZone(rule, facts);
  }
};

/**
 * Whether a deadline-bound objective has passed its last legal boundary.
 * `interact_before_deadline` fails once the encounter has completed more
 * rounds than its declared deadline.
 */
const deadlineExpired = (rule: RegisteredObjectiveRule, facts: ObjectiveEvaluationFacts): boolean =>
  rule.kind === 'interact_before_deadline' && facts.completedRounds >= rule.deadlineRound;

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

export type ObjectiveEvaluation = {
  /** Progress records in authored-definition order. */
  progress: ObjectiveProgress[];
  /** Objective ids that transitioned to `complete` in this evaluation. */
  completedObjectiveIds: string[];
  /** Objective ids that transitioned to `failed` in this evaluation. */
  failedObjectiveIds: string[];
  /** Protected actors that were lost at this boundary. */
  lostProtectedActorIds: string[];
  /** Required objectives still incomplete. */
  unmetRequiredObjectiveIds: string[];
  /**
   * A mandatory loss constraint fired. It wins over success at the same
   * boundary.
   */
  mandatoryLoss: boolean;
};

/**
 * Evaluates every authored objective against `facts`.
 *
 * `previous` is the last committed progress projection; it is used only to
 * latch completed objectives and to detect transitions. Pass `[]` on the first
 * evaluation.
 */
export const evaluateObjectives = (options: {
  rules: ObjectiveRules;
  previous: readonly ObjectiveProgress[];
  facts: ObjectiveEvaluationFacts;
}): ObjectiveEvaluation => {
  const { rules, facts } = options;
  const previousById = new Map(options.previous.map((entry) => [entry.objectiveId, entry]));

  const progress: ObjectiveProgress[] = [];
  const completedObjectiveIds: string[] = [];
  const failedObjectiveIds: string[] = [];

  for (const definition of rules.definitions) {
    const prior = previousById.get(definition.objectiveId);
    const evaluation = evaluatePrimitive(definition.rule, facts);
    const expired = deadlineExpired(definition.rule, facts);

    let status: ObjectiveProgress['status'];
    if (prior?.status === 'complete' && !evaluation.maintained) {
      // Latched: an objective that is already complete stays complete unless
      // its definition explicitly uses a maintained condition.
      status = 'complete';
    } else if (expired && !evaluation.satisfied) {
      status = 'failed';
    } else if (evaluation.satisfied) {
      status = 'complete';
    } else if (prior?.status === 'failed' && !evaluation.maintained) {
      status = 'failed';
    } else {
      status = 'pending';
    }

    const record: ObjectiveProgress = {
      objectiveId: definition.objectiveId,
      status,
      progress: evaluation.progress,
    };
    progress.push(record);

    if (status === 'complete' && prior?.status !== 'complete') {
      completedObjectiveIds.push(definition.objectiveId);
    }
    if (status === 'failed' && prior?.status !== 'failed') {
      failedObjectiveIds.push(definition.objectiveId);
    }
  }

  const lostProtectedActorIds = rules.protectedActorIds.filter((actorId) => {
    const combatant = facts.combatants[actorId];
    if (combatant === undefined || combatant.defeated) {
      return true;
    }
    const participation = facts.participation[actorId];
    return participation !== undefined && participation.status === 'defeated';
  });

  const unmetRequiredObjectiveIds = rules.definitions
    .filter((definition: ObjectiveDefinition) => definition.required)
    .map((definition) => definition.objectiveId)
    .filter((objectiveId) => {
      const record = progress.find((entry) => entry.objectiveId === objectiveId);
      return record === undefined || record.status !== 'complete';
    });

  const failedRequired = rules.definitions.some((definition) => {
    if (!definition.required) {
      return false;
    }
    const record = progress.find((entry) => entry.objectiveId === definition.objectiveId);
    return record?.status === 'failed';
  });

  return {
    progress,
    completedObjectiveIds,
    failedObjectiveIds,
    lostProtectedActorIds,
    unmetRequiredObjectiveIds,
    mandatoryLoss: lostProtectedActorIds.length > 0 || failedRequired,
  };
};

/**
 * Projects the evaluator's progress records onto the observable
 * `CombatObjectiveState` list carried on `CombatState`, in authored order.
 * Objectives that exist in state but not in the authored rules are preserved
 * unchanged (a migrated encounter keeps its legacy records).
 */
export const projectObjectiveState = (options: {
  rules: ObjectiveRules;
  previous: readonly {
    objectiveId: string;
    kind: string;
    status: 'pending' | 'complete' | 'failed';
    progress: number;
  }[];
  evaluation: ObjectiveEvaluation;
}): {
  objectiveId: string;
  kind: string;
  status: 'pending' | 'complete' | 'failed';
  progress: number;
}[] => {
  const authoredIds = new Set(
    options.rules.definitions.map((definition) => definition.objectiveId),
  );
  const projected = options.rules.definitions.map((definition) => {
    const record = options.evaluation.progress.find(
      (entry) => entry.objectiveId === definition.objectiveId,
    );
    return {
      objectiveId: definition.objectiveId,
      kind: definition.kind,
      status: record?.status ?? 'pending',
      progress: record?.progress ?? 0,
    };
  });
  const legacy = options.previous.filter((entry) => !authoredIds.has(entry.objectiveId));
  return [...projected, ...legacy].sort((a, b) => compareCombatIds(a.objectiveId, b.objectiveId));
};

/** Deterministic zone ordering helper used by authored content validation. */
export const canonicalZoneCells = (cells: readonly GridPoint[]): GridPoint[] =>
  [...cells].sort(compareGridPoints);
