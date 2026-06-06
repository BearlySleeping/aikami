// packages/frontend/engine/src/components/turn_order.ts
import type { World } from 'bitecs';
import { observe, onGet, onSet } from 'bitecs';

// ---------------------------------------------------------------------------
// TurnOrder — SoA component for turn-based combat sequencing
// ---------------------------------------------------------------------------

/** SoA storage for turn order state. Indexed by entity ID. */
export const TurnOrder = {
  /** Whether this entity currently has the active turn. */
  currentTurn: [] as boolean[],
  /** Initiative value used to sort turn order. */
  initiativeValue: [] as number[],
  /** Whether this entity is still alive and participating in combat. */
  isActive: [] as boolean[],
};

/** Payload shape stored/retrieved via observers. */
export type TurnOrderData = {
  currentTurn: boolean;
  initiativeValue: number;
  isActive: boolean;
};

/**
 * Registers onSet and onGet observers for the TurnOrder component on the
 * given world. Must be called once per world before any entity uses TurnOrder.
 *
 * @param world - The bitECS world to register observers on.
 */
export const registerTurnOrderObservers = (world: World): void => {
  observe(world, onSet(TurnOrder), (eid: number, params: TurnOrderData) => {
    TurnOrder.currentTurn[eid] = params.currentTurn;
    TurnOrder.initiativeValue[eid] = params.initiativeValue;
    TurnOrder.isActive[eid] = params.isActive;
  });

  observe(
    world,
    onGet(TurnOrder),
    (eid: number): TurnOrderData => ({
      currentTurn: TurnOrder.currentTurn[eid],
      initiativeValue: TurnOrder.initiativeValue[eid],
      isActive: TurnOrder.isActive[eid],
    }),
  );
};
