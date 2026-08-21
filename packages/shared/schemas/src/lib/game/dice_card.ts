// packages/shared/schemas/src/lib/game/dice_card.ts
//
// Dice card schema — the cross-boundary shape for a resolved roll rendered as
// a chat message and in combat. Contract: C-421.
import Type, { type Static } from 'typebox';

/** A single die result within a roll. */
export const DiceResultSchema = Type.Object({
  /** Number of sides on the die. */
  sides: Type.Number({ minimum: 1 }),
  /** The rolled face value. */
  value: Type.Number({ minimum: 1 }),
});

/** Check context attached to a roll made against a DC. */
export const DiceCheckSchema = Type.Object({
  /** Difficulty class the total was compared against. */
  dc: Type.Number(),
  /** Whether the total met or exceeded the DC. */
  success: Type.Boolean(),
  /** total - dc; negative on failure. */
  difference: Type.Number(),
  /** Optional ability/skill label, e.g. "Persuasion". */
  ability: Type.Optional(Type.String()),
});

/** A resolved roll, rendered as a chat message and in combat. */
export const DiceCardDataSchema = Type.Object({
  id: Type.String(),
  /** Raw notation as typed, e.g. "1d20+3". */
  notation: Type.String(),
  /** Individual die results, in roll order. */
  dice: Type.Array(DiceResultSchema),
  /** Flat modifier applied after the dice. */
  modifier: Type.Number(),
  /** Sum of dice + modifier. */
  total: Type.Number(),
  /** Present only when the roll was made against a DC. */
  check: Type.Optional(DiceCheckSchema),
  /** Only meaningful for a single d20. */
  isCriticalSuccess: Type.Boolean(),
  isCriticalFailure: Type.Boolean(),
  /** ISO-8601 timestamp (schemas-package convention). */
  timestamp: Type.String({ format: 'date-time' }),
});

export type DiceCardData = Static<typeof DiceCardDataSchema>;
export type DiceResult = Static<typeof DiceResultSchema>;
export type DiceCheck = Static<typeof DiceCheckSchema>;
