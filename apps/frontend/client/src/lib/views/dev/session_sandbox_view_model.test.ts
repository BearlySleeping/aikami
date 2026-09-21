// apps/frontend/client/src/lib/views/dev/session_sandbox_view_model.test.ts
//
// C-240: Session-management sandbox ViewModel tests.
//
// This suite exercises the ViewModel through feature-owned fixtures — no global
// `$services` barrel mock and no shared test inventory.
// Each test constructs exactly the capabilities it needs.

import { describe, expect, mock, test } from 'bun:test';
import { BaseViewModel } from '@aikami/frontend/services/base';
import type { GameSession } from '$types';
import {
  createSessionSandboxViewModel,
  type SessionCapabilities,
} from './session_sandbox_view_model.svelte';

const createSession = (overrides: Partial<GameSession> = {}): GameSession => ({
  id: 'session-1',
  gameId: 'sandbox-game',
  sessionNumber: 1,
  startedAt: '2026-09-04T00:00:00.000Z',
  isActive: true,
  messageCount: 0,
  characterSnapshots: {},
  recapReviewed: false,
  checkpointIds: [],
  ...overrides,
});

const createCapabilities = (overrides: Partial<SessionCapabilities> = {}): SessionCapabilities => ({
  activeSession: null,
  sessions: [],
  chatLocked: false,
  startSession: mock(async () => {}),
  endSession: mock(async () => {}),
  startNewSession: mock(async () => {}),
  loadSessions: mock(async () => {}),
  ...overrides,
});

const createViewModel = (capabilities: SessionCapabilities = createCapabilities()) =>
  createSessionSandboxViewModel({
    className: 'SessionSandboxViewModel',
    session: capabilities,
  });

describe('SessionSandboxViewModel — initial state', () => {
  test('starts with an empty sandbox', () => {
    const viewModel = createViewModel();

    expect(viewModel.sessionServiceReady).toBe(true);
    expect(viewModel.activeSession).toBeNull();
    expect(viewModel.sessions).toEqual([]);
    expect(viewModel.chatLocked).toBe(false);
    expect(viewModel.testLog).toEqual([]);
    expect(viewModel.testMessageCount).toBe(0);
  });

  test('extends the production BaseViewModel, not a shared fake', () => {
    expect(createViewModel()).toBeInstanceOf(BaseViewModel);
  });

  test('reads reflect the injected capability values', () => {
    const active = createSession();
    const viewModel = createViewModel(
      createCapabilities({ activeSession: active, sessions: [active], chatLocked: true }),
    );

    expect(viewModel.activeSession).toBe(active);
    expect(viewModel.sessions).toEqual([active]);
    expect(viewModel.chatLocked).toBe(true);
  });
});

describe('SessionSandboxViewModel — lifecycle delegation', () => {
  test('mockStartSession delegates to startSession', async () => {
    const startSession = mock(async () => {});
    const viewModel = createViewModel(createCapabilities({ startSession }));

    await viewModel.mockStartSession();

    expect(startSession).toHaveBeenCalledWith({ gameId: 'sandbox-game' });
    expect(viewModel.testLog).toContain('Starting session...');
  });

  test('mockEndSession delegates to endSession when a session is active', async () => {
    const endSession = mock(async () => {});
    const viewModel = createViewModel(
      createCapabilities({ endSession, activeSession: createSession() }),
    );

    await viewModel.mockEndSession();

    expect(endSession).toHaveBeenCalledWith({ playtimeMinutes: 15 });
  });

  test('mockEndSession skips endSession when no session is active', async () => {
    const endSession = mock(async () => {});
    const viewModel = createViewModel(createCapabilities({ endSession }));

    await viewModel.mockEndSession();

    expect(endSession).not.toHaveBeenCalled();
    expect(viewModel.testLog).toContain('No active session to end');
  });

  test('mockNewSession delegates to startNewSession', async () => {
    const startNewSession = mock(async () => {});
    const viewModel = createViewModel(createCapabilities({ startNewSession }));

    await viewModel.mockNewSession();

    expect(startNewSession).toHaveBeenCalledWith({ gameId: 'sandbox-game' });
  });

  test('mockLoadSessions delegates to loadSessions', async () => {
    const loadSessions = mock(async () => {});
    const viewModel = createViewModel(
      createCapabilities({ loadSessions, sessions: [createSession()] }),
    );

    await viewModel.mockLoadSessions();

    expect(loadSessions).toHaveBeenCalledWith({ gameId: 'sandbox-game' });
    expect(viewModel.testLog).toContain('Loaded 1 sessions');
  });
});

describe('SessionSandboxViewModel — local message counter', () => {
  test('mockAddMessages accumulates and clearLog resets', () => {
    const viewModel = createViewModel();

    viewModel.mockAddMessages({ count: 10 });
    viewModel.mockAddMessages({ count: 5 });
    expect(viewModel.testMessageCount).toBe(15);

    viewModel.clearLog();
    expect(viewModel.testLog).toEqual([]);
    expect(viewModel.testMessageCount).toBe(15);
  });
});
