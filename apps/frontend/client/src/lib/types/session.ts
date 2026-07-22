// apps/frontend/client/src/lib/types/session.ts
//
// Client-local types for game session management.

import type { SessionSummary } from './gm.ts';

/**
 * A game session — one play period within a campaign.
 *
 * Each game has one active session at most. Multiple sessions exist
 * per game. The active session is locked (read-only) once ended.
 *
 * Extended in C-344 with recapReviewed, editedSynopsis, and checkpointIds.
 */
export type GameSession = {
  /** Unique session identifier. */
  id: string;
  /** The game this session belongs to. */
  gameId: string;
  /** Monotonically increasing session number (1-indexed). */
  sessionNumber: number;
  /** ISO-8601 timestamp of session start. */
  startedAt: string;
  /** ISO-8601 timestamp of session end, or undefined if still active. */
  endedAt?: string;
  /** Whether this session is currently active (not ended). */
  isActive: boolean;
  /** The C-235 session summary, generated when the session ends. */
  summary?: SessionSummary;
  /** Total message count in the chat when the session was ended. */
  messageCount: number;
  /** Session duration in minutes. */
  durationMinutes?: number;
  /** Stat snapshots for party members at session end. */
  characterSnapshots: Record<string, { level: number; xp: number; hp: number }>;
  /** Whether the player has reviewed/edited the recap for this session (C-344). */
  recapReviewed: boolean;
  /** The player-edited synopsis (if edited; original summary.synopsis if not) (C-344). */
  editedSynopsis?: string;
  /** Checkpoint IDs created during this session, in creation order (C-344). */
  checkpointIds: readonly string[];
};
