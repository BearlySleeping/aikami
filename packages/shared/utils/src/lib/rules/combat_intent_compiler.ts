// packages/shared/utils/src/lib/rules/combat_intent_compiler.ts
//
// Deterministic intent compiler (Combat-05).
//
// The compiler is the ONLY place where `ActionIntent` selectors ("nearest
// hostile", "somewhere safe", "strongest fire ability") become mechanical
// intents. It is pure: snapshot-in / value-out, no AI, no I/O, no mutation, and
// it never invents a capability — every resolved command is grounded on
// `getLegalActions` / `computeReachableEndpoints` / `hasLineOfSight` /
// `forecastCombatAction` from the C-515 tactical layer, and therefore the
// committed command equals the previewed one for the same revision.
//
// The clarification-vs-preview decision (AC-5) is the pure function
// {@link decideIntentClarification} over the compiled candidate plans.
//
// Module graph (must stay acyclic):
//   combat_spatial.ts   ← combat_tactical.ts ← combat_intent_compiler.ts
//
// Contract: C-525 AC-3, AC-5

import { COMBAT_INTENT_BOUNDS } from '@aikami/schemas';
import type {
  AbilitySelector,
  ActionForecast,
  ActionIntent,
  ClarificationRequest,
  CombatAbilityDefinition,
  CombatCommand,
  CombatInvalidReason,
  CombatState,
  CompiledPlan,
  EntitySelector,
  GridPoint,
  IntentStep,
  LocationSelector,
  RangeBand,
} from '@aikami/types';
import { COMBAT_MESSAGE_KEYS } from './combat_kernel';
import { findCombatPathToCell, forecastCombatAction, getLegalActions } from './combat_tactical';

// ---------------------------------------------------------------------------
// Result shapes
// ---------------------------------------------------------------------------

/** One grounded candidate: the plan plus the step that produced it. */
export type IntentPlanCandidate = {
  plan: CompiledPlan;
  step: IntentStep;
};

export type CompileIntentResult =
  | { ok: true; kind: 'plan'; plan: CompiledPlan }
  | { ok: true; kind: 'clarification'; clarification: ClarificationRequest; plans: CompiledPlan[] }
  | { ok: false; reasonCode: CombatInvalidReason; messageKey: string };

/** Combat-state history the compiler cannot re-derive from a snapshot. */
export type CompileIntentHistory = {
  lastAttackerId?: string;
  previousTargetId?: string;
};

export type CompileIntentOptions = {
  state: CombatState;
  intent: ActionIntent;
  history?: CompileIntentHistory;
  /** Candidate cap — defaults to `COMBAT_INTENT_BOUNDS.clarificationOptions`. */
  maxCandidates?: number;
};

// ---------------------------------------------------------------------------
// Small deterministic helpers
// ---------------------------------------------------------------------------

/** Total order on ids — every tie-break in this module ends here. */
const compareIds = (a: string, b: string): number => {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
};

/** Manhattan distance — the movement metric of the 4-neighbour grid. */
const manhattan = (a: GridPoint, b: GridPoint): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

const isFriendlyTeam = (team: string): boolean => team === 'player' || team === 'ally';

const isHostileTeam = (team: string): boolean => team === 'enemy' || team === 'neutral';

/**
 * Whether `targetTeam` is hostile to the actor's own team.
 *
 * Selectors are actor-relative so an AI-controlled combatant on the enemy
 * side can use the same `nearest_hostile` / `nearest_ally` vocabulary the
 * player uses (Combat-06 reuses the C-525 step vocabulary for AI decisions).
 * For a player/ally actor this is exactly the absolute taxonomy the envelope
 * was written against, so existing intents compile identically.
 */
const isHostileToTeam = (actorTeam: string, targetTeam: string): boolean =>
  isFriendlyTeam(actorTeam) ? isHostileTeam(targetTeam) : isFriendlyTeam(targetTeam);

/** The mirror of {@link isHostileToTeam} for `nearest_ally`. */
const isFriendlyToTeam = (actorTeam: string, targetTeam: string): boolean =>
  isFriendlyTeam(actorTeam) ? isFriendlyTeam(targetTeam) : isHostileTeam(targetTeam);

const rejection = (reasonCode: CombatInvalidReason): CompileIntentResult => ({
  ok: false,
  reasonCode,
  messageKey: COMBAT_MESSAGE_KEYS[reasonCode],
});

