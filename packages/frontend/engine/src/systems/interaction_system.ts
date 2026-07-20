// packages/frontend/engine/src/systems/interaction_system.ts
import type { World } from 'bitecs';
import { getComponent, removeEntity } from 'bitecs';
import { logger } from '$logger';
import { isSimulationActive } from '../components/engine_state.ts';
import type { InteractableData } from '../components/interactable.ts';
import { Interactable } from '../components/interactable.ts';
import type { InteractableStateData } from '../components/interactable_state.ts';
import { InteractableState } from '../components/interactable_state.ts';
import { Inventory, MAX_INVENTORY_SLOTS } from '../components/inventory.ts';
import type { NPCDialogData } from '../components/npc_dialog.ts';
import { NPCDialog } from '../components/npc_dialog.ts';
import type { PositionData } from '../components/position.ts';
import { Position } from '../components/position.ts';
import { incrementEntityGeneration } from '../core/entity_reference.ts';
import type { EngineBridge } from '../engine_bridge.ts';
import { startDialogueZoom } from '../systems/camera_system.ts';
import { selectInteractionTarget } from '../systems/interaction_target_selector.ts';
import { evaluatePuzzleDag } from '../systems/puzzle_resolver.ts';

// ---------------------------------------------------------------------------
// Interaction System — handle INTERACT command
//
// Contract C-342: Extended to support doors, chests, levers, pressure plates,
// containers, readables, and traps. Loot resolution uses the content pack's
// loot table entries stored on the entity.
// ---------------------------------------------------------------------------

/** Seed for loot RNG — default campaign seed. Set via `setInteractionSeed`. */
let _campaignSeed = 0;

/**
 * Sets the campaign seed used for deterministic loot resolution.
 * Called during engine initialization.
 */
export const setInteractionSeed = (seed: number): void => {
  _campaignSeed = seed;
};

/**
 * Simple hash-based RNG for loot resolution.
 * Uses djb2 on spawnId + campaign seed for deterministic results.
 */
const _hashRng = (spawnId: string): number => {
  let hash = _campaignSeed ^ 5381;
  for (let i = 0; i < spawnId.length; i++) {
    hash = ((hash << 5) + hash + spawnId.charCodeAt(i)) | 0;
  }
  // Normalize to [0, 1)
  return ((hash >>> 0) % 1000000) / 1000000;
};

/**
 * Handles the INTERACT command from the UI layer.
 *
 * Finds the closest interactable entity within range of the player and
 * dispatches the appropriate action based on interactable type.
 */
const handleInteract = (options: {
  world: World;
  playerEntityId: number;
  bridge: EngineBridge;
}): void => {
  const { world, playerEntityId, bridge } = options;

  if (!world || !bridge) {
    return;
  }

  if (!isSimulationActive()) {
    return;
  }

  const playerPos = getComponent(world, playerEntityId, Position) as PositionData | undefined;
  if (!playerPos) {
    return;
  }

  const target = selectInteractionTarget({
    world,
    playerX: playerPos.x,
    playerY: playerPos.y,
  });

  if (!target) {
    return;
  }

  // Dispatch based on interactable type
  switch (target.targetType) {
    case 'item':
      _handleItemPickup({ world, playerEntityId, itemEid: target.entityId, bridge });
      break;
    case 'npc':
      _handleNpcInteraction({ world, npcEid: target.entityId, playerEntityId, bridge });
      break;
    case 'door':
      _handleDoor({ world, eid: target.entityId, bridge });
      break;
    case 'chest':
      _handleChest({ world, eid: target.entityId, bridge });
      break;
    case 'lever':
      _handleLever({ world, eid: target.entityId, bridge });
      break;
    case 'container':
      _handleContainer({ world, eid: target.entityId, bridge });
      break;
    case 'readable':
      _handleReadable({ world, eid: target.entityId, bridge });
      break;
    case 'trap':
      _handleTrap({ world, eid: target.entityId, bridge });
      break;
    default:
      // pressure_plate is not interactable via key press — handled by pressure_plate_system
      break;
  }
};

// ---------------------------------------------------------------------------
// Item pickup (unchanged from C-331)
// ---------------------------------------------------------------------------

