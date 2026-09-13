// packages/shared/types/src/lib/game/combat/combat_engine.ts
//
// Combat engine domain type — derived from the TypeBox schema in
// `@aikami/schemas` via `Static<>`.
//
// Contract: C-516 AC-1

import type { CombatEngineKindSchema } from '@aikami/schemas';
import type { Static } from 'typebox';

export type CombatEngineKind = Static<typeof CombatEngineKindSchema>;