/** Mean damage of a dice expression — the deterministic "strongest" ranking. */
const meanDamage = (ability: CombatAbilityDefinition): number => {
  const match = /^(\d+)d(\d+)(?:\+(\d+))?$/.exec(ability.damageDice ?? '');
  if (match === null) {
    return 0;
  }
  const count = Number.parseInt(match[1], 10);
  const sides = Number.parseInt(match[2], 10);
  const bonus = match[3] === undefined ? 0 : Number.parseInt(match[3], 10);
  return (count * (sides + 1)) / 2 + bonus;
};

/** Whether a cell satisfies the standoff band the player asked for. */
const isInBand = (distance: number, band: RangeBand): boolean => {
  switch (band) {
    case 'melee':
      return distance === 1;
    case 'reach':
      return distance <= 2;
    case 'ranged':
      return distance >= 2 && distance <= 6;
    default:
      return false;
  }
};

// ---------------------------------------------------------------------------
// Entity selector resolution (AC-3)
// ---------------------------------------------------------------------------

export type ResolveEntitySelectorOptions = {
  state: CombatState;
  actorId: string;
  selector: EntitySelector;
  history?: CompileIntentHistory;
};

export type ResolvedEntityCandidates = {
  /** Candidates in deterministic preference order. */
  ordered: string[];
  /**
   * The candidates the selector cannot choose between at equal preference
   * ("three equally visible goblins"): everything tied for first place when the
   * selector is a nearest-* / explicit selector. Empty when the selector
   * resolved unambiguously.
   */
  ambiguous: string[];
};

const matchesNamedRef = (options: { name: string; id: string; namedRef: string }): boolean => {
  const ref = options.namedRef.trim().toLowerCase();
  if (ref.length === 0) {
    return false;
  }
  return (
    options.id.toLowerCase() === ref ||
    options.name.toLowerCase() === ref ||
    options.name.toLowerCase().includes(ref)
  );
};

/**
 * Resolves an entity selector against the live snapshot.
 *
 * Deterministic order: distance first (nearest_*), then combatant id. Only
 * living combatants are addressable; a stale `last_attacker` /
 * `previous_target` history entry is dropped rather than resolved to a corpse.
 */
export const resolveEntitySelector = (
  options: ResolveEntitySelectorOptions,
): ResolvedEntityCandidates => {
  const { state, actorId, selector } = options;
  const actor = state.combatants[actorId];
  if (actor === undefined) {
    return { ordered: [], ambiguous: [] };
  }
  const others = Object.values(state.combatants).filter(
    (combatant) => combatant.combatantId !== actorId && !combatant.defeated,
  );

  switch (selector.kind) {
    case 'nearest_hostile':
    case 'nearest_ally': {
      const wantsFriendly = selector.kind === 'nearest_ally';
      const pool = others.filter((combatant) =>
        wantsFriendly
          ? isFriendlyToTeam(actor.team, combatant.team)
          : isHostileToTeam(actor.team, combatant.team),
      );
      const ranked = pool
        .map((combatant) => ({
          id: combatant.combatantId,
          distance: manhattan(actor.position, combatant.position),
        }))
        .sort((a, b) => a.distance - b.distance || compareIds(a.id, b.id));
      const nearest = ranked[0]?.distance;
      const tied =
        nearest === undefined ? [] : ranked.filter((entry) => entry.distance === nearest);
      return {
        ordered: ranked.map((entry) => entry.id),
        // A single survivor is not an ambiguity — "the nearest" has one answer.
        ambiguous: tied.length > 1 ? tied.map((entry) => entry.id) : [],
      };
    }
    case 'last_attacker':
    case 'previous_target': {
      const id =
        selector.kind === 'last_attacker'
          ? options.history?.lastAttackerId
          : options.history?.previousTargetId;
      if (id === undefined) {
        return { ordered: [], ambiguous: [] };
      }
      const combatant = state.combatants[id];
      if (combatant === undefined || combatant.defeated) {
        return { ordered: [], ambiguous: [] };
      }
      return { ordered: [id], ambiguous: [] };
    }
    case 'explicit': {
      const matched = others
        .filter((combatant) =>
          matchesNamedRef({
            name: combatant.name,
            id: combatant.combatantId,
            namedRef: selector.namedRef,
          }),
        )
        .map((combatant) => combatant.combatantId)
        .sort(compareIds);
      return {
        ordered: matched,
        ambiguous: matched.length > 1 ? matched : [],
      };
    }
    default:
      return { ordered: [], ambiguous: [] };
  }
};

