// apps/frontend/client/src/lib/views/dev/session_sandbox_view_model.svelte.ts
//
// Dev sandbox ViewModel for session management testing.
// Provides mock sessions, End Session simulator, recap preview,
// and state carry-forward tester.
//
// Dependencies arrive through typed capability options. This module never
// imports the `$services` barrel or any production singleton, so its tests can
// inject fresh feature fixtures instead of mocking the global service registry.
// Production wiring lives in ./session_sandbox_composition.ts.
//
// Contract: C-240 Session Management

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services/base';
import type { GameSession } from '$types';

// ── Capability contracts ────────────────────────────────────────────────

/** The session/observable state and lifecycle operations the sandbox exercises. */
export type SessionCapabilities = {
  readonly activeSession: GameSession | null;
  readonly sessions: GameSession[];
  readonly chatLocked: boolean;
  startSession(options: { gameId: string; campaignId?: string }): Promise<void>;
  endSession(options: { playtimeMinutes?: number; campaignId?: string }): Promise<void>;
  startNewSession(options: { gameId: string; campaignId?: string }): Promise<void>;
  loadSessions(options: { gameId: string }): Promise<void>;
};

// ── Types ───────────────────────────────────────────────────────────────

/** Base configuration used to create the session-management sandbox ViewModel. */
export type SessionSandboxViewModelOptions = BaseViewModelOptions & {
  /** Session operations and observable state. */
  session: SessionCapabilities;
};

export type SessionSandboxViewModelInterface = BaseViewModelInterface & {
  readonly sessionServiceReady: boolean;
  readonly activeSession: GameSession | null;
  readonly sessions: GameSession[];
  readonly testLog: string[];
  readonly chatLocked: boolean;
  readonly testMessageCount: number;

  mockStartSession(): Promise<void>;
  mockEndSession(): Promise<void>;
  mockNewSession(): Promise<void>;
  mockLoadSessions(): Promise<void>;
  mockAddMessages(options: { count: number }): void;
  clearLog(): void;
};

// ── Implementation ──────────────────────────────────────────────────────

class SessionSandboxViewModel
  extends BaseViewModel<SessionSandboxViewModelOptions>
  implements SessionSandboxViewModelInterface
{
  private readonly _session: SessionCapabilities;

  testLog = $state<string[]>([]);
  mockMessageCount = $state(0);

  constructor(options: SessionSandboxViewModelOptions) {
    super(options);
    this._session = options.session;
  }

  get testMessageCount(): number {
    return this.mockMessageCount;
  }

  get sessionServiceReady(): boolean {
    return this._session !== undefined;
  }

  get activeSession(): GameSession | null {
    return this._session.activeSession;
  }

  get sessions(): GameSession[] {
    return this._session.sessions;
  }

  get chatLocked(): boolean {
    return this._session.chatLocked;
  }

  /** @inheritdoc */
  async mockStartSession(): Promise<void> {
    this.testLog = [...this.testLog, 'Starting session...'];
    await this._session.startSession({ gameId: 'sandbox-game' });
    this.testLog = [
      ...this.testLog,
      `Session ${this._session.activeSession?.sessionNumber} started`,
    ];
  }

  /** @inheritdoc */
  async mockEndSession(): Promise<void> {
    if (!this._session.activeSession) {
      this.testLog = [...this.testLog, 'No active session to end'];
      return;
    }
    this.testLog = [...this.testLog, 'Ending session...'];
    await this._session.endSession({ playtimeMinutes: 15 });
    this.testLog = [
      ...this.testLog,
      `Session ${this._session.activeSession?.sessionNumber} ended. Chat locked: ${this._session.chatLocked}`,
    ];
  }

  /** @inheritdoc */
  async mockNewSession(): Promise<void> {
    this.testLog = [...this.testLog, 'Starting new session...'];
    await this._session.startNewSession({ gameId: 'sandbox-game' });
    this.testLog = [
      ...this.testLog,
      `New session started. Chat locked: ${this._session.chatLocked}`,
    ];
  }

  /** @inheritdoc */
  async mockLoadSessions(): Promise<void> {
    this.testLog = [...this.testLog, 'Loading sessions...'];
    await this._session.loadSessions({ gameId: 'sandbox-game' });
    this.testLog = [...this.testLog, `Loaded ${this._session.sessions.length} sessions`];
  }

  /** @inheritdoc */
  mockAddMessages(options: { count: number }): void {
    this.mockMessageCount += options.count;
    this.testLog = [
      ...this.testLog,
      `Added ${options.count} messages (total: ${this.mockMessageCount})`,
    ];
  }

  /** @inheritdoc */
  clearLog(): void {
    this.testLog = [];
  }
}

/**
 * Builds a session-sandbox ViewModel from explicit capabilities.
 *
 * Callers outside production (tests, sandboxes) use this directly; production
 * code goes through `getSessionSandboxViewModel` in
 * ./session_sandbox_composition.ts.
 */
export const createSessionSandboxViewModel = (
  options: SessionSandboxViewModelOptions,
): SessionSandboxViewModelInterface => SessionSandboxViewModel.create(options);
