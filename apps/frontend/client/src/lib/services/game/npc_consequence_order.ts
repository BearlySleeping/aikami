// apps/frontend/client/src/lib/services/game/npc_consequence_order.ts
//
// The canonical order of a consequence batch, and why it is this order.
//
// Extracted from the dialogue orchestrator, which had no use for it beyond
// calling it once, and which is 2 900 lines of turn orchestration. The rule is
// pure, total and independently worth stating: a batch of proposed state
// deltas has to reach the world in a DETERMINISTIC order, or two identical
// requests would apply the same changes in different sequences and the campaign
// would diverge from itself.
//
// The order is fixed rather than derived from the model's output, because the
// model does not know the order. It is also stable under reordering of the
// input, which is the property that makes "failure recovery" safe: a retried
// batch must be idempotent, and the only way to get that is for the order to
// be a function of the contents rather than of the arrival sequence.
//
// Contract: C-489 (consequence authority, failure recovery)

import type { NpcStateDelta } from '@aikami/types';

/** Delta kinds, in the order the world applies them. */
const CONSEQUENCE_KIND_ORDER = [
  'flag_clear',
  'flag_set',
  'inventory_remove',
  'inventory_grant',
  'relationship_update',
  'trust_change',
] as const satisfies readonly NpcStateDelta['kind'][];

/**
 * Canonical sort for a consequence batch: by kind in the fixed order, then
 * target (code-point), label (missing first, then code-point), then numeric
 * value (missing first, then ascending). Exact duplicates are equivalent —
 * their occurrence number is assigned after this sort.
 */
/**
 * Sorts a nullable field with "missing first", then ascending.
 *
 * The shared rule rather than eight separate comparisons: a delta that names no
 * target sorts before one that does, and within each group the values compare
 * in code-point order so the result does not depend on the model's ordering.
 */
const ascendingNullable = (a: string | undefined, b: string | undefined): number => {
  const aMissing = a === undefined || a === null;
  const bMissing = b === undefined || b === null;
  if (aMissing !== bMissing) {
    return aMissing ? -1 : 1;
  }
  if (aMissing) {
    return 0;
  }
  return (a ?? '') < (b ?? '') ? -1 : 1;
};

/** The same rule for a numeric field, where an absent value is not a number. */
const ascendingNullableNumber = (a: number | undefined, b: number | undefined): number => {
  const aMissing = !Number.isFinite(a);
  const bMissing = !Number.isFinite(b);
  if (aMissing !== bMissing) {
    return aMissing ? -1 : 1;
  }
  if (aMissing) {
    return 0;
  }
  return (a ?? 0) < (b ?? 0) ? -1 : 1;
};

/** Lexicographic comparison of a non-nullable pair, by code point. */
const ascending = (a: string, b: string): number => (a < b ? -1 : 1);

/**
 * Canonical sort for a consequence batch: by kind in the fixed order, then
 * target, label and numeric value, each with missing values first and equal
 * values equivalent. Exact duplicates are equivalent — their occurrence number
 * is assigned after this sort.
 *
 * Composed from three named comparators rather than a ladder of branches,
 * because the ladder was twenty-three points of cognitive complexity doing
 * exactly what three small functions do, and the branching was what made the
 * rule hard to check by eye.
 */
export const compareConsequenceDeltas = (a: NpcStateDelta, b: NpcStateDelta): number => {
  const byKind = CONSEQUENCE_KIND_ORDER.indexOf(a.kind) - CONSEQUENCE_KIND_ORDER.indexOf(b.kind);
  if (byKind !== 0) {
    return byKind;
  }
  if (a.target !== b.target) {
    return ascending(a.target, b.target);
  }
  const byLabel = ascendingNullable(a.label, b.label);
  return byLabel !== 0 ? byLabel : ascendingNullableNumber(a.value, b.value);
};
