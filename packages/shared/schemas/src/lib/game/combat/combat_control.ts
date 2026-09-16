// packages/shared/schemas/src/lib/game/combat/combat_control.ts
//
// Shared combat ownership vocabulary. Kept as a leaf so both combat state and
// AI decision contracts can consume it without closing a module cycle.

import Type, { type Static } from 'typebox';

/** Persisted player preference deciding who owns a companion's combat turn. */
export const CompanionControlModeSchema = Type.Union([
  Type.Literal('direct'),
  Type.Literal('suggest'),
  Type.Literal('intent'),
  Type.Literal('autonomous'),
]);

export type CompanionControlMode = Static<typeof CompanionControlModeSchema>;

/** Default companion control mode for new and legacy party entries. */
export const DEFAULT_COMPANION_CONTROL_MODE: CompanionControlMode = 'suggest';
