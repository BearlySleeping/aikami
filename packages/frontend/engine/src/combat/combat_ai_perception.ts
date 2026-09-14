// packages/frontend/engine/src/combat/combat_ai_perception.ts
//
// Perception-limited AI decision snapshot (Combat-06).
//
// The snapshot is the ONLY thing an AI decision model may read. It is built
// from the v2 kernel projection plus the same legal-action query the preview
// uses, and it is bounded BY CONSTRUCTION: every array is capped by
// `COMBAT_AI_BOUNDS` and the serialized result is asserted against the
// caller's `tokenBudget`. Raw ECS state, hidden entities, secrets, unrelated
// campaign history and full path lists never reach it.
//
// Perception source (contract Q4): the v2 projection + legal actions, with an
// optional caller-supplied vision mask where the exploration vision system has
// one. Morale and cover carry neutral defaults until Combat-08.
//
// Contract: C-526 AC-2, AC-8

import {
  COMBAT_AI_BOUNDS,
  COMBAT_AI_TOKEN_BUDGET,
  fitsCombatDecisionTokenBudget,
} from '@aikami/schemas';
import type {
  CombatAiDecisionRecord,
  CombatAiDegradedReason,
  CombatantState,
  CombatCover,
  CombatDecisionContext,
  CombatDifficulty,
  CombatEvent,
  CombatHealthBand,
  CombatMorale,
  CombatObedience,
  CombatRelationshipStance,
  CombatRiskTolerance,
  CombatState,
  GridPoint,
  RangeBand,
  VisibleCombatantContext,
} from '@aikami/types';
import { type CompileIntentHistory, getLegalActions } from '@aikami/utils';
import { logger } from '$logger';

// ---------------------------------------------------------------------------
// Caller-supplied character policy
// ---------------------------------------------------------------------------

/**
 * Character policy for one actor.
 *
 * This is CONTENT, not state: the v2 kernel carries no personality, so the
 * caller (encounter authoring / content pack / party setup) supplies it. Every
 * field is optional and neutral by default, so an old caller keeps compiling
 * without it (AC-8 edge case).
 */
export type CombatDecisionPolicy = {
  role?: string;
  personality?: string[];
  relationships?: Array<{ combatantId: string; stance: CombatRelationshipStance; note?: string }>;
  fears?: string[];
  emotionalState?: string;
  riskTolerance?: CombatRiskTolerance;
  obedience?: CombatObedience;
  difficulty?: CombatDifficulty;
  morale?: CombatMorale;
};

export type BuildCombatDecisionContextOptions = {
  state: CombatState;
  combatantId: string;
  policy?: CombatDecisionPolicy;
  history?: CompileIntentHistory;
  /** Resolved kernel events; only those the actor may perceive are surfaced. */
  recentEvents?: readonly CombatEvent[];
  /**
   * Perception mask: when supplied, ONLY these combatants are visible.
   * Omit to use the v2 projection's own visibility (all living combatants —
   * the kernel state already excludes entities the encounter did not spawn).
   */
  visibleCombatantIds?: readonly string[];
  /** Defaults to `COMBAT_AI_TOKEN_BUDGET` (800). */
  tokenBudget?: number;
};

// ---------------------------------------------------------------------------
// Deterministic helpers
// ---------------------------------------------------------------------------

const manhattan = (a: GridPoint, b: GridPoint): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

const compareIds = (a: string, b: string): number => {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
};

/** Coarse health band — a raw HP total never reaches the model. */
export const healthBandOf = (combatant: Pick<CombatantState, 'hp' | 'maxHp'>): CombatHealthBand => {
  const ratio = combatant.maxHp <= 0 ? 0 : combatant.hp / combatant.maxHp;
  if (ratio > 0.6) {
    return 'healthy';
  }
  if (ratio > 0.25) {
    return 'bloodied';
  }
  return 'critical';
};

/** Distance band from a cell count. */
export const rangeBandForDistance = (distance: number): RangeBand => {
  if (distance <= 1) {
    return 'melee';
  }
  if (distance <= 2) {
    return 'reach';
  }
  return 'ranged';
};

