// apps/frontend/client/src/lib/services/game/game_state_facts.ts
//
// Compact, bounded economy facts for NPC dialogue AI context (C-331 AC-5).
// Rendered into the system prompt under [GAME STATE] by npcDialogueService.
// Extended (C-341) with relationship and faction standing facts.

import { equipmentService } from './equipment_service.svelte';
import { getItemDefinition, inventoryService } from './inventory_service.svelte';
import { relationshipService } from './relationship_service.svelte';

/** Maximum number of inventory entries listed before truncating with "\u2026". */
const MAX_LISTED_ITEMS = 8;

/** Maximum total facts across all categories. */
const MAX_TOTAL_FACTS = 5;

/**
 * Builds a compact (\u2264 5 lines) summary of the player's gold, inventory,
 * equipment, and relationship/faction standing for injection into NPC dialogue
 * prompts.
 *
 * @param options.npcId - The NPC being conversed with for relationship lookup
 * @param options.npcFactionId - Optional faction ID for faction-specific facts
 */
export const buildGameStateFacts = (options: {
  npcId: string;
  npcFactionId?: string;
}): string[] => {
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
    const suffix = entries.length > MAX_LISTED_ITEMS ? ', \u2026' : '';
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

  // C-341: Append relationship/faction facts (bounded to total max)
  const remaining = MAX_TOTAL_FACTS - facts.length;
  if (remaining > 0) {
    const relationshipFacts = relationshipService.getFacts({
      npcId: options.npcId,
      npcFactionId: options.npcFactionId,
    });
    facts.push(...relationshipFacts.slice(0, remaining));
  }

  return facts;
};
