// packages/shared/schemas/src/lib/game/onboarding_hints.ts
//
// TypeBox schemas for content pack onboarding / tutorial hint data.
// Contract: C-327 AC-3, AC-4

import Type, { type Static } from 'typebox';

// ---------------------------------------------------------------------------
// Input action id validation (subset of KeybindingConfig's InputActionId)
// ---------------------------------------------------------------------------

const INPUT_ACTION_ID_VALUES = [
  'move_up',
  'move_down',
  'move_left',
  'move_right',
  'interact',
  'open_inventory',
  'open_quest_log',
  'open_character',
  'open_menu',
] as const;

// ---------------------------------------------------------------------------
// Trigger values
// ---------------------------------------------------------------------------

const TRIGGER_VALUES = ['map_loaded', 'near_interactable', 'after_previous'] as const;

// ---------------------------------------------------------------------------
// OnboardingHintStep
// ---------------------------------------------------------------------------

export const OnboardingHintStepSchema = Type.Object({
  /** Stable id, unique within the pack (e.g. "hint_move"). */
  id: Type.String({ minLength: 1, description: 'Stable hint identifier' }),
  /** The action being taught; the hint auto-dismisses when performed. */
  action: Type.Union(
    INPUT_ACTION_ID_VALUES.map((v) => Type.Literal(v)),
    { description: 'Input action id the hint teaches' },
  ),
  /** Display text template; "{key}" replaced with current binding label. */
  text: Type.String({ minLength: 1, description: 'Hint display text with {key} placeholder' }),
  /** When the hint becomes eligible. */
  trigger: Type.Union(
    TRIGGER_VALUES.map((v) => Type.Literal(v)),
    { description: 'When the hint becomes eligible to show' },
  ),
});

export type OnboardingHintStep = Static<typeof OnboardingHintStepSchema>;

// ---------------------------------------------------------------------------
// OnboardingSection
// ---------------------------------------------------------------------------

export const OnboardingSectionSchema = Type.Object({
  /** Ordered list of hint steps (first → last). Duplicate ids are rejected. */
  steps: Type.Array(OnboardingHintStepSchema, {
    minItems: 1,
    description: 'Ordered hint steps (first → last)',
    uniqueItems: true,
  }),
});

export type OnboardingSection = Static<typeof OnboardingSectionSchema>;
