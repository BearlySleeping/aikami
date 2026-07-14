// packages/shared/types/src/lib/game/content_pack.ts
//
// Content Pack types — derived from TypeBox schemas in @aikami/schemas.
// Single source of truth for content pack data shapes.
// Contract: C-315 Define a Versioned Campaign Content Pack and Atomic Loader
// Contract: C-316 Build the Authored Emberwatch Demo Adventure

import type {
  ContentPackCombatStatsSchema,
  ContentPackCreditsSchema,
  ContentPackEncounterEntrySchema,
  ContentPackItemEntrySchema,
  ContentPackLootEntrySchema,
  ContentPackManifestSchema,
  ContentPackMapEntrySchema,
  ContentPackNpcEntrySchema,
  ContentPackQuestEndingSchema,
  ContentPackQuestEntrySchema,
  ContentPackQuestObjectiveSchema,
  ContentPackQuestRewardSchema,
  ContentPackQuestRewardTypeSchema,
  ContentPackSkillCheckSchema,
  ContentPackSkillStatSchema,
  ItemTypeSchema,
} from '@aikami/schemas';
import type { Static } from 'typebox';

/** A single map entry in a content pack manifest. */
export type ContentPackMapEntry = Static<typeof ContentPackMapEntrySchema>;

/** Combat stats on an NPC (C-316). */
export type ContentPackCombatStats = Static<typeof ContentPackCombatStatsSchema>;

/** An NPC definition in a content pack manifest. */
export type ContentPackNpcEntry = Static<typeof ContentPackNpcEntrySchema>;

/** Supported item types. */
export type ItemType = Static<typeof ItemTypeSchema>;

/** An item definition in a content pack manifest. */
export type ContentPackItemEntry = Static<typeof ContentPackItemEntrySchema>;

/** A single quest objective (C-316). */
export type ContentPackQuestObjective = Static<typeof ContentPackQuestObjectiveSchema>;

/** Quest reward categories (C-316). */
export type ContentPackQuestRewardType = Static<typeof ContentPackQuestRewardTypeSchema>;

/** A quest completion reward (C-316). */
export type ContentPackQuestReward = Static<typeof ContentPackQuestRewardSchema>;

/** A quest ending variation (C-316). */
export type ContentPackQuestEnding = Static<typeof ContentPackQuestEndingSchema>;

/** A quest definition (C-316). */
export type ContentPackQuestEntry = Static<typeof ContentPackQuestEntrySchema>;

/** Skill stat for skill checks (C-316). */
export type ContentPackSkillStat = Static<typeof ContentPackSkillStatSchema>;

/** A skill check definition (C-316). */
export type ContentPackSkillCheck = Static<typeof ContentPackSkillCheckSchema>;

/** A loot drop entry (C-316). */
export type ContentPackLootEntry = Static<typeof ContentPackLootEntrySchema>;

/** A combat encounter definition (C-316). */
export type ContentPackEncounterEntry = Static<typeof ContentPackEncounterEntrySchema>;

/** Adventure credits (C-316). */
export type ContentPackCredits = Static<typeof ContentPackCreditsSchema>;

/** Top-level content pack manifest. */
export type ContentPackManifest = Static<typeof ContentPackManifestSchema>;
