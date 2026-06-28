// packages/frontend/engine/src/systems/interaction_system.ts
import type { World } from 'bitecs';
import { getComponent, query, removeEntity } from 'bitecs';
import { logger } from '$logger';
import { isSimulationActive } from '../components/engine_state.ts';
import type { InteractableData } from '../components/interactable.ts';
import { Interactable } from '../components/interactable.ts';
import { Inventory, MAX_INVENTORY_SLOTS } from '../components/inventory.ts';
import type { NPCDialogData } from '../components/npc_dialog.ts';
import { NPCDialog } from '../components/npc_dialog.ts';
import type { PositionData } from '../components/position.ts';
import { Position } from '../components/position.ts';
import { incrementEntityGeneration } from '../core/entity_reference.ts';
import type { EngineBridge } from '../engine_bridge.ts';
import { startDialogueZoom } from '../systems/camera_system.ts';

// ---------------------------------------------------------------------------
// Interaction System — handle INTERACT command for item pickup and NPC dialogue
//
// Contract C-142 Task 2: Wire the ECS Inventory component to interaction logic.
// When the player presses the Interact key (E/Enter), the system finds the
// closest interactable entity and dispatches the appropriate action.
// ---------------------------------------------------------------------------

/** Default interaction radius in pixels for items (same as NPC default). */
const DEFAULT_INTERACTION_RADIUS = 50;

/** Cached query terms — entities with Position + Interactable (pickup items). */
const ITEM_QUERY_TERMS = [Position, Interactable];

/** Cached query terms — entities with Position + NPCDialog (NPCs). */
const NPC_QUERY_TERMS = [Position, NPCDialog];

