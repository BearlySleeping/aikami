// packages/shared/types/src/lib/game/status_effect.ts
//
// Status effect types — derived from TypeBox schemas.
// Contract: C-338 Deepen Turn-Based Combat

import type {
  ActiveStatusEffectSchema,
  StatusEffectDefinitionSchema,
  StatusEffectModifierSchema,
  StatusEffectTagSchema,
} from '@aikami/schemas';
import type { Static } from 'typebox';

export type StatusEffectModifier = Static<typeof StatusEffectModifierSchema>;
export type StatusEffectTag = Static<typeof StatusEffectTagSchema>;
export type StatusEffectDefinition = Static<typeof StatusEffectDefinitionSchema>;
export type ActiveStatusEffect = Static<typeof ActiveStatusEffectSchema>;
