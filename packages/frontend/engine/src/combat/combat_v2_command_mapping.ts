// packages/frontend/engine/src/combat/combat_v2_command_mapping.ts
//
// Bridge-command -> kernel-command mapping helpers (review F3/F-B).
//
// Extracted from `combat_v2_resolver.ts` so the resolver stays the admission +
// resolution pipeline. Behaviour is unchanged: the client addresses a target by
// authored combatant id or by runtime eid (the registry decides the latter), and
// a confirmed movement path is compared cell-by-cell in order.
//
// Contract: C-516 AC-8, C-525 AC-4

import type { CombatState, GridPoint } from '@aikami/types';

/**
 * Whether two movement paths describe the same traversal.
 *
 * Compared cell-by-cell in order: a different route to the same destination is
 * a different command, because it can pass through a different reaction
 * trigger cell, spend different movement and expose the mover differently.
 */
export const pathsAreEquivalent = (a: readonly GridPoint[], b: readonly GridPoint[]): boolean => {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((cell, index) => cell.x === b[index]?.x && cell.y === b[index]?.y);
};

/**
 * Resolves a bridge target selection to a combatant id.
 *
 * The client addresses targets by combatant id (`String(targetId)` — an
 * authored id, never a raw eid); a numeric target that is not an authored id
 * falls back to the raw-eid convention older code used.
 */
export const resolveTargetIds = (options: {
  state: CombatState;
  targetId?: number | string;
  targetIds?: Array<number | string>;
  toCombatantId?: (entityId: number) => string | undefined;
}): string[] => {
  const { state, toCombatantId } = options;
  // A complete target set takes precedence over the legacy single target; the
  // kernel dedupes and sorts during normalization.
  const requested = options.targetIds ?? (options.targetId === undefined ? [] : [options.targetId]);
  return requested.map((targetId) =>
    resolveOneTargetId({
      state,
      targetId,
      ...(toCombatantId === undefined ? {} : { toCombatantId }),
    }),
  );
};

const resolveOneTargetId = (options: {
  state: CombatState;
  targetId: number | string;
  toCombatantId?: (entityId: number) => string | undefined;
}): string => {
  const { state, targetId } = options;
  // The client may address a target by authored combatant id (v2 rosters are
  // keyed by authored id, which is not always numeric) or by runtime eid; the
  // registry decides the latter.
  const asAuthoredId = String(targetId);
  if (state.combatants[asAuthoredId] !== undefined) {
    return asAuthoredId;
  }
  if (typeof targetId === 'number') {
    const mapped = options.toCombatantId?.(targetId);
    if (mapped !== undefined && state.combatants[mapped] !== undefined) {
      return mapped;
    }
  }
  return asAuthoredId;
};