/** Ability range in cells translated to the catalogue's coarse band. */
const rangeBandForCells = (rangeCells: number): RangeBand => {
  if (rangeCells <= 1) {
    return 'melee';
  }
  if (rangeCells <= 2) {
    return 'reach';
  }
  return 'ranged';
};

const isHostileTeam = (team: string): boolean => team === 'enemy' || team === 'neutral';

const isHostileTo = (actorTeam: string, targetTeam: string): boolean =>
  actorTeam === 'player' || actorTeam === 'ally'
    ? isHostileTeam(targetTeam)
    : targetTeam === 'player' || targetTeam === 'ally';

const nameOf = (state: CombatState, combatantId: string): string =>
  state.combatants[combatantId]?.name ?? combatantId;

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

const buildActorContext = (options: {
  state: CombatState;
  actor: CombatantState;
  policy: CombatDecisionPolicy;
}): CombatDecisionContext['actor'] => {
  const { actor, policy } = options;
  return {
    combatantId: actor.combatantId,
    role: policy.role ?? 'combatant',
    personality: (policy.personality ?? []).slice(0, COMBAT_AI_BOUNDS.personalityTraits),
    relationships: (policy.relationships ?? [])
      .slice(0, COMBAT_AI_BOUNDS.relationships)
      .map((relationship) => ({
        combatantId: relationship.combatantId,
        stance: relationship.stance,
        ...(relationship.note === undefined ? {} : { note: relationship.note }),
      })),
    fears: (policy.fears ?? []).slice(0, COMBAT_AI_BOUNDS.fears),
    emotionalState: policy.emotionalState ?? 'steady',
  };
};

/** Whether a combatant is perceivable under the caller's mask. */
const isVisible = (options: {
  combatantId: string;
  visibleCombatantIds?: readonly string[];
}): boolean =>
  options.visibleCombatantIds === undefined ||
  options.visibleCombatantIds.includes(options.combatantId);

const buildVisibleCombatants = (options: {
  state: CombatState;
  actor: CombatantState;
  visibleCombatantIds?: readonly string[];
}): VisibleCombatantContext[] => {
  const { state, actor } = options;
  return Object.values(state.combatants)
    .filter(
      (combatant) =>
        combatant.combatantId !== actor.combatantId &&
        !combatant.defeated &&
        isVisible({
          combatantId: combatant.combatantId,
          visibleCombatantIds: options.visibleCombatantIds,
        }),
    )
    .sort((a, b) => compareIds(a.combatantId, b.combatantId))
    .slice(0, COMBAT_AI_BOUNDS.visibleCombatants)
    .map((combatant) => ({
      combatantId: combatant.combatantId,
      team: combatant.team,
      healthBand: healthBandOf(combatant),
      conditions: combatant.downed ? ['downed'] : [],
      lastKnown: combatant.position,
    }));
};

const buildCapabilities = (options: {
  state: CombatState;
  actor: CombatantState;
  legalTargetsByAbility: Record<string, string[]>;
  visibleCombatantIds?: readonly string[];
}): CombatDecisionContext['capabilities'] => {
  const { state, actor } = options;
  return [...actor.abilityIds]
    .sort(compareIds)
    .map((abilityId) => state.abilityCatalog[abilityId])
    .filter((ability) => ability !== undefined)
    .slice(0, COMBAT_AI_BOUNDS.capabilities)
    .map((ability) => {
      const legalTargets = (options.legalTargetsByAbility[ability.abilityId] ?? []).filter(
        (targetId) =>
          isVisible({ combatantId: targetId, visibleCombatantIds: options.visibleCombatantIds }),
      );
      const isAttack = ability.kind === 'melee_attack' || ability.kind === 'ranged_attack';
      const usable = isAttack ? legalTargets.length > 0 : ability.kind === 'defend';
      return {
        abilityId: ability.abilityId,
        rangeBand: rangeBandForCells(ability.rangeCells),
        requiresLineOfSight: ability.requiresLineOfSight,
        available: actor.budget.actionAvailable && usable,
      };
    });
};

