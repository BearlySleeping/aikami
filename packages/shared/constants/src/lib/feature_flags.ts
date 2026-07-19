// packages/shared/constants/src/lib/feature_flags.ts
//
// Shared feature flag key names used across client, E2E, and CI.
// These keys map to PUBLIC_* environment variables.
//
// Contract: C-335 — Enforce the Playable Demo Release Gate

/**
 * Feature flag environment variable keys.
 * All flags use the PUBLIC_ prefix for Vite/SvelteKit exposure.
 */
export const FEATURE_FLAG_KEYS = {
  /** QA/CI bypass: when '1', allows gameplay without a resolved text AI provider */
  qaBypassTextAi: 'PUBLIC_QA_BYPASS_TEXT_AI',
} as const;

export type FeatureFlagKey = (typeof FEATURE_FLAG_KEYS)[keyof typeof FEATURE_FLAG_KEYS];
