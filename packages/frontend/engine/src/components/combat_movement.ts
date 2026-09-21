// packages/frontend/engine/src/components/combat_movement.ts
//
// CombatMovement — per-combatant movement allowance for Combat 2.0.
//
// C-514 used a single global `DEFAULT_MOVEMENT_PER_TURN` because `CombatStats`
// carries no movement field and is on the persisted ECS wire format. This
// component is the per-combatant source the C-515 turn driver reads; a
// combatant without it falls back to `DEFAULT_MOVEMENT_PER_TURN` (6).
//
// Deliberately NOT part of `PERSISTENT_COMPONENTS` (see
// `serialization/ecs_serializer.ts`) — the ECS snapshot wire format and
// `CURRENT_SNAPSHOT_VERSION` are unchanged, exactly as C-509 kept
// `CombatIdentity` out. Consequence, documented rather than hidden: after a
// save/load restore a combatant falls back to the default 6 until Combat-04
// wires encounter-start data into the restore path.
//
// Contract: C-515 AC-6

import type { World } from 'bitecs';
import { observe, onGet, onSet } from 'bitecs';

// ---------------------------------------------------------------------------
// CombatMovement — SoA component
// ---------------------------------------------------------------------------

/** SoA storage for per-combatant movement allowances. Indexed by entity ID. */
export const CombatMovement = {
  /** Movement cells restored when this combatant's turn starts. */
  movementPerTurn: [] as number[],
};

/** Payload shape stored/retrieved via observers. */
export type CombatMovementData = {
  movementPerTurn: number;
};

/**
 * Registers onSet and onGet observers for the CombatMovement component on the
 * given world. Must be called once per world before any entity uses it.
 *
 * @param world - The bitECS world to register observers on.
 */
export const registerCombatMovementObservers = (world: World): void => {
  observe(world, onSet(CombatMovement), (eid: number, params: Partial<CombatMovementData>) => {
    if (params.movementPerTurn !== undefined) {
      CombatMovement.movementPerTurn[eid] = params.movementPerTurn;
    }
  });

  observe(
    world,
    onGet(CombatMovement),
    (eid: number): CombatMovementData => ({
      movementPerTurn: CombatMovement.movementPerTurn[eid] ?? 0,
    }),
  );
};
