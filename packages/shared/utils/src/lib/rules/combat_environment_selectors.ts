// packages/shared/utils/src/lib/rules/combat_environment_selectors.ts
//
// The registered environmental selector vocabulary, check resolution and the
// declarative requirement evaluator that backs the object inspector.
//
// Selectors are data: an unknown selector is a `selectorUnresolved` rejection,
// never a silent empty result.
//
// Contract: C-531 AC-1, AC-2, AC-3, AC-4, AC-7

import type {
  AffordanceDefinition,
  BattlefieldObject,
  CombatantState,
  CombatInvalidReason,
  CombatState,
  GridPoint,
  ImpactZoneDefinition,
  RegisteredCheckDefinition,
  RegisteredEffect,
  SurfaceCell,
} from '@aikami/types';
import {
  cellsEqual,
  combatantsAtCell,
  compareCells,
  type EnvironmentalGeometry,
  failure,
  getEnvironmentalGeometry,
  hasEnvironmentalLineOfSight,
  manhattan,
  objectCells,
  orthogonalNeighbours,
  sortedObjects,
  sortedSurfaces,
} from './combat_environment_internal';
import { cellKey } from './combat_spatial';

// ---------------------------------------------------------------------------
// Selector vocabulary (AC-2)
// ---------------------------------------------------------------------------

/**
 * The registered selector vocabulary.
 *
 * Selectors are data — an unknown selector is a `selectorUnresolved`
 * rejection, never a silent empty result. Effects address objects, cells,
 * surfaces and combatants through these names only.
 */
export const OBJECT_SELECTORS = [
  'source',
  'target',
  'payloads',
  'ignitedObjects',
  'intactObjects',
  'brokenObjects',
  'allObjects',
] as const;

export const CELL_SELECTORS = [
  'sourceFootprint',
  'targetFootprint',
  'sourceCell',
  'targetCell',
  'adjacent',
  'actorCell',
] as const;

export const SURFACE_SELECTORS = [
  'allSurfaces',
  'surfaces:oil',
  'surfaces:fire',
  'sourceSurfaces',
] as const;

export const COMBATANT_SELECTORS = [
  'actor',
  'sourceCellOccupants',
  'targetCellOccupants',
  'allCombatants',
] as const;

/** An `impactZone:<zoneId>` selector resolves to the zone's absolute cells. */
export const IMPACT_ZONE_SELECTOR_PREFIX = 'impactZone:';

export type SelectorContext = {
  state: CombatState;
  actor: CombatantState;
  source: BattlefieldObject;
  target: BattlefieldObject | undefined;
};

export type ObjectSelectorResolution =
  | { ok: true; objects: BattlefieldObject[] }
  | { ok: false; reasonCode: CombatInvalidReason; messageKey: string };

export const resolveObjectSelector = (
  selector: string,
  context: SelectorContext,
): ObjectSelectorResolution => {
  const { state, source, target } = context;
  switch (selector) {
    case 'source':
      return { ok: true, objects: [source] };
    case 'target':
      return target === undefined ? failure('selectorUnresolved') : { ok: true, objects: [target] };
    case 'payloads':
      return {
        ok: true,
        objects: sortedObjects(state).filter(
          (object) => object.attachedToObjectId === source.objectId,
        ),
      };
    case 'ignitedObjects':
      return { ok: true, objects: sortedObjects(state).filter((object) => object.ignited) };
    case 'intactObjects':
      return {
        ok: true,
        objects: sortedObjects(state).filter((object) => object.state === 'intact'),
      };
    case 'brokenObjects':
      return {
        ok: true,
        objects: sortedObjects(state).filter((object) => object.state === 'broken'),
      };
    case 'allObjects':
      return { ok: true, objects: sortedObjects(state) };
    default:
      return failure('selectorUnresolved');
  }
};

