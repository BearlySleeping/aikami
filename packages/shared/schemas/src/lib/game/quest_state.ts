// packages/shared/schemas/src/lib/game/quest_state.ts
//
// Quest runtime state schemas — serializable quest state for the save envelope.
// Derived types live in packages/shared/types/src/lib/game/quest_state.ts.
// Contract: C-329 Integrate the Demo Quest from Offer Through Reward

import Type from 'typebox';

// ── Objective progress (minimal — labels derived from content pack on hydrate) ──

export const QuestObjectiveProgressSchema = Type.Object({
  objectiveIndex: Type.Integer({
    minimum: 0,
    description: 'Index into content pack objectives array',
  }),
  current: Type.Integer({ minimum: 0, description: 'Current progress count' }),
});

// ── Per-quest progress ──

export const QuestProgressSchema = Type.Object({
  questId: Type.String({ description: 'Content pack quest ID' }),
  status: Type.Union([Type.Literal('active'), Type.Literal('completed'), Type.Literal('failed')], {
    description: 'Quest status',
  }),
  objectives: Type.Array(QuestObjectiveProgressSchema, {
    description: 'Objective progress entries',
  }),
  startedAt: Type.Number({ description: 'Timestamp when quest was accepted (ms)' }),
  completedAt: Type.Optional(Type.Number({ description: 'Timestamp when quest completed' })),
  rewardsGranted: Type.Boolean({
    description: 'Whether rewards have been delivered (idempotency guard)',
  }),
  chosenEndingId: Type.Optional(Type.String({ description: 'Ending ID chosen by player' })),
});

// ── Top-level save envelope structure ──

export const ActiveQuestStateSchema = Type.Object({
  activeQuests: Type.Array(QuestProgressSchema, { description: 'Currently tracked quests' }),
  completedQuestIds: Type.Array(Type.String(), {
    description: 'Quest IDs completed (for dedup) — legacy, prefer completedQuests',
  }),
  completedQuests: Type.Array(QuestProgressSchema, {
    description: 'Completed quest progress records with metadata (C-329 code review fix)',
  }),
  failedQuestIds: Type.Array(Type.String(), { description: 'Quest IDs failed (for dedup)' }),
  declinedQuestIds: Type.Array(Type.String(), {
    description: 'Quest IDs declined by the player (dedup guard)',
  }),
  worldStateFlags: Type.Record(Type.String(), Type.Boolean(), {
    description: 'World-state flags set by quest endings and events',
  }),
});
