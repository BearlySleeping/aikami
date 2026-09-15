// packages/shared/utils/src/lib/rules/combat_environment_internal.ts
//
// Shared internals for the Combat-07 environmental registry: registered
// constants, result shapes, derived geometry, lookups and dice helpers.
//
// This module imports no other environmental module, so the family stays
// acyclic.
//
// Contract: C-531 AC-1, AC-2, AC-3, AC-4, AC-7

import type {
  BattlefieldObject,
  CombatEvent,
  CombatInteractWithObjectCommand,
  CombatInvalidReason,
  CombatantState,
  CombatState,
  CoverLevel,
  GridPoint,
  SurfaceCell,
  SurfaceKind,
  DamageTypeKey,
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

export const failure = (reasonCode: CombatInvalidReason) => ({
  ok: false as const,
  reasonCode,
  messageKey: COMBAT_MESSAGE_KEYS[reasonCode],
});

export const rejection = (reasonCode: CombatInvalidReason): EnvironmentalResolution => ({
  ok: false,
  reasonCode,
  messageKey: COMBAT_MESSAGE_KEYS[reasonCode],
});

/** Wraps an `{ ok: false }` outcome in the kernel's validation result shape. */
export const toValidationFailure = (outcome: {
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
 * The armor-class bonus the target's cover grants against this attacker.
 *
 * Registered rule: cover is read from the TARGET's cell, and an ADJACENT
 * attacker ignores it — at contact range the attacker is past the
 * obstruction. `half` grants +2 and `full` grants +5; a broken object grants
 * nothing because a broken object contributes no cover to the geometry.
 */
export const coverArmorClassBonus = (options: {
  state: CombatState;
  attacker: GridPoint;
  target: GridPoint;
}): number => {
  if (manhattan(options.attacker, options.target) <= 1) {
    return 0;
  }
  const geometry = getEnvironmentalGeometry(options.state);
  return COVER_ARMOR_CLASS_MODIFIERS[coverAt({ geometry, cell: options.target })];
};

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

export const compareCells = (a: GridPoint, b: GridPoint): number => a.y - b.y || a.x - b.x;

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

export const bestCover = (current: CoverLevel | undefined, next: CoverLevel): CoverLevel => {
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

export const objectAtCell = (state: CombatState, cell: GridPoint): BattlefieldObject | undefined =>
  sortedObjects(state).find((object) =>
    objectCells(object).some((occupied) => occupied.x === cell.x && occupied.y === cell.y),
  );

export const combatantsAtCell = (state: CombatState, cell: GridPoint): CombatantState[] =>
  Object.values(state.combatants)
    .filter(
      (combatant) =>
        !combatant.defeated &&
        combatant.position.x === cell.x &&
        combatant.position.y === cell.y,
    )
    .sort((a, b) => (a.combatantId < b.combatantId ? -1 : 1));

export const isCellOccupiedByCombatant = (state: CombatState, cell: GridPoint): boolean =>
  combatantsAtCell(state, cell).length > 0;

export const cellsEqual = (a: GridPoint, b: GridPoint): boolean => a.x === b.x && a.y === b.y;

export const orthogonalNeighbours = (cell: GridPoint): GridPoint[] => [
  { x: cell.x, y: cell.y - 1 },
  { x: cell.x, y: cell.y + 1 },
  { x: cell.x - 1, y: cell.y },
  { x: cell.x + 1, y: cell.y },
];

export const manhattan = (a: GridPoint, b: GridPoint): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

// ---------------------------------------------------------------------------
// Dice helpers
// ---------------------------------------------------------------------------

export const DAMAGE_DICE_PATTERN = /^(\d+)d(\d+)(?:\+(\d+))?$/;

export const rollDice = (rng: SeedableRng, dice: string): number => {
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

export const directionAway = (from: GridPoint, to: GridPoint): GridPoint => {
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