export const resolveCellSelector = (
  selector: string,
  context: SelectorContext,
):
  | { ok: true; cells: GridPoint[] }
  | { ok: false; reasonCode: CombatInvalidReason; messageKey: string } => {
  const { state, actor, source, target } = context;
  switch (selector) {
    case 'sourceFootprint':
      return { ok: true, cells: objectCells(source).sort(compareCells) };
    case 'targetFootprint':
      return target === undefined
        ? failure('selectorUnresolved')
        : { ok: true, cells: objectCells(target).sort(compareCells) };
    case 'sourceCell':
      return { ok: true, cells: [{ x: source.position.x, y: source.position.y }] };
    case 'targetCell':
      return target === undefined
        ? failure('selectorUnresolved')
        : { ok: true, cells: [{ x: target.position.x, y: target.position.y }] };
    case 'adjacent':
      return { ok: true, cells: orthogonalNeighbours(source.position).sort(compareCells) };
    case 'actorCell':
      return { ok: true, cells: [{ x: actor.position.x, y: actor.position.y }] };
    default:
      if (selector.startsWith(IMPACT_ZONE_SELECTOR_PREFIX)) {
        const zoneId = selector.slice(IMPACT_ZONE_SELECTOR_PREFIX.length);
        const zone = state.environmentBundle.impactZones[zoneId];
        if (zone === undefined) {
          return failure('selectorUnresolved');
        }
        return { ok: true, cells: impactZoneCells({ zone, origin: source.position }) };
      }
      return failure('selectorUnresolved');
  }
};

/** Absolute, in-bounds, de-duplicated cells of an impact zone centred on `origin`. */
export const impactZoneCells = (options: {
  zone: ImpactZoneDefinition;
  origin: GridPoint;
}): GridPoint[] => {
  const seen = new Set<string>();
  const cells: GridPoint[] = [];
  for (const offset of options.zone.offsets) {
    const cell = { x: options.origin.x + offset.x, y: options.origin.y + offset.y };
    const key = cellKey(cell);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    cells.push(cell);
  }
  return cells.sort(compareCells);
};

export const resolveSurfaceSelector = (
  selector: string,
  context: SelectorContext,
):
  | { ok: true; surfaces: SurfaceCell[] }
  | { ok: false; reasonCode: CombatInvalidReason; messageKey: string } => {
  const surfaces = sortedSurfaces(context.state);
  switch (selector) {
    case 'allSurfaces':
      return { ok: true, surfaces };
    case 'surfaces:oil':
      return { ok: true, surfaces: surfaces.filter((surface) => surface.kind === 'oil') };
    case 'surfaces:fire':
      return { ok: true, surfaces: surfaces.filter((surface) => surface.kind === 'fire') };
    case 'sourceSurfaces':
      return {
        ok: true,
        surfaces: surfaces.filter((surface) => surface.sourceObjectId === context.source.objectId),
      };
    default:
      return failure('selectorUnresolved');
  }
};

export const resolveCombatantSelector = (
  selector: string,
  context: SelectorContext,
):
  | { ok: true; combatantIds: string[] }
  | { ok: false; reasonCode: CombatInvalidReason; messageKey: string } => {
  const { state, actor, source, target } = context;
  const idOf = (combatants: CombatantState[]): string[] => combatants.map((c) => c.combatantId);
  switch (selector) {
    case 'actor':
      return { ok: true, combatantIds: [actor.combatantId] };
    case 'sourceCellOccupants':
      return { ok: true, combatantIds: idOf(combatantsAtCell(state, source.position)) };
    case 'targetCellOccupants':
      return target === undefined
        ? failure('selectorUnresolved')
        : { ok: true, combatantIds: idOf(combatantsAtCell(state, target.position)) };
    case 'allCombatants':
      return {
        ok: true,
        combatantIds: Object.values(state.combatants)
          .filter((combatant) => !combatant.defeated)
          .sort((a, b) => (a.combatantId < b.combatantId ? -1 : 1))
          .map((combatant) => combatant.combatantId),
      };
    default:
      return failure('selectorUnresolved');
  }
};

// ---------------------------------------------------------------------------
// Checks (AC-2)
// ---------------------------------------------------------------------------

/**
 * The modifier a registered check resolves to.
 *
 * Returns `undefined` when the acting combatant's snapshot carries no value for
 * `modifierSource`. That is a rejection (`checkModifierUnavailable`) — the
 * kernel never substitutes an unrelated bonus such as `attackBonus`.
 */