/**
 * Handles the INTERACT command from the UI layer.
 *
 * Finds the closest interactable entity (item or NPC) within range of the
 * player and performs the appropriate action:
 *
 * - **Items**: Adds the item stack to the player's Inventory component,
 *   destroys the item entity from the world, and emits `INVENTORY_UPDATED`
 *   with the full inventory array.
 * - **NPCs**: Emits `NPC_INTERACTED` so the dialogue overlay can open.
 *
 * Uses squared distance (`dx*dx + dy*dy`) to avoid `Math.sqrt` overhead.
 *
 * @param options.world - The bitECS world.
 * @param options.playerEntityId - The entity ID of the player.
 * @param options.bridge - The EngineBridge for emitting events.
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

  // ── C-172 AC-1: Return early during map transitions ──
  if (!isSimulationActive()) {
    return;
  }

  const playerPos = getComponent(world, playerEntityId, Position) as PositionData | undefined;
  if (!playerPos) {
    return;
  }

  // ── Find the closest interactable entity (item or NPC) ──

  let closestEid = -1;
  let closestDistSq = Number.POSITIVE_INFINITY;
  let closestType: 'npc' | 'item' | undefined;

  // Check item entities first (priority over NPCs — items are picked up).
  for (const eid of query(world, ITEM_QUERY_TERMS)) {
    const interactable = getComponent(world, eid, Interactable) as InteractableData | undefined;
    if (interactable?.type !== 'item') {
      continue;
    }

    const pos = getComponent(world, eid, Position) as PositionData | undefined;
    if (!pos) {
      continue;
    }

    const dx = pos.x - playerPos.x;
    const dy = pos.y - playerPos.y;
    const distSq = dx * dx + dy * dy;
    const radius = DEFAULT_INTERACTION_RADIUS;
    const radiusSq = radius * radius;

    if (distSq <= radiusSq && distSq < closestDistSq) {
      closestEid = eid;
      closestDistSq = distSq;
      closestType = 'item';
    }
  }

  // Check NPC entities
  for (const eid of query(world, NPC_QUERY_TERMS)) {
    const npcDialog = getComponent(world, eid, NPCDialog) as NPCDialogData | undefined;
    if (!npcDialog) {
      continue;
    }

    const pos = getComponent(world, eid, Position) as PositionData | undefined;
    if (!pos) {
      continue;
    }

    const dx = pos.x - playerPos.x;
    const dy = pos.y - playerPos.y;
    const distSq = dx * dx + dy * dy;
    const radiusSq = npcDialog.interactionRadius * npcDialog.interactionRadius;

    if (distSq <= radiusSq && distSq < closestDistSq) {
      closestEid = eid;
      closestDistSq = distSq;
      closestType = 'npc';
    }
  }

  if (closestEid < 0 || !closestType) {
    return; // Nothing interactable in range
  }

  // ── Dispatch based on type ──

  if (closestType === 'item') {
    _handleItemPickup({ world, playerEntityId, itemEid: closestEid, bridge });
  } else {
    _handleNpcInteraction({ world, npcEid: closestEid, playerEntityId, bridge });
  }
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Adds the item from the given entity into the player's inventory,
 * destroys the item entity, and emits {@link INVENTORY_UPDATED}.
 */
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

  const { itemId, quantity } = interactable;

  // ── Add to player inventory (find first empty slot) ──

  const playerItemIds = Inventory.itemIds[playerEntityId];
  const playerQuantities = Inventory.quantities[playerEntityId];
  const playerItemTypes = Inventory.itemTypes[playerEntityId];

  if (!playerItemIds || !playerQuantities || !playerItemTypes) {
    return;
  }

  // Find first empty slot (where itemId === 0)
  let slotFound = false;
  for (let slot = 0; slot < MAX_INVENTORY_SLOTS; slot++) {
    if ((playerItemIds[slot] ?? 0) === 0) {
      playerItemIds[slot] = 1; // generic item reference — 1 = filled
      playerQuantities[slot] = quantity;
      playerItemTypes[slot] = 0; // 0 = generic
      slotFound = true;
      break;
    }
  }

  if (!slotFound) {
    // Inventory full — could emit a feedback event in the future
    return;
  }

  // ── Destroy the item entity ──

  incrementEntityGeneration(itemEid);
  removeEntity(world, itemEid);

  // ── Emit INVENTORY_UPDATED with full inventory ──

  const inventoryPayload: Array<{ itemId: string; quantity: number }> = [];
  for (let slot = 0; slot < MAX_INVENTORY_SLOTS; slot++) {
    const slotItemId = playerItemIds[slot] ?? 0;
    if (slotItemId > 0) {
      inventoryPayload.push({
        itemId,
        quantity: playerQuantities[slot] ?? 0,
      });
    }
  }

  bridge.emit({
    type: 'INVENTORY_UPDATED',
    inventory: inventoryPayload,
  });
};

/**
 * Emits {@link NPC_INTERACTED} or {@link VENDOR_INTERACTED} for the given NPC entity.
 *
 * Vendor NPCs (isVendor=true) open the VendorView overlay.
 * Non-vendor NPCs open the DialogueOverlay.
 */
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

  // Start cinematic dialogue zoom — camera lerps to 1.5× centered on
  // the midpoint between the player and the NPC (C-161).
  // Fires for ALL NPCs (vendors + non-vendors).
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
    logger.debug('[interaction_system] VENDOR NPC interacted:', {
      npcId: npcDialog.npcId,
      npcName: npcDialog.npcName,
      isVendor: npcDialog.isVendor,
      vendorInventory: npcDialog.vendorInventory,
    });
    bridge.emit({
      type: 'VENDOR_INTERACTED',
      npcId: npcDialog.npcId,
      npcName: npcDialog.npcName,
      dialog: npcDialog.dialog,
      vendorInventory: npcDialog.vendorInventory,
    });
  } else {
    logger.debug('[interaction_system] NON-VENDOR NPC interacted:', {
      npcId: npcDialog.npcId,
      npcName: npcDialog.npcName,
      isVendor: npcDialog.isVendor,
    });

    bridge.emit({
      type: 'NPC_INTERACTED',
      npcId: npcDialog.npcId,
      npcName: npcDialog.npcName,
      dialog: npcDialog.dialog,
    });
  }
};

export { handleInteract };
