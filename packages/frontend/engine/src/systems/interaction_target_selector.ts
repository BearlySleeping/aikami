// packages/frontend/engine/src/systems/interaction_target_selector.ts
//
// Shared target-selection helper for interaction proximity and press-time
// interact. Single source of truth for interaction priority rules:
//   items before NPCs, nearest wins, deterministic tie-break on entity id.
// Contract: C-327 AC-2

import type { World } from 'bitecs';
import { getComponent, query } from 'bitecs';
import { Interactable, type InteractableData } from '../components/interactable.ts';
import { NPCDialog, type NPCDialogData } from '../components/npc_dialog.ts';
import { Position, type PositionData } from '../components/position.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default interaction radius in pixels for items. */
const DEFAULT_ITEM_RADIUS = 50;

/** Cached query terms — entities with Position + Interactable (all interactable types). */
const INTERACTABLE_QUERY_TERMS = [Position, Interactable];

/** Cached query terms — entities with Position + NPCDialog (NPCs). */
const NPC_QUERY_TERMS = [Position, NPCDialog];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The selected interaction target, or undefined if nothing is in range. */
export type InteractionTarget = {
  /** Entity ID in the bitECS world. */
  entityId: number;
  /** Display name for the prompt (NPC name or item id). */
  targetName: string;
  /** Interaction type. */
  targetType:
    | 'npc'
    | 'item'
    | 'door'
    | 'chest'
    | 'lever'
    | 'pressure_plate'
    | 'container'
    | 'readable'
    | 'trap';
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Scans the world for the closest interactable entity (item or NPC) within
 * range of the player position.
 *
 * Priority rules:
 *  1. Items are checked first (higher priority).
 *  2. Within each category, nearest entity wins (squared-distance).
 *  3. If two entities are exactly equidistant, the lower entity id wins
 *     (deterministic tie-break — no flicker).
 *
 * @param options.world - The bitECS world.
 * @param options.playerX - Player's world X coordinate.
 * @param options.playerY - Player's world Y coordinate.
 * @returns The selected target, or `undefined` if nothing is in range.
 */
export const selectInteractionTarget = (options: {
  world: World;
  playerX: number;
  playerY: number;
}): InteractionTarget | undefined => {
  const { world, playerX, playerY } = options;

  let closestEid = -1;
  let closestDistSq = Number.POSITIVE_INFINITY;
  let closestType: InteractionTarget['targetType'] | undefined;

  // ── Interactables first (items, doors, chests, levers, etc.) — higher priority ──

  for (const eid of query(world, INTERACTABLE_QUERY_TERMS)) {
    const interactable = getComponent(world, eid, Interactable) as InteractableData | undefined;
    if (!interactable) {
      continue;
    }

    // Skip NPC-type interactables — they're handled in the NPC pass below.
    // Only process non-NPC interactables: item, door, chest, lever, pressure_plate,
    // container, readable, trap.
    if (interactable.type === 'npc') {
      continue;
    }

    const pos = getComponent(world, eid, Position) as PositionData | undefined;
    if (!pos) {
      continue;
    }

    const dx = pos.x - playerX;
    const dy = pos.y - playerY;
    const distSq = dx * dx + dy * dy;
    const radiusSq = DEFAULT_ITEM_RADIUS * DEFAULT_ITEM_RADIUS;

    if (distSq <= radiusSq && distSq < closestDistSq) {
      closestEid = eid;
      closestDistSq = distSq;
      closestType = interactable.type;
    }
  }

  // ── NPCs — only consider if no interactable target has been selected ──

  if (closestEid < 0) {
    for (const eid of query(world, NPC_QUERY_TERMS)) {
      const npcDialog = getComponent(world, eid, NPCDialog) as NPCDialogData | undefined;
      if (!npcDialog) {
        continue;
      }

      const pos = getComponent(world, eid, Position) as PositionData | undefined;
      if (!pos) {
        continue;
      }

      const dx = pos.x - playerX;
      const dy = pos.y - playerY;
      const distSq = dx * dx + dy * dy;
      const radiusSq = npcDialog.interactionRadius * npcDialog.interactionRadius;

      if (distSq <= radiusSq && distSq < closestDistSq) {
        closestEid = eid;
        closestDistSq = distSq;
        closestType = 'npc';
      }
    }
  }

  if (closestEid < 0 || !closestType) {
    return undefined;
  }

  // ── Resolve display name ──

  let targetName: string;
  if (closestType === 'npc') {
    const npcDialog = getComponent(world, closestEid, NPCDialog) as NPCDialogData | undefined;
    targetName = npcDialog?.npcName ?? 'Unknown NPC';
  } else {
    // All non-NPC types: item, door, chest, lever, pressure_plate, container, readable, trap
    const interactable = getComponent(world, closestEid, Interactable) as
      | InteractableData
      | undefined;
    const spawnId = interactable?.spawnId ?? '';
    // Use spawnId as the fallback display name for non-item, non-NPC types
    if (closestType === 'item') {
      targetName = interactable?.itemId ?? 'Unknown Item';
    } else {
      targetName = spawnId || `Unknown ${closestType}`;
    }
  }

  return {
    entityId: closestEid,
    targetName,
    targetType: closestType,
  };
};
