// apps/frontend/client/src/lib/services/game/session_playtime.ts
import type { GameSession } from '$types';

/**
 * Returns the elapsed session time in whole minutes for session recap metadata.
 * Invalid or missing timestamps intentionally resolve to zero so a damaged save
 * cannot produce an invalid summary duration.
 */
export const getSessionPlaytimeMinutes = (
  session: GameSession | null,
  nowMs: number = Date.now(),
): number => {
  if (!session?.startedAt) {
    return 0;
  }
  const startedAtMs = Date.parse(session.startedAt);
  if (!Number.isFinite(startedAtMs)) {
    return 0;
  }
  return Math.max(0, Math.floor((nowMs - startedAtMs) / 60_000));
};