export const resolveCheckModifier = (options: {
  actor: CombatantState;
  check: RegisteredCheckDefinition;
}): number | undefined => {
  const projected = options.actor.checkModifiers?.[options.check.modifierSource];
  return projected === undefined ? undefined : projected;
};

/** Advisory success probability — 0..1, never a dice result. */
export const successOdds = (options: { modifier: number; dc: number }): number => {
  // d20 + modifier ≥ dc. Faces 1..20 are equally likely; natural 1/20 carry no
  // special check behaviour unless a registered rule says so.
  const needed = options.dc - options.modifier;
  const successes = Math.max(0, Math.min(20, 20 - needed + 1));
  return successes / 20;
};

// ---------------------------------------------------------------------------
// Requirements (AC-2)
// ---------------------------------------------------------------------------

export const evaluateRequirement = (options: {
  state: CombatState;
  geometry: EnvironmentalGeometry;
  actor: CombatantState;
  object: BattlefieldObject;
  requirement: { kind: string; value: string | number | boolean };
}): { ok: true } | { ok: false; reasonCode: CombatInvalidReason; messageKey: string } => {
  const { state, geometry, actor, object, requirement } = options;
  switch (requirement.kind) {
    case 'adjacent': {
      if (requirement.value !== true) {
        return { ok: true };
      }
      const cells = objectCells(object);
      const adjacent = cells.some((cell) =>
        orthogonalNeighbours(cell).some((neighbour) => cellsEqual(neighbour, actor.position)),
      );
      return adjacent ? { ok: true } : failure('requirementUnmet');
    }
    case 'lineOfSight': {
      if (requirement.value !== true) {
        return { ok: true };
      }
      return hasEnvironmentalLineOfSight({
        state,
        geometry,
        from: actor.position,
        to: object.position,
      })
        ? { ok: true }
        : failure('requirementUnmet');
    }
    case 'range': {
      const maximum = typeof requirement.value === 'number' ? requirement.value : 0;
      return manhattan(actor.position, object.position) <= maximum
        ? { ok: true }
        : failure('requirementUnmet');
    }
    case 'budget': {
      const cost = requirement.value;
      if (cost === 'action') {
        return actor.budget.actionAvailable ? { ok: true } : failure('noActionAvailable');
      }
      if (cost === 'quick') {
        return actor.budget.quickActionAvailable ? { ok: true } : failure('noActionAvailable');
      }
      return { ok: true };
    }
    case 'objectState': {
      return object.state === requirement.value ? { ok: true } : failure('objectDestroyed');
    }
    case 'surfaceKind': {
      const kind = requirement.value;
      const present = sortedSurfaces(state).some(
        (surface) =>
          surface.kind === kind &&
          objectCells(object).some((cell) => cellsEqual(cell, surface.cell)),
      );
      return present ? { ok: true } : failure('requirementUnmet');
    }
    default:
      return failure('requirementUnmet');
  }
};

/**
 * Eligibility of one authored affordance on one object for one actor.
 *
 * Pure: no mutation, no RNG. `validateCombatCommand` and the object inspector
 * both read this — the inspector reports the same reason the kernel would.
 */
export const evaluateAffordanceEligibility = (options: {
  state: CombatState;
  actor: CombatantState;
  object: BattlefieldObject;
  affordance: AffordanceDefinition;
  targetObjectId: string | null;
}): { ok: true } | { ok: false; reasonCode: CombatInvalidReason; messageKey: string } => {
  const { state, actor, object, affordance, targetObjectId } = options;
  const geometry = getEnvironmentalGeometry(state);
  const target = targetObjectId === null ? undefined : state.environment.objects[targetObjectId];

  if (targetObjectId !== null && target === undefined) {
    return failure('objectUnknown');
  }

  for (const requirement of affordance.requirements) {
    const outcome = evaluateRequirement({ state, geometry, actor, object, requirement });
    if (!outcome.ok) {
      return outcome;
    }
  }

  // A declared check whose modifier source is missing is a rejection, not a
  // silent unmodified roll.
  if (
    affordance.check !== null &&
    resolveCheckModifier({ actor, check: affordance.check }) === undefined
  ) {
    return failure('checkModifierUnavailable');
  }

  // Selectors are validated before the roll so an unresolvable effect can never
  // consume the attempt cost.
  for (const effect of [...affordance.successEffects, ...affordance.failureEffects]) {
    const selectorCheck = validateEffectSelectors({
      state,
      actor,
      source: object,
      target,
      effect,
    });
    if (!selectorCheck.ok) {
      return selectorCheck;
    }
  }

  return { ok: true };
};

