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
} from '@aikami/types';
import {
  COMBAT_MESSAGE_KEYS,
  COMBAT_RULES_VERSION,
  computeReachableEndpoints,
  forecastCombatAction,
  getLegalActions,
  occupiedCellsFor,
} from '@aikami/utils';
import type { World } from 'bitecs';
import type { EngineBridge } from '../engine_bridge.ts';
import { snapshotBattlefield } from './combat_battlefield.ts';
import type {
  CombatPreviewReadyEvent,
  CombatPreviewRequestedCommand,
} from './combat_bridge_types.ts';
import { snapshotCombatState } from './combat_state_adapter.ts';
import type { CombatPreviewDriverSnapshot } from './combat_turn_driver.ts';
import { getCombatPreviewSnapshot } from './combat_turn_driver.ts';

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
const buildPreviewState = (options: {
  world: World;
  battlefield: BattlefieldState;
  driver: CombatPreviewDriverSnapshot;
}): CombatState => {
  const { world, battlefield, driver } = options;
  const state = snapshotCombatState(world, {
    encounterId: driver.encounterId,
    rulesVersion: COMBAT_RULES_VERSION,
    seed: driver.seed,
    abilityCatalog: driver.abilityCatalog,
    battlefield,
    playerCombatantId: driver.playerCombatantId,
  });

  state.initiative.order = [...driver.order];
  state.initiative.activeIndex = driver.activeIndex;
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

  const state = buildPreviewState({
    world,
    battlefield: snapshotBattlefield(world),
    driver,
  });

  // Until Combat-04 commits resolutions through `resolveCombatCommand` a
  // freshly built state always carries `stateRevision: 0`, so a non-matching
  // `basedOnRevision` is the stale case (AC-5).
  if (request.basedOnRevision !== state.stateRevision) {
    return rejection(requestId, 'staleRevision');
  }

  const { combatantId } = request.query;

  switch (request.query.kind) {
    case 'legalMoves': {
      const actions = getLegalActions({ state, combatantId });
      const origin = state.combatants[combatantId]?.position ?? { x: 0, y: 0 };
      const reachable = computeReachableEndpoints({
        battlefield: state.battlefield,
        origin,
        movementBudget: actions.budget.movementRemaining,
        occupied: occupiedCellsFor({ state, combatantId }),
      });
      return {
        requestId,
        valid: true,
        forecast: emptyForecast('movement'),
        legalEndpoints: actions.endpoints,
        movementCostTo: reachable.costTo,
      };
    }

    case 'legalTargets': {
      const ability = state.abilityCatalog[request.query.abilityId];
      if (ability === undefined) {
        return rejection(requestId, 'abilityUnknown');
      }
      const actions = getLegalActions({ state, combatantId });
      return {
        requestId,
        valid: true,
        forecast: emptyForecast(ability.actionCost),
        legalTargetIds: actions.targetsByAbility[request.query.abilityId] ?? [],
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
  if (result.movementCostTo !== undefined) {
    event.movementCostTo = result.movementCostTo;
  }
  bridge.emit(event);
};
