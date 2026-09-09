// packages/shared/constants/src/lib/memory.ts
//
// Constants for the in-house memory/lore retrieval system.
//
// Contract: C-458 In-House Memory & Lore Retrieval System

/** Default maximum results per retrieval query. */
export const DEFAULT_MAX_RESULTS = 10;

/** Minimum confidence threshold for returning a retrieval result (0..1). */
export const DEFAULT_MIN_SCORE = 0.25;

/** Maximum entries in the retrieval index before prioritization kicks in. */
export const MAX_INDEX_ENTRIES = 500;

/** Soft warning threshold for index size (entries). */
export const INDEX_SIZE_WARN = 250;

/** Default cap on facts recalled into the NPC dialogue `[MEMORY]` section (C-492). */
export const NPC_RECALL_MAX_RESULTS = 4;

/** Maximum NPC-scope candidates inspected before witness filtering (C-492). */
export const NPC_RECALL_CANDIDATE_LIMIT = 50;

/**
 * Indexed source types searched for each public retrieval scope.
 *
 * `all`/`history`/`lore` are the GM/narrative-director surfaces (may include
 * the player's private `session_summary`). `npc` is the player-facing NPC
 * recall scope — witnessed narrative events + shared lore ONLY, never
 * `session_summary` (C-492 trust boundary).
 */
export const MEMORY_QUERY_SCOPE_SOURCE_TYPES = {
  all: ['lore', 'session_summary', 'narrative_event'],
  history: ['session_summary'],
  lore: ['lore'],
  npc: ['narrative_event', 'lore'],
} as const;
