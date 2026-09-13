// packages/shared/schemas/src/lib/game/combat/combat_engine.ts
//
// Combat engine selection schema.
//
// The engine is chosen ONCE at encounter start (§22.2 "choose composition
// once") from `PUBLIC_COMBAT_ENGINE`; a live encounter never re-reads the flag.
// The schema exists so the config validator, the bridge command and the worker
// all agree on the same two literals instead of redeclaring them.
//
// Contract: C-516 AC-1

import type { Static } from 'typebox';
import Type from 'typebox';

/** Which combat resolver owns an encounter for its whole lifetime. */
export const CombatEngineKindSchema = Type.Union([Type.Literal('legacy'), Type.Literal('v2')]);

export type CombatEngineKind = Static<typeof CombatEngineKindSchema>;
