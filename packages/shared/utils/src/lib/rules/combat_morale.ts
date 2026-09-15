// packages/shared/utils/src/lib/rules/combat_morale.ts
//
// Pure, deterministic morale authority — Combat-08.
//
// There is exactly ONE mechanical morale authority: the bounded 0–100 integer
// carried in `ParticipationState.morale`. The pre-existing qualitative
// `CombatMorale` band (`'steady' | 'shaken' | 'wavering' | 'broken'`) that AI
// decisions consume is a DERIVED VIEW produced by `moraleBandFromValue` using
// `MORALE_BAND_THRESHOLDS` below. The band never mutates mechanical morale.
//
// Crossing a threshold *permits* an authored response; it never declares an
// outcome. Outcomes are produced by the settlement pass.
//
// Contract: C-532 AC-2

import { gridPointKey } from '@aikami/schemas';
import type {
  CombatMorale,
  GridPoint,
  MoraleResponseKind,
  MoraleResponseRule,
  MoraleRules,
  ParticipationState,
} from '@aikami/types';

// ---------------------------------------------------------------------------
// Band mapping (the single documented projection)
// ---------------------------------------------------------------------------

/**
 * The one documented mapping from numeric morale onto the AI-consumed
 * qualitative band. Inclusive lower bounds, evaluated high → low.
 */
export const MORALE_BAND_THRESHOLDS: readonly { minMorale: number; band: CombatMorale }[] = [
  { minMorale: 75, band: 'steady' },
  { minMorale: 50, band: 'shaken' },
  { minMorale: 25, band: 'wavering' },
  { minMorale: 0, band: 'broken' },
] as const;

/** Derives the AI-visible band from mechanical morale. Never the reverse. */
export const moraleBandFromValue = (morale: number): CombatMorale => {
  for (const threshold of MORALE_BAND_THRESHOLDS) {
    if (morale >= threshold.minMorale) {
      return threshold.band;
    }
  }
  return 'broken';
};

// ---------------------------------------------------------------------------
// Triggers
// ---------------------------------------------------------------------------

/**
 * Canonical trigger id for a morale source. A trigger is applied at most once
 * per combatant for the whole encounter; the id is the exactly-once key.
 */
export const moraleTriggerId = (triggerKind: string, sourceId: string): string =>
  `${triggerKind}:${sourceId}`;

export type MoraleTriggerEvent =
  | { kind: 'leader_defeated'; leaderId: string }
  | { kind: 'ally_removed'; removedId: string }
  | { kind: 'objective_failed'; objectiveId: string };

export type MoraleApplication = {
  participation: Record<string, ParticipationState>;
  /** Combatants whose morale actually changed, in stable id order. */
  changedCombatantIds: string[];
  /** Trigger ids applied in this call, in application order. */
  appliedTriggerIds: string[];
  /** Combatants whose morale crossed the break threshold in this call. */
  crossedBreakThresholdIds: string[];
  /** Combatants whose derived AI band changed in this call. */
  bandChangedCombatantIds: string[];
};

const clampMorale = (value: number): number => Math.max(0, Math.min(100, value));

/**
 * Applies one trigger event to every combatant on `affectedTeam`.
 *
 * `teamOf` resolves a combatant's team from the caller's roster — the evaluator
 * never reads engine state. `sourceId` is the removed/failed entity; the
 * canonical trigger id makes the application idempotent per combatant.
 */