// ---------------------------------------------------------------------------
// Ability selector resolution (AC-3)
// ---------------------------------------------------------------------------

export type ResolveAbilitySelectorOptions = {
  state: CombatState;
  actorId: string;
  selector: AbilitySelector;
};

/** Whether `ability` is what the player asked for (tag match). */
export const matchesAbilityTag = (ability: CombatAbilityDefinition, value: string): boolean => {
  const tag = value.trim().toLowerCase();
  return (
    ability.abilityId.toLowerCase() === tag ||
    ability.kind.toLowerCase() === tag ||
    // A category tag ("melee", "ranged") names the ability KIND prefix.
    ability.kind.toLowerCase().startsWith(tag) ||
    ability.name.toLowerCase() === tag ||
    ability.name.toLowerCase().replaceAll(' ', '_') === tag
  );
};

/**
 * Candidate ability ids for `selector`, in deterministic preference order.
 *
 * `tag` matches the granted ability id / kind / name; `strongest` ranks attack
 * abilities by mean damage (descending), then id — an explicit `damageType`
 * filters the pool without ever widening it.
 */
export const resolveAbilitySelector = (options: ResolveAbilitySelectorOptions): string[] => {
  const { state, actorId, selector } = options;
  const actor = state.combatants[actorId];
  if (actor === undefined) {
    return [];
  }
  const granted = actor.abilityIds
    .map((abilityId) => state.abilityCatalog[abilityId])
    .filter((ability): ability is CombatAbilityDefinition => ability !== undefined);

  if (selector.kind === 'tag') {
    return granted
      .filter((ability) => matchesAbilityTag(ability, selector.value))
      .map((ability) => ability.abilityId)
      .sort(compareIds);
  }

  return granted
    .filter((ability) => ability.kind === 'melee_attack' || ability.kind === 'ranged_attack')
    .filter((ability) =>
      selector.damageType === undefined ? true : ability.damageType === selector.damageType,
    )
    .sort((a, b) => meanDamage(b) - meanDamage(a) || compareIds(a.abilityId, b.abilityId))
    .map((ability) => ability.abilityId);
};

// ---------------------------------------------------------------------------
// Plan construction
// ---------------------------------------------------------------------------

const buildPlan = (options: {
  intent: ActionIntent;
  command: CombatCommand;
  forecast: ActionForecast;
  assumptions: string[];
}): CompiledPlan => ({
  planId: `${options.intent.intentId}:0`,
  intentId: options.intent.intentId,
  encounterId: options.intent.encounterId,
  actorId: options.intent.actorId,
  basedOnRevision: options.intent.basedOnRevision,
  command: options.command,
  forecast: options.forecast,
  assumptions: options.assumptions.slice(0, COMBAT_INTENT_BOUNDS.assumptions),
  warnings: options.forecast.warnings,
});

const groundCommand = (options: {
  state: CombatState;
  intent: ActionIntent;
  command: CombatCommand;
  assumptions: string[];
}): { ok: true; plan: CompiledPlan } | { ok: false; reasonCode: CombatInvalidReason } => {
  const forecast = forecastCombatAction({ state: options.state, command: options.command });
  if (!forecast.valid) {
    return { ok: false, reasonCode: forecast.reasonCode };
  }
  return {
    ok: true,
    plan: buildPlan({
      intent: options.intent,
      command: options.command,
      forecast: forecast.forecast,
      assumptions: options.assumptions,
    }),
  };
};

// ---------------------------------------------------------------------------
// Move grounding
// ---------------------------------------------------------------------------

type MoveGrounding =
  | { ok: true; command: CombatCommand; assumptions: string[] }
  | { ok: false; reasonCode: CombatInvalidReason };

