// apps/frontend/client/src/lib/services/game/game_state_facts.ts
//
// Compact, bounded economy facts for NPC dialogue AI context (C-331 AC-5).
// Rendered into the system prompt under [GAME STATE] by npcDialogueService.
// Extended (C-341) with relationship and faction standing facts.
// Extended (quest overlay) with active-quest facts + difficulty-based
// GM guidance so NPCs steer the player toward the current quest objective
// at a difficulty-appropriate level of explicitness.

import { getItemDefinition } from '$utils/inventory_utils';
import { equipmentService } from './equipment_service.svelte';
import { type GameplayDifficulty, getGameplayDifficulty } from './gameplay_settings';
import { inventoryService } from './inventory_service.svelte';
import { questStateService } from './quest_state_service.svelte';
import { relationshipService } from './relationship_service.svelte';

/** Maximum number of inventory entries listed before truncating with "\u2026". */
const MAX_LISTED_ITEMS = 8;

/** Maximum number of active quests surfaced to the GM context. */
const MAX_QUEST_FACTS = 2;

/** Maximum total facts across all categories. */
const MAX_TOTAL_FACTS = 8;

/** Difficulty → how explicitly NPCs may guide the player. */
const DIFFICULTY_GUIDANCE: Record<GameplayDifficulty, string> = {
  easy: 'be very direct — openly name the item, person, and location the player needs (e.g. "Rollo at the inn has the Ward Wand"). NPCs volunteer helpful directions unprompted.',
  medium:
    'hint indirectly — reference the item and its holder obliquely without spelling everything out. NPCs answer questions but do not volunteer the full answer.',
  hard: 'be realistic — NPCs never volunteer quest information the player has not earned or asked about. They respond only to what is directly said, and can be evasive, guarded, or suspicious.',
};

/**
 * Builds a compact summary of the player's gold, inventory, equipment,
 * active quests, and relationship/faction standing for injection into NPC
 * dialogue prompts.
 *
 * @param options.npcId - The NPC being conversed with for relationship lookup
 * @param options.npcFactionId - Optional faction ID for faction-specific facts
 */
export const buildGameStateFacts = (options: {
  npcId: string;
  npcFactionId?: string;
}): string[] => {
  const facts: string[] = [];

  // Every fact goes through the cap so MAX_TOTAL_FACTS bounds the whole
  // list (gold, inventory, equipped, quest, easy-mode hint, offerable-quest,
  // and difficulty-guidance facts) before relationship facts are appended.
  const pushFact = (fact: string): void => {
    if (facts.length < MAX_TOTAL_FACTS) {
      facts.push(fact);
    }
  };

  pushFact(`Gold: ${inventoryService.gold}`);

  const entries = inventoryService.inventory;
  if (entries.length === 0) {
    facts.push('Inventory: (empty)');
  } else {
    const listed = entries
      .slice(0, MAX_LISTED_ITEMS)
      .map((entry) => `${getItemDefinition(entry.itemId).label} x${entry.quantity}`)
      .join(', ');
    const suffix = entries.length > MAX_LISTED_ITEMS ? ', \u2026' : '';
    pushFact(`Inventory: ${listed}${suffix}`);
  }

  const equipped: string[] = [];
  for (const { slot, itemId } of equipmentService.equippedItems) {
    equipped.push(`${getItemDefinition(itemId).label} (${slot})`);
  }
  pushFact(`Equipped: ${equipped.length > 0 ? equipped.join(', ') : 'nothing'}`);

  // ── Active quest facts (drives GM quest guidance) ────────────────────
  const difficulty = getGameplayDifficulty();
  const activeQuests = questStateService.quests.filter((q) => q.status === 'active');
  for (const quest of activeQuests.slice(0, MAX_QUEST_FACTS)) {
    const next = quest.objectives.find(
      (o) => o.current < o.max && o.status !== 'completed' && o.status !== 'failed',
    );
    const nextText = next ? next.label : 'Complete the quest';
    pushFact(`Active quest: "${quest.title}" — next objective: ${nextText}`);
    // Easy mode: surface the item the player must obtain so NPCs can name it.
    if (difficulty === 'easy') {
      const itemHint = _extractItemHint(nextText);
      if (itemHint) {
        pushFact(`Hint (easy mode only): the player needs "${itemHint}".`);
      }
    }
  }

  // ── Offerable quests (the GM's quest-activation tool targets) ────────
  const offerable = questStateService.getOfferableQuests(options.npcId);
  if (offerable.length > 0) {
    pushFact(
      `Offerable quests: ${offerable
        .map((q) => `"${q.name}" (id: ${q.id})`)
        .join(', ')} — ${options.npcId} can offer these.`,
    );
  }

  // ── Difficulty guidance for the GM/NPC voice ─────────────────────────
  pushFact(`Game difficulty: ${difficulty}. ${DIFFICULTY_GUIDANCE[difficulty]}`);

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

/** Recognizable item nouns used to pick the most likely quest-item phrase. */
const ITEM_NOUNS =
  /(Wand|Sword|Amulet|Ring|Pendant|Blade|Staff|Shield|Charm|Stone|Key|Gem|Dagger|Bow|Armor|Armour|Potion|Scroll|Crown|Idol|Tome|Relic|Orb|Sigil)\b/i;

/**
 * Extracts a likely quest-item name from the objective text so the easy-mode
 * GM can name it explicitly. Prefers capitalized phrases ending in an item
 * noun (e.g. "Ward Wand"); falls back to the longest capitalized phrase.
 * Matches only consecutive capitalized words so lowercase text and arbitrary
 * spaces are never consumed by one greedy match (e.g. "Find the Ward Wand's
 * keeper at the inn" yields "Ward Wand", not the full sentence).
 */
const _extractItemHint = (objectiveText: string): string | undefined => {
  const matches = objectiveText.match(/\b([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)\b/g) ?? [];
  const itemLike = matches.filter((m) => ITEM_NOUNS.test(m));
  if (itemLike.length > 0) {
    return itemLike.sort((a, b) => b.length - a.length)[0] ?? undefined;
  }
  return matches.sort((a, b) => b.length - a.length)[0] ?? undefined;
};
