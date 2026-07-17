// packages/shared/constants/src/lib/degradation.ts
//
// Per-feature degradation policy — maps every game feature to its fallback
// mode when AI capabilities (text, image, voice) are unavailable.
// Read-only, no runtime dependencies — pure data module.
// Contract: C-318 AC-5, amended C-324

/**
 * How a feature behaves when its required AI capability is absent.
 * Generated from DegradationModeSchema in @aikami/schemas.
 */
import type { CapabilityProfile, DegradationMode } from '@aikami/types';

// ── Feature IDs ────────────────────────────────────────────────────────

/** Every feature that can degrade when AI is unavailable. */
export type FeatureId =
  | 'dialogue'
  | 'combatNarration'
  | 'questDescriptions'
  | 'npcExpressions'
  | 'lpcSprites'
  | 'ttsVoice'
  | 'imageGeneration'
  | 'sessionRecap'
  | 'aiGm';

// ── Policy matrix ──────────────────────────────────────────────────────

/**
 * Degradation behaviour for each feature in each capability state.
 *
 * - `onFailure`: textProvider is false or the text AI call fails transiently.
 *   Authored/template fallbacks are transient-failure resilience, never a
 *   supported steady-state zero-AI mode (C-324).
 * - `online`:  textProvider is true (text AI is available).
 */
type PolicyEntry = {
  /** Fallback mode when a required text AI call fails or is transiently unavailable. */
  readonly onFailure: DegradationMode;
  /** Fallback mode when text AI is available (may still degrade on image/voice). */
  readonly online: DegradationMode;
  /** Optional: secondary capability that overrides the online fallback when absent. */
  readonly alsoRequires?: 'imageProvider' | 'voiceProvider';
};

/**
 * The canonical per-feature degradation policy.
 *
 * When text AI is available (textProvider: true), features default to
 * `full_ai` unless a secondary capability is required and absent.
 */
export const DEGRADATION_POLICY: Readonly<Record<FeatureId, PolicyEntry>> = {
  dialogue: {
    /** Authored dialogue lines — transient AI failure fallback, never a steady-state mode (C-324). */
    onFailure: 'authored_fallback',
    online: 'full_ai',
  },
  combatNarration: {
    /** Template-driven narration — transient AI failure fallback, never a steady-state mode (C-324). */
    onFailure: 'template_fallback',
    online: 'full_ai',
  },
  questDescriptions: {
    /** Authored quest text — transient AI failure fallback, never a steady-state mode (C-324). */
    onFailure: 'authored_fallback',
    online: 'full_ai',
  },
  npcExpressions: {
    onFailure: 'static',
    online: 'full_ai',
  },
  lpcSprites: {
    onFailure: 'full_ai',
    online: 'full_ai',
  },
  ttsVoice: {
    onFailure: 'disabled',
    online: 'full_ai',
    alsoRequires: 'voiceProvider',
  },
  imageGeneration: {
    onFailure: 'disabled',
    online: 'full_ai',
    alsoRequires: 'imageProvider',
  },
  sessionRecap: {
    onFailure: 'static',
    online: 'full_ai',
  },
  aiGm: {
    onFailure: 'disabled',
    online: 'full_ai',
  },
} as const;

// ── Query function ─────────────────────────────────────────────────────

/**
 * Returns the active degradation mode for a feature given a capability profile.
 *
 * @param options.feature - The feature being queried.
 * @param options.capabilityProfile - The campaign's capability profile.
 * @returns The degradation mode for the feature in the current capability context.
 */
export const degradationBehavior = (options: {
  feature: FeatureId;
  capabilityProfile: CapabilityProfile;
}): DegradationMode => {
  const entry = DEGRADATION_POLICY[options.feature];

  // Text AI unavailable or failing transiently → use the onFailure fallback
  if (!options.capabilityProfile.textProvider) {
    return entry.onFailure;
  }

  // Text AI is online → check secondary capability requirement
  if (entry.alsoRequires) {
    const secondaryAvailable = options.capabilityProfile[entry.alsoRequires];
    if (!secondaryAvailable) {
      // Secondary capability missing → degrade (same as onFailure for image/voice features)
      return entry.onFailure;
    }
  }

  return entry.online;
};
