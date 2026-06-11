// apps/frontend/client/src/lib/game/components/interactable.ts

import type { World } from 'bitecs';
import { observe, onGet, onSet } from 'bitecs';

// ---------------------------------------------------------------------------
// Interactable — SoA component marking an entity as interactable
//
// An entity with this component can be interacted with by the player
// when within its interaction radius. The interaction_system handles
// proximity checking and triggers dialogue via the dialogue_controller.
// ---------------------------------------------------------------------------

/** SoA storage for interactable radius. Indexed by entity ID. */
export const Interactable = {
  /** Interaction radius in pixels (squared-distance check). */
  radius: [] as number[],
};

/** Payload shape stored/retrieved via observers. */
export type InteractableData = {
  radius: number;
};

/**
 * Registers onSet and onGet observers for the Interactable component.
 *
 * @param world - The bitECS world to register observers on.
 */
export const registerInteractableObservers = (world: World): void => {
  observe(world, onSet(Interactable), (eid: number, params: InteractableData) => {
    Interactable.radius[eid] = params.radius;
  });

  observe(
    world,
    onGet(Interactable),
    (eid: number): InteractableData => ({
      radius: Interactable.radius[eid],
    }),
  );
};
