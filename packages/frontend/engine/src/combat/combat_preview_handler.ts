// packages/frontend/engine/src/combat/combat_preview_handler.ts
//
// Worker-side tactical preview handler (Combat-03).
//
// Answers a `COMBAT_PREVIEW_REQUESTED` by projecting the live ECS world into a
// `BattlefieldState` + `CombatState`, running the PURE tactical module over it,
// and returning a schema-shaped `CombatPreviewResult`. It never commits an
// action, never advances the RNG, never emits an event and never writes to the
// ECS world — the dispatcher owns the single correlated reply.
//
// Contract: C-515 AC-5, AC-7

import type {
  ActionForecast,
  BattlefieldState,
  CombatInvalidReason,
  CombatPreviewResult,
  CombatState,
  GridPoint,
} from '@aikami/types';
import {
  COMBAT_MESSAGE_KEYS,
  COMBAT_RULES_VERSION,
  forecastCombatAction,
  getLegalActions,
} from '@aikami/utils';
import type { World } from 'bitecs';
import { logger } from '$logger';
import type { EngineBridge } from '../engine_bridge.ts';
import { snapshotBattlefield } from './combat_battlefield.ts';
import type {
  CombatPreviewReadyEvent,
  CombatPreviewRequestedCommand,
} from './combat_bridge_types.ts';
import { getCombatCheckModifiers } from './combat_check_modifiers.ts';
import { getEncounterEnvironment } from './combat_encounter_environment.ts';
import { snapshotCombatState } from './combat_state_adapter.ts';
import type { CombatPreviewDriverSnapshot } from './combat_turn_driver.ts';
import { getCombatPreviewSnapshot } from './combat_turn_driver.ts';
import { getLiveV2CombatState } from './combat_v2_state.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export type HandleCombatPreviewRequestOptions = {
  world: World;
  bridge: EngineBridge;
  request: CombatPreviewRequestedCommand;
};

const rejection = (requestId: string, reasonCode: CombatInvalidReason): CombatPreviewResult => ({
  requestId,
  valid: false,
  reasonCode,
  messageKey: COMBAT_MESSAGE_KEYS[reasonCode],
});

const emptyForecast = (actionCost: ActionForecast['actionCost']): ActionForecast => ({
  actionCost,
  reactionRisks: [],
  objectiveEffects: [],
  warnings: [],
});

/**
 * Builds the `CombatState` a preview is answered from.
 *
 * `snapshotCombatState` is the projection authority; the driver is the TURN
 * authority, so its order, active index and live budgets are mirrored onto the
 * snapshot. Without that the preview would answer for whoever the ECS
 * initiative sort happens to put first instead of the combatant whose turn it
 * actually is (C-515 AC-6).
 */
/**
 * Builds the `CombatState` a preview is answered from.
 *
 * `snapshotCombatState` is the projection authority; the driver is the TURN
 * authority, so its order, active index and live budgets are mirrored onto the
 * snapshot. Without that the preview would answer for whoever the ECS
 * initiative sort happens to put first instead of the combatant whose turn it
 * actually is (C-515 AC-6).
 *
 * Exported (C-525 AC-4): the intent compiler is grounded on the SAME projection
 * the preview/commit path answers from, so the client's compiled plan and the
 * engine's own view cannot diverge on positions, budgets or revision.
 */
export const buildCombatProjectionState = (options: {
  world: World;
  battlefield: BattlefieldState;
  driver: CombatPreviewDriverSnapshot;
}): CombatState => {
  const { world, battlefield, driver } = options;
  // C-531: the pinned environmental pair rides the projection exactly as it
  // rides the kernel commit path (`buildV2CombatState`). Without it the object
  // inspector would answer from an object-free state the kernel could never
  // have produced for an authored encounter.
  const pinned = getEncounterEnvironment(world);
  // C-531 AC-2: the pinned sheet modifiers ride every projection, so the
  // preview and the commit answer with the same modifier.
  const checkModifiers = getCombatCheckModifiers(world);
  // C-531: the committed live state is the environmental authority once it
  // exists — the pinned pair is only the INITIAL state. A preview or inspector
  // refresh that answered from the pinned pair after a commit would show
  // objects the kernel already broke (the mirror of the resolver's rule).
  const live = getLiveV2CombatState(world);
  const environment =
    live !== null && live.encounterId === driver.encounterId ? live.environment : pinned?.state;
  const environmentBundle =
    live !== null && live.encounterId === driver.encounterId
      ? live.environmentBundle
      : pinned?.bundle;
  const state = snapshotCombatState(world, {
    encounterId: driver.encounterId,
    rulesVersion: COMBAT_RULES_VERSION,
    seed: driver.seed,
    abilityCatalog: driver.abilityCatalog,
    abilityIdsByCombatant: driver.abilityIdsByCombatant,
    battlefield,
    playerCombatantId: driver.playerCombatantId,
    ...(checkModifiers === undefined ? {} : { checkModifiersByCombatant: checkModifiers }),
    ...(environment === undefined ? {} : { environment, environmentBundle }),
  });

  state.initiative.order = [...driver.order];
  state.initiative.activeIndex = driver.activeIndex;
  state.stateRevision = driver.stateRevision;
  for (const [combatantId, budget] of Object.entries(driver.budgets)) {
    const combatant = state.combatants[combatantId];
    if (combatant !== undefined) {
      combatant.budget = { ...budget };
    }
  }

  return state;
};

