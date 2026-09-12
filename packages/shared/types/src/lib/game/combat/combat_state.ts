// packages/shared/types/src/lib/game/combat/combat_state.ts
//
// Combat state domain types — derived from the TypeBox schemas in
// `@aikami/schemas` via `Static<>`.
//
// Contract: C-509 AC-1

import type {
  BattlefieldStateSchema,
  CombatAbilityDefinitionSchema,
  CombatAbilityKindSchema,
  CombatActionCostSchema,
  CombatantStateSchema,
  CombatObjectiveStateSchema,
  CombatObjectiveStatusSchema,
  CombatOutcomeSchema,
  CombatPhaseSchema,
  CombatRngStateSchema,
  CombatRngStreamKeySchema,
  CombatStateSchema,
  CombatTeamSchema,
  GridPointSchema,
  InitiativeStateSchema,
  RangeBandSchema,
  SerializedRngSchema,
  TurnBudgetSchema,
} from '@aikami/schemas';
import type { Static } from 'typebox';

export type GridPoint = Static<typeof GridPointSchema>;
export type RangeBand = Static<typeof RangeBandSchema>;
export type CombatPhase = Static<typeof CombatPhaseSchema>;
export type TurnBudget = Static<typeof TurnBudgetSchema>;
export type SerializedRng = Static<typeof SerializedRngSchema>;
export type CombatRngState = Static<typeof CombatRngStateSchema>;
export type CombatRngStreamKey = Static<typeof CombatRngStreamKeySchema>;
export type CombatAbilityKind = Static<typeof CombatAbilityKindSchema>;
export type CombatActionCost = Static<typeof CombatActionCostSchema>;
export type CombatAbilityDefinition = Static<typeof CombatAbilityDefinitionSchema>;
export type CombatTeam = Static<typeof CombatTeamSchema>;
export type CombatantState = Static<typeof CombatantStateSchema>;
export type InitiativeState = Static<typeof InitiativeStateSchema>;
export type BattlefieldState = Static<typeof BattlefieldStateSchema>;
export type CombatObjectiveStatus = Static<typeof CombatObjectiveStatusSchema>;
export type CombatObjectiveState = Static<typeof CombatObjectiveStateSchema>;
export type CombatOutcome = Static<typeof CombatOutcomeSchema>;
export type CombatState = Static<typeof CombatStateSchema>;
