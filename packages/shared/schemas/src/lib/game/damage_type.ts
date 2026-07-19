// packages/shared/schemas/src/lib/game/damage_type.ts
//
// Damage type and resistance schemas — TypeBox validation for the 12-type
// damage taxonomy and per-entity resistance profiles.
// Contract: C-338 Deepen Turn-Based Combat

import Type, { type Static } from 'typebox';

// ---------------------------------------------------------------------------
// DamageTypeKey — the 12 damage type taxonomy
// ---------------------------------------------------------------------------

export const DamageTypeKeySchema = Type.Union([
  Type.Literal('slashing'),
  Type.Literal('piercing'),
  Type.Literal('bludgeoning'),
  Type.Literal('fire'),
  Type.Literal('cold'),
  Type.Literal('lightning'),
  Type.Literal('acid'),
  Type.Literal('poison'),
  Type.Literal('necrotic'),
  Type.Literal('radiant'),
  Type.Literal('psychic'),
  Type.Literal('force'),
  Type.Literal('thunder'),
]);

export type DamageTypeKey = Static<typeof DamageTypeKeySchema>;

// ---------------------------------------------------------------------------
// ResistanceFactor — 0.0 = immune, 0.5 = resistant, 1.0 = normal, 2.0 = vulnerable
// ---------------------------------------------------------------------------

export const ResistanceFactorSchema = Type.Number({
  minimum: 0,
  maximum: 2,
  description: '0.0 = immune, 0.5 = resistant, 1.0 = normal, 2.0 = vulnerable',
});

// ---------------------------------------------------------------------------
// DamageResistanceProfile — per-damage-type resistance factor map
// ---------------------------------------------------------------------------

export const DamageResistanceProfileSchema = Type.Record(
  Type.String({ minLength: 1 }),
  ResistanceFactorSchema,
);

export type DamageResistanceProfile = Static<typeof DamageResistanceProfileSchema>;

// ---------------------------------------------------------------------------
// ResistancesData — the shape stored in the engine's Resistances SoA
// ---------------------------------------------------------------------------

export const ResistancesDataSchema = Type.Object(
  {
    profile: DamageResistanceProfileSchema,
  },
  { additionalProperties: false },
);

export type ResistancesData = Static<typeof ResistancesDataSchema>;