export const applyMoraleTrigger = (options: {
  rules: MoraleRules;
  participation: Record<string, ParticipationState>;
  event: MoraleTriggerEvent;
  /** Combatant ids that should receive the trigger, in stable id order. */
  affectedCombatantIds: readonly string[];
}): MoraleApplication => {
  const { rules, event } = options;
  let triggerKind: 'leader_defeated' | 'ally_removed' | 'objective_failed' = 'objective_failed';
  let sourceId = '';
  if (event.kind === 'leader_defeated') {
    triggerKind = 'leader_defeated';
    sourceId = event.leaderId;
  } else if (event.kind === 'ally_removed') {
    triggerKind = 'ally_removed';
    sourceId = event.removedId;
  } else {
    sourceId = event.objectiveId;
  }
  const triggerId = moraleTriggerId(triggerKind, sourceId);
  const rule = rules.triggers.find((entry) => entry.triggerKind === triggerKind);

  const participation: Record<string, ParticipationState> = { ...options.participation };
  const changedCombatantIds: string[] = [];
  const crossedBreakThresholdIds: string[] = [];
  const bandChangedCombatantIds: string[] = [];

  if (rule === undefined) {
    return {
      participation,
      changedCombatantIds,
      appliedTriggerIds: [],
      crossedBreakThresholdIds,
      bandChangedCombatantIds,
    };
  }

  for (const combatantId of [...options.affectedCombatantIds].sort()) {
    const current = participation[combatantId];
    if (current === undefined) {
      continue;
    }
    if (current.appliedTriggerIds.includes(triggerId)) {
      // Exactly-once: the same source event never moves morale twice.
      continue;
    }
    const before = current.morale;
    const after = clampMorale(before - rule.magnitude);
    const next: ParticipationState = {
      ...current,
      morale: after,
      appliedTriggerIds: [...current.appliedTriggerIds, triggerId],
    };
    participation[combatantId] = next;
    changedCombatantIds.push(combatantId);
    if (before > rules.breakThreshold && after <= rules.breakThreshold) {
      crossedBreakThresholdIds.push(combatantId);
    }
    if (moraleBandFromValue(before) !== moraleBandFromValue(after)) {
      bandChangedCombatantIds.push(combatantId);
    }
  }

  return {
    participation,
    changedCombatantIds,
    appliedTriggerIds: changedCombatantIds.length > 0 ? [triggerId] : [],
    crossedBreakThresholdIds,
    bandChangedCombatantIds,
  };
};

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

/** The authored response of `responseKind`, or `null` when not authored. */
export const authoredMoraleResponse = (
  rules: MoraleRules,
  responseKind: MoraleResponseKind,
): MoraleResponseRule | null =>
  rules.responses.find((response) => response.responseKind === responseKind) ?? null;

/**
 * Whether the authored rules offer a `retreat` response AND the actor's morale
 * has reached the break threshold. A retreat is never legal merely because the
 * rules name one — the actor must actually be broken.
 */
export const retreatIsPermitted = (
  rules: MoraleRules,
  participation: ParticipationState,
): boolean => {
  const response = authoredMoraleResponse(rules, 'retreat');
  if (response === null || response.exitZoneId === null) {
    return false;
  }
  return moraleAllowsResponse(rules, participation);
};

/** The same test for surrender. */
export const surrenderIsPermitted = (
  rules: MoraleRules,
  participation: ParticipationState,
): boolean =>
  authoredMoraleResponse(rules, 'surrender') !== null && moraleAllowsResponse(rules, participation);

/** Every cell of the authored exit zone, or `[]` when it is not authored. */
export const exitZoneCellsFor = (rules: MoraleRules, exitZoneId: string): GridPoint[] =>
  rules.exitZones.find((zone) => zone.zoneId === exitZoneId)?.cells ?? [];

/**
 * Distance from `cell` to the nearest authored exit-zone cell. `Infinity` when
 * the zone is empty, so a caller comparing distances can never treat an
 * unauthored zone as "already there".
 */
export const distanceToExitZone = (options: {
  rules: MoraleRules;
  exitZoneId: string;
  cell: GridPoint;
}): number => {
  const cells = exitZoneCellsFor(options.rules, options.exitZoneId);
  if (cells.length === 0) {
    return Number.POSITIVE_INFINITY;
  }
  let best = Number.POSITIVE_INFINITY;
  for (const zoneCell of cells) {
    const distance = Math.abs(zoneCell.x - options.cell.x) + Math.abs(zoneCell.y - options.cell.y);
    if (distance < best) {
      best = distance;
    }
  }
  return best;
};