export const validateEffectSelectors = (options: {
  state: CombatState;
  actor: CombatantState;
  source: BattlefieldObject;
  target: BattlefieldObject | undefined;
  effect: RegisteredEffect;
}): { ok: true } | { ok: false; reasonCode: CombatInvalidReason; messageKey: string } => {
  const context: SelectorContext = {
    state: options.state,
    actor: options.actor,
    source: options.source,
    target: options.target,
  };
  const effect = options.effect;
  switch (effect.kind) {
    case 'damage':
      return toEligibility(resolveCombatantSelector(effect.targetSelector, context));
    case 'forcedMovement':
      return toEligibility(resolveCombatantSelector(effect.targetSelector, context));
    case 'setObjectState':
    case 'moveObject':
    case 'setIgnited':
    case 'setCover':
    case 'dropPayload':
      return toEligibility(resolveObjectSelector(effect.objectSelector, context));
    case 'createSurface':
      return toEligibility(resolveCellSelector(effect.cellSelector, context));
    case 'removeSurface':
      return toEligibility(resolveSurfaceSelector(effect.surfaceSelector, context));
    default:
      return failure('selectorUnresolved');
  }
};

export const toEligibility = (
  resolution: { ok: true } | { ok: false; reasonCode: CombatInvalidReason; messageKey: string },
): { ok: true } | { ok: false; reasonCode: CombatInvalidReason; messageKey: string } =>
  resolution.ok ? { ok: true } : resolution;

// ---------------------------------------------------------------------------
// Object inspector (AC-4)
// ---------------------------------------------------------------------------

/** One affordance as the object inspector presents it. */
export type ObjectAffordanceView = {
  objectId: string;
  definitionId: string;
  affordanceId: string;
  name: string;
  actionCost: AffordanceDefinition['actionCost'];
  available: boolean;
  /** `null` when available; otherwise the same reason the kernel would reject with. */
  unavailableReasonCode: CombatInvalidReason | null;
  unavailableMessageKey: string | null;
};

/**
 * Every affordance of every object, with availability and the reason an
 * unavailable one is unavailable — "why others are unavailable" is part of the
 * inspector contract.
 */
export const getObjectAffordances = (options: {
  state: CombatState;
  actorId: string;
  targetObjectId?: string | null;
}): ObjectAffordanceView[] => {
  const actor = options.state.combatants[options.actorId];
  if (actor === undefined) {
    return [];
  }
  const targetObjectId = options.targetObjectId ?? null;
  const views: ObjectAffordanceView[] = [];

  for (const object of sortedObjects(options.state)) {
    const definition = options.state.environmentBundle.objectDefinitions[object.definitionId];
    if (definition === undefined) {
      continue;
    }
    for (const affordanceId of object.affordanceIds) {
      const affordance = options.state.environmentBundle.affordances[affordanceId];
      if (affordance === undefined) {
        continue;
      }
      if (!definition.affordanceIds.includes(affordanceId)) {
        continue;
      }
      const outcome = evaluateAffordanceEligibility({
        state: options.state,
        actor,
        object,
        affordance,
        targetObjectId,
      });
      views.push({
        objectId: object.objectId,
        definitionId: object.definitionId,
        affordanceId,
        name: affordance.name,
        actionCost: affordance.actionCost,
        available: outcome.ok,
        unavailableReasonCode: outcome.ok ? null : outcome.reasonCode,
        unavailableMessageKey: outcome.ok ? null : outcome.messageKey,
      });
    }
  }

  return views;
};