const destinationCellFor = (options: {
  state: CombatState;
  actorId: string;
  destination: LocationSelector;
  stopAt?: RangeBand;
  history?: CompileIntentHistory;
}): MoveGrounding => {
  const { state, actorId, destination } = options;
  const actor = state.combatants[actorId];
  if (actor === undefined) {
    return { ok: false, reasonCode: 'actorUnknown' };
  }
  const legalActions = getLegalActions({ state, combatantId: actorId });
  if (legalActions.endpoints.length === 0) {
    return { ok: false, reasonCode: 'movementBudgetExceeded' };
  }
  const assumptions: string[] = [];
  const costTo = legalActions.costTo;

  if (destination.kind === 'nearest_safe') {
    const hostiles = Object.values(state.combatants).filter(
      (combatant) =>
        combatant.combatantId !== actorId &&
        !combatant.defeated &&
        isHostileToTeam(actor.team, combatant.team),
    );
    const safety = (candidateCell: GridPoint): number =>
      hostiles.length === 0
        ? Number.POSITIVE_INFINITY
        : Math.min(...hostiles.map((hostile) => manhattan(candidateCell, hostile.position)));
    const ranked = [...legalActions.endpoints].sort(
      (a, b) =>
        safety(b) - safety(a) ||
        (costTo[`${a.x},${a.y}`] ?? 0) - (costTo[`${b.x},${b.y}`] ?? 0) ||
        a.y - b.y ||
        a.x - b.x,
    );
    const cell = ranked[0];
    if (cell === undefined) {
      return { ok: false, reasonCode: 'movementBudgetExceeded' };
    }
    assumptions.push('destination resolved as the reachable cell farthest from every hostile');
    const path = findCombatPathToCell({ state, combatantId: actorId, to: cell });
    if (path === null) {
      return { ok: false, reasonCode: 'pathInvalid' };
    }
    return { ok: true, command: { kind: 'move', combatantId: actorId, path }, assumptions };
  }

  // A relative destination is an in-band standoff around a resolved entity.
  const band = options.stopAt ?? destination.band;
  const resolved = resolveEntitySelector({
    state,
    actorId,
    selector: destination.relativeTo,
    ...(options.history === undefined ? {} : { history: options.history }),
  });
  const anchorId = resolved.ordered[0];
  const anchor = anchorId === undefined ? undefined : state.combatants[anchorId];
  if (anchor === undefined) {
    return { ok: false, reasonCode: 'targetInvalid' };
  }

  const direction = destination.direction ?? 'toward';
  const inBand = legalActions.endpoints.filter((candidateCell) =>
    isInBand(manhattan(candidateCell, anchor.position), band),
  );
  if (inBand.length === 0) {
    // Already standing in the band: there is no move left to make. Otherwise the
    // band is simply out of reach this turn.
    const alreadyInBand = isInBand(manhattan(actor.position, anchor.position), band);
    return { ok: false, reasonCode: alreadyInBand ? 'pathInvalid' : 'targetOutOfRange' };
  }
  const distanceFromActor = (candidateCell: GridPoint): number =>
    manhattan(candidateCell, actor.position);
  const ranked = [...inBand].sort((a, b) => {
    if (direction === 'away') {
      return distanceFromActor(b) - distanceFromActor(a) || a.y - b.y || a.x - b.x;
    }
    if (direction === 'behind') {
      return (
        distanceFromActor(b) - distanceFromActor(a) ||
        manhattan(a, anchor.position) - manhattan(b, anchor.position) ||
        a.y - b.y ||
        a.x - b.x
      );
    }
    return (
      distanceFromActor(a) - distanceFromActor(b) ||
      manhattan(a, anchor.position) - manhattan(b, anchor.position) ||
      a.y - b.y ||
      a.x - b.x
    );
  });
  const cell = ranked[0];
  if (cell === undefined) {
    return { ok: false, reasonCode: 'pathInvalid' };
  }
  assumptions.push(`standoff band "${band}" resolved around ${anchorId}`);
  const path = findCombatPathToCell({ state, combatantId: actorId, to: cell });
  if (path === null) {
    return { ok: false, reasonCode: 'pathInvalid' };
  }
  return { ok: true, command: { kind: 'move', combatantId: actorId, path }, assumptions };
};

// ---------------------------------------------------------------------------
// Clarification decision (AC-5)
// ---------------------------------------------------------------------------

/** The mechanical signature two candidates must share to be "the same intent". */
const materialSignature = (plan: CompiledPlan): string => {
  const command = plan.command;
  const targetIds = command.kind === 'useAbility' ? [...command.targetIds].sort(compareIds) : [];
  const abilityId = command.kind === 'useAbility' ? command.abilityId : '';
  const destination = command.kind === 'move' ? command.path.at(-1) : undefined;
  return JSON.stringify({
    kind: command.kind,
    abilityId,
    targetIds,
    destination: destination === undefined ? null : [destination.x, destination.y],
    movementCost: plan.forecast.movementCost ?? null,
    actionCost: plan.forecast.actionCost,
    warnings: [...plan.forecast.warnings].sort(compareIds),
  });
};

