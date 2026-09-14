// packages/shared/utils/src/lib/rules/combat_environment.ts
//
// Combat-07 environmental registry and deterministic resolver.
//
// The registry is DATA: authored affordances declare cost, prerequisites, a
// check and both outcome branches; this module is the single implementation
// that evaluates them. Adding a usable object means composing registered
// affordances — never writing object-specific engine code and never adding a
// "brazier-on-goblin" command.
//
// Module graph (must stay acyclic):
//   combat_spatial.ts       ← combat_environment.ts
//   combat_message_keys.ts  ← combat_environment.ts
//   combat_environment.ts   ← combat_kernel.ts
//
// Contract: C-531 AC-1, AC-2, AC-3, AC-7

import { COMBAT_ENVIRONMENT_BOUNDS } from '@aikami/schemas';
import type {
  ActionForecast,
  AffordanceDefinition,
  BattlefieldObject,
  BattlefieldObjectDefinition,
  CombatEnvironmentBundle,
  CombatEvent,
  CombatEventEnvelope,
  CombatInteractWithObjectCommand,
  CombatInvalidReason,
  CombatantState,
  CombatState,
  CoverLevel,
  DamageTypeKey,
  EnvironmentalDamageAppliedEvent,
  EnvironmentalForecastEffect,
  GridPoint,
  ImpactZoneDefinition,
  RegisteredCheckDefinition,
  RegisteredEffect,
  SurfaceCell,
  SurfaceKind,
} from '@aikami/types';
import { cellKey, hasLineOfSight, isCellImpassable } from './combat_spatial';
import { COMBAT_MESSAGE_KEYS } from './combat_message_keys';
import type { SeedableRng } from '../rng/seedable_rng';

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/** Rules version stamped on the pinned environmental dependency bundle. */
export const COMBAT_ENVIRONMENT_RULES_VERSION = 'combat-environment-1.0.0';

/** Cover AC modifiers. `half` and `full` are the only registered levels. */
export const COVER_ARMOR_CLASS_MODIFIERS: Record<CoverLevel, number> = {
  none: 0,
  half: 2,
  full: 5,
};

/**
 * Registered hazard families.
 *
 * A hazard family is the identity the "at most one hit per actor per round"
 * rule is stamped with. Fire surfaces are the only registered family in v1.
 */
export const REGISTERED_HAZARD_FAMILIES: Record<
  string,
  {
    hazardFamilyId: string;
    surfaceKind: SurfaceKind;
    diceExpression: string;
    damageType: DamageTypeKey;
  }
> = {
  fire: {
    hazardFamilyId: 'fire',
    surfaceKind: 'fire',
    diceExpression: '1d4',
    damageType: 'fire',
  },
};

/** The hazard family a surface kind belongs to, or `null` when it has none. */
export const hazardFamilyForSurfaceKind = (kind: SurfaceKind): string | null => {
  for (const family of Object.values(REGISTERED_HAZARD_FAMILIES)) {
    if (family.surfaceKind === kind) {
      return family.hazardFamilyId;
    }
  }
  return null;
};

// ---------------------------------------------------------------------------
// Result shapes
// ---------------------------------------------------------------------------

/** Structural match for `CombatValidationResult` — the kernel returns it as-is. */
export type EnvironmentalEligibility =
  | { valid: true; normalizedCommand: CombatInteractWithObjectCommand }
  | { valid: false; reasonCode: CombatInvalidReason; messageKey: string };

export type EnvironmentalResolution =
  | { ok: true; events: CombatEvent[] }
  | { ok: false; reasonCode: CombatInvalidReason; messageKey: string };

const failure = (reasonCode: CombatInvalidReason) => ({
  ok: false as const,
  reasonCode,
  messageKey: COMBAT_MESSAGE_KEYS[reasonCode],
});

const rejection = (reasonCode: CombatInvalidReason): EnvironmentalResolution => ({
  ok: false,
  reasonCode,
  messageKey: COMBAT_MESSAGE_KEYS[reasonCode],
});

/** Wraps an `{ ok: false }` outcome in the kernel's validation result shape. */
const toValidationFailure = (outcome: {
  reasonCode: CombatInvalidReason;
  messageKey: string;
}): EnvironmentalEligibility => ({
  valid: false,
  reasonCode: outcome.reasonCode,
  messageKey: outcome.messageKey,
});

// ---------------------------------------------------------------------------
// Derived geometry (AC-3)
// ---------------------------------------------------------------------------

/**
 * Walkability, sight blocking and cover derived from IMMUTABLE terrain plus
 * CURRENT object state.
 *
 * Destroying an object never erases terrain data: the terrain lists are copied
 * verbatim and object contributions are added on top.
 */
export type EnvironmentalGeometry = {
  /** Terrain-blocked cells plus intact `blocksMovement` object footprints. */
  blockedCells: GridPoint[];
  /** Terrain-opaque cells plus intact `blocksSight` object footprints. */
  sightBlockingCells: GridPoint[];
  /** Best cover available per cell, keyed `"x,y"`. */
  coverByCell: Record<string, CoverLevel>;
};

const compareCells = (a: GridPoint, b: GridPoint): number => a.y - b.y || a.x - b.x;

/**
 * Every absolute cell an object currently occupies.
 *
 * `footprint` holds offsets relative to `position` and always includes the
 * origin offset `{ x: 0, y: 0 }`, so a single-cell object is a one-element
 * footprint.
 */
export const objectCells = (object: BattlefieldObject): GridPoint[] =>
  object.footprint
    .map((cell) => ({ x: object.position.x + cell.x, y: object.position.y + cell.y }))
    .sort(compareCells);

