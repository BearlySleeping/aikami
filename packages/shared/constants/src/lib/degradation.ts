// packages/shared/constants/src/lib/degradation.ts
//
// Per-feature degradation policy — maps every game feature to its fallback
// mode when AI capabilities (text, image, voice) are unavailable.
// Read-only, no runtime dependencies — pure data module.
// Contract: C-318 AC-5

import type { CapabilityProfile } from '@aikami/types';

// ── Degradation mode ───────────────────────────────────────────────────

/**
 * How a feature behaves when its required AI capability is absent.
 *
 * - `full_ai`: Feature operates with full AI augmentation.
 * - `authored_fallback`: Pre-authored content from the content pack is used.
 * - `template_fallback`: Deterministic templates fill in the gaps.
 * - `static`: A static/default value is substituted.
 * - `disabled`: Feature is completely disabled / silent.
 */
export type DegradationMode =
  | 'full_ai'
  | 'authored_fallback'
  | 'template_fallback'
  | 'static'
  | 'disabled';

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
 * - `offline`: textProvider is false (no text AI at all).
 * - `online`:  textProvider is true (text AI is available).
 */
type PolicyEntry = {
  /** Fallback mode when text AI is unavailable. */
  readonly offline: DegradationMode;
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
    offline: 'authored_fallback',
    online: 'full_ai',
  },
  combatNarration: {
    offline: 'template_fallback',
    online: 'full_ai',
  },
  questDescriptions: {
    offline: 'authored_fallback',
    online: 'full_ai',
  },
  npcExpressions: {
    offline: 'static',
    online: 'full_ai',
  },
  lpcSprites: {
    offline: 'full_ai',
    online: 'full_ai',
  },
  ttsVoice: {
    offline: 'disabled',
    online: 'full_ai',
    alsoRequires: 'voiceProvider',
  },
  imageGeneration: {
    offline: 'disabled',
    online: 'full_ai',
    alsoRequires: 'imageProvider',
  },
  sessionRecap: {
    offline: 'static',
    online: 'full_ai',
  },
  aiGm: {
    offline: 'disabled',
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

  // Text AI is offline → use the offline fallback unconditionally
  if (!options.capabilityProfile.textProvider) {
    return entry.offline;
  }

  // Text AI is online → check secondary capability requirement
  if (entry.alsoRequires) {
    const secondaryAvailable = options.capabilityProfile[entry.alsoRequires];
    if (!secondaryAvailable) {
      // Secondary capability missing → degrade (same as offline for image/voice features)
      return entry.offline;
    }
  }

  return entry.online;
};
