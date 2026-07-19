// packages/shared/schemas/src/lib/game/status_effect.ts
//
// Status effect schemas — TypeBox validation for status effect definitions
// and active status effect instances in combat.
// Contract: C-338 Deepen Turn-Based Combat

import Type, { type Static } from 'typebox';
import { DamageTypeKeySchema } from './damage_type.ts';

// ---------------------------------------------------------------------------
// StatusEffectModifier — mechanical modifiers a status applies
// ---------------------------------------------------------------------------

export const StatusEffectModifierSchema = Type.Object(
  {
    attackModifier: Type.Optional(
      Type.Number({ description: 'Flat bonus/penalty to attack rolls' }),
    ),
    defenseModifier: Type.Optional(Type.Number({ description: 'Flat bonus/penalty to defense' })),
    accuracyModifier: Type.Optional(
      Type.Number({ description: 'Flat bonus/penalty to accuracy (hit chance)' }),
    ),
    evasionModifier: Type.Optional(Type.Number({ description: 'Flat bonus/penalty to evasion' })),
    damagePerTick: Type.Optional(
      Type.Number({ description: 'Damage per turn tick (e.g. poison deals 2 damage per turn)' }),
    ),
    tickDamageType: Type.Optional(DamageTypeKeySchema),
    healPerTick: Type.Optional(
      Type.Number({ description: 'Healing per turn tick (e.g. regeneration)' }),
    ),
    damageDealtMultiplier: Type.Optional(
      Type.Number({
        description: 'Multiplier on damage dealt (e.g. 0.5 = half damage while weakened)',
      }),
    ),
    skipTurn: Type.Optional(
      Type.Boolean({ description: 'Whether the entity skips its turn entirely (stun/paralysis)' }),
    ),
    blocksReactions: Type.Optional(
      Type.Boolean({ description: 'Whether the entity cannot take reactions' }),
    ),
  },
  { additionalProperties: false },
);

export type StatusEffectModifier = Static<typeof StatusEffectModifierSchema>;

// ---------------------------------------------------------------------------
// StatusEffectTag — classification for UI rendering
// ---------------------------------------------------------------------------

export const StatusEffectTagSchema = Type.Union([
  Type.Literal('harmful'),
  Type.Literal('beneficial'),
  Type.Literal('neutral'),
]);

export type StatusEffectTag = Static<typeof StatusEffectTagSchema>;

// ---------------------------------------------------------------------------
// StatusEffectDefinition — a status effect in the registry
// ---------------------------------------------------------------------------

export const StatusEffectDefinitionSchema = Type.Object(
  {
    id: Type.String({
      minLength: 1,
      description: 'Unique effect ID — "poisoned", "stunned", "blessed"',
    }),
    name: Type.String({ minLength: 1, description: 'Display name' }),
    description: Type.String({ description: 'Player-facing description' }),
    defaultDuration: Type.Number({
      minimum: 0,
      description: 'How long this effect lasts (in turns). 0 = permanent until removed.',
    }),
    modifier: StatusEffectModifierSchema,
    tag: StatusEffectTagSchema,
  },
  { additionalProperties: false },
);

export type StatusEffectDefinition = Static<typeof StatusEffectDefinitionSchema>;

// ---------------------------------------------------------------------------
// ActiveStatusEffect — an active instance on an entity
// ---------------------------------------------------------------------------

export const ActiveStatusEffectSchema = Type.Object(
  {
    effectId: Type.String({ minLength: 1, description: 'The effect definition ID' }),
    sourceEntityId: Type.Number({
      minimum: 0,
      description: 'Entity that applied this effect (0 = environmental/unknown)',
    }),
    remainingDuration: Type.Number({
      minimum: 0,
      description: 'Turns remaining (decremented each start-of-turn tick)',
    }),
    appliedOnTurn: Type.Number({
      minimum: 0,
      description: 'The turn number when this was applied',
    }),
  },
  { additionalProperties: false },
);

export type ActiveStatusEffect = Static<typeof ActiveStatusEffectSchema>;
