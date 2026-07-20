// packages/frontend/engine/src/components/interactable.ts
import type { World } from 'bitecs';
import { observe, onGet, onSet } from 'bitecs';

// ---------------------------------------------------------------------------
// Interactable — component marking entities as interactable
//
// Contract C-342: Extends InteractableType to support doors, chests, levers,
// pressure plates, containers, readables, and traps. Adds puzzle dependency
// fields (requiredItemId, requiredState, puzzleGroupId, activatesOnSpawnIds).
// ---------------------------------------------------------------------------

/** Discriminated union for the interactable entity type. */
export type InteractableType =
  | 'npc'
  | 'item'
  | 'door'
  | 'chest'
  | 'lever'
  | 'pressure_plate'
  | 'container'
  | 'readable'
  | 'trap';

/** SoA storage for interactable metadata. Indexed by entity ID. */
export const Interactable = {
  type: [] as InteractableType[],
  /** Item ID for pickup items (empty string for non-item types). */
  itemId: [] as string[],
  /** Stack quantity for pickup items (0 for non-item types). */
  quantity: [] as number[],
  /** Tiled spawn-point ID for respawn suppression / state persistence. */
  spawnId: [] as string[],
  /** Item ID required to unlock (e.g., 'rustyKey') — empty for non-locked types. */
  requiredItemId: [] as string[],
  /** Target state that triggers activation (e.g. 'on' for a lever) — empty when unused. */
  requiredState: [] as string[],
  /** Puzzle group identifier for journal/quest tracking — empty when not part of a puzzle. */
  puzzleGroupId: [] as string[],
  /** Comma-separated list of spawn IDs that toggle/activate this interactable. */
  activatesOnSpawnIds: [] as string[],
};

/** Payload shape stored/retrieved via observers. */
export type InteractableData = {
  type: InteractableType;
  itemId: string;
  quantity: number;
  /** Optional spawn-point ID — defaults to '' when unset. */
  spawnId?: string;
  /** Optional item ID required to unlock. */
  requiredItemId?: string;
  /** Optional target state for activation. */
  requiredState?: string;
  /** Optional puzzle group identifier. */
  puzzleGroupId?: string;
  /** Optional comma-separated spawn IDs that activate this interactable. */
  activatesOnSpawnIds?: string;
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
    Interactable.requiredItemId[eid] = params.requiredItemId ?? '';
    Interactable.requiredState[eid] = params.requiredState ?? '';
    Interactable.puzzleGroupId[eid] = params.puzzleGroupId ?? '';
    Interactable.activatesOnSpawnIds[eid] = params.activatesOnSpawnIds ?? '';
  });

  observe(
    world,
    onGet(Interactable),
    (eid: number): InteractableData => ({
      type: Interactable.type[eid],
      itemId: Interactable.itemId[eid],
      quantity: Interactable.quantity[eid],
      spawnId: Interactable.spawnId[eid] ?? '',
      requiredItemId: Interactable.requiredItemId[eid] ?? '',
      requiredState: Interactable.requiredState[eid] ?? '',
      puzzleGroupId: Interactable.puzzleGroupId[eid] ?? '',
      activatesOnSpawnIds: Interactable.activatesOnSpawnIds[eid] ?? '',
    }),
  );
};
