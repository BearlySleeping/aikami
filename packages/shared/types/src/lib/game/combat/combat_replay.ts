// packages/shared/types/src/lib/game/combat/combat_replay.ts
//
// Combat replay domain types — derived from `@aikami/schemas`.
// Contract: C-509 AC-1

import type {
  CombatDivergenceSchema,
  CombatReplaySchema,
  ReplayCombatResultSchema,
} from '@aikami/schemas';
import type { Static } from 'typebox';

export type CombatReplay = Static<typeof CombatReplaySchema>;
export type ReplayCombatResult = Static<typeof ReplayCombatResultSchema>;
export type CombatDivergence = Static<typeof CombatDivergenceSchema>;
