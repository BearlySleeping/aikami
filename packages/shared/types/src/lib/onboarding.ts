// packages/shared/types/src/lib/onboarding.ts
//
// Types for the fast character onboarding flow.
// Contract: C-319 Replace /setup with Fast Character Onboarding

import type { OnboardingStep } from '@aikami/constants';

/** Mode of the onboarding coordinator. */
export type SetupMode = 'starter_select' | 'custom' | 'session_zero';

/** Shape of the onboarding draft persisted to localStorage. */
export type OnboardingDraft = {
  /** The step the player was on when the draft was saved. */
  step: OnboardingStep;
  /** Character name. */
  name: string;
  /** Selected pronoun set ID (e.g., 'he_him'). */
  pronounId: string;
  /** Display string like "he/him" for storage in persona notes. */
  pronounDisplay: string;
  /** Selected race/species ID. */
  raceId: string;
  /** Selected class ID. */
  classId: string;
  /** Selected alignment. */
  alignment: string;
  /** Current ability scores keyed by ability name. */
  abilityScores: Record<string, number>;
  /** Physical appearance description. */
  appearanceDescription: string;
  /** Character background story. */
  background: string;
  /** Personality traits. */
  personalityTraits: string;
  /** Equipment list. */
  equipment: string[];
};
