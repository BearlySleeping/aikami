// apps/frontend/client/src/lib/services/game/session_service.svelte.ts
//
// Session lifecycle management — GameSession CRUD, end-session flow with
// C-235 summarization, new-session recap + state carry-forward, and
// auto-summarization toast threshold.
//
// Contract: C-240 Session Management

import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import { logger } from '$logger';
import { playerStateService } from '$services';
import { textGenerationService } from '$services/ai/text_generation_service.svelte';
import { chatService } from '../chat/chat.svelte';
import type { SessionSummary } from '../gm/gm_types';
import { sessionSummaryService } from '../gm/session_summary_service.svelte';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A saved game session wrapping a C-235 SessionSummary with metadata.
 *
 * Each session represents one play period. Sessions are numbered sequentially
 * per game. The active session is locked (read-only) once ended.
 */
export type GameSession = {
  /** Unique session identifier. */
  id: string;
  /** The game this session belongs to. */
  gameId: string;
  /** Monotonically increasing session number (1-indexed). */
  sessionNumber: number;
  /** ISO-8601 timestamp of session start. */
  startedAt: string;
  /** ISO-8601 timestamp of session end, or undefined if still active. */
  endedAt?: string;
  /** Whether this session is currently active (not ended). */
  isActive: boolean;
  /** The C-235 session summary, generated when the session ends. */
  summary?: SessionSummary;
  /** Total message count in the chat when the session was ended. */
  messageCount: number;
  /** Session duration in minutes. */
  durationMinutes?: number;
  /** Stat snapshots for party members at session end. */
  characterSnapshots: Record<string, { level: number; xp: number; hp: number }>;
};

/** Options for constructing a {@link SessionService}. */
export type SessionServiceOptions = BaseFrontendClassOptions;

