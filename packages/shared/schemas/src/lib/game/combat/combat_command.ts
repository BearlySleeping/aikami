// packages/shared/schemas/src/lib/game/combat/combat_command.ts
//
// Bounded Combat-01 command vocabulary — explicit discriminated variants,
// never a patch object (architecture §8.4).
//
// `interact`, `disengage` and `respondToReaction` are explicitly deferred
// (interactions → Combat-07, reactions → Combat-08). The `useAbility` variant
// plus a `basic_melee` catalog entry is the "basic attack".
//
// Contract: C-509 AC-1

import Type, { type Static } from 'typebox';
import { COMBAT_ENVIRONMENT_BOUNDS } from './combat_environment';
import { GridPointSchema } from './combat_grid';

// ---------------------------------------------------------------------------
// Command variants — discriminated on `kind`
// ---------------------------------------------------------------------------

/** Moves along a contiguous, in-bounds, unblocked cell path. */
export const CombatMoveCommandSchema = Type.Object(
  {
    kind: Type.Literal('move'),
    combatantId: Type.String({ minLength: 1 }),
    path: Type.Array(GridPointSchema, {
      minItems: 1,
      description: 'Ordered contiguous cells; each step is adjacent to the previous',
    }),
  },
  { additionalProperties: false },
);

export type CombatMoveCommand = Static<typeof CombatMoveCommandSchema>;

/** Uses a catalogued ability against zero or more resolved targets. */
export const CombatUseAbilityCommandSchema = Type.Object(
  {
    kind: Type.Literal('useAbility'),
    combatantId: Type.String({ minLength: 1 }),
    abilityId: Type.String({ minLength: 1 }),
    targetIds: Type.Array(Type.String({ minLength: 1 }), {
      description: 'Resolved combatantIds; sorted+deduped during normalization',
    }),
  },
  { additionalProperties: false },
);

export type CombatUseAbilityCommand = Static<typeof CombatUseAbilityCommandSchema>;

/** Spends the action to defend. Emits no event in Combat-01. */
export const CombatDefendCommandSchema = Type.Object(
  {
    kind: Type.Literal('defend'),
    combatantId: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export type CombatDefendCommand = Static<typeof CombatDefendCommandSchema>;

/** Spends the action to hold. Emits no event in Combat-01. */
export const CombatWaitCommandSchema = Type.Object(
  {
    kind: Type.Literal('wait'),
    combatantId: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export type CombatWaitCommand = Static<typeof CombatWaitCommandSchema>;

/** Ends the actor's turn and advances the initiative index. */
export const CombatEndTurnCommandSchema = Type.Object(
  {
    kind: Type.Literal('endTurn'),
    combatantId: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export type CombatEndTurnCommand = Static<typeof CombatEndTurnCommandSchema>;

/**
 * Uses one authored affordance on one authored object (Combat-07).
 *
 * The command names stable authored ids only — never a numeric mechanic, a
 * dice value, an effect definition or a state patch. `targetObjectId` is
 * required and nullable: it names the second object an approach uses (e.g. the
 * oil pool a brazier is tipped into), or is `null` when no target exists.
 */
export const CombatInteractWithObjectCommandSchema = Type.Object(
  {
    kind: Type.Literal('interactWithObject'),
    combatantId: Type.String({ minLength: 1 }),
    objectId: Type.String({ minLength: 1, maxLength: COMBAT_ENVIRONMENT_BOUNDS.idChars }),
    affordanceId: Type.String({ minLength: 1, maxLength: COMBAT_ENVIRONMENT_BOUNDS.idChars }),
    targetObjectId: Type.Union([
      Type.String({ minLength: 1, maxLength: COMBAT_ENVIRONMENT_BOUNDS.idChars }),
      Type.Null(),
    ]),
  },
  { additionalProperties: false },
);

export type CombatInteractWithObjectCommand = Static<typeof CombatInteractWithObjectCommandSchema>;

/**
 * Discriminated union of every Combat-01 command.
 * Unknown `kind` values and extra fields fail validation.
 */
export const CombatCommandSchema = Type.Union([
  CombatMoveCommandSchema,
  CombatUseAbilityCommandSchema,
  CombatDefendCommandSchema,
  CombatWaitCommandSchema,
  CombatEndTurnCommandSchema,
  CombatInteractWithObjectCommandSchema,
]);

export type CombatCommand = Static<typeof CombatCommandSchema>;

/** The `kind` discriminator values of {@link CombatCommandSchema}. */
export type CombatCommandKind = CombatCommand['kind'];

/** Every Combat-01 command kind, in canonical order. */
export const COMBAT_COMMAND_KINDS: readonly CombatCommandKind[] = [
  'move',
  'useAbility',
  'defend',
  'wait',
  'endTurn',
  'interactWithObject',
] as const;
