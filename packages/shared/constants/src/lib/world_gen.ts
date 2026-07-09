// packages/shared/constants/src/lib/world_gen.ts
//
// World Generation Wizard display constants. Consumed by the WorldGen Wizard ViewModel.

import type { WizardStep } from '@aikami/types';

/** Human-readable labels for each wizard step. */
export const STEP_LABELS: Record<WizardStep, string> = {
  genre_tone: 'Genre & Tone',
  setting_difficulty: 'Setting & Difficulty',
  goals: 'Goals',
  generating: 'Generating...',
  preview: 'Preview',
  character_creation: 'Character Creation',
} as const;
