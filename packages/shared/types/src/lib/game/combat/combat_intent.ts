// packages/shared/types/src/lib/game/combat/combat_intent.ts
//
// Natural-language combat intent domain types — derived from the TypeBox
// schemas in `@aikami/schemas` via `Static<>`.
//
// Contract: C-525 AC-1

import type {
  AbilitySelectorSchema,
  ActionIntentSchema,
  ClarificationOptionSchema,
  ClarificationRequestSchema,
  CombatIntentDraftSchema,
  CompiledPlanSchema,
  EntitySelectorSchema,
  IntentInterpreterFailureReasonSchema,
  IntentInterpreterResultSchema,
  IntentSourceSchema,
  IntentStepSchema,
  LocationSelectorSchema,
  RelativeDirectionSchema,
  TrustedAbilityInputSchema,
  TrustedCellInputSchema,
} from '@aikami/schemas';
import type { Static } from 'typebox';

export type EntitySelector = Static<typeof EntitySelectorSchema>;
export type RelativeDirection = Static<typeof RelativeDirectionSchema>;
export type LocationSelector = Static<typeof LocationSelectorSchema>;
export type AbilitySelector = Static<typeof AbilitySelectorSchema>;
export type CombatIntentDraft = Static<typeof CombatIntentDraftSchema>;
export type IntentStep = Static<typeof IntentStepSchema>;
export type IntentSource = Static<typeof IntentSourceSchema>;
export type ActionIntent = Static<typeof ActionIntentSchema>;
export type TrustedCellInput = Static<typeof TrustedCellInputSchema>;
export type TrustedAbilityInput = Static<typeof TrustedAbilityInputSchema>;
export type CompiledPlan = Static<typeof CompiledPlanSchema>;
export type ClarificationOption = Static<typeof ClarificationOptionSchema>;
export type ClarificationRequest = Static<typeof ClarificationRequestSchema>;
export type IntentInterpreterFailureReason = Static<typeof IntentInterpreterFailureReasonSchema>;
export type IntentInterpreterResult = Static<typeof IntentInterpreterResultSchema>;
