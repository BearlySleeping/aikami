// packages/frontend/configs/src/lib/feature-flags.ts
import { resolveCombatEngineKind, resolveCombatLlmAgents } from '@aikami/constants';
import { publicEnv } from './environment';

/**
 * Feature flag definitions for the frontend.
 * Backed by environment variables to allow per-environment configuration.
 */
export const featureFlags = {
  /** Enable Firestore offline persistence */
  offlinePersistence: publicEnv.PUBLIC_ENABLE_FIRESTORE_OFFLINE_PERSISTENCE === '1',

  /** Enable push notifications */
  pushNotifications: Boolean(publicEnv.PUBLIC_VAPID_KEY),

  /**
   * QA/CI bypass flag for text AI capability gate.
   * When '1', allows gameplay without a resolved text AI provider.
   * MUST be '0' or absent in production builds.
   *
   * Contract: C-335 AC-4 — AI capability gate enforcement
   */
  qaBypassTextAi: publicEnv.PUBLIC_QA_BYPASS_TEXT_AI === '1',

  /**
   * Combat resolver selection — 'legacy' (default) or 'v2'.
   *
   * Resolved once here; the encounter start reads the resolved value and pins
   * it on the encounter, so a mid-fight env change can never switch engines
   * (C-516 AC-1). Unset or invalid resolves to `legacy`.
   */
  combatEngine: resolveCombatEngineKind(publicEnv.PUBLIC_COMBAT_ENGINE),

  /**
   * Natural-language combat input (C-525).
   *
   * Enabled unless explicitly switched off with `PUBLIC_COMBAT_LANGUAGE_INPUT=0`:
   * the flag is a KILL SWITCH for the language surfaces (input, preview,
   * clarification), not a launch gate — disabling it leaves the direct click
   * controls and the resolver completely untouched (C-525 Migration & Rollback).
   */
  combatLanguageInput: publicEnv.PUBLIC_COMBAT_LANGUAGE_INPUT !== '0',

  /**
   * LLM-driven combat agents + outcome narration (C-526).
   *
   * Default OFF — opt-in with the exact literal `'1'`. Off keeps the
   * deterministic `chooseV2AiCommand` AI and the authored narration templates
   * as the only paths (C-526 AC-9 kill switch).
   */
  combatLlmAgents: resolveCombatLlmAgents(publicEnv.PUBLIC_COMBAT_LLM_AGENTS),
} as const;

export type FeatureFlags = typeof featureFlags;
