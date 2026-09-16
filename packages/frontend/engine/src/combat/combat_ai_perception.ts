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
  VisibleObjectContext,
} from '@aikami/types';
import {
  type CompileIntentHistory,
  getEnvironmentalGeometry,
  getLegalActions,
  getObjectAffordances,
  hasEnvironmentalLineOfSight,
  hasLineOfSight,
  moraleBandFromValue,
} from '@aikami/utils';
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
  /**
   * Player-authored standing goal (C-526 §12.5, Intent mode).
   *
   * Direction for the model, never mechanics: it biases goal selection and the
   * kernel still validates every resulting command. Bounded on the way in.
   */
  standingGoal?: string;
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
   *
   * Omit to use {@link derivePerceivableCombatantIds} — the actor-relative
   * default. It is deliberately NOT "every living combatant": an actor
   * perceives itself, its own team, and only those hostiles the battlefield's
   * authoritative sight grid does not occlude (C-526 lifecycle/perception
   * repair). A caller that has a richer vision source may narrow it further;
   * nothing may widen it past what the battlefield allows.
   */
  visibleCombatantIds?: readonly string[];
  /** Defaults to `COMBAT_AI_TOKEN_BUDGET` (800). */
  tokenBudget?: number;
};

/**
 * Derives the actor-relative perception mask from authoritative state.
 *
 * Safe fallback (documented, deterministic, never omniscience):
 *
 *   - the actor always perceives itself;
 *   - it perceives every living combatant on its own team (allies coordinate);
 *   - it perceives a hostile or neutral combatant only when the battlefield's
 *     sight-blocking grid reports an unobstructed line of sight between the
 *     two positions.
 *
 * `battlefield.blocksSight` absent means the kernel's own rule applies — "no
 * occlusion data, every line of sight is clear" (`CombatStateSchema`) — so an
 * open, unauthored battlefield yields full visibility. That is the kernel's
 * documented semantics, not an accidental default.
 */