const bestCover = (current: CoverLevel | undefined, next: CoverLevel): CoverLevel => {
  const rank: Record<CoverLevel, number> = { none: 0, half: 1, full: 2 };
  if (current === undefined) {
    return next;
  }
  return rank[next] > rank[current] ? next : current;
};

/**
 * Projects the environmental geometry for a state.
 *
 * Output order is deterministic: blocked and sight-blocking cells are sorted
 * by `y` then `x`, and `coverByCell` keys are inserted in that same order.
 */
export const getEnvironmentalGeometry = (state: CombatState): EnvironmentalGeometry => {
  const blocked = new Map<string, GridPoint>();
  const sightBlocking = new Map<string, GridPoint>();
  const cover = new Map<string, CoverLevel>();

  for (const cell of state.battlefield.blockedCells) {
    blocked.set(cellKey(cell), { x: cell.x, y: cell.y });
  }
  const terrainSight = state.battlefield.blocksSight;
  if (terrainSight !== undefined) {
    for (let y = 0; y < state.battlefield.height; y++) {
      for (let x = 0; x < state.battlefield.width; x++) {
        if (terrainSight[y * state.battlefield.width + x] === true) {
          sightBlocking.set(cellKey({ x, y }), { x, y });
        }
      }
    }
  }

  for (const object of sortedObjects(state)) {
    if (object.state !== 'intact') {
      continue;
    }
    const definition = state.environmentBundle.objectDefinitions[object.definitionId];
    for (const cell of objectCells(object)) {
      const key = cellKey(cell);
      if (definition?.blocksMovement === true) {
        blocked.set(key, cell);
      }
      if (definition?.blocksSight === true) {
        sightBlocking.set(key, cell);
      }
      if (object.cover !== 'none') {
        cover.set(key, bestCover(cover.get(key), object.cover));
      }
    }
  }

  return {
    blockedCells: [...blocked.values()].sort(compareCells),
    sightBlockingCells: [...sightBlocking.values()].sort(compareCells),
    coverByCell: Object.fromEntries(
      [...cover.entries()].sort(([a], [b]) => (a < b ? -1 : 1)),
    ) as Record<string, CoverLevel>,
  };
};

/** Whether derived geometry makes a cell impassable (terrain ∪ intact objects). */
export const isEnvironmentallyBlocked = (options: {
  state: CombatState;
  geometry: EnvironmentalGeometry;
  cell: GridPoint;
}): boolean => {
  if (isCellImpassable({ battlefield: options.state.battlefield, cell: options.cell })) {
    return true;
  }
  const key = cellKey(options.cell);
  return options.geometry.blockedCells.some((cell) => cellKey(cell) === key);
};

/** Cover level available at a cell under current object state. */
export const coverAt = (options: {
  geometry: EnvironmentalGeometry;
  cell: GridPoint;
}): CoverLevel => options.geometry.coverByCell[cellKey(options.cell)] ?? 'none';

/** Line of sight over terrain occlusion ∪ intact sight-blocking objects. */
export const hasEnvironmentalLineOfSight = (options: {
  state: CombatState;
  geometry: EnvironmentalGeometry;
  from: GridPoint;
  to: GridPoint;
}): boolean => {
  if (!hasLineOfSight({ battlefield: options.state.battlefield, from: options.from, to: options.to })) {
    return false;
  }
  const sightKeys = new Set(options.geometry.sightBlockingCells.map((cell) => cellKey(cell)));
  if (sightKeys.size === 0) {
    return true;
  }
  const from = options.from;
  const to = options.to;
  if (from.x === to.x && from.y === to.y) {
    return true;
  }
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  const stepX = from.x < to.x ? 1 : -1;
  const stepY = from.y < to.y ? 1 : -1;
  let x = from.x;
  let y = from.y;
  let err = dx - dy;
  let firstStep = true;
  for (let step = 0; step <= dx + dy; step++) {
    const isTarget = x === to.x && y === to.y;
    if (!firstStep && !isTarget && sightKeys.has(cellKey({ x, y }))) {
      return false;
    }
    firstStep = false;
    if (isTarget) {
      return true;
    }
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += stepX;
    }
    if (e2 < dx) {
      err += dx;
      y += stepY;
    }
  }
  return true;
};

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

/** Stable ordering: object id ascending — every tie-break ends here. */
export const sortedObjects = (state: CombatState): BattlefieldObject[] =>
  Object.values(state.environment.objects).sort((a, b) => (a.objectId < b.objectId ? -1 : 1));

/** Stable ordering: surface id ascending. */
export const sortedSurfaces = (state: CombatState): SurfaceCell[] =>
  [...state.environment.surfaces].sort((a, b) => (a.surfaceId < b.surfaceId ? -1 : 1));

const objectAtCell = (state: CombatState, cell: GridPoint): BattlefieldObject | undefined =>
  sortedObjects(state).find((object) =>
    objectCells(object).some((occupied) => occupied.x === cell.x && occupied.y === cell.y),
  );

const combatantsAtCell = (state: CombatState, cell: GridPoint): CombatantState[] =>
  Object.values(state.combatants)
    .filter(
      (combatant) =>
        !combatant.defeated &&
        combatant.position.x === cell.x &&
        combatant.position.y === cell.y,
    )
    .sort((a, b) => (a.combatantId < b.combatantId ? -1 : 1));

const isCellOccupiedByCombatant = (state: CombatState, cell: GridPoint): boolean =>
  combatantsAtCell(state, cell).length > 0;

const cellsEqual = (a: GridPoint, b: GridPoint): boolean => a.x === b.x && a.y === b.y;

