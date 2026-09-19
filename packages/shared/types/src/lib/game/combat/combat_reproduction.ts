// packages/shared/types/src/lib/game/combat/combat_reproduction.ts
//
// Combat reproduction domain types — derived from `@aikami/schemas`.
// Contract: combat debug workspace (execution prompt §8)

import type {
  CombatReproductionCheckpointSchema,
  CombatReproductionControllerRecordSchema,
  CombatReproductionReplayResultSchema,
  CombatReproductionSchema,
} from '@aikami/schemas';
import type { Static } from 'typebox';

export type CombatReproduction = Static<typeof CombatReproductionSchema>;
export type CombatReproductionCheckpoint = Static<typeof CombatReproductionCheckpointSchema>;
export type CombatReproductionControllerRecord = Static<
  typeof CombatReproductionControllerRecordSchema
>;
export type CombatReproductionReplayResult = Static<typeof CombatReproductionReplayResultSchema>;
