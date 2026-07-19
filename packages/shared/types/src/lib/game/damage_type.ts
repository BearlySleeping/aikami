// packages/shared/types/src/lib/game/damage_type.ts
//
// Damage type and resistance types — derived from TypeBox schemas.
// Contract: C-338 Deepen Turn-Based Combat

import type {
  DamageResistanceProfileSchema,
  DamageTypeKeySchema,
  ResistancesDataSchema,
} from '@aikami/schemas';
import type { Static } from 'typebox';

export type DamageTypeKey = Static<typeof DamageTypeKeySchema>;
export type DamageResistanceProfile = Static<typeof DamageResistanceProfileSchema>;
export type ResistancesData = Static<typeof ResistancesDataSchema>;
