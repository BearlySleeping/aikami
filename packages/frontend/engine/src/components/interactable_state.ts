// packages/frontend/engine/src/components/interactable_state.ts
import type { World } from 'bitecs';
import { observe, onGet, onSet } from 'bitecs';

// ---------------------------------------------------------------------------
// InteractableState — runtime state for world interactables
//
// Contract C-342: Tracks per-entity interactable runtime state (isOpen,
// isLocked, isLooted, isToggled, isTriggered) and the resolved loot table
// registry index. Registered per-world via registerInteractableStateObservers.
//
// All fields are numeric (0/1 flags) for SoA efficiency — the interaction
// system reads them directly from typed arrays.
// ---------------------------------------------------------------------------

/** SoA storage for interactable runtime state. Indexed by entity ID. */
export const InteractableState = {
  /** 0 = closed, 1 = open (doors, chests, containers). */
  isOpen: [] as number[],
  /** 0 = unlocked, 1 = locked (doors, chests). */
  isLocked: [] as number[],
  /** 0 = not looted, 1 = already looted (chests, containers). */
  isLooted: [] as number[],
  /** 0 = off, 1 = on (levers, pressure plates). */
  isToggled: [] as number[],
  /** 0 = not triggered, 1 = already triggered (traps, one-shot triggers). */
  isTriggered: [] as number[],
  /** String registry index for authored loot table key (chests, containers).
   *  The content pack loader resolves `lootTableKey` (string) → integer
   *  at load time via a `Map<string, number>` lookup table. */
  lootTableKey: [] as number[],
};

/** Payload shape stored/retrieved via observers. */
export type InteractableStateData = {
  isOpen?: number;
  isLocked?: number;
  isLooted?: number;
  isToggled?: number;
  isTriggered?: number;
  lootTableKey?: number;
};

/** Loot table index lookup — resolves string keys to integer handles. */
export type LootTableRegistry = Map<string, number>;

/**
 * Registers onSet and onGet observers for the InteractableState component.
 * Must be called once per world before any entity uses InteractableState.
 *
 * @param world - The bitECS world to register observers on.
 * @param lootTableRegistry - Optional loot table key → index map for resolving string keys.
 */
export const registerInteractableStateObservers = (
  world: World,
  lootTableRegistry?: LootTableRegistry,
): void => {
  observe(world, onSet(InteractableState), (eid: number, params: InteractableStateData) => {
    InteractableState.isOpen[eid] = params.isOpen ?? 0;
    InteractableState.isLocked[eid] = params.isLocked ?? 0;
    InteractableState.isLooted[eid] = params.isLooted ?? 0;
    InteractableState.isToggled[eid] = params.isToggled ?? 0;
    InteractableState.isTriggered[eid] = params.isTriggered ?? 0;
    InteractableState.lootTableKey[eid] = params.lootTableKey ?? 0;
  });

  observe(
    world,
    onGet(InteractableState),
    (eid: number): InteractableStateData => ({
      isOpen: InteractableState.isOpen[eid],
      isLocked: InteractableState.isLocked[eid],
      isLooted: InteractableState.isLooted[eid],
      isToggled: InteractableState.isToggled[eid],
      isTriggered: InteractableState.isTriggered[eid],
      lootTableKey: InteractableState.lootTableKey[eid],
    }),
  );

  // Stash the registry reference for later use by the spawner
  if (lootTableRegistry) {
    _activeLootTableRegistry = lootTableRegistry;
  }
};

/** Active loot table registry — set by registerInteractableStateObservers. */
let _activeLootTableRegistry: LootTableRegistry | undefined;

/**
 * Returns the active loot table registry (if registered).
 */
export const getActiveLootTableRegistry = (): LootTableRegistry | undefined => {
  return _activeLootTableRegistry;
};
