// apps/frontend/client/src/lib/services/game/session_service.test.ts
//
// Unit tests for SessionService — session lifecycle, chat locking,
// auto-summarization, and IndexedDB persistence.
//
// Contract: C-240 Session Management

import { beforeEach, describe, expect, test } from 'bun:test';

describe('SessionService', () => {
  let service: import('./session_service.svelte').SessionServiceInterface;

  beforeEach(async () => {
    const mod = await import('./session_service.svelte');
    service = mod.sessionService;
    await service.reset();
  });

  test('should export a singleton instance', () => {
    expect(service).toBeDefined();
    expect(typeof service.startSession).toBe('function');
    expect(typeof service.endSession).toBe('function');
    expect(typeof service.startNewSession).toBe('function');
  });

  test('should start with no active session', () => {
    expect(service.activeSession).toBeNull();
    expect(service.chatLocked).toBe(false);
  });

  test('should start a session and assign session number', async () => {
    await service.startSession({ gameId: 'test-game' });

    expect(service.activeSession).not.toBeNull();
    expect(service.activeSession?.gameId).toBe('test-game');
    expect(service.activeSession?.sessionNumber).toBe(1);
    expect(service.activeSession?.isActive).toBe(true);
    expect(service.chatLocked).toBe(false);
  });

  test('should increment session number for subsequent sessions', async () => {
    // Session 1: start and end
    await service.startSession({ gameId: 'test-game' });
    const session1Number = service.activeSession?.sessionNumber;
    expect(session1Number).toBe(1);

    await service.endSession({ playtimeMinutes: 0 });

    // Session 2
    await service.startSession({ gameId: 'test-game' });
    const session2Number = service.activeSession?.sessionNumber;
    expect(session2Number).toBe(2);
  });

  test('should lock chat when session ends', async () => {
    await service.startSession({ gameId: 'test-game' });
    expect(service.chatLocked).toBe(false);

    await service.endSession({ playtimeMinutes: 0 });
    expect(service.chatLocked).toBe(true);
    expect(service.activeSession?.isActive).toBe(false);
  });

  test('should not generate summary for sessions with < 10 messages', async () => {
    await service.startSession({ gameId: 'test-game' });
    await service.endSession({ playtimeMinutes: 5 });

    expect(service.latestSummary).toBeNull();
    expect(service.chatLocked).toBe(true);
  });

  test('should unlock chat when new session starts', async () => {
    await service.startSession({ gameId: 'test-game' });
    await service.endSession({ playtimeMinutes: 0 });
    expect(service.chatLocked).toBe(true);

    await service.startNewSession({ gameId: 'test-game' });
    expect(service.chatLocked).toBe(false);
  });

  test('should clear state on reset', async () => {
    await service.startSession({ gameId: 'test-game' });
    await service.endSession({ playtimeMinutes: 0 });

    await service.reset();

    expect(service.activeSession).toBeNull();
    expect(service.chatLocked).toBe(false);
    expect(service.latestSummary).toBeNull();
    expect(service.sessions).toEqual([]);
  });

  test('should load sessions for a specific game', async () => {
    await service.startSession({ gameId: 'game-a' });
    await service.endSession({ playtimeMinutes: 0 });
    await service.startSession({ gameId: 'game-a' });
    await service.endSession({ playtimeMinutes: 0 });

    await service.loadSessions({ gameId: 'game-a' });

    expect(service.sessions.length).toBe(2);
    expect(service.sessions[0].sessionNumber).toBe(2);
    expect(service.sessions[1].sessionNumber).toBe(1);
  });

  test('should auto-show summary toast at threshold', async () => {
    // Default: toast not shown
    expect(service.showAutoSummaryToast).toBe(false);

    // After calling check, still false with low message count
    service.checkAutoSummaryThreshold();
    expect(service.showAutoSummaryToast).toBe(false);
  });

  test('should dismiss auto-summary toast', async () => {
    await service.startSession({ gameId: 'test-game' });
    service.dismissAutoSummaryToast();
    expect(service.showAutoSummaryToast).toBe(false);
  });

  test('should save session with correct metadata', async () => {
    await service.startSession({ gameId: 'test-game' });
    const startedAt = service.activeSession?.startedAt;
    expect(startedAt).toBeDefined();

    await service.endSession({ playtimeMinutes: 30 });
    expect(service.activeSession?.endedAt).toBeDefined();
    expect(service.activeSession?.messageCount).toBe(0);
    expect(service.activeSession?.durationMinutes).toBe(30);
  });
});
