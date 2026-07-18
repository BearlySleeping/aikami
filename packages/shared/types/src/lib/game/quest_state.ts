// packages/shared/types/src/lib/game/quest_state.ts
//
// Quest runtime state types — derived from TypeBox schemas in @aikami/schemas.
// Contract: C-329 Integrate the Demo Quest from Offer Through Reward

import type {
  ActiveQuestStateSchema,
  QuestObjectiveProgressSchema,
  QuestProgressSchema,
} from '@aikami/schemas';
import type { Static } from 'typebox';

/** Per-objective progress (minimal — labels derived from content pack on hydrate). */
export type QuestObjectiveProgress = Static<typeof QuestObjectiveProgressSchema>;

/** Per-quest progress entry for the save envelope. */
export type QuestProgress = Static<typeof QuestProgressSchema>;

/** Top-level quest state for the save envelope. */
export type ActiveQuestState = Static<typeof ActiveQuestStateSchema>;
