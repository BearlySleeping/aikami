// packages/shared/utils/src/lib/rules/combat_canonical_json.ts
//
// Sorted-key JSON — the canonical byte-equivalence form used by replay
// comparison and by tests that assert structural equality of combat state.
//
// A LEAF module: it exists so the replay helpers can compare canonical forms
// without importing the kernel back (which would close a cycle, since the
// kernel re-exports this for its existing callers).
//
// Contract: C-531 AC-7

/**
 * Sorted-key JSON. `JSON.stringify` preserves insertion order, which is not
 * stable across runs; canonicalizing makes two structurally equal values
 * byte-identical.
 */
export const canonicalCombatJson = (value: unknown): string => JSON.stringify(canonicalize(value));

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalize(entry));
  }
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
};
