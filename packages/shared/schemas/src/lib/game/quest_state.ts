// packages/shared/schemas/src/lib/game/quest_state.ts
//
// Quest runtime state schemas — serializable quest state for the save envelope.
// Derived types live in packages/shared/types/src/lib/game/quest_state.ts.
// Contract: C-329 Integrate the Demo Quest from Offer Through Reward
// Contract: C-339 Complete Quest Graph, Journal, Objectives, and Reward Pipelines

import Type from 'typebox';

// ── Per-objective status (C-339) ──

export const QuestObjectiveStatusSchema = Type.Union([
  Type.Literal('locked'),
  Type.Literal('active'),
  Type.Literal('completed'),
  Type.Literal('failed'),
  Type.Literal('skipped'),
  Type.Literal('expired'),
]);

// ── Objective progress (extended for C-339) ──

/** Legacy v0 objective progress — objectiveIndex + current only. */
export const QuestObjectiveProgressSchema = Type.Object({
  objectiveIndex: Type.Integer({
    minimum: 0,
    description: 'Index into content pack objectives array',
  }),
  current: Type.Integer({ minimum: 0, description: 'Current progress count' }),
});

/** V1 objective progress with per-objective status and hidden/timed support (C-339). */
export const QuestObjectiveProgressV1Schema = Type.Object({
  objectiveIndex: Type.Integer({
    minimum: 0,
    description: 'Index into content pack objectives array',
  }),
  current: Type.Integer({ minimum: 0, description: 'Current progress count' }),
  /** Per-objective status. */
  status: QuestObjectiveStatusSchema,
  /** Whether a hidden objective has been revealed to the player. */
  hiddenRevealed: Type.Boolean({ description: 'Whether a hidden objective has been revealed' }),
  /** Timestamp when this objective first became active (for timer calculation). */
  activeSince: Type.Optional(
    Type.Number({ description: 'Timestamp when objective became active (ms)' }),
  ),
  /** Timestamp when a hidden objective was revealed to the player. */
  revealedAt: Type.Optional(
    Type.Number({ description: 'Timestamp when hidden objective was revealed (ms)' }),
  ),
});

// ── Journal entry schemas (C-339) ──

/** Journal reward entry. */
export const QuestJournalRewardSchema = Type.Object({
  type: Type.String({ description: 'Reward type (item, gold, xp, equipment)' }),
  label: Type.String({ description: 'Human-readable reward label' }),
});

/** Journal objective result entry. */
export const QuestJournalObjectiveResultSchema = Type.Object({
  label: Type.String({ description: 'Objective display text' }),
  status: QuestObjectiveStatusSchema,
  revealedAt: Type.Optional(
    Type.Number({ description: 'Timestamp when hidden objective was revealed' }),
  ),
});

/** A journal entry for a completed or failed quest. */
export const QuestJournalEntrySchema = Type.Object({
  /** Quest ID from content pack. */
  questId: Type.String({ description: 'Content pack quest ID' }),
  /** Quest display name (cached from content pack). */
  title: Type.String({ description: 'Quest display name' }),
  /** Final status — completed or failed. */
  status: Type.Union([Type.Literal('completed'), Type.Literal('failed')]),
  /** Timestamp of completion/failure. */
  timestamp: Type.Number({ description: 'Timestamp of completion/failure (ms)' }),
  /** Ending ID chosen (if applicable). */
  endingId: Type.Optional(Type.String()),
  /** Ending title (if applicable). */
  endingTitle: Type.Optional(Type.String()),
  /** Authored narration text from the ending. */
  narration: Type.String({ description: 'Authored narration text' }),
  /** Objectives with their final status for the journal record. */
  objectiveResults: Type.Array(QuestJournalObjectiveResultSchema),
  /** Rewards received. */
  rewards: Type.Array(QuestJournalRewardSchema),
  /** World-state flags set by this quest completion. */
  worldStateFlags: Type.Array(Type.String()),
});

// ── Per-quest progress (extended for C-339) ──

export const QuestProgressSchema = Type.Object({
  questId: Type.String({ description: 'Content pack quest ID' }),
  status: Type.Union([Type.Literal('active'), Type.Literal('completed'), Type.Literal('failed')], {
    description: 'Quest status',
  }),
  objectives: Type.Array(QuestObjectiveProgressV1Schema, {
    description: 'Objective progress entries (v1 format — per-objective status)',
  }),
  startedAt: Type.Number({ description: 'Timestamp when quest was accepted (ms)' }),
  completedAt: Type.Optional(Type.Number({ description: 'Timestamp when quest completed' })),
  rewardsGranted: Type.Boolean({
    description: 'Whether rewards have been delivered (idempotency guard)',
  }),
  chosenEndingId: Type.Optional(Type.String({ description: 'Ending ID chosen by player' })),
});

// ── Top-level save envelope structure (extended for C-339) ──

export const ActiveQuestStateSchema = Type.Object({
  /** Schema version for migration. 0 = C-329 format, 1 = C-339 format. */
  schemaVersion: Type.Optional(
    Type.Number({ description: 'Schema version for migration (1 = C-339)' }),
  ),
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
  /** Completed repeatable quests with last-completed timestamps (C-339). */
  repeatableCompletions: Type.Optional(
    Type.Record(Type.String(), Type.Number(), {
      description: 'Last completion timestamps for repeatable quests',
    }),
  ),
  /** Journal entries for completed and failed quests (C-339). */
  journalEntries: Type.Optional(
    Type.Array(QuestJournalEntrySchema, { description: 'Quest journal entries' }),
  ),
});
