// apps/frontend/client/src/lib/views/dev/session_sandbox_view_model.svelte.ts
//
// Dev sandbox ViewModel for session management testing.
// Provides mock sessions, End Session simulator, recap preview,
// and state carry-forward tester.
//
// Contract: C-240 Session Management

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { GameSession } from '$services/game/session_service.svelte';
import { sessionService } from '$services/game/session_service.svelte';

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

class SessionSandboxViewModel
  extends BaseViewModel<BaseViewModelOptions>
  implements SessionSandboxViewModelInterface
{
  testLog = $state<string[]>([]);
  mockMessageCount = $state(0);

  get testMessageCount(): number {
    return this.mockMessageCount;
  }

  get sessionServiceReady(): boolean {
    return sessionService !== undefined;
  }

  get activeSession(): GameSession | null {
    return sessionService.activeSession;
  }

  get sessions(): GameSession[] {
    return sessionService.sessions;
  }

  get chatLocked(): boolean {
    return sessionService.chatLocked;
  }

  /** @inheritdoc */
  async mockStartSession(): Promise<void> {
    this.testLog = [...this.testLog, 'Starting session...'];
    await sessionService.startSession({ gameId: 'sandbox-game' });
    this.testLog = [
      ...this.testLog,
      `Session ${sessionService.activeSession?.sessionNumber} started`,
    ];
  }

  /** @inheritdoc */
  async mockEndSession(): Promise<void> {
    if (!sessionService.activeSession) {
      this.testLog = [...this.testLog, 'No active session to end'];
      return;
    }
    this.testLog = [...this.testLog, 'Ending session...'];
    await sessionService.endSession({ playtimeMinutes: 15 });
    this.testLog = [
      ...this.testLog,
      `Session ${sessionService.activeSession?.sessionNumber} ended. Chat locked: ${sessionService.chatLocked}`,
    ];
  }

  /** @inheritdoc */
  async mockNewSession(): Promise<void> {
    this.testLog = [...this.testLog, 'Starting new session...'];
    await sessionService.startNewSession({ gameId: 'sandbox-game' });
    this.testLog = [
      ...this.testLog,
      `New session started. Chat locked: ${sessionService.chatLocked}`,
    ];
  }

  /** @inheritdoc */
  async mockLoadSessions(): Promise<void> {
    this.testLog = [...this.testLog, 'Loading sessions...'];
    await sessionService.loadSessions({ gameId: 'sandbox-game' });
    this.testLog = [...this.testLog, `Loaded ${sessionService.sessions.length} sessions`];
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

export const getSessionSandboxViewModel = (
  options: BaseViewModelOptions,
): SessionSandboxViewModelInterface => SessionSandboxViewModel.create(options);
