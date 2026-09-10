// apps/frontend/client/src/lib/views/session/session_browser_view_model.svelte.ts
//
// ViewModel for the Session Browser — lists past sessions with checkpoints,
// allows read-only viewing, continuing, and forking from checkpoints.
//
// Dependencies arrive through typed capability options. This module never
// imports the `$services` barrel or any production singleton, so its tests can
// inject fresh feature fixtures (see ./testing/session_browser_fixtures.ts)
// instead of mocking the global service registry. Production wiring lives in
// ./session_browser_composition.ts.
//
// Contract: C-240 Session Management
// Contract: C-344 Complete Session Recaps, Checkpoints, and Long-Campaign Lifecycle

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services/base';
import type { GameSession, SessionCheckpoint } from '$types';

// ── Capability contracts ────────────────────────────────────────────────

/**
 * The session/checkpoint operations and observable state the browser reads.
 * `sessions` / `checkpoints` are read reactively, so an injected capability may
 * expose them as Svelte `$state`.
 */
export type SessionBrowserCapabilities = {
  readonly sessions: GameSession[];
  readonly checkpoints: SessionCheckpoint[];
  loadSessions(options: { gameId: string }): Promise<void>;
  listCheckpoints(options: { campaignId: string }): Promise<void>;
  forkFromCheckpoint(options: {
    checkpointId: string;
    gameId: string;
    campaignId: string;
  }): Promise<void>;
};

/** The navigation capability the browser uses to continue play. */
export type SessionBrowserRouterCapability = {
  navigateToApp(): Promise<void>;
};

// ── Types ───────────────────────────────────────────────────────────────

export type SessionBrowserViewModelInterface = BaseViewModelInterface & {
  /** All sessions for the current game, sorted by sessionNumber descending. */
  readonly sessions: GameSession[];
  /** Whether sessions are currently being loaded. */
  readonly isLoading: boolean;
  /** The currently selected session for read-only viewing. */
  readonly selectedSession: GameSession | null;
  /** Whether the read-only session view is open. */
  readonly showReadOnly: boolean;
  /** Checkpoints for the current campaign (C-344). */
  readonly checkpoints: SessionCheckpoint[];
  /** Whether a fork operation is in progress. */
  readonly isForking: boolean;
  /** Whether the fork confirmation dialog is open. */
  readonly showForkConfirm: boolean;
  /** The checkpoint being forked. */
  readonly forkCheckpoint: SessionCheckpoint | null;
  /** Fork error message, or null (C-344). */
  readonly forkError: string | null;

  /** Loads sessions for the given game ID. */
  loadSessions(options: { gameId: string }): Promise<void>;
  /** Loads checkpoints for the given campaign (C-344). */
  loadCheckpoints(options: { campaignId: string }): Promise<void>;
  /** Opens the read-only view for a specific session. */
  viewSession(session: GameSession): void;
  /** Closes the read-only session view. */
  closeReadOnly(): void;
  /** Continues the game from a specific session (C-344). */
  continueFromSession(session: GameSession): Promise<void>;
  /** Opens the fork confirmation dialog for a checkpoint (C-344). */
  openForkConfirm(checkpoint: SessionCheckpoint): void;
  /** Closes the fork confirmation dialog (C-344). */
  closeForkConfirm(): void;
  /** Confirms fork from a checkpoint (C-344). */
  confirmFork(): Promise<void>;
};

export type SessionBrowserViewModelOptions = BaseViewModelOptions & {
  /** Current game ID for continue/fork operations. */
  gameId?: string;
  /** Current campaign ID for checkpoint operations. */
  campaignId?: string;
  /** Session/checkpoint operations and observable state. */
  session: SessionBrowserCapabilities;
  /** Navigation capability for continuing play. */
  router: SessionBrowserRouterCapability;
};

// ── Implementation ──────────────────────────────────────────────────────

class SessionBrowserViewModel
  extends BaseViewModel<SessionBrowserViewModelOptions>
  implements SessionBrowserViewModelInterface
{
  private readonly _session: SessionBrowserCapabilities;
  private readonly _router: SessionBrowserRouterCapability;

  selectedSession = $state<GameSession | null>(null);
  showReadOnly = $state(false);
  isLoadingSessions = $state(false);
  isForking = $state(false);
  showForkConfirm = $state(false);
  forkCheckpoint = $state<SessionCheckpoint | null>(null);
  forkError = $state<string | null>(null);

  constructor(options: SessionBrowserViewModelOptions) {
    super(options);
    this._session = options.session;
    this._router = options.router;
  }

  get sessions(): GameSession[] {
    return this._session.sessions;
  }

  get checkpoints(): SessionCheckpoint[] {
    return this._session.checkpoints;
  }

  get isLoading(): boolean {
    return this.isLoadingSessions;
  }

  /** @inheritdoc */
  async loadSessions(options: { gameId: string }): Promise<void> {
    this.isLoadingSessions = true;
    try {
      await this._session.loadSessions({ gameId: options.gameId });
    } finally {
      this.isLoadingSessions = false;
    }
  }

  /** @inheritdoc */
  async loadCheckpoints(options: { campaignId: string }): Promise<void> {
    await this._session.listCheckpoints({ campaignId: options.campaignId });
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
    // Navigate to the game — the boot pipeline will load the last save state.
    await this._router.navigateToApp();
  }

  // ── C-344: Fork from checkpoint ─────────────────────────────────────

  /** @inheritdoc */
  openForkConfirm(checkpoint: SessionCheckpoint): void {
    this.forkCheckpoint = checkpoint;
    this.showForkConfirm = true;
  }

  /** @inheritdoc */
  closeForkConfirm(): void {
    this.forkCheckpoint = null;
    this.showForkConfirm = false;
  }

  /** @inheritdoc */
  async confirmFork(): Promise<void> {
    const checkpoint = this.forkCheckpoint;
    if (!checkpoint) {
      return;
    }

    const gameId = this._options.gameId;
    const campaignId = this._options.campaignId;

    if (!gameId || !campaignId) {
      this.forkError = 'Missing game or campaign ID';
      this.debug('confirmFork:missing-ids');
      return;
    }

    this.forkError = null;
    this.isForking = true;

    try {
      await this._session.forkFromCheckpoint({
        checkpointId: checkpoint.id,
        gameId,
        campaignId,
      });
      this.showForkConfirm = false;
      this.forkCheckpoint = null;
      this.forkError = null;
    } catch (error) {
      this.forkError = String(error);
      this.debug('confirmFork:failed', { error: String(error) });
    } finally {
      this.isForking = false;
    }
  }
}

/**
 * Builds a session-browser ViewModel from explicit capabilities.
 *
 * Callers outside production (tests, sandboxes) use this directly; production
 * code goes through `getSessionBrowserViewModel` in
 * ./session_browser_composition.ts.
 */
export const createSessionBrowserViewModel = (
  options: SessionBrowserViewModelOptions,
): SessionBrowserViewModelInterface => SessionBrowserViewModel.create(options);
