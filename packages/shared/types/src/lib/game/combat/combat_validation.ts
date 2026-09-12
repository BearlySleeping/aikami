// packages/shared/types/src/lib/game/combat/combat_validation.ts
//
// Combat validation/resolution result types — derived from `@aikami/schemas`.
// Contract: C-509 AC-1

import type {
  CombatInvalidReasonSchema,
  CombatValidationFailureSchema,
  CombatValidationResultSchema,
  CombatValidationSuccessSchema,
  ResolveCombatResultSchema,
  ResolveCombatSuccessSchema,
} from '@aikami/schemas';
import type { Static } from 'typebox';

export type CombatInvalidReason = Static<typeof CombatInvalidReasonSchema>;
export type CombatValidationSuccess = Static<typeof CombatValidationSuccessSchema>;
export type CombatValidationFailure = Static<typeof CombatValidationFailureSchema>;
export type CombatValidationResult = Static<typeof CombatValidationResultSchema>;
export type ResolveCombatSuccess = Static<typeof ResolveCombatSuccessSchema>;
export type ResolveCombatResult = Static<typeof ResolveCombatResultSchema>;
