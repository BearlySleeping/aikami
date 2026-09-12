// packages/shared/schemas/src/lib/game/combat/combat_validation.ts
//
// Validation and resolution results. `resolveCombatCommand` returns the same
// discriminated shape as `CombatValidationResult` so a rejection is always
// typed — the kernel never throws and never returns partial state.
//
// Contract: C-509 AC-1, AC-2

import Type, { type Static } from 'typebox';
import { CombatCommandSchema } from './combat_command';
import { CombatEventSchema } from './combat_event';
import { CombatStateSchema } from './combat_state';

// ---------------------------------------------------------------------------
// Reason codes
// ---------------------------------------------------------------------------

export const CombatInvalidReasonSchema = Type.Union([
  Type.Literal('invalidCommandShape'),
  Type.Literal('encounterEnded'),
  Type.Literal('staleRevision'),
  Type.Literal('notActiveCombatant'),
  Type.Literal('actorUnknown'),
  Type.Literal('abilityUnknown'),
  Type.Literal('abilityNotAvailable'),
  Type.Literal('noActionAvailable'),
  Type.Literal('targetInvalid'),
  Type.Literal('targetDefeated'),
  Type.Literal('targetOutOfRange'),
  Type.Literal('movementBudgetExceeded'),
  Type.Literal('pathBlocked'),
  Type.Literal('pathInvalid'),
]);

export type CombatInvalidReason = Static<typeof CombatInvalidReasonSchema>;

/** Every reason code, in canonical order. */
export const COMBAT_INVALID_REASONS: readonly CombatInvalidReason[] = [
  'invalidCommandShape',
  'encounterEnded',
  'staleRevision',
  'notActiveCombatant',
  'actorUnknown',
  'abilityUnknown',
  'abilityNotAvailable',
  'noActionAvailable',
  'targetInvalid',
  'targetDefeated',
  'targetOutOfRange',
  'movementBudgetExceeded',
  'pathBlocked',
  'pathInvalid',
] as const;

// ---------------------------------------------------------------------------
// Validation result
// ---------------------------------------------------------------------------

export const CombatValidationSuccessSchema = Type.Object(
  {
    valid: Type.Literal(true),
    normalizedCommand: CombatCommandSchema,
  },
  { additionalProperties: false },
);

export type CombatValidationSuccess = Static<typeof CombatValidationSuccessSchema>;

export const CombatValidationFailureSchema = Type.Object(
  {
    valid: Type.Literal(false),
    reasonCode: CombatInvalidReasonSchema,
    messageKey: Type.String({ minLength: 1, description: 'i18n key; the kernel never logs' }),
  },
  { additionalProperties: false },
);

export type CombatValidationFailure = Static<typeof CombatValidationFailureSchema>;

export const CombatValidationResultSchema = Type.Union([
  CombatValidationSuccessSchema,
  CombatValidationFailureSchema,
]);

export type CombatValidationResult = Static<typeof CombatValidationResultSchema>;

// ---------------------------------------------------------------------------
// Resolve result
// ---------------------------------------------------------------------------

export const ResolveCombatSuccessSchema = Type.Object(
  {
    valid: Type.Literal(true),
    state: CombatStateSchema,
    events: Type.Array(CombatEventSchema),
  },
  { additionalProperties: false },
);

export type ResolveCombatSuccess = Static<typeof ResolveCombatSuccessSchema>;

/**
 * Same discriminated shape as {@link CombatValidationResultSchema} — on
 * `valid: false` the caller's state is untouched.
 */
export const ResolveCombatResultSchema = Type.Union([
  ResolveCombatSuccessSchema,
  CombatValidationFailureSchema,
]);

export type ResolveCombatResult = Static<typeof ResolveCombatResultSchema>;