const _handleItemPickup = (options: {
  world: World;
  playerEntityId: number;
  itemEid: number;
  bridge: EngineBridge;
}): void => {
  const { world, playerEntityId, itemEid, bridge } = options;

  const interactable = getComponent(world, itemEid, Interactable) as InteractableData | undefined;
  if (!interactable) {
    return;
  }

  const { itemId, quantity, spawnId } = interactable;

  if (itemId === 'goldCoin') {
    incrementEntityGeneration(itemEid);
    removeEntity(world, itemEid);
    bridge.emit({
      type: 'ITEM_PICKED_UP',
      itemId,
      quantity,
      ...(spawnId ? { spawnId } : {}),
    });
    return;
  }

  const playerItemIds = Inventory.itemIds[playerEntityId];
  const playerQuantities = Inventory.quantities[playerEntityId];
  const playerItemTypes = Inventory.itemTypes[playerEntityId];

  if (!playerItemIds || !playerQuantities || !playerItemTypes) {
    return;
  }

  let slotFound = false;
  for (let slot = 0; slot < MAX_INVENTORY_SLOTS; slot++) {
    if ((playerItemIds[slot] ?? 0) === 0) {
      playerItemIds[slot] = 1;
      playerQuantities[slot] = quantity;
      playerItemTypes[slot] = 0;
      slotFound = true;
      break;
    }
  }

  if (!slotFound) {
    bridge.emit({ type: 'INVENTORY_FULL', itemId });
    return;
  }

  incrementEntityGeneration(itemEid);
  removeEntity(world, itemEid);

  bridge.emit({
    type: 'ITEM_PICKED_UP',
    itemId,
    quantity,
    ...(spawnId ? { spawnId } : {}),
  });
};

// ---------------------------------------------------------------------------
// NPC interaction (unchanged)
// ---------------------------------------------------------------------------

const _handleNpcInteraction = (options: {
  world: World;
  npcEid: number;
  playerEntityId: number;
  bridge: EngineBridge;
}): void => {
  const { world, npcEid, playerEntityId, bridge } = options;

  const npcDialog = getComponent(world, npcEid, NPCDialog) as NPCDialogData | undefined;
  if (!npcDialog) {
    return;
  }

  const npcPos = getComponent(world, npcEid, Position) as PositionData | undefined;
  const playerPos = getComponent(world, playerEntityId, Position) as PositionData | undefined;
  if (npcPos && playerPos) {
    startDialogueZoom({
      npcX: npcPos.x,
      npcY: npcPos.y,
      playerX: playerPos.x,
      playerY: playerPos.y,
    });
  }

  if (npcDialog.isVendor) {
    bridge.emit({
      type: 'VENDOR_INTERACTED',
      npcId: npcDialog.npcId,
      npcName: npcDialog.npcName,
      dialog: npcDialog.dialog,
      vendorInventory: npcDialog.vendorInventory,
    });
  } else {
    bridge.emit({
      type: 'NPC_INTERACTED',
      npcId: npcDialog.npcId,
      npcName: npcDialog.npcName,
      dialog: npcDialog.dialog,
    });
  }
};

// ---------------------------------------------------------------------------
// Door interaction — toggle open/closed, check lock
// ---------------------------------------------------------------------------

const _handleDoor = (options: { world: World; eid: number; bridge: EngineBridge }): void => {
  const { world, eid, bridge } = options;

  const interactable = getComponent(world, eid, Interactable) as InteractableData | undefined;
  if (!interactable) {
    return;
  }

  const spawnId = interactable.spawnId ?? '';

  // Check if locked
  const isLocked = InteractableState.isLocked[eid] === 1;
  if (isLocked) {
    // TODO: Player inventory check for requiredItemId — deferred to client-side
    // For now, any locked door can be unlocked by interacting with it.
    InteractableState.isLocked[eid] = 0;
    logger.debug('[interaction_system] Door unlocked', { spawnId });
  }

  // Toggle open/closed
  const isOpen = InteractableState.isOpen[eid] === 1;
  if (isOpen) {
    InteractableState.isOpen[eid] = 0;
    bridge.emit({ type: 'DOOR_CLOSED', spawnId });
    logger.debug('[interaction_system] Door closed', { spawnId });

    // Update collision — door tile becomes blocked
    _updateDoorCollision({ world, eid, open: false });
  } else {
    InteractableState.isOpen[eid] = 1;
    bridge.emit({ type: 'DOOR_OPENED', spawnId });
    logger.debug('[interaction_system] Door opened', { spawnId });

    // Update collision — door tile becomes walkable
    _updateDoorCollision({ world, eid, open: true });

    // Evaluate puzzle DAG — door opening may trigger downstream interactables
    evaluatePuzzleDag({ world, changedSpawnId: spawnId, bridge });
  }

  // Swap sprite
  _updateDoorVisual({ world, eid, open: InteractableState.isOpen[eid] === 1 });
};

// ---------------------------------------------------------------------------
// Chest interaction — check lock, roll loot, mark looted
// ---------------------------------------------------------------------------

