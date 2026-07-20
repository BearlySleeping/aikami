// apps/frontend/client/src/lib/types/compacted_campaign_summary.ts
//
// Client-local type for hierarchical campaign-level summarization.
// Contract: C-344 Complete Session Recaps, Checkpoints, and Long-Campaign Lifecycle

/**
 * Result of compacting multiple session summaries into a hierarchical
 * campaign-level summary. Stored alongside session data so the AI prompt
 * can reference a single compacted entry instead of N individual summaries.
 */
export type CompactedCampaignSummary = {
  /** Unique summary identifier (UUID). */
  id: string;
  /** The campaign this compaction covers. */
  campaignId: string;
  /** Which sessions were compacted (session IDs). */
  compactedSessionIds: readonly string[];
  /** The session number range covered. */
  sessionRange: { readonly first: number; readonly last: number };
  /** Hierarchical synopsis (LLM-generated or deterministic fallback). */
  synopsis: string;
  /** Key events across all compacted sessions, deduplicated and ranked. */
  keyEvents: readonly string[];
  /** ISO-8601 timestamp of compaction. */
  compactedAt: string;
  /** Method used: 'ai' for LLM compaction, 'truncation' for offline fallback. */
  method: 'ai' | 'truncation';
};
