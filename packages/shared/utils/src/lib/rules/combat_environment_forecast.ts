// packages/shared/utils/src/lib/rules/combat_environment_forecast.ts
//
// The deterministic, non-mutating forecast of one environmental command.
//
// Nothing here advances the RNG or touches state — a preview consumes no
// resources. A probabilistic branch states its odds; it never presents success
// as certain.
//
// Contract: C-531 AC-1, AC-2, AC-3, AC-4, AC-7

import { COMBAT_ENVIRONMENT_BOUNDS } from '@aikami/schemas';
import type {
  ActionForecast,
  BattlefieldObject,
  CombatantState,
  CombatInteractWithObjectCommand,
  CombatState,
  EnvironmentalForecastEffect,
  GridPoint,
  RegisteredEffect,
} from '@aikami/types';
import {
  impactZoneCells,
  resolveCellSelector,
  resolveCheckModifier,
  resolveCombatantSelector,
  resolveObjectSelector,
  resolveSurfaceSelector,
  type SelectorContext,
  successOdds,
} from './combat_environment_selectors';
import { cellKey } from './combat_spatial';

// ---------------------------------------------------------------------------
// Forecast (AC-4)
// ---------------------------------------------------------------------------

export const forecastEffect = (options: {
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
    case 'damage': {
      const resolution = resolveCombatantSelector(options.effect.targetSelector, selectorContext);
      if (resolution.ok && resolution.combatantIds.length > 0) {
        push({
          change: 'damage',
          objectId: null,
          state: null,
          cover: null,
          surfaceKind: null,
          cells: [],
        });
      }
      return results;
    }
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
            cells: impactZoneCells({
              zone,
              origin: support.position,
              battlefield: options.state.battlefield,
            }),
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

  const effects: EnvironmentalForecastEffect[] = [];
  const affectedEntityIds: string[] = [];
  const affectedEntitySet = new Set<string>();
  const selectorContext: SelectorContext = { state: options.state, actor, source: object, target };
  for (const effect of affordance.successEffects) {
    if (effect.kind === 'damage') {
      const resolution = resolveCombatantSelector(effect.targetSelector, selectorContext);
      if (resolution.ok) {
        for (const combatantId of resolution.combatantIds) {
          if (!affectedEntitySet.has(combatantId)) {
            affectedEntitySet.add(combatantId);
            affectedEntityIds.push(combatantId);
          }
        }
      }
    }
    const expanded = forecastEffect({
      state: options.state,
      actor,
      source: object,
      target,
      effect,
    });
    const remaining = COMBAT_ENVIRONMENT_BOUNDS.effectExpansion - effects.length;
    effects.push(...expanded.slice(0, remaining));
    if (effects.length >= COMBAT_ENVIRONMENT_BOUNDS.effectExpansion) {
      break;
    }
  }

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
  if (affectedEntitySet.has(actor.combatantId)) {
    warnings.push('damagesSelf');
  }
  if (effects.some((effect) => effect.change === 'surfaceCreated')) {
    warnings.push('createsHazard');
  }
  if (effects.some((effect) => effect.change === 'objectState' && effect.state === 'broken')) {
    warnings.push('destroysCover');
  }
  if (
    effects.some((effect) => effect.change === 'objectMoved' || effect.change === 'objectState')
  ) {
    warnings.push('damagesObject');
  }

  const forecast: ActionForecast = {
    actionCost: affordance.actionCost,
    affectedCells: impactCells,
    affectedEntityIds,
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