const _handleChest = (options: { world: World; eid: number; bridge: EngineBridge }): void => {
  const { world, eid, bridge } = options;

  const interactable = getComponent(world, eid, Interactable) as InteractableData | undefined;
  if (!interactable) {
    return;
  }

  const spawnId = interactable.spawnId ?? '';

  // Already looted — no-op
  if (InteractableState.isLooted[eid] === 1) {
    return;
  }

  // Check if locked
  if (InteractableState.isLocked[eid] === 1) {
    InteractableState.isLocked[eid] = 0;
    logger.debug('[interaction_system] Chest unlocked', { spawnId });
  }

  // Roll loot — use stored loot table entries
  const items = _rollLoot({ world, eid, spawnId });
  InteractableState.isLooted[eid] = 1;
  InteractableState.isOpen[eid] = 1;

  bridge.emit({
    type: 'LOOT_GENERATED',
    spawnId,
    items,
  });

  logger.debug('[interaction_system] Chest looted', { spawnId, itemCount: items.length });

  // Swap to open sprite
  _updateChestVisual({ world, eid, open: true });
};

// ---------------------------------------------------------------------------
// Lever interaction — toggle on/off, evaluate puzzle DAG
// ---------------------------------------------------------------------------

const _handleLever = (options: { world: World; eid: number; bridge: EngineBridge }): void => {
  const { world, eid, bridge } = options;

  const interactable = getComponent(world, eid, Interactable) as InteractableData | undefined;
  if (!interactable) {
    return;
  }

  const spawnId = interactable.spawnId ?? '';
  const isToggled = InteractableState.isToggled[eid] === 1;

  InteractableState.isToggled[eid] = isToggled ? 0 : 1;

  bridge.emit({
    type: 'LEVER_TOGGLED',
    spawnId,
    isToggled: InteractableState.isToggled[eid] === 1,
  });

  logger.debug('[interaction_system] Lever toggled', {
    spawnId,
    isToggled: InteractableState.isToggled[eid] === 1,
  });

  // Swap visual
  _updateLeverVisual({ world, eid, toggled: InteractableState.isToggled[eid] === 1 });

  // Evaluate puzzle DAG
  evaluatePuzzleDag({ world, changedSpawnId: spawnId, bridge });
};

// ---------------------------------------------------------------------------
// Container interaction — roll loot, mark looted
// ---------------------------------------------------------------------------

const _handleContainer = (options: { world: World; eid: number; bridge: EngineBridge }): void => {
  const { world, eid, bridge } = options;

  const interactable = getComponent(world, eid, Interactable) as InteractableData | undefined;
  if (!interactable) {
    return;
  }

  const spawnId = interactable.spawnId ?? '';

  // Already looted — no-op
  if (InteractableState.isLooted[eid] === 1) {
    return;
  }

  const items = _rollLoot({ world, eid, spawnId });
  InteractableState.isLooted[eid] = 1;
  InteractableState.isOpen[eid] = 1;

  bridge.emit({
    type: 'LOOT_GENERATED',
    spawnId,
    items,
  });

  logger.debug('[interaction_system] Container looted', { spawnId, itemCount: items.length });
};

// ---------------------------------------------------------------------------
// Readable interaction — emit dialogue key
// ---------------------------------------------------------------------------

const _handleReadable = (options: { world: World; eid: number; bridge: EngineBridge }): void => {
  const { world, eid, bridge } = options;

  const interactable = getComponent(world, eid, Interactable) as InteractableData | undefined;
  if (!interactable) {
    return;
  }

  const spawnId = interactable.spawnId ?? '';
  const textDialogueKey = interactable.itemId; // reused for textDialogueKey

  logger.debug('[interaction_system] Readable inspected', { spawnId, textDialogueKey });

  bridge.emit({
    type: 'READABLE_INTERACTED',
    spawnId,
    textDialogueKey: textDialogueKey || 'readable_default',
  });
};

// ---------------------------------------------------------------------------
// Trap interaction — trigger or disarm attempt
// ---------------------------------------------------------------------------

const _handleTrap = (options: { world: World; eid: number; bridge: EngineBridge }): void => {
  const { world, eid, bridge } = options;

  const interactable = getComponent(world, eid, Interactable) as InteractableData | undefined;
  if (!interactable) {
    return;
  }

  const spawnId = interactable.spawnId ?? '';

  // Already triggered + does not reArm — no-op
  if (InteractableState.isTriggered[eid] === 1) {
    return;
  }

  // Deal damage
  const damage = _parseAndRollDamage({ world, eid, spawnId });

  InteractableState.isTriggered[eid] = 1;

  bridge.emit({
    type: 'TRAP_TRIGGERED',
    spawnId,
    damage,
  });

  logger.debug('[interaction_system] Trap triggered', { spawnId, damage });
};

