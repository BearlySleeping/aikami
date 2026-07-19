// packages/shared/types/src/lib/game/quest_state.ts
//
// Quest runtime state types — derived from TypeBox schemas in @aikami/schemas.
// Contract: C-329 Integrate the Demo Quest from Offer Through Reward
// Contract: C-339 Complete Quest Graph, Journal, Objectives, and Reward Pipelines

import type {
  ActiveQuestStateSchema,
  QuestJournalEntrySchema,
  QuestObjectiveProgressSchema,
  QuestObjectiveProgressV1Schema,
  QuestProgressSchema,
} from '@aikami/schemas';
import type { Static } from 'typebox';

/** Per-objective status values. */
export type QuestObjectiveStatus =
  | 'locked'
  | 'active'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'expired';

/** Legacy v0 per-objective progress. */
export type QuestObjectiveProgress = Static<typeof QuestObjectiveProgressSchema>;

/** V1 per-objective progress with status and hidden/timed support (C-339). */
export type QuestObjectiveProgressV1 = Static<typeof QuestObjectiveProgressV1Schema>;

/** Per-quest progress entry for the save envelope. */
export type QuestProgress = Static<typeof QuestProgressSchema>;

/** Top-level quest state for the save envelope. */
export type ActiveQuestState = Static<typeof ActiveQuestStateSchema>;

/** A journal entry for a completed or failed quest (C-339). */
export type QuestJournalEntry = Static<typeof QuestJournalEntrySchema>;
