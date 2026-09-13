// packages/frontend/engine/src/combat/combat_sync_events.ts
//
// Re-emit the live combat state (C-516 AC-5).
//
// The combat overlay is opened optimistically before the engine answers, so the
// ViewModel that owns the sidebar routinely mounts while `COMBAT_STARTED` and
// the opening `TURN_CHANGED` are already in flight — it registers its listeners
// milliseconds too late and renders a fight with no turn tracker, no budgets and
// no End Turn. Answering a `COMBAT_SYNC_REQUEST` with the live snapshot is the
// only correct fix: the engine is the authority, and the surface that mounted
// late still has to render the encounter it is showing.
//
// Projection only: this module reads the driver + ECS world and emits the same
// events the driver itself emits at start/turn-change. It never mutates state.
//
// Contract: C-516 AC-5

import type { World } from 'bitecs';
import { CombatStats } from '../components/combat_stats.ts';
import type { EngineBridge } from '../engine_bridge.ts';
import { getCombatIdentityRegistry } from './combat_state_adapter.ts';
import { getCombatPreviewSnapshot } from './combat_turn_driver.ts';

/**
 * Emits `COMBAT_STARTED`, `TURN_CHANGED`, `ACTION_ECONOMY_CHANGED` and
 * `COMBAT_STATE_UPDATE` for the running encounter.
 *
 * A no-op when no encounter is running, so a client may ask unconditionally.
 *
 * @returns `true` when a live encounter snapshot was emitted.
 */
export const emitLiveCombatSnapshot = (options: {
  world: World;
  bridge: EngineBridge;
}): boolean => {
  const { world, bridge } = options;
  const driver = getCombatPreviewSnapshot(world);
  if (driver === null) {
    return false;
  }

  const registry = getCombatIdentityRegistry(world);
  registry.sync(world);

  const participantIds = driver.order
    .map((combatantId) => registry.toEntityId(combatantId) ?? 0)
    .filter((entityId) => entityId !== 0);
  if (participantIds.length === 0) {
    return false;
  }

  const activeEntityId =
    driver.activeCombatantId === null ? 0 : (registry.toEntityId(driver.activeCombatantId) ?? 0);

  bridge.emit({
    type: 'COMBAT_STARTED',
    participantIds,
    firstTurnEntityId: activeEntityId,
    engine: driver.engine,
    playerEntityId: registry.toEntityId(driver.playerCombatantId) ?? 0,
    encounterId: driver.encounterId,
  });

  if (activeEntityId !== 0) {
    bridge.emit({
      type: 'TURN_CHANGED',
      currentEntityId: activeEntityId,
      activeEntities: participantIds,
      stateRevision: driver.stateRevision,
    });

    const budget =
      driver.activeCombatantId === null ? undefined : driver.budgets[driver.activeCombatantId];
    if (budget !== undefined) {
      bridge.emit({
        type: 'ACTION_ECONOMY_CHANGED',
        entityId: activeEntityId,
        movementRemaining: budget.movementRemaining,
        actionAvailable: budget.actionAvailable,
        quickActionAvailable: budget.quickActionAvailable,
        bonusActionAvailable: budget.quickActionAvailable,
        reactionAvailable: budget.reactionAvailable,
        stateRevision: driver.stateRevision,
      });
    }
  }

  const entityHpMap: Record<number, number> = {};
  const entityMaxHpMap: Record<number, number> = {};
  for (const entityId of participantIds) {
    entityHpMap[entityId] = CombatStats.health[entityId] ?? 0;
    entityMaxHpMap[entityId] = CombatStats.maxHealth[entityId] ?? 0;
  }
  bridge.emit({
    type: 'COMBAT_STATE_UPDATE',
    entityHpMap,
    entityMaxHpMap,
    ...(activeEntityId === 0 ? {} : { activeTurnEntity: activeEntityId }),
  });

  return true;
};