// ---------------------------------------------------------------------------
// Loot resolution
// ---------------------------------------------------------------------------

/**
 * Rolls on the loot table stored in the InteractableState component.
 * Uses a deterministic hash of spawnId + campaign seed.
 * Returns items that passed their drop chance check.
 */
const _rollLoot = (options: {
  world: World;
  eid: number;
  spawnId: string;
}): Array<{ itemId: string; quantity: number }> => {
  const { world, eid, spawnId } = options;

  const state = getComponent(world, eid, InteractableState) as InteractableStateData | undefined;
  if (!state) {
    return [];
  }

  // Loot table entries are stored as arrays on the interactable component
  const interactable = getComponent(world, eid, Interactable) as InteractableData | undefined;
  if (!interactable) {
    return [];
  }

  // Parse loot table entries from stored data.
  // Entries are stored as: the itemId field holds comma-separated itemIds,
  // requiredState holds comma-separated quantities,
  // activatesOnSpawnIds holds comma-separated dropChances.
  const itemIds = (interactable.itemId || '')
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean);
  const quantityStrs = (interactable.requiredState || '')
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean);
  const chanceStrs = (interactable.activatesOnSpawnIds || '')
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean);

  if (itemIds.length === 0) {
    return [];
  }

  const items: Array<{ itemId: string; quantity: number }> = [];
  const rngValue = _hashRng(spawnId);

  for (let i = 0; i < itemIds.length; i++) {
    const dropChance = i < chanceStrs.length ? Number.parseFloat(chanceStrs[i]) || 0.5 : 0.5;
    const quantity = i < quantityStrs.length ? Number.parseInt(quantityStrs[i], 10) || 1 : 1;

    // Use a pseudo-random value derived from spawnId + campaign seed + entry index
    const roll = ((rngValue * 1103515245 + i * 12345) % 1000000) / 1000000;

    if (roll < dropChance) {
      items.push({ itemId: itemIds[i], quantity });
    }
  }

  return items;
};

/**
 * Parses damage dice string (e.g. "2d6") and rolls for trap damage.
 * Stored in the requiredItemId field for traps.
 */
const _parseAndRollDamage = (options: { world: World; eid: number; spawnId: string }): number => {
  const { world, eid, spawnId } = options;

  const interactable = getComponent(world, eid, Interactable) as InteractableData | undefined;
  const diceStr = interactable?.requiredItemId || '1d6';

  const match = diceStr.match(/^(\d+)d(\d+)(?:\+(\d+))?$/);
  if (!match) {
    return 2; // default damage
  }

  const count = Number.parseInt(match[1], 10);
  const sides = Number.parseInt(match[2], 10);
  const bonus = match[3] ? Number.parseInt(match[3], 10) : 0;

  // Deterministic roll using hash
  const rngValue = _hashRng(`${spawnId}_trap`);
  let total = 0;
  for (let i = 0; i < count; i++) {
    const roll = ((rngValue * 1103515245 + i * 23456) % (sides * 1000000)) / 1000000;
    total += Math.floor(roll) + 1;
  }

  return total + bonus;
};

// ---------------------------------------------------------------------------
// Visual updates
// ---------------------------------------------------------------------------

const _updateDoorVisual = (options: { world: World; eid: number; open: boolean }): void => {
  const { world, eid, open } = options;
  // Visual update handled by the rendering system on the main thread
  // based on InteractableState.isOpen field.
  void world;
  void eid;
  void open;
};

const _updateChestVisual = (options: { world: World; eid: number; open: boolean }): void => {
  const { world, eid, open } = options;
  void world;
  void eid;
  void open;
};

const _updateLeverVisual = (options: { world: World; eid: number; toggled: boolean }): void => {
  const { world, eid, toggled } = options;
  void world;
  void eid;
  void toggled;
};

// ---------------------------------------------------------------------------
// Collision update
// ---------------------------------------------------------------------------

/**
 * Updates spatial hash grid when a door opens/closes.
 * Marked as TODO — collision mutation requires spatial grid access from worker.
 */
const _updateDoorCollision = (options: { world: World; eid: number; open: boolean }): void => {
  const { world, eid, open } = options;
  // TODO: Update spatial hash grid when door opens/closes (C-173 integration)
  // Requires calling into the spatial grid system from the worker context.
  void world;
  void eid;
  void open;
};

export { handleInteract };
