// packages/shared/types/src/lib/game/class_definition.ts
//
// TypeScript types derived from ClassDefinition TypeBox schemas.
// Schema-first: all types here derive from @aikami/schemas via Static<>.
//
// Contract: C-337 Complete Character Progression, Classes, Abilities, Skills, and Spells

import type {
  AbilityActivationSchema,
  AbilityRegistrySchema,
  ClassDefinitionSchema,
  ClassFeatureSchema,
  ClassRegistrySchema,
  SubclassDefinitionSchema,
  XpThresholdsSchema,
} from '@aikami/schemas';
import type { Static } from 'typebox';

export type AbilityActivation = Static<typeof AbilityActivationSchema>;
export type ClassFeature = Static<typeof ClassFeatureSchema>;
export type SubclassDefinition = Static<typeof SubclassDefinitionSchema>;
export type ClassDefinition = Static<typeof ClassDefinitionSchema>;
export type ClassRegistry = Static<typeof ClassRegistrySchema>;
export type AbilityRegistry = Static<typeof AbilityRegistrySchema>;
export type XpThresholds = Static<typeof XpThresholdsSchema>;
