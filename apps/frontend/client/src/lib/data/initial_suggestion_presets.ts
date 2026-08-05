// apps/frontend/client/src/lib/data/initial_suggestion_presets.ts
//
// Player-class-based initial dialogue suggestions. When dialogue opens with
// an NPC, the production DialogueOverlayViewModel preloads the NPC's static
// `initialSuggestions` (content pack) merged with the active player class's
// preset chips — so a bard gets performance/gossip hooks, a fighter gets
// blade-for-hire hooks, etc.
//
// Chips satisfy NpcSuggestionChipSchema: prefillText must be a complete
// natural sentence (min 10 chars), ids are unique within the merged set.

import type { NpcSuggestionChip } from '@aikami/types';

/** Maximum number of chips shown on dialogue open (NPC + class merged). */
export const MAX_INITIAL_SUGGESTIONS = 5 as const;

/**
 * Player class id → suggestion chips preloaded at dialogue open.
 * Keys mirror CLASS_PRESETS ids (fighter, wizard, rogue, ...).
 */
export const PLAYER_CLASS_INITIAL_CHIPS: Readonly<Record<string, readonly NpcSuggestionChip[]>> = {
  fighter: [
    {
      id: 'class_fighter_blade',
      label: '⚔️ Offer your sword',
      intentType: 'dialogue',
      prefillText: 'I am handy with a blade if you need someone fought for.',
    },
    {
      id: 'class_fighter_training',
      label: '🛡️ Ask about training',
      intentType: 'skill_check',
      prefillText: 'Do you know where a fighter could find proper training around here?',
    },
  ],
  wizard: [
    {
      id: 'class_wizard_lore',
      label: '📜 Ask about arcane lore',
      intentType: 'dialogue',
      prefillText: 'Have you heard any arcane lore or strange magical happenings recently?',
    },
    {
      id: 'class_wizard_ward',
      label: '🔮 Study the ward',
      intentType: 'quest',
      prefillText: 'As a scholar, I would very much like to study the fading ward myself.',
    },
  ],
  rogue: [
    {
      id: 'class_rogue_ear',
      label: '👂 Keep an ear out',
      intentType: 'dialogue',
      prefillText: 'I have a way of hearing things people would rather keep quiet.',
    },
    {
      id: 'class_rogue_job',
      label: '🗡️ Quiet work',
      intentType: 'dialogue',
      prefillText: 'I am good at quiet work if anyone needs a delicate problem solved.',
    },
  ],
  bard: [
    {
      id: 'class_bard_perform',
      label: '🎵 Offer a song',
      intentType: 'skill_check',
      prefillText: 'Would you like to hear a song I composed on the road?',
    },
    {
      id: 'class_bard_rumors',
      label: '💬 Trade gossip',
      intentType: 'dialogue',
      prefillText: 'I always love a good story — what rumors have you heard lately?',
    },
  ],
  cleric: [
    {
      id: 'class_cleric_blessing',
      label: '✨ Offer a blessing',
      intentType: 'dialogue',
      prefillText: 'May the light watch over this place — would you like a blessing?',
    },
    {
      id: 'class_cleric_suffering',
      label: '🕯️ Ask about the sick',
      intentType: 'dialogue',
      prefillText: 'Is there anyone in the village who is sick or injured that I could help?',
    },
  ],
  ranger: [
    {
      id: 'class_ranger_roads',
      label: '🏹 Ask about the roads',
      intentType: 'dialogue',
      prefillText: 'I travel the wild roads often — what dangers have you seen out there?',
    },
    {
      id: 'class_ranger_track',
      label: '🐾 Offer tracking',
      intentType: 'skill_check',
      prefillText: 'I am skilled at tracking and scouting if you need someone to investigate.',
    },
  ],
  paladin: [
    {
      id: 'class_paladin_oath',
      label: '🛡️ Swear aid',
      intentType: 'dialogue',
      prefillText: 'By my oath, I will protect the innocent of this village with my life.',
    },
    {
      id: 'class_paladin_menace',
      label: '⚔️ Ask about threats',
      intentType: 'quest',
      prefillText: 'Tell me of any threat menacing this village so I may confront it directly.',
    },
  ],
  druid: [
    {
      id: 'class_druid_wilds',
      label: '🌿 Ask about the wilds',
      intentType: 'dialogue',
      prefillText: 'Has the land itself seemed restless or unsettled around here lately?',
    },
    {
      id: 'class_druid_heal',
      label: '🌱 Offer herbal aid',
      intentType: 'skill_check',
      prefillText: 'I know the healing herbs of the forest well if anyone is in need.',
    },
  ],
};

/** Fallback chips used when the player class has no preset entry. */
const FALLBACK_CLASS_CHIPS: readonly NpcSuggestionChip[] = [
  {
    id: 'class_default_help',
    label: '🤝 Offer to help',
    intentType: 'dialogue',
    prefillText: 'Is there any way I can be of help to you or the village today?',
  },
  {
    id: 'class_default_news',
    label: '🗞️ Ask for news',
    intentType: 'dialogue',
    prefillText: 'What has been happening in the village lately? I would like to know.',
  },
];

/** Suggested chips the given player class preloads at dialogue open. */
export const getClassInitialSuggestions = (
  classId: string | undefined,
): readonly NpcSuggestionChip[] =>
  PLAYER_CLASS_INITIAL_CHIPS[classId ?? ''] ?? FALLBACK_CLASS_CHIPS;

/**
 * Merges NPC-authored initial chips with player-class preset chips.
 * Deduplicates by chip id (NPC chips win) and caps at MAX_INITIAL_SUGGESTIONS.
 */
export const mergeInitialSuggestions = (
  npcChips: readonly NpcSuggestionChip[] | undefined,
  classId: string | undefined,
): NpcSuggestionChip[] => {
  const seen = new Set<string>();
  const merged: NpcSuggestionChip[] = [];

  const push = (chip: NpcSuggestionChip): void => {
    if (merged.length >= MAX_INITIAL_SUGGESTIONS) {
      return;
    }
    if (seen.has(chip.id)) {
      return;
    }
    seen.add(chip.id);
    merged.push(chip);
  };

  for (const chip of npcChips ?? []) {
    push(chip);
  }
  for (const chip of getClassInitialSuggestions(classId)) {
    push(chip);
  }

  return merged;
};
