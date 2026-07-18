// packages/frontend/engine/src/components/interactable.ts
import type { World } from 'bitecs';
import { observe, onGet, onSet } from 'bitecs';

// ---------------------------------------------------------------------------
// Interactable — component marking entities as interactable (npc or item)
//
// Contract C-142: Inventory Item Pickups — enables the interaction system
// to distinguish between NPC interactions (dialogue) and item pickups
// (add to inventory, destroy entity).
// ---------------------------------------------------------------------------

/** Discriminated union for the interactable entity type. */
export type InteractableType = 'npc' | 'item';

/** SoA storage for interactable metadata. Indexed by entity ID. */
export const Interactable = {
  type: [] as InteractableType[],
  /** Item ID for pickup items (empty string for NPCs). */
  itemId: [] as string[],
  /** Stack quantity for pickup items (0 for NPCs). */
  quantity: [] as number[],
  /** Tiled spawn-point ID for respawn suppression (empty for programmatic spawns) — C-331. */
  spawnId: [] as string[],
};

/** Payload shape stored/retrieved via observers. */
export type InteractableData = {
  type: InteractableType;
  itemId: string;
  quantity: number;
  /** Optional spawn-point ID — defaults to '' when unset. */
  spawnId?: string;
};

/**
 * Registers onSet and onGet observers for the Interactable component on the
 * given world. Must be called once per world before any entity uses Interactable.
 *
 * @param world - The bitECS world to register observers on.
 */
export const registerInteractableObservers = (world: World): void => {
  observe(world, onSet(Interactable), (eid: number, params: InteractableData) => {
    Interactable.type[eid] = params.type;
    Interactable.itemId[eid] = params.itemId;
    Interactable.quantity[eid] = params.quantity;
    Interactable.spawnId[eid] = params.spawnId ?? '';
  });

  observe(
    world,
    onGet(Interactable),
    (eid: number): InteractableData => ({
      type: Interactable.type[eid],
      itemId: Interactable.itemId[eid],
      quantity: Interactable.quantity[eid],
      spawnId: Interactable.spawnId[eid] ?? '',
    }),
  );
};
