// apps/frontend/client/src/lib/types/player_journal_entry.ts
//
// Client-local type for player-written journal entries.
// Contract: C-344 Complete Session Recaps, Checkpoints, and Long-Campaign Lifecycle

/**
 * A player-written journal entry — separate from auto-generated quest journal
 * entries (C-339). Players use this to record observations, plans, and
 * narrative notes that persist across sessions.
 */
export type PlayerJournalEntry = {
  /** Unique entry identifier (UUID). */
  id: string;
  /** The campaign this entry belongs to. */
  campaignId: string;
  /** The session number when this entry was written. */
  sessionNumber: number;
  /** Entry title (free text, player-written). */
  title: string;
  /** Entry body (free text, player-written). */
  content: string;
  /** Optional tags for categorization (e.g. "quest", "npc", "theory"). */
  tags: readonly string[];
  /** ISO-8601 timestamp of entry creation. */
  createdAt: string;
  /** ISO-8601 timestamp of last edit, same as createdAt if never edited. */
  updatedAt: string;
};
