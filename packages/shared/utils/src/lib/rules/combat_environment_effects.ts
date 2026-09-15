// packages/shared/utils/src/lib/rules/combat_environment_effects.ts
//
// Effect application: one implementation per registered effect kind, plus the
// budget spend and the forced/object movement steppers.
//
// Effects run in declared order with stable-id tie-breaks. Every step of forced
// movement validates bounds, footprint and occupancy and stops at the last
// legal cell.
//
// Contract: C-531 AC-1, AC-2, AC-3, AC-4, AC-7

import type {
  AffordanceDefinition,
  BattlefieldObject,
  CombatantState,
  CombatEvent,
  CombatEventEnvelope,
  CombatInteractWithObjectCommand,
  CombatState,
  DamageTypeKey,
  EnvironmentalDamageAppliedEvent,
  GridPoint,
  RegisteredEffect,
  SurfaceCell,
  SurfaceKind,
} from '@aikami/types';
import type { SeedableRng } from '../rng/seedable_rng';
import {
  cellsEqual,
  combatantsAtCell,
  directionAway,
  getEnvironmentalGeometry,
  isCellOccupiedByCombatant,
  objectAtCell,
  rollDice,
  sortedObjects,
} from './combat_environment_internal';
import {
  impactZoneCells,
  resolveCellSelector,
  resolveCombatantSelector,
  resolveObjectSelector,
  resolveSurfaceSelector,
  type SelectorContext,
} from './combat_environment_selectors';
import { isCellImpassable } from './combat_spatial';

const isLegalObjectPlacement = (options: {
  state: CombatState;
  object: BattlefieldObject;
  position: GridPoint;
}): boolean =>
  options.object.footprint.every((offset) => {
    const cell = { x: options.position.x + offset.x, y: options.position.y + offset.y };
    if (isCellImpassable({ battlefield: options.state.battlefield, cell })) {
      return false;
    }
    if (isCellOccupiedByCombatant(options.state, cell)) {
      return false;
    }
    const occupant = objectAtCell(options.state, cell);
    return occupant === undefined || occupant.objectId === options.object.objectId;
  });

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

export const spendAffordanceCost = (options: {
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

export type EffectContext = {
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

export const applyDamageToCombatant = (options: {
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

export const applyEffect = (options: {
  context: EffectContext;
  effect: RegisteredEffect;
}): void => {
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
          (placed) => placed.kind === effect.surfaceKind && cellsEqual(placed.cell, cell),
        );
        if (existing !== undefined) {
          continue;
        }
        // Registered surface interaction: fire consumes oil on the same cell.
        if (effect.surfaceKind === 'fire') {
          const oil = context.state.environment.surfaces.filter(
            (candidate) => candidate.kind === 'oil' && cellsEqual(candidate.cell, cell),
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
          surfaceId: surfaceIdFor({
            kind: effect.surfaceKind,
            cell,
            sourceObjectId: context.source.objectId,
          }),
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
        const cells = impactZoneCells({
          zone,
          origin: support.position,
          battlefield: context.state.battlefield,
        });
        if (cells.length === 0) {
          continue;
        }
        const payloads = sortedObjects(context.state).filter(
          (object) => object.attachedToObjectId === support.objectId,
        );
        for (const payload of payloads) {
          const destination = cells.find((cell) =>
            isLegalObjectPlacement({ state: context.state, object: payload, position: cell }),
          );
          if (destination === undefined) {
            continue;
          }
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
export const removeSurface = (options: {
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
  const geometry = getEnvironmentalGeometry(options.state);
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
    if (geometry.blockedCells.some((cell) => cellsEqual(cell, candidate))) {
      break;
    }
    path.push(candidate);
    current = candidate;
  }
  return path;
};
