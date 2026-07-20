// apps/frontend/client/src/lib/types/session_checkpoint.ts
//
// Client-local type for named, forkable game-state checkpoints within a session.
// Contract: C-344 Complete Session Recaps, Checkpoints, and Long-Campaign Lifecycle

/**
 * A named, forkable game-state checkpoint within a session.
 *
 * Checkpoints are stored as Turso save slots (`slot_id = 'checkpoint-{uuid}'`).
 * Unlike auto/manual saves, checkpoints carry a label and description
 * so the player can remember why they created them.
 */
export type SessionCheckpoint = {
  /** Unique checkpoint identifier (UUID). */
  id: string;
  /** The session this checkpoint belongs to. */
  sessionId: string;
  /** The campaign this checkpoint belongs to. */
  campaignId: string;
  /** Human-readable label (e.g. "Before the dragon"). */
  label: string;
  /** Optional player-written note about this checkpoint. */
  description?: string;
  /** Session number when this checkpoint was created. */
  sessionNumber: number;
  /** ISO-8601 timestamp of checkpoint creation. */
  createdAt: string;
  /** The Turso save slot ID backing this checkpoint's game state. */
  saveSlotId: string;
  /** Whether this checkpoint has been forked from (creating a branch). */
  hasForks: boolean;
};
