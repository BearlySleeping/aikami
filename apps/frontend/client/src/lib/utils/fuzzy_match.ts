// apps/frontend/client/src/lib/utils/fuzzy_match.ts
//
// Lightweight subsequence-based fuzzy matcher for client-side list filtering
// (e.g. the model picker in AI Settings) — no dependency needed for this.

/** True if every character of `query` appears in `target`, in order, case-insensitively. */
export const fuzzyMatch = (query: string, target: string): boolean => {
  if (!query) {
    return true;
  }
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      qi++;
    }
  }
  return qi === q.length;
};