const buildReachableTargets = (options: {
  state: CombatState;
  actor: CombatantState;
  legalTargetsByAbility: Record<string, string[]>;
  visibleCombatantIds?: readonly string[];
}): CombatDecisionContext['reachableTargets'] => {
  const { state, actor } = options;
  const targetIds = new Set<string>();
  for (const abilityId of [...actor.abilityIds].sort(compareIds)) {
    for (const targetId of options.legalTargetsByAbility[abilityId] ?? []) {
      targetIds.add(targetId);
    }
  }
  return [...targetIds]
    .filter((targetId) => targetId !== actor.combatantId)
    .filter((targetId) =>
      isVisible({ combatantId: targetId, visibleCombatantIds: options.visibleCombatantIds }),
    )
    .sort(compareIds)
    .slice(0, COMBAT_AI_BOUNDS.reachableTargets)
    .map((targetId) => ({
      combatantId: targetId,
      distanceBand: rangeBandForDistance(
        manhattan(actor.position, state.combatants[targetId]?.position ?? actor.position),
      ),
      // Cover mechanics are Combat-08; the field carries a neutral default.
      cover: 'none' as CombatCover,
    }));
};

const buildCandidatePositions = (options: {
  state: CombatState;
  actor: CombatantState;
  endpoints: readonly GridPoint[];
  visibleCombatantIds?: readonly string[];
}): CombatDecisionContext['candidatePositions'] => {
  const { state, actor, endpoints } = options;
  if (endpoints.length === 0) {
    return [];
  }
  const hostiles = Object.values(state.combatants).filter(
    (combatant) =>
      !combatant.defeated &&
      isHostileTo(actor.team, combatant.team) &&
      isVisible({
        combatantId: combatant.combatantId,
        visibleCombatantIds: options.visibleCombatantIds,
      }),
  );
  if (hostiles.length === 0) {
    return [{ cellBand: 'hold position', risk: 'low' }];
  }
  const distanceToNearest = (cell: GridPoint): number =>
    Math.min(...hostiles.map((hostile) => manhattan(cell, hostile.position)));
  const ranked = [...endpoints].sort(
    (a, b) => distanceToNearest(a) - distanceToNearest(b) || a.y - b.y || a.x - b.x,
  );
  const closest = ranked[0];
  const farthest = ranked.at(-1);
  const candidates: CombatDecisionContext['candidatePositions'] = [];
  if (closest !== undefined) {
    candidates.push({ cellBand: 'close with the nearest hostile', risk: 'high' });
  }
  if (farthest !== undefined && distanceToNearest(farthest) > distanceToNearest(actor.position)) {
    candidates.push({ cellBand: 'maximum standoff', risk: 'low' });
  }
  if (actor.budget.movementRemaining > 0) {
    candidates.push({ cellBand: 'flank the nearest hostile', risk: 'medium' });
  }
  return candidates.slice(0, COMBAT_AI_BOUNDS.candidatePositions);
};

const buildImminentThreats = (options: {
  state: CombatState;
  actor: CombatantState;
  visibleCombatantIds?: readonly string[];
}): string[] => {
  const { state, actor } = options;
  const threats: string[] = [];
  for (const combatant of Object.values(state.combatants).sort((a, b) =>
    compareIds(a.combatantId, b.combatantId),
  )) {
    if (
      combatant.combatantId === actor.combatantId ||
      combatant.defeated ||
      !isHostileTo(actor.team, combatant.team) ||
      !isVisible({
        combatantId: combatant.combatantId,
        visibleCombatantIds: options.visibleCombatantIds,
      })
    ) {
      continue;
    }
    const distance = manhattan(actor.position, combatant.position);
    const reach = combatant.abilityIds
      .map((abilityId) => state.abilityCatalog[abilityId])
      .filter((ability) => ability !== undefined)
      .filter((ability) => ability.kind === 'melee_attack' || ability.kind === 'ranged_attack')
      .reduce((max, ability) => Math.max(max, ability.rangeCells), 0);
    if (reach >= distance) {
      threats.push(`${combatant.name} can strike you at ${rangeBandForDistance(distance)} range`);
    }
  }
  return threats.slice(0, COMBAT_AI_BOUNDS.imminentThreats);
};

