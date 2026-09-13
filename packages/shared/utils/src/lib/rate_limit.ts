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

// ---------------------------------------------------------------------------
// Sliding-window limiter
// ---------------------------------------------------------------------------

/**
 * Recorded hit timestamps per key, oldest first.
 *
 * A *window* rather than a bare cooldown, because a cooldown of N seconds also
 * rejects legitimate bursts: two concurrent calls that are each valid on their
 * own (a retry, a duplicate-submit guard) would collide on a pure cooldown.
 * A window caps the rate without forbidding the burst.
 */
const hitsByKey = new Map<string, number[]>();

/**
 * Tracked-key ceiling, swept on insert.
 *
 * The map is the only retained state, so an unbounded key space (one key per
 * account, per IP, …) would otherwise grow without limit in a long-lived
 * process. A sweep drops every key whose hits have all aged out.
 */
const MAX_TRACKED_KEYS = 5_000;

/** Drops keys whose entire window has aged out. */
const sweepExpiredKeys = (cutoff: number): void => {
  for (const [key, hits] of hitsByKey) {
    if (hits.every((at) => at <= cutoff)) {
      hitsByKey.delete(key);
    }
  }
};

/**
 * True (and records the hit) while `key` has made fewer than `maxHits` calls in
 * the trailing `windowMs`; false once the window is full.
 *
 * Best-effort in the same sense as {@link tryReserve}: per-process state, which
 * on a horizontally-scaled deployment bounds each instance rather than the
 * fleet. That makes it an anti-abuse brake, not an authorisation control.
 *
 * @param key - Identity to meter (e.g. `publish:<accountId>`).
 * @param options - `maxHits` per `windowMs`.
 */
export function tryReserveWindow(
  key: string,
  options: { maxHits: number; windowMs: number },
): boolean {
  const now = Date.now();
  const cutoff = now - options.windowMs;
  const hits = (hitsByKey.get(key) ?? []).filter((at) => at > cutoff);

  if (hits.length >= options.maxHits) {
    // Retain the pruned list so a blocked caller still advances the window.
    hitsByKey.set(key, hits);
    return false;
  }

  hits.push(now);
  hitsByKey.set(key, hits);

  if (hitsByKey.size > MAX_TRACKED_KEYS) {
    sweepExpiredKeys(cutoff);
  }
  return true;
}
