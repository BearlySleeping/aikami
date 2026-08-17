// packages/shared/utils/src/lib/rate_limit.ts
//
// In-memory per-key cooldown. Best-effort by design: a single Map, not
// coordinated across processes — fine for a single long-running host (e.g.
// the Discord Gateway bot) and still a meaningful (if per-instance) speed
// bump for a horizontally-scaled service (e.g. Cloud Run), but never a hard
// guarantee under concurrent instances. For cross-instance coordination
// (many stateless Cloud Function invocations), use a shared store (e.g.
// Firestore) instead — this utility deliberately doesn't try to be that.

const lastActionAt = new Map<string, number>();

/** True (and records the hit) if `key` hasn't acted within `cooldownMs`; false if still cooling down. */
export function tryReserve(key: string, cooldownMs: number): boolean {
  const now = Date.now();
  const last = lastActionAt.get(key);
  if (last !== undefined && now - last < cooldownMs) {
    return false;
  }
  lastActionAt.set(key, now);
  return true;
}