/** True when `cell` is inside the authored exit zone. */
export const isInExitZone = (options: {
  rules: MoraleRules;
  exitZoneId: string;
  cell: GridPoint;
}): boolean =>
  exitZoneCellsFor(options.rules, options.exitZoneId).some(
    (zoneCell) => gridPointKey(zoneCell) === gridPointKey(options.cell),
  );

/** True when mechanical morale permits an authored nonlethal response. */
export const moraleAllowsResponse = (
  rules: MoraleRules,
  participation: ParticipationState,
): boolean => participation.morale <= rules.breakThreshold;

/** Authored responses currently permitted for a combatant. */
export const availableMoraleResponses = (
  rules: MoraleRules,
  participation: ParticipationState,
): MoraleResponseRule[] => (moraleAllowsResponse(rules, participation) ? rules.responses : []);

const exitZoneCells = (rules: MoraleRules, exitZoneId: string): GridPoint[] =>
  rules.exitZones.find((zone) => zone.zoneId === exitZoneId)?.cells ?? [];

/**
 * Whether a retreat is currently legal: the authored response must name an
 * exit zone and the actor must be able to move at least one cell toward it.
 * `reachableCells` is supplied by the caller from the tactical pathfinder —
 * this module never runs pathfinding itself.
 */
export const retreatIsLegal = (options: {
  rules: MoraleRules;
  response: MoraleResponseRule;
  reachableCells: readonly GridPoint[];
}): boolean => {
  if (options.response.responseKind !== 'retreat' || options.response.exitZoneId === null) {
    return false;
  }
  const zone = exitZoneCells(options.rules, options.response.exitZoneId);
  if (zone.length === 0) {
    return false;
  }
  const reachable = new Set(options.reachableCells.map(gridPointKey));
  return zone.some((cell) => reachable.has(gridPointKey(cell)));
};

/**
 * Deterministic response policy.
 *
 * Retreat is preferred whenever it is legal; otherwise the actor surrenders.
 * A retreat that is blocked never leaves the actor stuck — the fallback is a
 * legal response from the same authored policy. Returns `null` when the
 * authored policy offers no legal response, in which case the actor keeps its
 * current participation and may choose another legal action normally.
 */
export const chooseMoraleResponse = (options: {
  rules: MoraleRules;
  participation: ParticipationState;
  reachableCells: readonly GridPoint[];
}): MoraleResponseKind | null => {
  const responses = availableMoraleResponses(options.rules, options.participation);
  if (responses.length === 0) {
    return null;
  }
  for (const response of responses) {
    if (response.responseKind === 'surrender') {
      return 'surrender';
    }
  }
  for (const response of responses) {
    if (
      retreatIsLegal({ rules: options.rules, response, reachableCells: options.reachableCells })
    ) {
      return 'retreat';
    }
  }
  return null;
};

// ---------------------------------------------------------------------------
// Participation transitions
// ---------------------------------------------------------------------------

/**
 * Applies a participation status change while preserving HP and identity.
 *
 * Escape and surrender are NOT represented as `hp = 0` or `defeated = true`:
 * the actor keeps its HP, its identity and its initiative slot.
 */
export const applyParticipationStatus = (options: {
  participation: ParticipationState;
  status: ParticipationState['status'];
}): ParticipationState => ({ ...options.participation, status: options.status });

/**
 * Whether a participation status is eligible for ordinary hostile attack
 * targeting. Surrendered and escaped actors are not; a retreating actor still
 * on the battlefield is.
 */
export const isHostileTargetEligible = (status: ParticipationState['status']): boolean =>
  status === 'active' || status === 'retreating';

/** Whether an actor still contests the encounter. */
export const stillContestsEncounter = (status: ParticipationState['status']): boolean =>
  status === 'active' || status === 'retreating';
