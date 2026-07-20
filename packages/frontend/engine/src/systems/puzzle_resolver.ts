// packages/frontend/engine/src/systems/puzzle_resolver.ts
import type { World } from 'bitecs';
import { getComponent, query } from 'bitecs';
import { logger } from '$logger';
import type { InteractableData } from '../components/interactable.ts';
import { Interactable } from '../components/interactable.ts';
import { InteractableState } from '../components/interactable_state.ts';
import { Position } from '../components/position.ts';
import type { EngineBridge } from '../engine_bridge.ts';

// ---------------------------------------------------------------------------
// Puzzle Resolver — DAG-based puzzle dependency evaluation
//
// Contract C-342 AC-5: Eagerly evaluates all downstream interactables when
// a state change occurs. Walks a directed acyclic graph (DAG) of spawn IDs
// using activateSpawnIds / activatedBySpawnIds relationships.
// ---------------------------------------------------------------------------

/** Maximum depth for DAG walk — guards against authored cycles. */
const MAX_DAG_DEPTH = 50;

/**
 * Evaluates the puzzle dependency DAG starting from a changed interactable.
 *
 * When an interactable's state changes (lever toggled, pressure plate pressed),
 * this function finds all interactables whose `activatesOnSpawnIds` include
 * the changed spawn ID, checks if their activation conditions are now met,
 * and applies the state change (open door, toggle, etc.).
 *
 * @param options.world - The bitECS world.
 * @param options.changedSpawnId - The spawn ID of the interactable that just changed.
 * @param options.bridge - The EngineBridge for emitting events.
 */
export const evaluatePuzzleDag = (options: {
  world: World;
  changedSpawnId: string;
  bridge: EngineBridge;
}): void => {
  const { world, changedSpawnId, bridge } = options;

  if (!changedSpawnId) {
    return;
  }

  try {
    const visited = new Set<string>();
    const queue: string[] = [changedSpawnId];
    let depth = 0;

    while (queue.length > 0 && depth < MAX_DAG_DEPTH) {
      const currentSpawnId = queue.shift();
      if (!currentSpawnId) {
        continue;
      }
      if (visited.has(currentSpawnId)) {
        continue;
      }
      visited.add(currentSpawnId);

      // Find all interactables whose activatesOnSpawnIds includes currentSpawnId
      const affected = _findActivatedBy({ world, spawnId: currentSpawnId });

      for (const result of affected) {
        _applyActivation({ world, eid: result.eid, interactable: result.interactable, bridge });

        // Enqueue for further propagation
        if (result.interactable.spawnId) {
          queue.push(result.interactable.spawnId);
        }
      }

      depth++;
    }

    if (depth >= MAX_DAG_DEPTH) {
      logger.warn('[puzzle_resolver] Max DAG depth reached — possible cycle', {
        changedSpawnId,
        visited: visited.size,
      });
    }
  } catch (error) {
    logger.error('[puzzle_resolver] DAG evaluation failed', {
      changedSpawnId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type AffectedResult = {
  eid: number;
  interactable: InteractableData;
};

/**
 * Finds all interactables whose `activatesOnSpawnIds` include the given spawn ID.
 */
const _findActivatedBy = (options: { world: World; spawnId: string }): AffectedResult[] => {
  const { world, spawnId } = options;
  const results: AffectedResult[] = [];

  for (const eid of query(world, [Position, Interactable])) {
    const interactable = getComponent(world, eid, Interactable) as InteractableData | undefined;
    if (!interactable?.activatesOnSpawnIds) {
      continue;
    }

    const triggerIds = interactable.activatesOnSpawnIds
      .split(',')
      .map((s: string) => s.trim())
      .filter(Boolean);

    if (triggerIds.includes(spawnId)) {
      results.push({ eid, interactable });
    }
  }

  return results;
};

/**
 * Applies the activation effect on a downstream interactable.
 * Determines the correct state change based on the interactable type.
 */
const _applyActivation = (options: {
  world: World;
  eid: number;
  interactable: InteractableData;
  bridge: EngineBridge;
}): void => {
  const { world, eid, interactable, bridge } = options;
  const spawnId = interactable.spawnId ?? '';

  switch (interactable.type) {
    case 'door': {
      // Check if activation condition is met (requiredState)
      const requiredState = interactable.requiredState ?? 'on';
      const upstreamToggled = _isUpstreamToggled({ world, interactable, requiredState });

      if (upstreamToggled) {
        InteractableState.isOpen[eid] = 1;
        bridge.emit({ type: 'DOOR_OPENED', spawnId });
        logger.debug('[puzzle_resolver] Door activated', { spawnId });
      } else {
        InteractableState.isOpen[eid] = 0;
        bridge.emit({ type: 'DOOR_CLOSED', spawnId });
        logger.debug('[puzzle_resolver] Door deactivated', { spawnId });
      }
      break;
    }
    case 'lever': {
      // Toggle lever state
      const isToggled = InteractableState.isToggled[eid] === 1;
      InteractableState.isToggled[eid] = isToggled ? 0 : 1;
      bridge.emit({
        type: 'LEVER_TOGGLED',
        spawnId,
        isToggled: InteractableState.isToggled[eid] === 1,
      });
      logger.debug('[puzzle_resolver] Lever activated by puzzle', { spawnId, toggled: !isToggled });
      break;
    }
    case 'trap': {
      // Trigger trap
      if (InteractableState.isTriggered[eid] === 0) {
        InteractableState.isTriggered[eid] = 1;
        // Default damage — actual dice stored on requiredItemId
        const damage = 5;
        bridge.emit({ type: 'TRAP_TRIGGERED', spawnId, damage });
        logger.debug('[puzzle_resolver] Trap triggered by puzzle', { spawnId });
      }
      break;
    }
    default:
      // Chests and containers don't auto-open from puzzle chains
      logger.debug('[puzzle_resolver] No puzzle activation for type', { type: interactable.type });
      break;
  }
};

/**
 * Checks whether all upstream interactables in `activatesOnSpawnIds` are in
 * the expected state (toggled on for levers, pressed for pressure plates).
 *
 * @param requiredState - Expected state ('on'/'off') — defaults to 'on'.
 */
const _isUpstreamToggled = (options: {
  world: World;
  interactable: InteractableData;
  requiredState: string;
}): boolean => {
  const { world, interactable, requiredState } = options;
  const targetState = requiredState === 'off' ? 0 : 1;

  if (!interactable.activatesOnSpawnIds) {
    return true;
  }

  const upstreamIds = interactable.activatesOnSpawnIds
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean);

  if (upstreamIds.length === 0) {
    return true;
  }

  for (const eid of query(world, [Position, Interactable])) {
    const upstream = getComponent(world, eid, Interactable) as InteractableData | undefined;
    if (!upstream?.spawnId || !upstreamIds.includes(upstream.spawnId)) {
      continue;
    }

    if (upstream.type === 'pressure_plate') {
      const isPressed = InteractableState.isToggled[eid] === 1;
      if ((isPressed ? 1 : 0) !== targetState) {
        return false;
      }
    } else {
      const isToggled = InteractableState.isToggled[eid] === 1;
      if ((isToggled ? 1 : 0) !== targetState) {
        return false;
      }
    }
  }

  return true;
};