const orthogonalNeighbours = (cell: GridPoint): GridPoint[] => [
  { x: cell.x, y: cell.y - 1 },
  { x: cell.x, y: cell.y + 1 },
  { x: cell.x - 1, y: cell.y },
  { x: cell.x + 1, y: cell.y },
];

const manhattan = (a: GridPoint, b: GridPoint): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

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

type SelectorContext = {
  state: CombatState;
  actor: CombatantState;
  source: BattlefieldObject;
  target: BattlefieldObject | undefined;
};

type ObjectSelectorResolution =
  | { ok: true; objects: BattlefieldObject[] }
  | { ok: false; reasonCode: CombatInvalidReason; messageKey: string };

const resolveObjectSelector = (
  selector: string,
  context: SelectorContext,
): ObjectSelectorResolution => {
  const { state, source, target } = context;
  switch (selector) {
    case 'source':
      return { ok: true, objects: [source] };
    case 'target':
      return target === undefined
        ? failure('selectorUnresolved')
        : { ok: true, objects: [target] };
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
      return { ok: true, objects: sortedObjects(state).filter((object) => object.state === 'intact') };
    case 'brokenObjects':
      return { ok: true, objects: sortedObjects(state).filter((object) => object.state === 'broken') };
    case 'allObjects':
      return { ok: true, objects: sortedObjects(state) };
    default:
      return failure('selectorUnresolved');
  }
};

