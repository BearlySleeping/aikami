// apps/frontend/client/src/lib/views/session/session_browser_view_model.svelte.ts
//
// ViewModel for the Session Browser — lists past sessions, allows
// read-only viewing and continuing from a specific session.
//
// Contract: C-240 Session Management

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { GameSession } from '$services/game/session_service.svelte';
import { sessionService } from '$services/game/session_service.svelte';

export type SessionBrowserViewModelInterface = BaseViewModelInterface & {
  /** All sessions for the current game, sorted by sessionNumber descending. */
  readonly sessions: GameSession[];
  /** Whether sessions are currently being loaded. */
  readonly isLoading: boolean;
  /** The currently selected session for read-only viewing. */
  readonly selectedSession: GameSession | null;
  /** Whether the read-only session view is open. */
  readonly showReadOnly: boolean;

  /** Loads sessions for the given game ID. */
  loadSessions(options: { gameId: string }): Promise<void>;
  /** Opens the read-only view for a specific session. */
  viewSession(session: GameSession): void;
  /** Closes the read-only session view. */
  closeReadOnly(): void;
  /** Continues the game from a specific session. */
  continueFromSession(session: GameSession): Promise<void>;
};

export type SessionBrowserViewModelOptions = BaseViewModelOptions & {};

class SessionBrowserViewModel
  extends BaseViewModel<SessionBrowserViewModelOptions>
  implements SessionBrowserViewModelInterface
{
  selectedSession = $state<GameSession | null>(null);
  showReadOnly = $state(false);
  isLoadingSessions = $state(false);

  get sessions(): GameSession[] {
    return sessionService.sessions;
  }

  get isLoading(): boolean {
    return this.isLoadingSessions;
  }

  /** @inheritdoc */
  async loadSessions(options: { gameId: string }): Promise<void> {
    this.isLoadingSessions = true;
    try {
      await sessionService.loadSessions({ gameId: options.gameId });
    } finally {
      this.isLoadingSessions = false;
    }
  }

  /** @inheritdoc */
  viewSession(session: GameSession): void {
    this.selectedSession = session;
    this.showReadOnly = true;
  }

  /** @inheritdoc */
  closeReadOnly(): void {
    this.selectedSession = null;
    this.showReadOnly = false;
  }

  /** @inheritdoc */
  async continueFromSession(_session: GameSession): Promise<void> {
    const { routerService } = await import('@aikami/frontend/services');
    await routerService.navigateToApp();
  }
}

export const getSessionBrowserViewModel = (
  options: SessionBrowserViewModelOptions,
): SessionBrowserViewModelInterface => SessionBrowserViewModel.create(options);
