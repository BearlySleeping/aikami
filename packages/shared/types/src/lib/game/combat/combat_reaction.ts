// packages/shared/types/src/lib/game/combat/combat_reaction.ts
//
// Combat-08 reaction domain types — derived from the TypeBox schemas in
// `@aikami/schemas` via `Static<>`.
//
// Contract: C-532 AC-3

import type {
  ReactionChoiceSchema,
  ReactionChoiceSourceSchema,
  ReactionRegistrySchema,
  ReactionSelectionRequestSchema,
  ReactionStateSchema,
  ReactionTriggerKindSchema,
  ReactionWindowSchema,
  ReactionWindowStatusSchema,
  RegisteredReactionDefinitionSchema,
  SerializableCommandContinuationSchema,
} from '@aikami/schemas';
import type { Static } from 'typebox';

export type ReactionTriggerKind = Static<typeof ReactionTriggerKindSchema>;
export type RegisteredReactionDefinition = Static<typeof RegisteredReactionDefinitionSchema>;
export type ReactionRegistry = Static<typeof ReactionRegistrySchema>;
export type SerializableCommandContinuation = Static<typeof SerializableCommandContinuationSchema>;
export type ReactionWindowStatus = Static<typeof ReactionWindowStatusSchema>;
export type ReactionWindow = Static<typeof ReactionWindowSchema>;
export type ReactionState = Static<typeof ReactionStateSchema>;
export type ReactionChoice = Static<typeof ReactionChoiceSchema>;
export type ReactionSelectionRequest = Static<typeof ReactionSelectionRequestSchema>;
export type ReactionChoiceSource = Static<typeof ReactionChoiceSourceSchema>;
