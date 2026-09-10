// apps/frontend/client/src/lib/views/game/ui/overlays/end_session/testing/end_session_fixtures.ts
//
// Feature-owned test doubles for the end-session ViewModel. Operations are not
// defaulted to success: an unconfigured call throws, so a test cannot pass by
// accident on a silent no-op.

import type { GameSession, SessionSummary } from '$types';
import type {
  EndSessionOverlayCapabilities,
  EndSessionSessionCapabilities,
} from '../end_session_view_model.svelte';

const unconfigured = (operation: string): never => {
  throw new Error(`Unexpected ${operation} call; configure this fixture explicitly.`);
};

/** A complete game session, overridable per test. */
export const createGameSession = (overrides: Partial<GameSession> = {}): GameSession => ({
  id: 'session-1',
  gameId: 'game-1',
  sessionNumber: 1,
  startedAt: '2026-09-04T00:00:00.000Z',
  isActive: true,
  messageCount: 0,
  characterSnapshots: {},
  recapReviewed: false,
  checkpointIds: [],
  ...overrides,
});

/** A complete session summary, overridable per test. */
export const createSessionSummary = (overrides: Partial<SessionSummary> = {}): SessionSummary => ({
  id: 'summary-1',
  createdAt: 0,
  playtimeMinutes: 0,
  synopsis: '',
  keyEvents: [],
  npcInteractions: [],
  resumePoint: '',
  ...overrides,
});

/** Overlay capability where every operation must be configured explicitly. */
export const createEndSessionOverlay = (
  overrides: Partial<EndSessionOverlayCapabilities> = {},
): EndSessionOverlayCapabilities => ({
  endSession: () => unconfigured('endSession'),
  closeEndSession: () => unconfigured('closeEndSession'),
  startNewSession: () => unconfigured('startNewSession'),
  ...overrides,
});

/** Session capability with no active session/summary until overridden. */
export const createEndSessionSession = (
  overrides: Partial<EndSessionSessionCapabilities> = {},
): EndSessionSessionCapabilities => ({
  latestSummary: null,
  activeSession: null,
  updateSessionRecap: () => unconfigured('updateSessionRecap'),
  ...overrides,
});
