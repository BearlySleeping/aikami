// packages/shared/types/src/lib/game/combat/combat_settlement.ts
//
// Combat-08 settlement domain types — derived from the TypeBox schemas in
// `@aikami/schemas` via `Static<>`.
//
// Contract: C-532 AC-5

import type {
  EncounterSettlementSchema,
  SettlementReasonCodeSchema,
  SettlementResultSchema,
} from '@aikami/schemas';
import type { Static } from 'typebox';

export type SettlementReasonCode = Static<typeof SettlementReasonCodeSchema>;
export type SettlementResult = Static<typeof SettlementResultSchema>;
export type EncounterSettlement = Static<typeof EncounterSettlementSchema>;
