// packages/shared/types/src/lib/game/combat/combat_command.ts
//
// Combat command domain types — derived from `@aikami/schemas`.
// Contract: C-509 AC-1

import type {
  CombatCommandSchema,
  CombatDefendCommandSchema,
  CombatEndTurnCommandSchema,
  CombatMoveCommandSchema,
  CombatUseAbilityCommandSchema,
  CombatWaitCommandSchema,
} from '@aikami/schemas';
import type { Static } from 'typebox';

export type CombatCommand = Static<typeof CombatCommandSchema>;
export type CombatCommandKind = CombatCommand['kind'];
export type CombatMoveCommand = Static<typeof CombatMoveCommandSchema>;
export type CombatUseAbilityCommand = Static<typeof CombatUseAbilityCommandSchema>;
export type CombatDefendCommand = Static<typeof CombatDefendCommandSchema>;
export type CombatWaitCommand = Static<typeof CombatWaitCommandSchema>;
export type CombatEndTurnCommand = Static<typeof CombatEndTurnCommandSchema>;
