// packages/shared/types/src/lib/game/combat/combat_objective.ts
//
// Combat-08 objective domain types — derived from the TypeBox schemas in
// `@aikami/schemas` via `Static<>`.
//
// Contract: C-532 AC-1

import type {
  ObjectiveDefinitionSchema,
  ObjectiveKindSchema,
  ObjectiveProgressSchema,
  ObjectiveRulesSchema,
  RegisteredObjectiveRuleSchema,
} from '@aikami/schemas';
import type { Static } from 'typebox';

export type ObjectiveKind = Static<typeof ObjectiveKindSchema>;
export type RegisteredObjectiveRule = Static<typeof RegisteredObjectiveRuleSchema>;
export type ObjectiveDefinition = Static<typeof ObjectiveDefinitionSchema>;
export type ObjectiveRules = Static<typeof ObjectiveRulesSchema>;
export type ObjectiveProgress = Static<typeof ObjectiveProgressSchema>;