export const derivePerceivableCombatantIds = (options: {
  state: CombatState;
  combatantId: string;
}): string[] => {
  const actor = options.state.combatants[options.combatantId];
  if (actor === undefined) {
    return [];
  }
  const perceivable = new Set<string>([actor.combatantId]);
  for (const combatant of Object.values(options.state.combatants)) {
    if (combatant.combatantId === actor.combatantId || combatant.defeated) {
      continue;
    }
    if (combatant.team === actor.team) {
      perceivable.add(combatant.combatantId);
      continue;
    }
    if (
      hasLineOfSight({
        battlefield: options.state.battlefield,
        from: actor.position,
        to: combatant.position,
      })
    ) {
      perceivable.add(combatant.combatantId);
    }
  }
  return [...perceivable].sort(compareIds);
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
    ...(policy.standingGoal === undefined || policy.standingGoal.trim().length === 0
      ? {}
      : {
          standingGoal: policy.standingGoal.trim().slice(0, COMBAT_AI_BOUNDS.standingGoalChars),
        }),
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
 * Clamps every free-text field to its authored bound.
 *
 * The builder already slices most arrays, but a caller-supplied policy (role,
 * traits, fears, relationship notes, emotional state) is unbounded input: it is
 * narrowed here so array trimming is not the only thing standing between a
 * verbose content pack and an oversized prompt (AC-2).
 */
const boundContextStrings = (context: CombatDecisionContext): CombatDecisionContext => ({
  ...context,
  actor: {
    ...context.actor,
    role: context.actor.role.slice(0, COMBAT_AI_BOUNDS.roleChars),
    personality: context.actor.personality
      .slice(0, COMBAT_AI_BOUNDS.personalityTraits)
      .map((trait) => trait.slice(0, COMBAT_AI_BOUNDS.traitChars)),
    relationships: context.actor.relationships
      .slice(0, COMBAT_AI_BOUNDS.relationships)
      .map((relationship) => ({
        combatantId: relationship.combatantId,
        stance: relationship.stance,
        ...(relationship.note === undefined
          ? {}
          : { note: relationship.note.slice(0, COMBAT_AI_BOUNDS.relationshipNoteChars) }),
      })),
    fears: context.actor.fears
      .slice(0, COMBAT_AI_BOUNDS.fears)
      .map((fear) => fear.slice(0, COMBAT_AI_BOUNDS.traitChars)),
    emotionalState: context.actor.emotionalState.slice(0, COMBAT_AI_BOUNDS.emotionalStateChars),
    ...(context.actor.standingGoal === undefined
      ? {}
      : { standingGoal: context.actor.standingGoal.slice(0, COMBAT_AI_BOUNDS.standingGoalChars) }),
  },
  imminentThreats: context.imminentThreats
    .slice(0, COMBAT_AI_BOUNDS.imminentThreats)
    .map((threat) => threat.slice(0, COMBAT_AI_BOUNDS.threatChars)),
  candidatePositions: context.candidatePositions
    .slice(0, COMBAT_AI_BOUNDS.candidatePositions)
    .map((position) => ({
      cellBand: position.cellBand.slice(0, COMBAT_AI_BOUNDS.cellBandChars),
      risk: position.risk,
    })),
  recentEvents: context.recentEvents.slice(0, COMBAT_AI_BOUNDS.recentEvents).map((event) => ({
    kind: event.kind.slice(0, COMBAT_AI_BOUNDS.recentEventKindChars),
    summary: event.summary.slice(0, COMBAT_AI_BOUNDS.recentEventSummaryChars),
  })),
  visibleCombatants: context.visibleCombatants
    .slice(0, COMBAT_AI_BOUNDS.visibleCombatants)
    .map((combatant) => ({
      ...combatant,
      conditions: combatant.conditions.slice(0, COMBAT_AI_BOUNDS.conditionsPerCombatant),
    })),
  capabilities: context.capabilities.slice(0, COMBAT_AI_BOUNDS.capabilities),
  reachableTargets: context.reachableTargets.slice(0, COMBAT_AI_BOUNDS.reachableTargets),
  objectives: context.objectives.slice(0, COMBAT_AI_BOUNDS.objectives),
});

/**
 * Shrinks the snapshot until it fits `tokenBudget`.
 *
 * Deterministic and total: every array is bounded first, then arrays shrink
 * lowest-signal-first (events, candidate positions, reachable targets,
 * capabilities, visible combatants). Returns `undefined` when even the minimum
 * valid context does not fit — the caller then uses the deterministic planner
 * instead of sending an over-budget prompt (AC-2). A trimming loop that logs
 * and returns an over-budget context is not an acceptable outcome.
 */
const trimToTokenBudget = (context: CombatDecisionContext): CombatDecisionContext | undefined => {
  const order: Array<
    keyof Pick<
      CombatDecisionContext,
      | 'recentEvents'
      | 'candidatePositions'
      | 'reachableTargets'
      | 'capabilities'
      | 'visibleCombatants'
      | 'visibleObjects'
    >
  > = [
    'recentEvents',
    'candidatePositions',
    'reachableTargets',
    'capabilities',
    'visibleObjects',
    'visibleCombatants',
  ];
  let trimmed = boundContextStrings(context);
  // Every array can be emptied; the loop is bounded by the sum of the caps so
  // it always terminates, and each pass removes exactly one element.
  const maxPasses = order.length * (COMBAT_AI_BOUNDS.capabilities + 1);
  for (let pass = 0; pass < maxPasses; pass++) {
    if (fitsCombatDecisionTokenBudget({ context: trimmed })) {
      return trimmed;
    }
    const key = order[pass % order.length];
    if (key === undefined || trimmed[key].length === 0) {
      continue;
    }
    trimmed = { ...trimmed, [key]: trimmed[key].slice(0, -1) };
  }
  if (!fitsCombatDecisionTokenBudget({ context: trimmed })) {
    // Nothing optional is left and it still does not fit: refuse to send it.
    logger.warn(
      '[combat_ai_perception] minimum snapshot exceeds token budget — deterministic fallback',
      {
        actorId: context.actor.combatantId,
        tokenBudget: context.tokenBudget,
        serializedChars: JSON.stringify(trimmed).length,
      },
    );
    return undefined;
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
/**
 * The battlefield objects the actor can actually SEE, each with only the
 * affordances it can actually take (C-531 AC-5).
 *
 * An object out of sight never enters the snapshot, and an affordance the
 * registry reports as unavailable is omitted rather than described — the model
 * is never handed an action the kernel would reject, and it never learns about
 * an object the actor has not perceived.
 */
const buildVisibleObjects = (options: {
  state: CombatState;
  actor: CombatantState;
}): VisibleObjectContext[] => {
  const { state, actor } = options;
  const geometry = getEnvironmentalGeometry(state);
  const visible: VisibleObjectContext[] = [];
  const objectIds = Object.keys(state.environment.objects).sort();
  for (const objectId of objectIds) {
    if (visible.length >= COMBAT_AI_BOUNDS.visibleObjects) {
      break;
    }
    const object = state.environment.objects[objectId];
    const definition = state.environmentBundle.objectDefinitions[object.definitionId];
    if (definition === undefined) {
      continue;
    }
    const perceived =
      object.position.x === actor.position.x && object.position.y === actor.position.y
        ? true
        : hasEnvironmentalLineOfSight({
            state,
            geometry,
            from: actor.position,
            to: object.position,
          });
    if (!perceived) {
      continue;
    }
    const available = getObjectAffordances({ state, actorId: actor.combatantId })
      .filter((view) => view.objectId === objectId && view.available)
      .slice(0, COMBAT_AI_BOUNDS.objectAffordances)
      .map((view) => ({
        affordanceId: view.affordanceId,
        name: view.name,
        actionCost: view.actionCost,
      }));
    visible.push({
      objectId,
      name: definition.name,
      state: object.state,
      cover: object.cover,
      ignited: object.ignited,
      availableAffordances: available,
    });
  }
  return visible;
};

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
  // participated in would be filtered out. With no caller mask the
  // actor-relative default applies: unknown visibility is never omniscience.
  const authoritativeMask = new Set(derivePerceivableCombatantIds({ state, combatantId }));
  const mask =
    options.visibleCombatantIds === undefined
      ? authoritativeMask
      : new Set(options.visibleCombatantIds.filter((id) => authoritativeMask.has(id)));
  mask.add(combatantId);
  const visibilityOptions = { visibleCombatantIds: [...mask].sort(compareIds) };

  const context: CombatDecisionContext = {
    actor: buildActorContext({ state, actor, policy }),
    objectives: state.objectives.slice(0, COMBAT_AI_BOUNDS.objectives).map((objective) => ({
      objectiveId: objective.objectiveId,
      kind: objective.kind,
      status: objective.status,
    })),
    visibleCombatants: buildVisibleCombatants({ state, actor, ...visibilityOptions }),
    // C-531: perceived objects only — never the whole encounter's object list.
    visibleObjects: buildVisibleObjects({ state, actor }),
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
    // The authoritative numeric participation morale is projected onto the
    // qualitative band the AI consumes. A caller-supplied policy value is only
    // a fallback for a combatant with no participation record (e.g. a
    // pre-Combat-08 fixture). Contract: C-532 AC-2.
    morale:
      state.participation[combatantId] !== undefined
        ? moraleBandFromValue(state.participation[combatantId].morale)
        : (policy.morale ?? 'steady'),
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
