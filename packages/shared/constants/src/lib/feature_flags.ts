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
  /** Extended onboarding arc: when '1', the Emberwatch manifest includes gameplay-teaching steps */
  extendedOnboardingArc: 'PUBLIC_EXTENDED_ONBOARDING_ARC',
  /**
   * Combat resolver selection: 'legacy' (default) or 'v2'. Chosen once at
   * encounter start — never re-read mid-fight.
   *
   * Contract: C-516 AC-1
   */
  combatEngine: 'PUBLIC_COMBAT_ENGINE',
  /**
   * LLM-driven combat agents + outcome narration (C-526). Default OFF —
   * opt-in with the exact literal `'1'`. Read once at encounter start and
   * pinned on the encounter, so a mid-fight change never switches AI mode.
   *
   * Contract: C-526 AC-9
   */
  combatLlmAgents: 'PUBLIC_COMBAT_LLM_AGENTS',
} as const;

export type FeatureFlagKey = (typeof FEATURE_FLAG_KEYS)[keyof typeof FEATURE_FLAG_KEYS];

/**
 * Resolves the combat LLM-agents kill switch.
 *
 * Only the exact literal `'1'` opts in: unset, `'0'`, `'true'` and a
 * half-configured deploy all leave the deterministic path in place (AC-9).
 * Kept total (never throws) so a bad env value cannot break config validation.
 */
export const resolveCombatLlmAgents = (raw?: string | null): boolean => raw === '1';
