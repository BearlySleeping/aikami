// apps/frontend/client/src/lib/services/game/game_state_facts.ts
//
// Compact, bounded economy facts for NPC dialogue AI context (C-331 AC-5).
// Rendered into the system prompt under [GAME STATE] by npcDialogueService.

import { equipmentService } from './equipment_service.svelte';
import { getItemDefinition, inventoryService } from './inventory_service.svelte';

/** Maximum number of inventory entries listed before truncating with "…". */
const MAX_LISTED_ITEMS = 8;

/**
 * Builds a compact (≤ 5 lines) summary of the player's gold, inventory,
 * and equipment for injection into NPC dialogue prompts.
 */
export const buildGameStateFacts = (): string[] => {
  const facts: string[] = [];

  facts.push(`Gold: ${inventoryService.gold}`);

  const entries = inventoryService.inventory;
  if (entries.length === 0) {
    facts.push('Inventory: (empty)');
  } else {
    const listed = entries
      .slice(0, MAX_LISTED_ITEMS)
      .map((entry) => `${getItemDefinition(entry.itemId).label} x${entry.quantity}`)
      .join(', ');
    const suffix = entries.length > MAX_LISTED_ITEMS ? ', …' : '';
    facts.push(`Inventory: ${listed}${suffix}`);
  }

  const equipped: string[] = [];
  if (equipmentService.equippedWeapon) {
    equipped.push(`${getItemDefinition(equipmentService.equippedWeapon).label} (weapon)`);
  }
  if (equipmentService.equippedArmor) {
    equipped.push(`${getItemDefinition(equipmentService.equippedArmor).label} (armor)`);
  }
  facts.push(`Equipped: ${equipped.length > 0 ? equipped.join(', ') : 'nothing'}`);

  return facts;
};
