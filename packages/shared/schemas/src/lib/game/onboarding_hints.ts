// packages/shared/schemas/src/lib/game/onboarding_hints.ts
//
// TypeBox schemas for content pack onboarding / tutorial hint data.
// Contract: C-327 AC-3, AC-4; C-422 AC-1 (widened action shape)

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

export type InputActionId = (typeof INPUT_ACTION_ID_VALUES)[number];

// ---------------------------------------------------------------------------
// Trigger values
// ---------------------------------------------------------------------------

const TRIGGER_VALUES = ['map_loaded', 'near_interactable', 'after_previous'] as const;

// ---------------------------------------------------------------------------
// Discriminated action shape (C-422 AC-1)
// ---------------------------------------------------------------------------

/** Input action hint — teaches a keybinding. "{key}" is substituted. */
export const InputActionSchema = Type.Object({
  kind: Type.Literal('input'),
  actionId: Type.Union(
    INPUT_ACTION_ID_VALUES.map((v) => Type.Literal(v)),
    { description: 'Input action id the hint teaches' },
  ),
});

export type InputAction = Static<typeof InputActionSchema>;

/** Gameplay event hint — completes when the event fires. */
export const EventActionSchema = Type.Object({
  kind: Type.Literal('event'),
  eventId: Type.String({ minLength: 1, description: 'Event id the hint listens for' }),
});

export type EventAction = Static<typeof EventActionSchema>;

/** Discriminated action union. */
export const OnboardingStepActionSchema = Type.Union(
  [InputActionSchema, EventActionSchema],
  { discriminator: 'kind', description: 'Step action — input keybinding or gameplay event' },
);

export type OnboardingStepAction = Static<typeof OnboardingStepActionSchema>;

// ---------------------------------------------------------------------------
// Legacy normalisation (C-422 AC-1)
// ---------------------------------------------------------------------------

/**
 * Normalises a legacy bare-string action to the discriminated shape.
 * Accepts both forms: bare string (legacy) and { kind, actionId | eventId }.
 */
export function normaliseLegacyStep(step: Record<string, unknown>): Record<string, unknown> {
  if (typeof step.action === 'string') {
    return { ...step, action: { kind: 'input', actionId: step.action } };
  }
  return step;
}

// ---------------------------------------------------------------------------
// OnboardingHintStep
// ---------------------------------------------------------------------------

export const OnboardingHintStepSchema = Type.Object({
  /** Stable id, unique within the pack (e.g. "hint_move"). */
  id: Type.String({ minLength: 1, description: 'Stable hint identifier' }),
  /** The action being taught; the hint auto-dismisses when performed. */
  action: OnboardingStepActionSchema,
  /** Display text template; "{key}" replaced with current binding label for input steps. */
  text: Type.String({ minLength: 1, description: 'Hint display text' }),
  /** When the hint becomes eligible. */
  trigger: Type.Union(
    TRIGGER_VALUES.map((v) => Type.Literal(v)),
    { description: 'When the hint becomes eligible to show' },
  ),
  /** Step needs a configured model; skippable when none. */
  requiresModel: Type.Optional(Type.Boolean({ description: 'Step requires a configured AI model' })),
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
