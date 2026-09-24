// apps/frontend/client/src/lib/services/game/session_playtime.test.ts
import { describe, expect, it } from 'bun:test';
import type { GameSession } from '$types';
import { getSessionPlaytimeMinutes } from './session_playtime.ts';

const session = (startedAt: string): GameSession => ({
  id: 'session-1',
  gameId: 'game-1',
  sessionNumber: 1,
  startedAt,
  isActive: true,
  messageCount: 0,
  characterSnapshots: {},
  recapReviewed: false,
  checkpointIds: [],
});

describe('getSessionPlaytimeMinutes', () => {
  it('uses elapsed session time and floors partial minutes', () => {
    const nowMs = Date.parse('2026-01-01T01:02:30.000Z');
    expect(getSessionPlaytimeMinutes(session('2026-01-01T00:00:00.000Z'), nowMs)).toBe(62);
  });

  it('returns zero for missing, invalid, or future timestamps', () => {
    expect(getSessionPlaytimeMinutes(null, 1_000)).toBe(0);
    expect(getSessionPlaytimeMinutes(session('invalid'), 1_000)).toBe(0);
    expect(getSessionPlaytimeMinutes(session('2026-01-01T00:00:00.000Z'), 1_000)).toBe(0);
  });
});