/**
 * Decides whether the player must be asked, and what to ask (AC-5).
 *
 * Pure function of the compiled candidates:
 *   - one candidate, or every candidate mechanically identical → `null`
 *     (a unique reasonable reading previews directly, no round trip);
 *   - materially different candidates → one bounded clarification round with
 *     concrete options, capped by `COMBAT_INTENT_BOUNDS.clarificationOptions`.
 */
export const decideIntentClarification = (
  candidates: readonly IntentPlanCandidate[],
): ClarificationRequest | null => {
  if (candidates.length <= 1) {
    return null;
  }
  const signatures = new Set(candidates.map((candidate) => materialSignature(candidate.plan)));
  if (signatures.size <= 1) {
    return null;
  }
  const bounded = candidates.slice(0, COMBAT_INTENT_BOUNDS.clarificationOptions);
  if (bounded.length < 2) {
    return null;
  }
  return {
    questionKey: 'combat.clarify.target',
    options: bounded.map((candidate, index) => ({
      optionId: `option-${index + 1}`,
      labelKey: `combat.clarify.option_${index + 1}`,
      steps: [candidate.step],
    })),
  };
};

// ---------------------------------------------------------------------------
// compileActionIntent (AC-3)
// ---------------------------------------------------------------------------

const compileUseAbility = (options: {
  state: CombatState;
  intent: ActionIntent;
  step: Extract<IntentStep, { kind: 'use_ability' }>;
  history?: CompileIntentHistory;
  maxCandidates: number;
  stepIndex: number;
}): CompileIntentResult => {
  const { state, intent, step } = options;
  const actorId = intent.actorId;
  const abilityIds = resolveAbilitySelector({ state, actorId, selector: step.ability });
  if (abilityIds.length === 0) {
    // Distinguish "this ability does not exist" from "you do not have it".
    const tag = step.ability.kind === 'tag' ? step.ability.value.toLowerCase() : '';
    const catalogued =
      step.ability.kind === 'strongest' ||
      Object.values(state.abilityCatalog).some(
        (ability) => ability.abilityId.toLowerCase() === tag || ability.kind.toLowerCase() === tag,
      );
    return rejection(catalogued ? 'abilityNotAvailable' : 'abilityUnknown');
  }

  const legalActions = getLegalActions({ state, combatantId: actorId });
  for (const abilityId of abilityIds) {
    const legalTargets = legalActions.targetsByAbility[abilityId] ?? [];
    if (legalTargets.length === 0) {
      continue;
    }
    const resolved = resolveEntitySelector({
      state,
      actorId,
      selector: step.target,
      ...(options.history === undefined ? {} : { history: options.history }),
    });
    const addressable = resolved.ordered.filter((id) => legalTargets.includes(id));
    if (addressable.length === 0) {
      continue;
    }
    const ambiguous = resolved.ambiguous.filter((id) => legalTargets.includes(id));
    const candidates: IntentPlanCandidate[] = [];
    // A nearest-* tie (or several name matches) is a material ambiguity: the
    // player asked for "the nearest", and two exist. A unique reading — the
    // first element of a stable order — previews directly.
    const pool = ambiguous.length > 1 ? ambiguous : [addressable[0]];
    for (const targetId of pool.slice(0, options.maxCandidates)) {
      const command: CombatCommand = {
        kind: 'useAbility',
        combatantId: actorId,
        abilityId,
        targetIds: [targetId],
      };
      const grounded = groundCommand({
        state,
        intent,
        command,
        assumptions:
          options.stepIndex === 0
            ? [`target "${targetId}" resolved deterministically`]
            : [`step ${options.stepIndex + 1} compiled as the first legal step`],
      });
      if (!grounded.ok) {
        continue;
      }
      candidates.push({
        plan: { ...grounded.plan, planId: `${intent.intentId}:${candidates.length + 1}` },
        step,
      });
    }
    if (candidates.length === 0) {
      continue;
    }
    const clarification = decideIntentClarification(candidates);
    if (clarification === null) {
      return { ok: true, kind: 'plan', plan: candidates[0].plan };
    }
    return {
      ok: true,
      kind: 'clarification',
      clarification,
      plans: candidates.map((candidate) => candidate.plan),
    };
  }

  // The ability resolved, but no target the selector named is legal for it.
  const resolved = resolveEntitySelector({
    state,
    actorId,
    selector: step.target,
    ...(options.history === undefined ? {} : { history: options.history }),
  });
  return rejection(resolved.ordered.length === 0 ? 'targetInvalid' : 'targetOutOfRange');
};

