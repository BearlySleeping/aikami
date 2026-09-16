// packages/shared/types/src/lib/game/combat/combat_participation.ts
//
// Combat-08 participation/morale domain types — derived from the TypeBox
// schemas in `@aikami/schemas` via `Static<>`.
//
// Contract: C-532 AC-2

import type {
  MoraleExitZoneSchema,
  MoraleResponseKindSchema,
  MoraleResponseRuleSchema,
  MoraleRulesSchema,
  MoraleTriggerKindSchema,
  MoraleTriggerRuleSchema,
  ParticipationStateSchema,
  ParticipationStatusSchema,
  ReactionPolicySchema,
} from '@aikami/schemas';
import type { Static } from 'typebox';

export type ParticipationStatus = Static<typeof ParticipationStatusSchema>;
export type ReactionPolicy = Static<typeof ReactionPolicySchema>;
export type ParticipationState = Static<typeof ParticipationStateSchema>;
export type MoraleTriggerKind = Static<typeof MoraleTriggerKindSchema>;
export type MoraleTriggerRule = Static<typeof MoraleTriggerRuleSchema>;
export type MoraleResponseKind = Static<typeof MoraleResponseKindSchema>;
export type MoraleResponseRule = Static<typeof MoraleResponseRuleSchema>;
export type MoraleExitZone = Static<typeof MoraleExitZoneSchema>;
export type MoraleRules = Static<typeof MoraleRulesSchema>;