const resolveCellSelector = (
  selector: string,
  context: SelectorContext,
): { ok: true; cells: GridPoint[] } | { ok: false; reasonCode: CombatInvalidReason; messageKey: string } => {
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
export const impactZoneCells = (options: { zone: ImpactZoneDefinition; origin: GridPoint }): GridPoint[] => {
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

const resolveSurfaceSelector = (
  selector: string,
  context: SelectorContext,
): { ok: true; surfaces: SurfaceCell[] } | { ok: false; reasonCode: CombatInvalidReason; messageKey: string } => {
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

const resolveCombatantSelector = (
  selector: string,
  context: SelectorContext,
): { ok: true; combatantIds: string[] } | { ok: false; reasonCode: CombatInvalidReason; messageKey: string } => {
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

const evaluateRequirement = (options: {
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
        orthogonalNeighbours(cell).some((neighbour) =>
          cellsEqual(neighbour, actor.position),
        ),
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
  const target =
    targetObjectId === null ? undefined : state.environment.objects[targetObjectId];

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
  if (affordance.check !== null && resolveCheckModifier({ actor, check: affordance.check }) === undefined) {
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

const validateEffectSelectors = (options: {
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

const toEligibility = (
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

// ---------------------------------------------------------------------------
// Validation (AC-2)
// ---------------------------------------------------------------------------

/**
 * Validates an environmental command without touching state and without
 * rolling dice.
 *
 * `targetObjectId` is normalized to `null` when absent so a commit and a
 * preview hash identically.
 */
export const validateEnvironmentalCommand = (options: {
  state: CombatState;
  actorId: string;
  command: CombatInteractWithObjectCommand;
}): EnvironmentalEligibility => {
  const { state, command } = options;
  const actor = state.combatants[options.actorId];
  if (actor === undefined) {
    return toValidationFailure(failure('actorUnknown'));
  }

  const object = state.environment.objects[command.objectId];
  if (object === undefined) {
    return toValidationFailure(failure('objectUnknown'));
  }
  const definition: BattlefieldObjectDefinition | undefined =
    state.environmentBundle.objectDefinitions[object.definitionId];
  if (definition === undefined) {
    return toValidationFailure(failure('objectUnknown'));
  }

  const affordance = state.environmentBundle.affordances[command.affordanceId];
  if (affordance === undefined) {
    return toValidationFailure(failure('affordanceUnknown'));
  }
  if (!definition.affordanceIds.includes(command.affordanceId)) {
    return toValidationFailure(failure('affordanceNotAvailable'));
  }
  if (!object.affordanceIds.includes(command.affordanceId)) {
    // A broken, extinguished or missing object cannot retain stale actions.
    return toValidationFailure(
      failure(object.state === 'broken' ? 'objectDestroyed' : 'affordanceNotAvailable'),
    );
  }

  const eligibility = evaluateAffordanceEligibility({
    state,
    actor,
    object,
    affordance,
    targetObjectId: command.targetObjectId,
  });
  if (!eligibility.ok) {
    return toValidationFailure(eligibility);
  }

  return {
    valid: true,
    normalizedCommand: {
      kind: 'interactWithObject',
      combatantId: command.combatantId,
      objectId: command.objectId,
      affordanceId: command.affordanceId,
      targetObjectId: command.targetObjectId,
    },
  };
};

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

const spendAffordanceCost = (options: {
  actor: CombatantState;
  actionCost: AffordanceDefinition['actionCost'];
}): void => {
  if (options.actionCost === 'action') {
    options.actor.budget.actionAvailable = false;
  } else if (options.actionCost === 'quick') {
    options.actor.budget.quickActionAvailable = false;
  }
};

// ---------------------------------------------------------------------------
// Effect application (AC-2, AC-3)
// ---------------------------------------------------------------------------

const DAMAGE_DICE_PATTERN = /^(\d+)d(\d+)(?:\+(\d+))?$/;

const rollDice = (rng: SeedableRng, dice: string): number => {
  const match = DAMAGE_DICE_PATTERN.exec(dice);
  if (match === null) {
    return 0;
  }
  const count = Number.parseInt(match[1], 10);
  const sides = Number.parseInt(match[2], 10);
  const bonus = match[3] === undefined ? 0 : Number.parseInt(match[3], 10);
  let total = bonus;
  for (let index = 0; index < count; index++) {
    total += rng.dice(sides);
  }
  return Math.max(0, total);
};

const directionAway = (from: GridPoint, to: GridPoint): GridPoint => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) {
    return { x: 1, y: 0 };
  }
  if (Math.abs(dx) >= Math.abs(dy)) {
    return { x: dx >= 0 ? 1 : -1, y: 0 };
  }
  return { x: 0, y: dy >= 0 ? 1 : -1 };
};

type EffectContext = {
  state: CombatState;
  actor: CombatantState;
  source: BattlefieldObject;
  target: BattlefieldObject | undefined;
  command: CombatInteractWithObjectCommand;
  envelope: CombatEventEnvelope;
  rng: SeedableRng;
  events: CombatEvent[];
  /** Running count of applied consequences; bounded by `effectExpansion`. */
  cascade: { count: number };
};

const applyDamageToCombatant = (options: {
  state: CombatState;
  envelope: CombatEventEnvelope;
  events: CombatEvent[];
  combatantId: string;
  amount: number;
  damageType: DamageTypeKey;
  sourceKind: 'hazard' | 'impact' | 'effect';
  sourceId: string;
}): void => {
  const combatant = options.state.combatants[options.combatantId];
  if (combatant === undefined || combatant.defeated) {
    return;
  }
  const hpAfter = Math.max(0, combatant.hp - options.amount);
  const downed = hpAfter <= 0;
  combatant.hp = hpAfter;
  combatant.downed = downed || combatant.downed;
  combatant.defeated = downed || combatant.defeated;

  const damageEvent: EnvironmentalDamageAppliedEvent = {
    ...options.envelope,
    kind: 'environmentalDamageApplied',
    combatantId: options.combatantId,
    sourceKind: options.sourceKind,
    sourceId: options.sourceId,
    amount: options.amount,
    damageType: options.damageType,
    hpAfter,
    downed,
  };
  options.events.push(damageEvent);

  if (downed) {
    options.events.push({
      ...options.envelope,
      kind: 'combatantDowned',
      combatantId: options.combatantId,
    });
    options.events.push({
      ...options.envelope,
      kind: 'combatantDefeated',
      combatantId: options.combatantId,
    });
  }
};

const applyEffect = (options: { context: EffectContext; effect: RegisteredEffect }): void => {
  const { context, effect } = options;
  const selectorContext: SelectorContext = {
    state: context.state,
    actor: context.actor,
    source: context.source,
    target: context.target,
  };

  switch (effect.kind) {
    case 'damage': {
      const resolution = resolveCombatantSelector(effect.targetSelector, selectorContext);
      if (!resolution.ok) {
        return;
      }
      for (const combatantId of resolution.combatantIds) {
        const amount = rollDice(context.rng, effect.diceExpression);
        applyDamageToCombatant({
          state: context.state,
          envelope: context.envelope,
          events: context.events,
          combatantId,
          amount,
          damageType: effect.damageType,
          sourceKind: 'effect',
          sourceId: context.source.objectId,
        });
        context.cascade.count += 1;
      }
      return;
    }

    case 'setObjectState': {
      const resolution = resolveObjectSelector(effect.objectSelector, selectorContext);
      if (!resolution.ok) {
        return;
      }
      for (const object of resolution.objects) {
        const previousState = object.state;
        const definition = context.state.environmentBundle.objectDefinitions[object.definitionId];
        object.state = effect.state;
        // Breaking an object zeroes its durability and drops its cover; a
        // destroyed object must not keep granting protection.
        if (effect.state === 'broken') {
          object.durability = 0;
          object.cover = 'none';
          object.ignited = false;
        } else {
          object.durability = definition?.durability ?? object.durability;
        }
        context.events.push({
          ...context.envelope,
          kind: 'objectStateChanged',
          objectId: object.objectId,
          previousState,
          state: object.state,
          durability: object.durability,
        });
        context.cascade.count += 1;
      }
      return;
    }

    case 'moveObject': {
      const resolution = resolveObjectSelector(effect.objectSelector, selectorContext);
      if (!resolution.ok) {
        return;
      }
      for (const object of resolution.objects) {
        const from = { x: object.position.x, y: object.position.y };
        const direction = directionAway(context.actor.position, object.position);
        const moved = moveObjectAlong({
          state: context.state,
          object,
          direction,
          steps: effect.steps,
        });
        if (moved === 0) {
          continue;
        }
        context.events.push({
          ...context.envelope,
          kind: 'objectMoved',
          objectId: object.objectId,
          from,
          to: { x: object.position.x, y: object.position.y },
          steps: moved,
        });
        context.cascade.count += 1;
      }
      return;
    }

    case 'forcedMovement': {
      const resolution = resolveCombatantSelector(effect.targetSelector, selectorContext);
      if (!resolution.ok) {
        return;
      }
      for (const combatantId of resolution.combatantIds) {
        const combatant = context.state.combatants[combatantId];
        if (combatant === undefined) {
          continue;
        }
        const origin = { x: combatant.position.x, y: combatant.position.y };
        const direction = directionAway(context.source.position, origin);
        const path = forcedMovementPath({
          state: context.state,
          origin,
          direction,
          cells: effect.cells,
        });
        if (path.length === 0) {
          continue;
        }
        const last = path[path.length - 1];
        combatant.position = { x: last.x, y: last.y };
        context.events.push({
          ...context.envelope,
          kind: 'forcedMovementApplied',
          combatantId,
          sourceObjectId: context.source.objectId,
          path,
          cellsMoved: path.length,
        });
        context.cascade.count += 1;
      }
      return;
    }

    case 'setIgnited': {
      const resolution = resolveObjectSelector(effect.objectSelector, selectorContext);
      if (!resolution.ok) {
        return;
      }
      for (const object of resolution.objects) {
        if (object.ignited === effect.ignited) {
          continue;
        }
        object.ignited = effect.ignited;
        context.events.push({
          ...context.envelope,
          kind: 'objectIgnitedChanged',
          objectId: object.objectId,
          ignited: object.ignited,
        });
        context.cascade.count += 1;
      }
      return;
    }

    case 'createSurface': {
      const resolution = resolveCellSelector(effect.cellSelector, selectorContext);
      if (!resolution.ok) {
        return;
      }
      for (const cell of resolution.cells) {
        if (
          cell.x < 0 ||
          cell.y < 0 ||
          cell.x >= context.state.battlefield.width ||
          cell.y >= context.state.battlefield.height
        ) {
          continue;
        }
        const existing = context.state.environment.surfaces.find(
          (surface) => surface.kind === effect.surfaceKind && cellsEqual(surface.cell, cell),
        );
        if (existing !== undefined) {
          continue;
        }
        // Registered surface interaction: fire consumes oil on the same cell.
        if (effect.surfaceKind === 'fire') {
          const oil = context.state.environment.surfaces.filter(
            (surface) => surface.kind === 'oil' && cellsEqual(surface.cell, cell),
          );
          for (const surface of oil) {
            removeSurface({
              state: context.state,
              envelope: context.envelope,
              events: context.events,
              surface,
              reason: 'effect',
            });
            context.cascade.count += 1;
          }
        }
        const surface: SurfaceCell = {
          surfaceId: surfaceIdFor({ kind: effect.surfaceKind, cell, sourceObjectId: context.source.objectId }),
          kind: effect.surfaceKind,
          cell: { x: cell.x, y: cell.y },
          expiresAfterRound: effect.expiresAfterRound,
          sourceObjectId: context.source.objectId,
        };
        context.state.environment.surfaces.push(surface);
        context.state.environment.surfaces.sort((a, b) => (a.surfaceId < b.surfaceId ? -1 : 1));
        context.events.push({
          ...context.envelope,
          kind: 'surfaceCreated',
          surfaceId: surface.surfaceId,
          surfaceKind: surface.kind,
          cell: { x: surface.cell.x, y: surface.cell.y },
          sourceObjectId: surface.sourceObjectId,
        });
        context.cascade.count += 1;
      }
      return;
    }

    case 'removeSurface': {
      const resolution = resolveSurfaceSelector(effect.surfaceSelector, selectorContext);
      if (!resolution.ok) {
        return;
      }
      for (const surface of resolution.surfaces) {
        removeSurface({
          state: context.state,
          envelope: context.envelope,
          events: context.events,
          surface,
          reason: 'effect',
        });
        context.cascade.count += 1;
      }
      return;
    }

    case 'dropPayload': {
      const resolution = resolveObjectSelector(effect.objectSelector, selectorContext);
      if (!resolution.ok) {
        return;
      }
      const zone = context.state.environmentBundle.impactZones[effect.impactZone];
      if (zone === undefined) {
        return;
      }
      for (const support of resolution.objects) {
        const cells = impactZoneCells({ zone, origin: support.position }).filter(
          (cell) =>
            cell.x >= 0 &&
            cell.y >= 0 &&
            cell.x < context.state.battlefield.width &&
            cell.y < context.state.battlefield.height,
        );
        if (cells.length === 0) {
          continue;
        }
        const payloads = sortedObjects(context.state).filter(
          (object) => object.attachedToObjectId === support.objectId,
        );
        for (const payload of payloads) {
          const landing = cells.find(
            (cell) =>
              !isCellOccupiedByCombatant(context.state, cell) &&
              objectAtCell(context.state, cell) === undefined,
          );
          const destination = landing ?? cells[0];
          payload.position = { x: destination.x, y: destination.y };
          payload.attachedToObjectId = null;
          context.events.push({
            ...context.envelope,
            kind: 'payloadDropped',
            supportObjectId: support.objectId,
            payloadObjectId: payload.objectId,
            impactZone: effect.impactZone,
            cells: cells.map((cell) => ({ x: cell.x, y: cell.y })),
          });
          context.cascade.count += 1;
        }
        // Registered impact rule: the zone damages every combatant standing in it.
        const occupants = new Set<string>();
        for (const cell of cells) {
          for (const combatant of combatantsAtCell(context.state, cell)) {
            occupants.add(combatant.combatantId);
          }
        }
        for (const combatantId of [...occupants].sort()) {
          const amount = rollDice(context.rng, zone.diceExpression);
          applyDamageToCombatant({
            state: context.state,
            envelope: context.envelope,
            events: context.events,
            combatantId,
            amount,
            damageType: zone.damageType,
            sourceKind: 'impact',
            sourceId: `${support.objectId}:${effect.impactZone}`,
          });
          context.cascade.count += 1;
        }
      }
      return;
    }

    case 'setCover': {
      const resolution = resolveObjectSelector(effect.objectSelector, selectorContext);
      if (!resolution.ok) {
        return;
      }
      for (const object of resolution.objects) {
        if (object.cover === effect.cover) {
          continue;
        }
        object.cover = effect.cover;
        context.events.push({
          ...context.envelope,
          kind: 'objectCoverChanged',
          objectId: object.objectId,
          cover: object.cover,
        });
        context.cascade.count += 1;
      }
      return;
    }

    default:
      return;
  }
};

/** Removes one surface cell and emits the removal fact. */
const removeSurface = (options: {
  state: CombatState;
  envelope: CombatEventEnvelope;
  events: CombatEvent[];
  surface: SurfaceCell;
  reason: 'expired' | 'effect';
}): void => {
  const index = options.state.environment.surfaces.findIndex(
    (candidate) => candidate.surfaceId === options.surface.surfaceId,
  );
  if (index === -1) {
    return;
  }
  options.state.environment.surfaces.splice(index, 1);
  options.events.push({
    ...options.envelope,
    kind: 'surfaceRemoved',
    surfaceId: options.surface.surfaceId,
    surfaceKind: options.surface.kind,
    cell: { x: options.surface.cell.x, y: options.surface.cell.y },
    reason: options.reason,
  });
};

/** Deterministic surface id: `surface:<kind>:<x>:<y>:<source|none>`. */
export const surfaceIdFor = (options: {
  kind: SurfaceKind;
  cell: GridPoint;
  sourceObjectId: string | null;
}): string =>
  `surface:${options.kind}:${options.cell.x}:${options.cell.y}:${options.sourceObjectId ?? 'none'}`;

/**
 * Walks an object cell-by-cell, stopping at the last legal cell.
 *
 * A step is legal when it is in bounds, not terrain-impassable, not covered by
 * another object's footprint, and not occupied by a combatant.
 */
export const moveObjectAlong = (options: {
  state: CombatState;
  object: BattlefieldObject;
  direction: GridPoint;
  steps: number;
}): number => {
  let moved = 0;
  for (let step = 0; step < options.steps; step++) {
    const candidate: GridPoint = {
      x: options.object.position.x + options.direction.x,
      y: options.object.position.y + options.direction.y,
    };
    const footprintCells = [
      candidate,
      ...options.object.footprint.map((cell) => ({
        x: candidate.x + cell.x,
        y: candidate.y + cell.y,
      })),
    ];
    const legal = footprintCells.every((cell) => {
      if (isCellImpassable({ battlefield: options.state.battlefield, cell })) {
        return false;
      }
      if (isCellOccupiedByCombatant(options.state, cell)) {
        return false;
      }
      const occupant = objectAtCell(options.state, cell);
      return occupant === undefined || occupant.objectId === options.object.objectId;
    });
    if (!legal) {
      break;
    }
    options.object.position = candidate;
    moved += 1;
  }
  return moved;
};

/**
 * Steps of forced movement, each validated for bounds, footprint and occupancy.
 *
 * Stops at the last legal cell — never overlaps an actor and never teleports
 * through a wall.
 */
export const forcedMovementPath = (options: {
  state: CombatState;
  origin: GridPoint;
  direction: GridPoint;
  cells: number;
}): GridPoint[] => {
  const path: GridPoint[] = [];
  let current = options.origin;
  for (let step = 0; step < options.cells; step++) {
    const candidate: GridPoint = {
      x: current.x + options.direction.x,
      y: current.y + options.direction.y,
    };
    if (isCellImpassable({ battlefield: options.state.battlefield, cell: candidate })) {
      break;
    }
    if (isCellOccupiedByCombatant(options.state, candidate)) {
      break;
    }
    if (objectAtCell(options.state, candidate) !== undefined) {
      break;
    }
    path.push(candidate);
    current = candidate;
  }
  return path;
};

// ---------------------------------------------------------------------------
// Resolution (AC-2)
// ---------------------------------------------------------------------------

export type ApplyEnvironmentalCommandOptions = {
  state: CombatState;
  actorId: string;
  command: CombatInteractWithObjectCommand;
  envelope: CombatEventEnvelope;
  rng: SeedableRng;
};

/**
 * Resolves one environmental command against `state` (a clone the caller owns).
 *
 * On success: the attempt cost is spent even when the check fails, effects run
 * in declared order, and every consequence is emitted as an event. On failure
 * the caller must discard `state` — the kernel never writes it back, so no
 * tentative mutation and no RNG advance survives.
 */
export const applyEnvironmentalCommand = (
  options: ApplyEnvironmentalCommandOptions,
): EnvironmentalResolution => {
  const { state, command, envelope, rng } = options;
  const actor = state.combatants[options.actorId];
  if (actor === undefined) {
    return rejection('actorUnknown');
  }
  const object = state.environment.objects[command.objectId];
  if (object === undefined) {
    return rejection('objectUnknown');
  }
  const affordance = state.environmentBundle.affordances[command.affordanceId];
  if (affordance === undefined) {
    return rejection('affordanceUnknown');
  }

  const events: CombatEvent[] = [];
  const context: EffectContext = {
    state,
    actor,
    source: object,
    target:
      command.targetObjectId === null
        ? undefined
        : state.environment.objects[command.targetObjectId],
    command,
    envelope,
    rng,
    events,
    cascade: { count: 0 },
  };

  // A legal attempted check consumes its declared cost even when the roll
  // fails — so the cost is spent before the dice.
  spendAffordanceCost({ actor, actionCost: affordance.actionCost });

  let success = true;
  if (affordance.check !== null) {
    const modifier = resolveCheckModifier({ actor, check: affordance.check });
    if (modifier === undefined) {
      return rejection('checkModifierUnavailable');
    }
    const naturalRoll = rng.dice(20);
    const total = naturalRoll + modifier;
    success = total >= affordance.check.dc;
    events.push({
      ...envelope,
      kind: 'environmentalCheckRolled',
      combatantId: actor.combatantId,
      objectId: object.objectId,
      affordanceId: affordance.affordanceId,
      checkCategory: affordance.check.category,
      modifierSource: affordance.check.modifierSource,
      modifier,
      naturalRoll,
      total,
      dc: affordance.check.dc,
      success,
    });
  }

  const branch = success ? affordance.successEffects : affordance.failureEffects;
  for (const effect of branch) {
    if (context.cascade.count > COMBAT_ENVIRONMENT_BOUNDS.effectExpansion) {
      // Transactional overflow: reject without retaining tentative mutation.
      return rejection('cascadeLimitExceeded');
    }
    applyEffect({ context, effect });
  }

  if (context.cascade.count > COMBAT_ENVIRONMENT_BOUNDS.effectExpansion) {
    return rejection('cascadeLimitExceeded');
  }

  return { ok: true, events };
};

// ---------------------------------------------------------------------------
// Round advance: surface expiry and hazard cadence (AC-3)
// ---------------------------------------------------------------------------

/**
 * Applies the environmental rules that fire when a round begins.
 *
 * Order is explicit and stable: surfaces whose `expiresAfterRound` has arrived
 * are removed first (so an expiring surface cannot also burn), then stale
 * hazard tick stamps are pruned, then each actor standing on a registered
 * hazard surface takes at most ONE hit from that hazard family this round.
 */
export const applyEnvironmentalRoundStart = (options: {
  state: CombatState;
  envelope: CombatEventEnvelope;
  rng: SeedableRng;
}): CombatEvent[] => {
  const { state, envelope, rng } = options;
  const events: CombatEvent[] = [];
  const round = state.round;

  const expired = state.environment.surfaces.filter(
    (surface) => surface.expiresAfterRound !== null && surface.expiresAfterRound <= round,
  );
  for (const surface of expired) {
    removeSurface({ state, envelope, events, surface, reason: 'expired' });
  }

  state.environment.hazardTickStamps = state.environment.hazardTickStamps.filter(
    (stamp) => stamp.round >= round,
  );

  const combatants = Object.values(state.combatants).sort((a, b) =>
    a.combatantId < b.combatantId ? -1 : 1,
  );
  for (const combatant of combatants) {
    if (combatant.defeated) {
      continue;
    }
    for (const family of Object.values(REGISTERED_HAZARD_FAMILIES)) {
      const onHazard = sortedSurfaces(state).some(
        (surface) =>
          surface.kind === family.surfaceKind &&
          surface.cell.x === combatant.position.x &&
          surface.cell.y === combatant.position.y,
      );
      if (!onHazard) {
        continue;
      }
      const stamped = state.environment.hazardTickStamps.some(
        (stamp) =>
          stamp.hazardFamilyId === family.hazardFamilyId &&
          stamp.actorId === combatant.combatantId &&
          stamp.round === round,
      );
      if (stamped) {
        continue;
      }
      const surface = sortedSurfaces(state).find(
        (candidate) =>
          candidate.kind === family.surfaceKind &&
          candidate.cell.x === combatant.position.x &&
          candidate.cell.y === combatant.position.y,
      );
      state.environment.hazardTickStamps.push({
        hazardFamilyId: family.hazardFamilyId,
        actorId: combatant.combatantId,
        round,
      });
      events.push({
        ...envelope,
        kind: 'hazardTickStamped',
        combatantId: combatant.combatantId,
        hazardFamilyId: family.hazardFamilyId,
        round,
      });
      const amount = rollDice(rng, family.diceExpression);
      applyDamageToCombatant({
        state,
        envelope,
        events,
        combatantId: combatant.combatantId,
        amount,
        damageType: family.damageType,
        sourceKind: 'hazard',
        sourceId: surface?.surfaceId ?? family.hazardFamilyId,
      });
    }
  }

  return events;
};

// ---------------------------------------------------------------------------
// Forecast (AC-4)
// ---------------------------------------------------------------------------

const forecastEffect = (options: {
  state: CombatState;
  actor: CombatantState;
  source: BattlefieldObject;
  target: BattlefieldObject | undefined;
  effect: RegisteredEffect;
}): EnvironmentalForecastEffect[] => {
  const selectorContext: SelectorContext = {
    state: options.state,
    actor: options.actor,
    source: options.source,
    target: options.target,
  };
  const results: EnvironmentalForecastEffect[] = [];
  const push = (effect: EnvironmentalForecastEffect): void => {
    results.push(effect);
  };

  switch (options.effect.kind) {
    case 'setObjectState': {
      const resolution = resolveObjectSelector(options.effect.objectSelector, selectorContext);
      if (resolution.ok) {
        for (const object of resolution.objects) {
          push({
            change: 'objectState',
            objectId: object.objectId,
            state: options.effect.state,
            cover: null,
            surfaceKind: null,
            cells: [],
          });
        }
      }
      return results;
    }
    case 'moveObject': {
      const resolution = resolveObjectSelector(options.effect.objectSelector, selectorContext);
      if (resolution.ok) {
        for (const object of resolution.objects) {
          push({
            change: 'objectMoved',
            objectId: object.objectId,
            state: null,
            cover: null,
            surfaceKind: null,
            cells: [],
          });
        }
      }
      return results;
    }
    case 'setIgnited': {
      const resolution = resolveObjectSelector(options.effect.objectSelector, selectorContext);
      if (resolution.ok) {
        for (const object of resolution.objects) {
          push({
            change: 'objectIgnited',
            objectId: object.objectId,
            state: null,
            cover: null,
            surfaceKind: null,
            cells: [],
          });
        }
      }
      return results;
    }
    case 'setCover': {
      const resolution = resolveObjectSelector(options.effect.objectSelector, selectorContext);
      if (resolution.ok) {
        for (const object of resolution.objects) {
          push({
            change: 'objectCover',
            objectId: object.objectId,
            state: null,
            cover: options.effect.cover,
            surfaceKind: null,
            cells: [],
          });
        }
      }
      return results;
    }
    case 'createSurface': {
      const resolution = resolveCellSelector(options.effect.cellSelector, selectorContext);
      if (resolution.ok) {
        push({
          change: 'surfaceCreated',
          objectId: null,
          state: null,
          cover: null,
          surfaceKind: options.effect.surfaceKind,
          cells: resolution.cells.map((cell) => ({ x: cell.x, y: cell.y })),
        });
      }
      return results;
    }
    case 'removeSurface': {
      const resolution = resolveSurfaceSelector(options.effect.surfaceSelector, selectorContext);
      if (resolution.ok) {
        for (const surface of resolution.surfaces) {
          push({
            change: 'surfaceRemoved',
            objectId: surface.sourceObjectId,
            state: null,
            cover: null,
            surfaceKind: surface.kind,
            cells: [{ x: surface.cell.x, y: surface.cell.y }],
          });
        }
      }
      return results;
    }
    case 'dropPayload': {
      const resolution = resolveObjectSelector(options.effect.objectSelector, selectorContext);
      const zone = options.state.environmentBundle.impactZones[options.effect.impactZone];
      if (resolution.ok && zone !== undefined) {
        for (const support of resolution.objects) {
          push({
            change: 'payloadDropped',
            objectId: support.objectId,
            state: null,
            cover: null,
            surfaceKind: null,
            cells: impactZoneCells({ zone, origin: support.position }),
          });
        }
      }
      return results;
    }
    case 'forcedMovement': {
      const resolution = resolveCombatantSelector(options.effect.targetSelector, selectorContext);
      if (resolution.ok) {
        push({
          change: 'forcedMovement',
          objectId: null,
          state: null,
          cover: null,
          surfaceKind: null,
          cells: [],
        });
      }
      return results;
    }
    default:
      return results;
  }
};

/**
 * A deterministic, non-mutating forecast of one environmental command.
 *
 * Nothing here advances the RNG or touches state — a preview consumes no
 * resources. A probabilistic branch states its odds; it never presents success
 * as certain.
 */
export const forecastEnvironmentalCommand = (options: {
  state: CombatState;
  actorId: string;
  command: CombatInteractWithObjectCommand;
}): ActionForecast | null => {
  const actor = options.state.combatants[options.actorId];
  const object = options.state.environment.objects[options.command.objectId];
  const affordance = options.state.environmentBundle.affordances[options.command.affordanceId];
  if (actor === undefined || object === undefined || affordance === undefined) {
    return null;
  }
  const target =
    options.command.targetObjectId === null
      ? undefined
      : options.state.environment.objects[options.command.targetObjectId];

  const effects = affordance.successEffects.flatMap((effect) =>
    forecastEffect({ state: options.state, actor, source: object, target, effect }),
  );

  const impactCells: GridPoint[] = [];
  const seen = new Set<string>();
  for (const effect of effects) {
    for (const cell of effect.cells) {
      const key = cellKey(cell);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      impactCells.push(cell);
    }
  }

  const warnings: ActionForecast['warnings'] = [];
  if (effects.some((effect) => effect.change === 'surfaceCreated')) {
    warnings.push('createsHazard');
  }
  if (effects.some((effect) => effect.change === 'objectState' && effect.state === 'broken')) {
    warnings.push('destroysCover');
  }
  if (effects.some((effect) => effect.change === 'objectMoved' || effect.change === 'objectState')) {
    warnings.push('damagesObject');
  }

  const forecast: ActionForecast = {
    actionCost: affordance.actionCost,
    affectedCells: impactCells,
    affectedEntityIds: [],
    reactionRisks: [],
    objectiveEffects: [],
    warnings,
    environmentalEffects: effects,
    impactCells,
  };

  if (affordance.check !== null) {
    const modifier = resolveCheckModifier({ actor, check: affordance.check });
    forecast.checkOutcome = {
      category: affordance.check.category,
      dc: affordance.check.dc,
      modifierSource: affordance.check.modifierSource,
      modifier: modifier ?? 0,
      modifierAvailable: modifier !== undefined,
      successOdds: modifier === undefined ? 0 : successOdds({ modifier, dc: affordance.check.dc }),
    };
  }

  return forecast;
};

// ---------------------------------------------------------------------------
// Bundle helpers
// ---------------------------------------------------------------------------

/** Whether a bundle declares every definition a state references. */
export const validateEnvironmentBundle = (options: {
  bundle: CombatEnvironmentBundle;
  state: CombatState;
}): { ok: true } | { ok: false; reasonCode: CombatInvalidReason; messageKey: string } => {
  const { bundle, state } = options;
  for (const object of sortedObjects(state)) {
    const definition = bundle.objectDefinitions[object.definitionId];
    if (definition === undefined) {
      return failure('objectUnknown');
    }
    for (const affordanceId of object.affordanceIds) {
      if (definition.affordanceIds.includes(affordanceId) && bundle.affordances[affordanceId] === undefined) {
        return failure('affordanceUnknown');
      }
    }
  }
  for (const surface of state.environment.surfaces) {
    if (surface.sourceObjectId !== null && state.environment.objects[surface.sourceObjectId] === undefined) {
      return failure('objectUnknown');
    }
  }
  return { ok: true };
};