const compileStep = (options: {
  state: CombatState;
  intent: ActionIntent;
  step: IntentStep;
  stepIndex: number;
  history?: CompileIntentHistory;
  maxCandidates: number;
}): CompileIntentResult => {
  const { state, intent, step } = options;
  const actorId = intent.actorId;

  switch (step.kind) {
    case 'move': {
      const grounded = destinationCellFor({
        state,
        actorId,
        destination: step.destination,
        ...(step.stopAt === undefined ? {} : { stopAt: step.stopAt }),
        ...(options.history === undefined ? {} : { history: options.history }),
      });
      if (!grounded.ok) {
        return rejection(grounded.reasonCode);
      }
      const plan = groundCommand({
        state,
        intent,
        command: grounded.command,
        assumptions: grounded.assumptions,
      });
      if (!plan.ok) {
        return rejection(plan.reasonCode);
      }
      return { ok: true, kind: 'plan', plan: plan.plan };
    }
    case 'defend':
    case 'wait':
    case 'end_turn': {
      const kind = step.kind === 'end_turn' ? 'endTurn' : step.kind;
      const command: CombatCommand = { kind, combatantId: actorId };
      const plan = groundCommand({ state, intent, command, assumptions: [] });
      if (!plan.ok) {
        return rejection(plan.reasonCode);
      }
      return { ok: true, kind: 'plan', plan: plan.plan };
    }
    case 'use_ability': {
      return compileUseAbility({
        state,
        intent,
        step,
        ...(options.history === undefined ? {} : { history: options.history }),
        maxCandidates: options.maxCandidates,
        stepIndex: options.stepIndex,
      });
    }
    default:
      // `interact` / `attempt_improvised_action` are reserved for Combat-07 and
      // are not in the Combat-05 vocabulary.
      return rejection('invalidCommandShape');
  }
};

/**
 * Grounds one intent against the live snapshot.
 *
 * Rejects before doing anything else when the intent is bound to a revision
 * that no longer matches, when the encounter ended or when the actor is
 * unknown — a stale intent is never compiled against newer state (AC-3 Edge
 * Cases). A multi-step intent compiles its FIRST step and says so in
 * `assumptions`; the remaining steps are never silently dropped (Edge Cases).
 */
export const compileActionIntent = (options: CompileIntentOptions): CompileIntentResult => {
  const { state, intent } = options;
  const maxCandidates = options.maxCandidates ?? COMBAT_INTENT_BOUNDS.clarificationOptions;

  if (state.phase === 'ended') {
    return rejection('encounterEnded');
  }
  if (intent.encounterId !== state.encounterId) {
    return rejection('targetInvalid');
  }
  if (intent.basedOnRevision !== state.stateRevision) {
    return rejection('staleRevision');
  }
  if (state.combatants[intent.actorId] === undefined) {
    return rejection('actorUnknown');
  }
  const firstStep = intent.steps[0];
  if (firstStep === undefined) {
    return rejection('invalidCommandShape');
  }

  const compiled = compileStep({
    state,
    intent,
    step: firstStep,
    stepIndex: 0,
    ...(options.history === undefined ? {} : { history: options.history }),
    maxCandidates,
  });

  if (!compiled.ok) {
    return compiled;
  }
  if (intent.steps.length <= 1 || compiled.kind !== 'plan') {
    return compiled;
  }
  // Multi-step intents are deferred (Combat-05 compiles a single command): the
  // partial plan carries the fact instead of pretending the whole intent ran.
  return {
    ok: true,
    kind: 'plan',
    plan: {
      ...compiled.plan,
      assumptions: [
        `partial: only step 1 of ${intent.steps.length} compiled (Combat-05 compiles a single command)`,
        ...compiled.plan.assumptions,
      ].slice(0, COMBAT_INTENT_BOUNDS.assumptions),
    },
  };
};
