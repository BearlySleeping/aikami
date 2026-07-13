// packages/shared/constants/src/lib/campaign.ts
//
// Campaign-related constants — content pack display labels and
// resumable campaign states.
// Contract: C-317 Rebuild the Start Menu Around Campaigns, Not Personas

import type { CampaignState } from '@aikami/types';

// ---------------------------------------------------------------------------
// Content pack labels
// ---------------------------------------------------------------------------

/**
 * Maps content pack IDs to human-readable display labels.
 * Phase 1: only 'emberwatch' exists. Future packs read from the
 * content pack manifest (C-315).
 */
export const CONTENT_PACK_LABELS: Record<string, string> = {
  emberwatch: 'Emberwatch: The Fading Ward',
} as const;

/** Fallback label when a content pack ID has no known display name. */
export const UNKNOWN_CONTENT_PACK_LABEL = 'Unknown Adventure';

// ---------------------------------------------------------------------------
// Resumable states
// ---------------------------------------------------------------------------

/**
 * Campaign states that count as "resumable" — the Continue button only
 * appears when at least one campaign is in one of these states.
 * `creating`/`loading` (incomplete boot) and `failed` are NOT resumable.
 */
export const RESUMABLE_CAMPAIGN_STATES: readonly CampaignState[] = [
  'playing',
  'paused',
  'saving',
] as const;