/** One bounded, ids-resolved summary line per perceivable recent event. */
const summarizeEvent = (options: {
  state: CombatState;
  event: CombatEvent;
  visibleCombatantIds?: readonly string[];
}): string => {
  const { state, event } = options;
  const nameOfEvent = (combatantId: string): string => nameOf(state, combatantId);
  switch (event.kind) {
    case 'attackRolled':
      return `${nameOfEvent(event.attackerId)} ${event.hit ? 'struck' : 'missed'} ${nameOfEvent(event.targetId)}`;
    case 'damageApplied':
      return `${nameOfEvent(event.targetId)} was wounded`;
    case 'movementCommitted':
      return `${nameOfEvent(event.combatantId)} moved`;
    case 'combatantDowned':
      return `${nameOfEvent(event.combatantId)} was downed`;
    case 'combatantDefeated':
      return `${nameOfEvent(event.combatantId)} was defeated`;
    case 'turnEnded':
      return `${nameOfEvent(event.combatantId)} ended their turn`;
    case 'combatEnded':
      return event.victory ? 'the fight was won' : 'the fight was lost';
    default:
      return event.kind;
  }
};

const eventCombatantIds = (event: CombatEvent): string[] => {
  switch (event.kind) {
    case 'attackRolled':
      return [event.attackerId, event.targetId];
    case 'damageApplied':
      return [event.targetId];
    case 'movementCommitted':
    case 'combatantDowned':
    case 'combatantDefeated':
    case 'turnEnded':
      return [event.combatantId];
    default:
      return [];
  }
};

const buildRecentEvents = (options: {
  state: CombatState;
  events: readonly CombatEvent[];
  visibleCombatantIds?: readonly string[];
}): CombatDecisionContext['recentEvents'] => {
  const visible = options.events.filter((event) =>
    eventCombatantIds(event).every((combatantId) =>
      isVisible({ combatantId, visibleCombatantIds: options.visibleCombatantIds }),
    ),
  );
  return visible.slice(-COMBAT_AI_BOUNDS.recentEvents).map((event) => ({
    kind: event.kind.slice(0, COMBAT_AI_BOUNDS.recentEventKindChars),
    summary: summarizeEvent({
      state: options.state,
      event,
      ...(options.visibleCombatantIds === undefined
        ? {}
        : { visibleCombatantIds: options.visibleCombatantIds }),
    }).slice(0, COMBAT_AI_BOUNDS.recentEventSummaryChars),
  }));
};

// ---------------------------------------------------------------------------
// Size enforcement
// ---------------------------------------------------------------------------

/**
 * Shrinks the snapshot until it fits `tokenBudget`.
 *
 * Bounded by construction already; this is the belt-and-braces pass that keeps
 * a future field addition from silently blowing the prompt budget (AC-2).
 * Arrays shrink lowest-signal-first: events, then candidate positions, then
 * reachable targets, then capabilities, then visible combatants.
 */
const trimToTokenBudget = (context: CombatDecisionContext): CombatDecisionContext => {
  const order: Array<
    keyof Pick<
      CombatDecisionContext,
      | 'recentEvents'
      | 'candidatePositions'
      | 'reachableTargets'
      | 'capabilities'
      | 'visibleCombatants'
    >
  > = [
    'recentEvents',
    'candidatePositions',
    'reachableTargets',
    'capabilities',
    'visibleCombatants',
  ];
  let trimmed = context;
  let index = 0;
  while (!fitsCombatDecisionTokenBudget({ context: trimmed }) && order.length > 0) {
    const key = order[index % order.length];
    const next = { ...trimmed, [key]: trimmed[key].slice(0, -1) };
    trimmed = next;
    index += 1;
    if (trimmed.visibleCombatants.length === 0 && index > order.length * 4) {
      break;
    }
  }
  if (!fitsCombatDecisionTokenBudget({ context: trimmed })) {
    logger.warn('[combat_ai_perception] snapshot exceeds token budget after trimming', {
      actorId: context.actor.combatantId,
      tokenBudget: context.tokenBudget,
    });
  }
  return trimmed;
};

// ---------------------------------------------------------------------------
// buildCombatDecisionContext
// ---------------------------------------------------------------------------