export type SessionServiceInterface = BaseFrontendClassInterface & {
  /** Currently active session, or null if none is active. */
  readonly activeSession: GameSession | null;
  /** Whether the chat is locked (read-only) due to session end. */
  readonly chatLocked: boolean;
  /** Whether a session end operation is in progress. */
  readonly isEndingSession: boolean;
  /** Whether a new session is being created. */
  readonly isStartingSession: boolean;
  /** The most recently generated summary, available for preview. */
  readonly latestSummary: SessionSummary | null;
  /** Whether the auto-summarization toast should be shown. */
  readonly showAutoSummaryToast: boolean;
  /** All sessions for the current game, ordered by sessionNumber descending. */
  readonly sessions: GameSession[];

  /** Starts a new session (Session 0 → Session 1 transition, or Nth session). */
  startSession(options: { gameId: string }): Promise<void>;
  /**
   * Ends the current active session — locks chat, generates summary,
   * and saves the session.
   */
  endSession(options: { playtimeMinutes?: number }): Promise<void>;
  /**
   * Starts a new session after a previous one ended — posts recap,
   * increments session number, carries forward game state, and unlocks chat.
   */
  startNewSession(options: { gameId: string }): Promise<void>;
  /** Loads all sessions for a given game. */
  loadSessions(options: { gameId: string }): Promise<void>;
  /** Dismisses the auto-summarization toast for the current session. */
  dismissAutoSummaryToast(): void;
  /** Checks whether the chat has crossed the auto-summary message threshold. */
  checkAutoSummaryThreshold(): void;
  /** Clears all session state (called on New Game). */
  reset(): Promise<void>;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** IndexedDB database name for session storage. */
const DB_NAME = 'aikami_sessions';

/** IndexedDB database version. */
const DB_VERSION = 1;

/** Object store name for session documents. */
const STORE_NAME = 'sessions';

/** Message count threshold for auto-summarization toast. */
const AUTO_SUMMARY_THRESHOLD = 100;

/** If fewer messages than this, skip summarization. */
const MIN_MESSAGES_FOR_SUMMARY = 10;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class SessionService
  extends BaseFrontendClass<SessionServiceOptions>
  implements SessionServiceInterface
{
  activeSession = $state<GameSession | null>(null);
  chatLocked = $state(false);
  isEndingSession = $state(false);
  isStartingSession = $state(false);
  latestSummary = $state<SessionSummary | null>(null);
  showAutoSummaryToast = $state(false);
  sessions = $state<GameSession[]>([]);

  private _toastDismissed = false;

  // ── Public API ──────────────────────────────────────────────────────

  /**
   * Should be called after messages are added to check auto-summary threshold.
   *
   * Called reactively by consumers when chatService.messages changes.
   */
  checkAutoSummaryThreshold(): void {
    if (this._toastDismissed || this.chatLocked || this.showAutoSummaryToast) {
      return;
    }
    const count = chatService.messages.length;
    if (count >= AUTO_SUMMARY_THRESHOLD) {
      this.showAutoSummaryToast = true;
      this.debug('autoSummaryToast:shown', { messageCount: count });
    }
  }

  /** @inheritdoc */
  async startSession(options: { gameId: string }): Promise<void> {
    const { gameId } = options;

    // Determine session number from existing sessions
    const existingSessions = await this._getAll(gameId);
    const nextNumber =
      existingSessions.length > 0
        ? Math.max(...existingSessions.map((s) => s.sessionNumber)) + 1
        : 1;

    const session: GameSession = {
      id: crypto.randomUUID(),
      gameId,
      sessionNumber: nextNumber,
      startedAt: new Date().toISOString(),
      isActive: true,
      messageCount: 0,
      characterSnapshots: {},
    };

    await this._put(session);
    this.activeSession = session;
    this.chatLocked = false;
    this._toastDismissed = false;
    this.showAutoSummaryToast = false;
    this.latestSummary = null;
    this.debug('startSession', { sessionNumber: nextNumber, gameId });
  }

  /** @inheritdoc */
  async endSession(options: { playtimeMinutes?: number } = {}): Promise<void> {
    const { playtimeMinutes = 0 } = options;

    if (!this.activeSession) {
      this.debug('endSession:no-active');
      return;
    }

    if (this.isEndingSession) {
      return;
    }

    this.isEndingSession = true;

    try {
      const messageCount = chatService.messages.length;

      // Lock chat immediately
      this.chatLocked = true;

      let summary: SessionSummary | undefined;

      // Only generate summary if there are enough messages
      if (messageCount >= MIN_MESSAGES_FOR_SUMMARY) {
        try {
          summary = await sessionSummaryService.generateSummary(playtimeMinutes);
          this.latestSummary = summary;
          this.debug('endSession:summary-generated', {
            summaryId: summary.id,
            synopsisLength: summary.synopsis.length,
          });
        } catch (error) {
          logger.warn('endSession:summary-failed', { error: String(error) });
          // Proceed without summary — session still ends
        }
      } else {
        this.debug('endSession:skipping-summary', { messageCount });
      }

      // Build the completed session
      const endedSession: GameSession = {
        ...this.activeSession,
        endedAt: new Date().toISOString(),
        isActive: false,
        summary,
        messageCount,
        durationMinutes: playtimeMinutes,
        characterSnapshots: await this._captureCharacterSnapshots(),
      };

      await this._put(endedSession);
      this.activeSession = endedSession;

      // Refresh sessions list
      await this.loadSessions({ gameId: endedSession.gameId });

      this.debug('endSession:complete', {
        sessionNumber: endedSession.sessionNumber,
        messageCount,
      });
    } finally {
      this.isEndingSession = false;
    }
  }

  /** @inheritdoc */
  async startNewSession(options: { gameId: string }): Promise<void> {
    const { gameId } = options;

    if (this.isStartingSession) {
      return;
    }

    this.isStartingSession = true;

    try {
      // Load previous sessions to get the recap
      const existing = await this._getAll(gameId);

      // Start the new session
      await this.startSession({ gameId });

      // If there was a previous session with a summary, post the recap
      if (existing.length > 0) {
        const previousSession = existing.sort((a, b) => b.sessionNumber - a.sessionNumber)[0];

        if (previousSession?.summary) {
          try {
            const recap = await this._generateRecap({
              previousSummary: previousSession.summary,
            });

            // Post the recap as the first chat message
            chatService.addMessage({
              id: crypto.randomUUID(),
              text: recap,
              sender: 'ai',
              timestamp: new Date(),
            });

            this.debug('startNewSession:recap-posted', {
              sessionNumber: this.activeSession?.sessionNumber,
            });
          } catch (error) {
            logger.warn('startNewSession:recap-failed', { error: String(error) });

            // Fallback recap
            chatService.addMessage({
              id: crypto.randomUUID(),
              text: this._buildFallbackRecap(previousSession.summary),
              sender: 'ai',
              timestamp: new Date(),
            });
          }
        }
      }

      // Unlock chat
      this.chatLocked = false;
      this._toastDismissed = false;
      this.showAutoSummaryToast = false;
      this.debug('startNewSession:complete');
    } finally {
      this.isStartingSession = false;
    }
  }

  /** @inheritdoc */
  async loadSessions(options: { gameId: string }): Promise<void> {
    const { gameId } = options;
    this.sessions = await this._getAll(gameId);
  }

  /** @inheritdoc */
  dismissAutoSummaryToast(): void {
    this.showAutoSummaryToast = false;
    this._toastDismissed = true;
  }

  /** @inheritdoc */
  async reset(): Promise<void> {
    this.activeSession = null;
    this.chatLocked = false;
    this.latestSummary = null;
    this.showAutoSummaryToast = false;
    this._toastDismissed = false;
    this.sessions = [];

    // Clear IndexedDB sessions store
    await this._clearDatabase();

    this.debug('reset');
  }

  // ── Private: Recap generation ───────────────────────────────────────

  /**
   * Captures a snapshot of party member stats for the session summary.
   *
   * In MVP, captures only the player character. Extend for full party support.
   */
  private async _captureCharacterSnapshots(): Promise<
    Record<string, { level: number; xp: number; hp: number }>
  > {
    return {
      player: {
        level: playerStateService.playerLevel,
        xp: playerStateService.playerXp,
        hp: playerStateService.playerHp,
      },
    };
  }

  // ── Private: Recap generation ───────────────────────────────────────

  /**
   * Generates a recap message from the previous session's summary using
   * an AI call.
   */
  private async _generateRecap(options: { previousSummary: SessionSummary }): Promise<string> {
    const { previousSummary } = options;

    const prompt = [
      'Write a concise recap (2-3 sentences) of a previous RPG session.',
      'Start with "📜 **Previously...**"',
      '',
      `Synopsis: ${previousSummary.synopsis}`,
      `Key events: ${previousSummary.keyEvents.join(', ')}`,
      '',
      'Make the player feel like they are continuing an ongoing story.',
    ].join('\n');

    let accumulated = '';

    await textGenerationService.streamChat({
      messages: [{ role: 'user', content: prompt }],
      onChunk: (text: string) => {
        accumulated += text;
      },
    });

    return accumulated;
  }

  /**
   * Builds a fallback recap message from the session summary.
   *
   * Used when the AI recap call fails (offline, timeout, etc.).
   */
  private _buildFallbackRecap(summary: SessionSummary): string {
    const lines = ['📜 **Previously...**', '', summary.synopsis];

    if (summary.keyEvents.length > 0) {
      lines.push('');
      lines.push(...summary.keyEvents.map((e) => `- ${e}`));
    }

    return lines.join('\n');
  }

  // ── Private: IndexedDB helpers ──────────────────────────────────────

  /**
   * Clears all session data from the IndexedDB store.
   *
   * Used during reset() and test cleanup.
   */
  private async _clearDatabase(): Promise<void> {
    try {
      const db = await this._openDatabase();
      try {
        return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_NAME, 'readwrite');
          const store = transaction.objectStore(STORE_NAME);
          const request = store.getAll();

          request.onsuccess = (): void => {
            const docs = request.result as GameSession[];
            for (const doc of docs) {
              store.delete(doc.id);
            }
            resolve();
          };

          request.onerror = (): void => {
            reject(request.error ?? new Error('IndexedDB clear failed'));
          };
        });
      } finally {
        db.close();
      }
    } catch {
      // IndexedDB may not be available in all test environments
    }
  }

  /**
   * Opens the IndexedDB database and ensures the object store exists.
   */
  private _openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (): void => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('gameId', 'gameId', { unique: false });
          store.createIndex('sessionNumber', 'sessionNumber', { unique: false });
        }
      };

      request.onsuccess = (): void => {
        resolve(request.result);
      };

      request.onerror = (): void => {
        logger.error('SessionService: failed to open IndexedDB', request.error);
        reject(request.error ?? new Error('IndexedDB open failed'));
      };
    });
  }

  /**
   * Retrieves all session documents for a given game, sorted by sessionNumber descending.
   */
  private async _getAll(gameId: string): Promise<GameSession[]> {
    const db = await this._openDatabase();
    try {
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const index = store.index('gameId');
        const request = index.getAll(gameId);

        request.onsuccess = (): void => {
          const docs = request.result as GameSession[];
          docs.sort((a, b) => b.sessionNumber - a.sessionNumber);
          resolve(docs);
        };

        request.onerror = (): void => {
          reject(request.error ?? new Error('IndexedDB getAll failed'));
        };
      });
    } finally {
      db.close();
    }
  }

  /**
   * Upserts a session document into the object store.
   */
  private async _put(session: GameSession): Promise<void> {
    const db = await this._openDatabase();
    try {
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.put(session);

        request.onsuccess = (): void => {
          resolve();
        };

        request.onerror = (): void => {
          reject(request.error ?? new Error('IndexedDB put failed'));
        };
      });
    } finally {
      db.close();
    }
  }
}

export { SessionService };

/**
 * Shared singleton instance of the session service.
 */
export const sessionService: SessionServiceInterface = SessionService.create({
  className: 'SessionService',
});