// ---------------------------------------------------------------------------
// handleCombatPreviewRequest
// ---------------------------------------------------------------------------

/**
 * Answers one preview request. Pure with respect to game state: it builds
 * throwaway projections, never calls `resolveCombatCommand`, and never touches
 * the RNG.
 */
export const handleCombatPreviewRequest = (
  options: HandleCombatPreviewRequestOptions,
): CombatPreviewResult => {
  const { world, request } = options;
  const { requestId } = request;

  const driver = getCombatPreviewSnapshot(world);
  if (driver === null || driver.encounterId !== request.encounterId) {
    return rejection(requestId, 'encounterEnded');
  }
  if (request.query.combatantId !== driver.activeCombatantId) {
    return rejection(requestId, 'notActiveCombatant');
  }

  const state = buildCombatProjectionState({
    world,
    battlefield: snapshotBattlefield(world),
    driver,
  });

  if (request.basedOnRevision !== state.stateRevision) {
    return rejection(requestId, 'staleRevision');
  }

  const { combatantId } = request.query;

  switch (request.query.kind) {
    case 'legalMoves': {
      const actions = getLegalActions({ state, combatantId });
      return {
        requestId,
        valid: true,
        forecast: emptyForecast('movement'),
        legalEndpoints: actions.endpoints,
        movementCostTo: actions.costTo,
      };
    }

    case 'legalTargets': {
      const ability = state.abilityCatalog[request.query.abilityId];
      if (ability === undefined) {
        return rejection(requestId, 'abilityUnknown');
      }
      const actions = getLegalActions({ state, combatantId });
      const legalTargetIds = actions.targetsByAbility[request.query.abilityId] ?? [];
      // Project each legal target id to its cell so the canvas can highlight
      // the target without re-deriving occupancy (C-525 R-2). An id with no
      // live position is skipped rather than emitting a zero cell.
      const legalTargetCells: GridPoint[] = [];
      for (const targetId of legalTargetIds) {
        const target = state.combatants[targetId];
        if (target !== undefined) {
          legalTargetCells.push({ x: target.position.x, y: target.position.y });
        }
      }
      return {
        requestId,
        valid: true,
        forecast: emptyForecast(ability.actionCost),
        legalTargetIds,
        legalTargetCells,
      };
    }

    case 'action': {
      const { command } = request.query;
      if (command.kind === 'useAbility' && state.abilityCatalog[command.abilityId] === undefined) {
        return rejection(requestId, 'abilityUnknown');
      }
      const forecast = forecastCombatAction({ state, command });
      if (!forecast.valid) {
        return rejection(requestId, forecast.reasonCode);
      }
      return { requestId, valid: true, forecast: forecast.forecast };
    }

    default: {
      return rejection(requestId, 'invalidCommandShape');
    }
  }
};

// ---------------------------------------------------------------------------
// emitCombatPreviewResult
// ---------------------------------------------------------------------------

/**
 * Emits exactly one correlated reply for a preview result — never a log entry
 * and never a turn-stream event (AC-5).
 */
export const emitCombatPreviewResult = (
  bridge: EngineBridge,
  result: CombatPreviewResult,
): void => {
  if (!result.valid) {
    // C-531 observability: a rejected preview is silent on the UI (one typed
    // rejection paragraph), so the reason must be readable in the worker log.
    logger.warn('combat:preview-rejected', {
      requestId: result.requestId,
      reasonCode: result.reasonCode,
    });
    bridge.emit({
      type: 'COMBAT_PLAN_REJECTED',
      requestId: result.requestId,
      reasonCode: result.reasonCode,
      messageKey: result.messageKey,
    });
    return;
  }

  const event: CombatPreviewReadyEvent = {
    type: 'COMBAT_PREVIEW_READY',
    requestId: result.requestId,
    forecast: result.forecast,
  };
  if (result.legalEndpoints !== undefined) {
    event.legalEndpoints = result.legalEndpoints;
  }
  if (result.legalTargetIds !== undefined) {
    event.legalTargetIds = result.legalTargetIds;
  }
  if (result.legalTargetCells !== undefined) {
    event.legalTargetCells = result.legalTargetCells;
  }
  if (result.movementCostTo !== undefined) {
    event.movementCostTo = result.movementCostTo;
  }
  bridge.emit(event);
};