/**
 * Builds the perception-limited snapshot for one AI-controlled actor.
 *
 * Returns `undefined` when the actor is unknown, defeated, or the encounter has
 * ended — there is nothing to decide, and an unknown actor must never receive a
 * snapshot.
 */
export const buildCombatDecisionContext = (
  options: BuildCombatDecisionContextOptions,
): CombatDecisionContext | undefined => {
  const { state, combatantId } = options;
  const actor = state.combatants[combatantId];
  if (actor === undefined || actor.defeated || state.phase === 'ended') {
    return undefined;
  }

  const policy = options.policy ?? {};
  const tokenBudget = options.tokenBudget ?? COMBAT_AI_TOKEN_BUDGET;
  const legalActions = getLegalActions({ state, combatantId });

  // An actor always perceives itself, so its own id is part of the mask even
  // when the caller supplies a narrower vision mask — otherwise every event it
  // participated in would be filtered out.
  const visibilityOptions =
    options.visibleCombatantIds === undefined
      ? {}
      : { visibleCombatantIds: [...options.visibleCombatantIds, combatantId] };

  const context: CombatDecisionContext = {
    actor: buildActorContext({ state, actor, policy }),
    objectives: state.objectives.slice(0, COMBAT_AI_BOUNDS.objectives).map((objective) => ({
      objectiveId: objective.objectiveId,
      kind: objective.kind,
      status: objective.status,
    })),
    visibleCombatants: buildVisibleCombatants({ state, actor, ...visibilityOptions }),
    capabilities: buildCapabilities({
      state,
      actor,
      legalTargetsByAbility: legalActions.targetsByAbility,
      ...visibilityOptions,
    }),
    reachableTargets: buildReachableTargets({
      state,
      actor,
      legalTargetsByAbility: legalActions.targetsByAbility,
      ...visibilityOptions,
    }),
    candidatePositions: buildCandidatePositions({
      state,
      actor,
      endpoints: legalActions.endpoints,
      ...visibilityOptions,
    }),
    imminentThreats: buildImminentThreats({ state, actor, ...visibilityOptions }),
    // Morale thresholds are Combat-08; the field carries a neutral default.
    morale: policy.morale ?? 'steady',
    riskTolerance: policy.riskTolerance ?? 'balanced',
    obedience: policy.obedience ?? 'obedient',
    difficulty: policy.difficulty ?? 'normal',
    recentEvents: buildRecentEvents({
      state,
      events: options.recentEvents ?? [],
      ...visibilityOptions,
    }),
    tokenBudget,
  };

  return trimToTokenBudget(context);
};

// ---------------------------------------------------------------------------
// Deterministic telegraph (fallback path)
// ---------------------------------------------------------------------------

/**
 * Authored telegraph for the deterministic path.
 *
 * AC-7 requires a readable intention even when the model never ran, so the
 * fallback produces a bounded authored line — never model text.
 */
export const authoredTelegraphForCommand = (options: {
  state: CombatState;
  command: { kind: string; targetIds?: string[] };
}): string => {
  switch (options.command.kind) {
    case 'useAbility': {
      const targetId = options.command.targetIds?.[0];
      const target = targetId === undefined ? 'the nearest foe' : nameOf(options.state, targetId);
      return `preparing an attack on ${target}`;
    }
    case 'move':
      return 'manoeuvring for position';
    case 'defend':
      return 'bracing for the next blow';
    case 'wait':
      return 'holding position';
    default:
      return 'ending the turn';
  }
};

/** Telemetry record for a deterministic fallback decision. */
export const fallbackDecisionRecord = (options: {
  decisionId: string;
  encounterId: string;
  actorId: string;
  basedOnRevision: number;
  latencyMs: number;
  reason?: CombatAiDegradedReason;
}): CombatAiDecisionRecord => ({
  decisionId: options.decisionId,
  encounterId: options.encounterId,
  actorId: options.actorId,
  basedOnRevision: options.basedOnRevision,
  source: 'fallback',
  latencyMs: options.latencyMs,
  ...(options.reason === undefined ? {} : { fallbackReason: options.reason }),
});
