// packages/shared/constants/src/lib/game/combat_engine.ts
//
// Combat engine selection constants.
//
// The production default is `legacy`: the v2 engine is opt-in through
// `PUBLIC_COMBAT_ENGINE` so an invalid, missing or half-configured value can
// never switch a live build onto the newer resolver by accident.
//
// Contract: C-516 AC-1

import type { CombatEngineKind } from '@aikami/types';

/** Engine used when `PUBLIC_COMBAT_ENGINE` is absent or unrecognised. */
export const DEFAULT_COMBAT_ENGINE: CombatEngineKind = 'legacy';

/**
 * Resolves the configured engine value to a known kind.
 *
 * Unset, empty and invalid values all resolve to {@link DEFAULT_COMBAT_ENGINE};
 * only the exact literal `'v2'` opts in. Kept total (never throws) so a bad
 * deploy cannot break config validation.
 */
export const resolveCombatEngineKind = (raw?: string | null): CombatEngineKind =>
  raw === 'v2' ? 'v2' : DEFAULT_COMBAT_ENGINE;

/** Whether `value` is one of the two supported engine literals. */
export const isCombatEngineKind = (value: unknown): value is CombatEngineKind =>
  value === 'legacy' || value === 'v2';
