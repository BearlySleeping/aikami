// packages/shared/constants/src/lib/npc_memory.ts
//
// Budgets for per-NPC conversational memory. Every bound exists so the save
// blob and the per-turn prompt stay constant-size no matter how long the
// campaign runs — detail is compacted into the rolling summary, never
// accumulated as raw transcript.

/** Hard caps for stored memory and for what is projected into prompts. */
export const NPC_MEMORY_LIMITS = {
  /** Max remembered NPCs per campaign; least-recently-talked-to is evicted. */
  maxRecords: 64,
  /** Max characters of the rolling summary. */
  summaryChars: 700,
  /** Max durable notes per NPC. */
  maxNotes: 8,
  /** Max characters per note. */
  noteChars: 160,
  /** Verbatim lines kept from the most recent conversation. */
  lastExchangeLines: 6,
  /** Max characters per verbatim line. */
  lineChars: 240,
  /** Transcript lines fed to the digest call (bounds the background prompt). */
  digestTranscriptLines: 30,
  /** Max characters of an opener. */
  openerChars: 400,
  /** Max suggestion chips attached to an opener. */
  maxOpenerSuggestions: 3,
} as const;

/** An opener older than this is regenerated on the next proximity/map prefetch. */
export const NPC_MEMORY_OPENER_MAX_AGE_MS = 15 * 60 * 1000;

/** Minimum gap between two opener refreshes for the same NPC (prefetch debounce). */
export const NPC_MEMORY_PREFETCH_COOLDOWN_MS = 60 * 1000;

/** Max concurrent opener prefetches when a map loads. */
export const NPC_MEMORY_MAP_PREFETCH_LIMIT = 4;
