// apps/frontend/client/src/lib/services/game/session_service.svelte.ts
//
// Session lifecycle management — GameSession CRUD, end-session flow with
// C-235 summarization, new-session recap + state carry-forward, auto-summarization
// toast threshold, checkpoint CRUD, context compaction, and recap editing.
//
// Contract: C-240 Session Management
// Contract: C-344 Complete Session Recaps, Checkpoints, and Long-Campaign Lifecycle

import { getLocalDatabase } from '@aikami/frontend/repositories';
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
  routerService,
} from '@aikami/frontend/services';
import { playerStateService } from '$services';
import { textGenerationService } from '$services/ai/text_generation_service.svelte';
import type { CompactedCampaignSummary } from '$types/compacted_campaign_summary';
import type { SessionCheckpoint } from '$types/session_checkpoint';
import { chatService } from '../chat/chat.svelte';
import type { SessionSummary } from '../gm/gm_types';
import { sessionSummaryService } from '../gm/session_summary_service.svelte';
import { gameSaveService } from './game_save_service.svelte.ts';
import { registerSerializable, type SerializableService } from './serializable_service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A saved game session wrapping a C-235 SessionSummary with metadata.
 *
 * Each session represents one play period. Sessions are numbered sequentially
 * per game. The active session is locked (read-only) once ended.
 *
 * Extended in C-344 with recapReviewed, editedSynopsis, and checkpointIds.
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
  /** Whether the player has reviewed/edited the recap for this session (C-344). */
  recapReviewed: boolean;
  /** The player-edited synopsis (if edited; original summary.synopsis if not) (C-344). */
  editedSynopsis?: string;
  /** Checkpoint IDs created during this session, in creation order (C-344). */
  checkpointIds: readonly string[];
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
  /** Checkpoints for the current campaign (C-344). */
  readonly checkpoints: SessionCheckpoint[];

  /** Starts a new session (Session 0 → Session 1 transition, or Nth session). */
  startSession(options: { gameId: string; campaignId?: string }): Promise<void>;
  /**
   * Ends the current active session — locks chat, generates summary,
   * saves the session, and triggers async context compaction.
   */
  endSession(options: { playtimeMinutes?: number; campaignId?: string }): Promise<void>;
  /**
   * Starts a new session after a previous one ended — posts recap,
   * increments session number, carries forward game state, and unlocks chat.
   */
  startNewSession(options: { gameId: string; campaignId?: string }): Promise<void>;
  /** Loads all sessions for a given game. */
  loadSessions(options: { gameId: string }): Promise<void>;
  /** Dismisses the auto-summarization toast for the current session. */
  dismissAutoSummaryToast(): void;
  /** Checks whether the chat has crossed the auto-summary message threshold. */
  checkAutoSummaryThreshold(): void;
  /** Clears all session state (called on New Game). */
  reset(): Promise<void>;

  // ── C-344: Recap Editing ─────────────────────────────────────────────

  /**
   * Updates the edited synopsis for the last ended session.
   *
   * Marks the session as recapReviewed and stores the edited synopsis.
   * This edited version is used for the next session's recap message
   * instead of the original AI-generated one.
   */
  updateSessionRecap(options: { sessionId: string; editedSynopsis: string }): Promise<void>;

  // ── C-344: Checkpoint CRUD ───────────────────────────────────────────

  /**
   * Creates a named checkpoint with the current game state.
   *
   * Saves a full ECS snapshot to Turso as a 'checkpoint-{uuid}' save slot
   * and records a SessionCheckpoint in the checkpoints table.
   */
  createCheckpoint(options: {
    label: string;
    description?: string;
    sessionId: string;
    campaignId: string;
    sessionNumber: number;
  }): Promise<SessionCheckpoint>;

  /**
   * Lists all checkpoints for a campaign, ordered by createdAt descending.
   */
  listCheckpoints(options: { campaignId: string }): Promise<void>;

  /**
   * Deletes a checkpoint and its associated save slot.
   */
  deleteCheckpoint(options: { checkpointId: string }): Promise<void>;

  /**
   * Forks from a checkpoint — copies the checkpoint's save to a new slot
   * and starts a new session with the forked state.
   */
  forkFromCheckpoint(options: {
    checkpointId: string;
    gameId: string;
    campaignId: string;
  }): Promise<void>;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** IndexedDB database name for legacy session storage (pre-C-344). */
const LEGACY_DB_NAME = 'aikami_sessions';

/** IndexedDB object store name for legacy sessions. */
const LEGACY_STORE_NAME = 'sessions';

/** Message count threshold for auto-summarization toast. */
const AUTO_SUMMARY_THRESHOLD = 100;

/** If fewer messages than this, skip summarization. */
const MIN_MESSAGES_FOR_SUMMARY = 10;

/** Number of completed sessions before context compaction triggers. */
const COMPACTION_THRESHOLD = 5;

/** Meta key for IndexedDB → Turso migration marker. */
const MIGRATION_META_KEY = 'sessions_migrated';

// ---------------------------------------------------------------------------
// Serialization snapshot
// ---------------------------------------------------------------------------

type SessionServiceSnapshot = {
  activeSession: GameSession | null;
  sessions: GameSession[];
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class SessionService
  extends BaseFrontendClass<SessionServiceOptions>
  implements SessionServiceInterface, SerializableService<SessionServiceSnapshot>
{
  activeSession = $state<GameSession | null>(null);
  chatLocked = $state(false);
  isEndingSession = $state(false);
  isStartingSession = $state(false);
  latestSummary = $state<SessionSummary | null>(null);
  showAutoSummaryToast = $state(false);
  sessions = $state<GameSession[]>([]);
  checkpoints = $state<SessionCheckpoint[]>([]);

  private _toastDismissed = false;
  private _migrationComplete = false;

  constructor(options: SessionServiceOptions) {
    super(options);
    registerSerializable('session', this as unknown as SerializableService<unknown>);
  }

  // ── Public API ──────────────────────────────────────────────────────

  /** @inheritdoc */
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
  async startSession(options: { gameId: string; campaignId?: string }): Promise<void> {
    const { gameId } = options;

    // Ensure migration from IndexedDB on first load
    await this._ensureMigration();

    const existingSessions = await this._getAll(gameId);
    const nextNumber =
      existingSessions.length > 0
        ? Math.max(...existingSessions.map((s) => s.sessionNumber)) + 1
        : 1;

    const now = new Date().toISOString();
    const session: GameSession = {
      id: crypto.randomUUID(),
      gameId,
      sessionNumber: nextNumber,
      startedAt: now,
      isActive: true,
      messageCount: 0,
      characterSnapshots: {},
      recapReviewed: false,
      checkpointIds: [],
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
  async endSession(options: { playtimeMinutes?: number; campaignId?: string } = {}): Promise<void> {
    const { playtimeMinutes = 0, campaignId } = options;

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
          this.warn('endSession:summary-failed', { error: String(error) });
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

      // Trigger async context compaction if threshold reached
      if (campaignId) {
        this._compactSessionsIfNeeded({ campaignId, gameId: endedSession.gameId }).catch(
          (error) => {
            this.warn('endSession:compaction-failed', { error: String(error) });
          },
        );
      }
    } finally {
      this.isEndingSession = false;
    }
  }

  /** @inheritdoc */
  async startNewSession(options: { gameId: string; campaignId?: string }): Promise<void> {
    const { gameId } = options;

    if (this.isStartingSession) {
      return;
    }

    this.isStartingSession = true;

    try {
      // Load previous sessions to get the recap
      const existing = await this._getAll(gameId);

      // Start the new session
      await this.startSession({ gameId, campaignId: options.campaignId });

      // If there was a previous session with a summary, post the recap
      if (existing.length > 0) {
        const previousSession = existing.sort((a, b) => b.sessionNumber - a.sessionNumber)[0];

        if (previousSession?.summary || previousSession?.editedSynopsis) {
          try {
            const recap = await this._generateRecap({
              previousSession,
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
            this.warn('startNewSession:recap-failed', { error: String(error) });

            // Fallback recap
            chatService.addMessage({
              id: crypto.randomUUID(),
              text: this._buildFallbackRecap(previousSession),
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
    await this._ensureMigration();
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
    this.checkpoints = [];

    // Delete session rows from Turso
    try {
      const db = await getLocalDatabase();
      await db.execute({ sql: 'DELETE FROM sessions', args: [] });
    } catch {
      // Ignore — database may not be available
    }

    this.debug('reset');
  }

  // ── C-344: Recap Editing ─────────────────────────────────────────────

  /** @inheritdoc */
  async updateSessionRecap(options: { sessionId: string; editedSynopsis: string }): Promise<void> {
    const { sessionId, editedSynopsis } = options;

    if (editedSynopsis.trim().length < 10) {
      throw new Error('Synopsis must be at least 10 characters');
    }

    const db = await getLocalDatabase();
    await db.execute({
      sql: 'UPDATE sessions SET edited_synopsis = ?, recap_reviewed = 1, updated_at = ? WHERE id = ?',
      args: [editedSynopsis.trim(), new Date().toISOString(), sessionId],
    });

    // Update in-memory
    if (this.activeSession?.id === sessionId) {
      this.activeSession = {
        ...this.activeSession,
        editedSynopsis: editedSynopsis.trim(),
        recapReviewed: true,
      };
    }
    const sIdx = this.sessions.findIndex((s) => s.id === sessionId);
    if (sIdx !== -1) {
      this.sessions[sIdx] = {
        ...this.sessions[sIdx],
        editedSynopsis: editedSynopsis.trim(),
        recapReviewed: true,
      };
    }

    this.debug('updateSessionRecap', { sessionId });
  }

  // ── C-344: Checkpoint CRUD ───────────────────────────────────────────

  /** @inheritdoc */
  async createCheckpoint(options: {
    label: string;
    description?: string;
    sessionId: string;
    campaignId: string;
    sessionNumber: number;
  }): Promise<SessionCheckpoint> {
    const { label, description, sessionId, campaignId, sessionNumber } = options;

    const checkpointId = crypto.randomUUID();
    const saveSlotId = `checkpoint-${checkpointId}`;
    const now = new Date().toISOString();

    // Create the checkpoint record first
    const db = await getLocalDatabase();
    await db.execute({
      sql: `INSERT OR REPLACE INTO session_checkpoints (id, session_id, campaign_id, label, description, session_number, created_at, save_slot_id, has_forks)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      args: [
        checkpointId,
        sessionId,
        campaignId,
        label,
        description ?? null,
        sessionNumber,
        now,
        saveSlotId,
      ],
    });

    // Trigger a game save to the checkpoint slot
    try {
      await gameSaveService.saveGame({ slotId: saveSlotId, campaignId });
    } catch (error) {
      // Rollback checkpoint record on save failure
      await db.execute({
        sql: 'DELETE FROM session_checkpoints WHERE id = ?',
        args: [checkpointId],
      });
      throw new Error(`Checkpoint creation failed: ${String(error)}`);
    }

    // Update session's checkpoint IDs
    await this._addCheckpointToSession({ sessionId, checkpointId });

    const checkpoint: SessionCheckpoint = {
      id: checkpointId,
      sessionId,
      campaignId,
      label: label.trim(),
      description,
      sessionNumber,
      createdAt: now,
      saveSlotId,
      hasForks: false,
    };

    this.checkpoints = [checkpoint, ...this.checkpoints];
    this.debug('checkpoint:created', { id: checkpointId, label });

    return checkpoint;
  }

  /** @inheritdoc */
  async listCheckpoints(options: { campaignId: string }): Promise<void> {
    const { campaignId } = options;

    const db = await getLocalDatabase();
    const result = await db.query({
      sql: `SELECT id, session_id, campaign_id, label, description, session_number, created_at, save_slot_id, has_forks
            FROM session_checkpoints WHERE campaign_id = ? ORDER BY created_at DESC`,
      args: [campaignId],
    });

    this.checkpoints = result.rows.map((row: Record<string, unknown>) => ({
      id: row.id as string,
      sessionId: row.session_id as string,
      campaignId: row.campaign_id as string,
      label: row.label as string,
      description: (row.description as string) || undefined,
      sessionNumber: row.session_number as number,
      createdAt: row.created_at as string,
      saveSlotId: row.save_slot_id as string,
      hasForks: (row.has_forks as number) === 1,
    }));
  }

  /** @inheritdoc */
  async deleteCheckpoint(options: { checkpointId: string }): Promise<void> {
    const { checkpointId } = options;

    const db = await getLocalDatabase();
    const result = await db.query({
      sql: 'SELECT save_slot_id FROM session_checkpoints WHERE id = ?',
      args: [checkpointId],
    });

    if (result.rows.length === 0) {
      return;
    }

    const saveSlotId = result.rows[0].save_slot_id as string;

    // Delete the Turso save slot
    try {
      await gameSaveService.deleteSave(saveSlotId);
    } catch {
      // Save slot may already be gone — proceed with checkpoint deletion
    }

    await db.execute({ sql: 'DELETE FROM session_checkpoints WHERE id = ?', args: [checkpointId] });
    this.checkpoints = this.checkpoints.filter((c) => c.id !== checkpointId);
    this.debug('checkpoint:deleted', { id: checkpointId });
  }

  /** @inheritdoc */
  async forkFromCheckpoint(options: {
    checkpointId: string;
    gameId: string;
    campaignId: string;
  }): Promise<void> {
    const { checkpointId, campaignId } = options;

    const db = await getLocalDatabase();
    const result = await db.query({
      sql: 'SELECT id, session_id, campaign_id, label, session_number, save_slot_id FROM session_checkpoints WHERE id = ?',
      args: [checkpointId],
    });

    if (result.rows.length === 0) {
      throw new Error(`Checkpoint not found: ${checkpointId}`);
    }

    const row = result.rows[0];
    const saveSlotId = row.save_slot_id as string;

    // Validate the checkpoint save is not corrupted
    let rawPayload: string;
    try {
      rawPayload = await gameSaveService.getRawSavePayload(saveSlotId);
    } catch {
      throw new Error('Checkpoint is corrupted — cannot fork');
    }

    // Verify the payload parses (basic corruption check)
    try {
      JSON.parse(rawPayload);
    } catch {
      throw new Error('Checkpoint is corrupted — cannot fork');
    }

    // Start a new session with the checkpoint's state
    // Copy the checkpoint save to a new save slot for the new session
    const newSlotId = 'manual-1';
    const envelope = JSON.parse(rawPayload) as Record<string, unknown>;

    // Preserve the envelope data for the forked session
    const newPayload = JSON.stringify(envelope);
    const newSaveId = `aikami_save_${newSlotId}`;

    await db.execute({
      sql: `INSERT OR REPLACE INTO saves (id, slot_id, campaign_id, timestamp, map_name, payload)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [newSaveId, newSlotId, campaignId, Date.now(), 'World', newPayload],
    });

    // Mark the checkpoint as having forks
    await db.execute({
      sql: 'UPDATE session_checkpoints SET has_forks = 1 WHERE id = ?',
      args: [checkpointId],
    });

    // Update in-memory checkpoints
    const cpIdx = this.checkpoints.findIndex((c) => c.id === checkpointId);
    if (cpIdx !== -1) {
      this.checkpoints[cpIdx] = { ...this.checkpoints[cpIdx], hasForks: true };
    }

    this.debug('checkpoint:forked', { checkpointId, newSlotId });

    // Navigate to game — the boot pipeline will load this save
    await routerService.navigateToApp();
  }

  // ── C-344: Context Compaction ────────────────────────────────────────

  /**
   * Compacts older session summaries into a hierarchical campaign summary
   * when the session count crosses the compaction threshold.
   *
   * Runs asynchronously — does not block the end-session flow. Uses LLM
   * compaction when available, deterministic truncation fallback otherwise.
   */
  private async _compactSessionsIfNeeded(options: {
    campaignId: string;
    gameId: string;
  }): Promise<void> {
    const { campaignId, gameId } = options;

    // Get all completed sessions with summaries
    const completedSessions = (await this._getAll(gameId))
      .filter((s) => !s.isActive && s.summary)
      .sort((a, b) => a.sessionNumber - b.sessionNumber);

    if (completedSessions.length < COMPACTION_THRESHOLD) {
      return;
    }

    // Check which sessions are already compacted
    const db = await getLocalDatabase();
    const compactedResult = await db.query({
      sql: 'SELECT compacted_session_ids_json FROM compacted_summaries WHERE campaign_id = ?',
      args: [campaignId],
    });

    const alreadyCompactedIds = new Set<string>();
    for (const row of compactedResult.rows) {
      const ids = JSON.parse(row.compacted_session_ids_json as string) as string[];
      for (const id of ids) {
        alreadyCompactedIds.add(id);
      }
    }

    // Filter to sessions not yet compacted
    const uncompactedSessions = completedSessions.filter((s) => !alreadyCompactedIds.has(s.id));
    if (uncompactedSessions.length < COMPACTION_THRESHOLD) {
      return;
    }

    // Take the oldest N uncompacted sessions
    const toCompact = uncompactedSessions.slice(0, COMPACTION_THRESHOLD);

    // Attempt AI compaction first
    let method: 'ai' | 'truncation' = 'truncation';
    let synopsis: string;
    let keyEvents: readonly string[];

    try {
      const aiResult = await this._aiCompact({ sessions: toCompact });
      synopsis = aiResult.synopsis;
      keyEvents = aiResult.keyEvents;
      method = 'ai';
    } catch (error) {
      this.warn('_compactSessionsIfNeeded:ai-failed', { error: String(error) });
      // Fallback to deterministic truncation
      const fallbackResult = this._truncationCompact({ sessions: toCompact });
      synopsis = fallbackResult.synopsis;
      keyEvents = fallbackResult.keyEvents;
    }

    // Store the compaction
    const compaction: CompactedCampaignSummary = {
      id: crypto.randomUUID(),
      campaignId,
      compactedSessionIds: toCompact.map((s) => s.id),
      sessionRange: {
        first: toCompact[0].sessionNumber,
        last: toCompact[toCompact.length - 1].sessionNumber,
      },
      synopsis,
      keyEvents,
      compactedAt: new Date().toISOString(),
      method,
    };

    await db.execute({
      sql: `INSERT OR REPLACE INTO compacted_summaries (id, campaign_id, session_range_first, session_range_last, compacted_session_ids_json, synopsis, key_events_json, method, compacted_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        compaction.id,
        campaignId,
        compaction.sessionRange.first,
        compaction.sessionRange.last,
        JSON.stringify(compaction.compactedSessionIds),
        synopsis,
        JSON.stringify(keyEvents),
        method,
        compaction.compactedAt,
      ],
    });

    this.debug('compaction:complete', {
      campaignId,
      sessionRange: `${compaction.sessionRange.first}-${compaction.sessionRange.last}`,
      method,
    });
  }

  /**
   * AI-based hierarchical summarization of multiple session summaries.
   */
  private async _aiCompact(options: {
    sessions: GameSession[];
  }): Promise<{ synopsis: string; keyEvents: readonly string[] }> {
    const { sessions } = options;

    const summaries = sessions
      .map((s) => `Session ${s.sessionNumber}: ${s.editedSynopsis ?? s.summary?.synopsis ?? ''}`)
      .join('\n\n');

    const prompt = [
      'Summarize these RPG session summaries into a single hierarchical campaign summary.',
      'Provide a concise synopsis (4-6 sentences) and a deduplicated, ranked list of key events.',
      '',
      summaries,
      '',
      'Respond with JSON:',
      '{',
      '  "synopsis": "string",',
      '  "keyEvents": ["event 1", "event 2", ...]',
      '}',
    ].join('\n');

    try {
      const result = (await textGenerationService.extractStructure({
        schema: {
          type: 'object',
          properties: {
            synopsis: { type: 'string', minLength: 1 },
            keyEvents: { type: 'array', items: { type: 'string' } },
          },
          required: ['synopsis', 'keyEvents'],
          additionalProperties: false,
        },
        schemaName: 'CompactedSummary',
        prompt,
        systemPrompt: 'Summarize RPG campaign sessions concisely. JSON only.',
      })) as { synopsis: string; keyEvents: string[] };

      return { synopsis: result.synopsis, keyEvents: result.keyEvents ?? [] };
    } catch {
      throw new Error('AI compaction failed');
    }
  }

  /**
   * Deterministic truncation fallback for context compaction.
   *
   * Takes the first 2 sentences of each session synopsis and deduplicates
   * key events.
   */
  private _truncationCompact(options: { sessions: GameSession[] }): {
    synopsis: string;
    keyEvents: readonly string[];
  } {
    const { sessions } = options;

    const synopsisParts = sessions.map((s) => {
      const text = s.editedSynopsis ?? s.summary?.synopsis ?? '';
      const sentences = text.split(/[.!?]+/).filter(Boolean);
      const firstTwo = sentences
        .slice(0, 2)
        .map((sent) => sent.trim())
        .join('. ');
      return `Session ${s.sessionNumber}: ${firstTwo}.`;
    });

    const synopsis = synopsisParts.join(' ');

    // Deduplicate key events
    const eventSet = new Set<string>();
    for (const s of sessions) {
      const events = s.summary?.keyEvents ?? [];
      for (const event of events) {
        eventSet.add(event);
      }
    }

    return { synopsis, keyEvents: [...eventSet] };
  }

  // ── Private: Recap generation ───────────────────────────────────────

  /**
   * Captures a snapshot of party member stats for the session summary.
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

  /**
   * Generates a recap message from the previous session's summary.
   *
   * Uses the edited synopsis if available, otherwise the AI-generated one.
   */
  private async _generateRecap(options: { previousSession: GameSession }): Promise<string> {
    const { previousSession } = options;

    // Use edited synopsis if available, otherwise original summary
    const synopsis = previousSession.editedSynopsis ?? previousSession.summary?.synopsis ?? '';
    const keyEvents = previousSession.summary?.keyEvents ?? [];

    const prompt = [
      'Write a concise recap (2-3 sentences) of a previous RPG session.',
      'Start with "📜 **Previously...**"',
      '',
      `Synopsis: ${synopsis}`,
      `Key events: ${keyEvents.join(', ')}`,
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
   */
  private _buildFallbackRecap(session: GameSession): string {
    const synopsis = session.editedSynopsis ?? session.summary?.synopsis ?? '';
    const keyEvents = session.summary?.keyEvents ?? [];

    const lines = ['📜 **Previously...**', '', synopsis];

    if (keyEvents.length > 0) {
      lines.push('');
      lines.push(...keyEvents.map((e) => `- ${e}`));
    }

    return lines.join('\n');
  }

  // ── Private: Checkpoint helpers ──────────────────────────────────────

  /**
   * Adds a checkpoint ID to a session's checkpointIds array.
   */
  private async _addCheckpointToSession(options: {
    sessionId: string;
    checkpointId: string;
  }): Promise<void> {
    const { sessionId, checkpointId } = options;

    // Get current checkpoint IDs
    const db = await getLocalDatabase();
    const result = await db.query({
      sql: 'SELECT checkpoint_ids_json FROM sessions WHERE id = ?',
      args: [sessionId],
    });

    const existingIds: string[] =
      result.rows.length > 0
        ? (JSON.parse(result.rows[0].checkpoint_ids_json as string) as string[])
        : [];
    const newIds = [...existingIds, checkpointId];

    await db.execute({
      sql: 'UPDATE sessions SET checkpoint_ids_json = ?, updated_at = ? WHERE id = ?',
      args: [JSON.stringify(newIds), new Date().toISOString(), sessionId],
    });

    if (this.activeSession?.id === sessionId) {
      this.activeSession = { ...this.activeSession, checkpointIds: newIds };
    }
  }

  // ── Private: Turso persistence ───────────────────────────────────────

  /**
   * Retrieves all session documents for a given game from Turso,
   * sorted by sessionNumber descending.
   */
  private async _getAll(gameId: string): Promise<GameSession[]> {
    await this._ensureMigration();

    const db = await getLocalDatabase();
    const result = await db.query({
      sql: `SELECT id, game_id, session_number, started_at, ended_at, is_active, summary_json,
                   message_count, duration_minutes, character_snapshots_json,
                   recap_reviewed, edited_synopsis, checkpoint_ids_json
            FROM sessions WHERE game_id = ? ORDER BY session_number DESC`,
      args: [gameId],
    });

    return result.rows.map((row: Record<string, unknown>) => ({
      id: row.id as string,
      gameId: row.game_id as string,
      sessionNumber: row.session_number as number,
      startedAt: row.started_at as string,
      endedAt: (row.ended_at as string) || undefined,
      isActive: (row.is_active as number) === 1,
      summary: row.summary_json
        ? (JSON.parse(row.summary_json as string) as SessionSummary)
        : undefined,
      messageCount: row.message_count as number,
      durationMinutes: (row.duration_minutes as number) || undefined,
      characterSnapshots: JSON.parse(row.character_snapshots_json as string) as Record<
        string,
        { level: number; xp: number; hp: number }
      >,
      recapReviewed: (row.recap_reviewed as number) === 1,
      editedSynopsis: (row.edited_synopsis as string) || undefined,
      checkpointIds: JSON.parse(row.checkpoint_ids_json as string) as readonly string[],
    }));
  }

  /**
   * Upserts a session document into the Turso sessions table.
   */
  private async _put(session: GameSession): Promise<void> {
    await this._ensureMigration();

    const db = await getLocalDatabase();
    await db.execute({
      sql: `INSERT OR REPLACE INTO sessions
            (id, game_id, session_number, started_at, ended_at, is_active, summary_json,
             message_count, duration_minutes, character_snapshots_json,
             recap_reviewed, edited_synopsis, checkpoint_ids_json, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        session.id,
        session.gameId,
        session.sessionNumber,
        session.startedAt,
        session.endedAt ?? null,
        session.isActive ? 1 : 0,
        session.summary ? JSON.stringify(session.summary) : null,
        session.messageCount,
        session.durationMinutes ?? null,
        JSON.stringify(session.characterSnapshots),
        session.recapReviewed ? 1 : 0,
        session.editedSynopsis ?? null,
        JSON.stringify(session.checkpointIds),
        new Date().toISOString(),
      ],
    });
  }

  // ── Private: IndexedDB → Turso Migration ────────────────────────────

  /**
   * Ensures the one-time migration from IndexedDB aikami_sessions to Turso
   * sessions table has been run.
   *
   * Idempotent — checks for the migration marker in the meta table first.
   * IndexedDB data is read-only — never deleted.
   */
  private async _ensureMigration(): Promise<void> {
    if (this._migrationComplete) {
      return;
    }

    // Check migration marker in Turso meta table
    const db = await getLocalDatabase();
    const metaResult = await db.query({
      sql: 'SELECT value FROM meta WHERE key = ?',
      args: [MIGRATION_META_KEY],
    });

    if (metaResult.rows.length > 0 && metaResult.rows[0].value === '1') {
      this._migrationComplete = true;
      return;
    }

    // Attempt migration from IndexedDB
    try {
      await this._migrateFromIndexedDB();
    } catch (error) {
      this.warn('_ensureMigration:indexeddb-unavailable', { error: String(error) });
      // IndexedDB may not be available — mark as migrated so we don't retry
    }

    // Mark migration complete
    await db.execute({
      sql: 'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)',
      args: [MIGRATION_META_KEY, '1'],
    });
    this._migrationComplete = true;
    this.debug('migration:sessions:complete');
  }

  /**
   * Migrates existing C-240 GameSession data from IndexedDB to Turso.
   *
   * Reads all entries from the legacy aikami_sessions IndexedDB database
   * and writes them to the Turso sessions table. Source data is preserved.
   */
  private async _migrateFromIndexedDB(): Promise<void> {
    const legacySessions = await this._readLegacyIndexedDB();

    if (legacySessions.length === 0) {
      return;
    }

    const db = await getLocalDatabase();
    for (const session of legacySessions) {
      await db.execute({
        sql: `INSERT OR REPLACE INTO sessions
              (id, game_id, session_number, started_at, ended_at, is_active, summary_json,
               message_count, duration_minutes, character_snapshots_json,
               recap_reviewed, edited_synopsis, checkpoint_ids_json)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, '[]')`,
        args: [
          session.id,
          session.gameId,
          session.sessionNumber,
          session.startedAt,
          session.endedAt ?? null,
          session.isActive ? 1 : 0,
          session.summary ? JSON.stringify(session.summary) : null,
          session.messageCount,
          session.durationMinutes ?? null,
          JSON.stringify(session.characterSnapshots),
        ],
      });
    }

    this.debug('_migrateFromIndexedDB', { count: legacySessions.length });
  }

  /**
   * Reads all GameSession documents from the legacy IndexedDB store.
   */
  private _readLegacyIndexedDB(): Promise<GameSession[]> {
    return new Promise((resolve) => {
      try {
        const request = indexedDB.open(LEGACY_DB_NAME, 1);

        request.onsuccess = (): void => {
          const db = request.result;
          try {
            if (!db.objectStoreNames.contains(LEGACY_STORE_NAME)) {
              db.close();
              resolve([]);
              return;
            }
            const transaction = db.transaction(LEGACY_STORE_NAME, 'readonly');
            const store = transaction.objectStore(LEGACY_STORE_NAME);
            const getAll = store.getAll();

            getAll.onsuccess = (): void => {
              resolve((getAll.result as GameSession[]) || []);
              db.close();
            };

            getAll.onerror = (): void => {
              db.close();
              resolve([]);
            };
          } catch {
            db.close();
            resolve([]);
          }
        };

        request.onerror = (): void => {
          resolve([]);
        };
      } catch {
        resolve([]);
      }
    });
  }

  // ── SerializableService ─────────────────────────────────────────────

  serialize(): SessionServiceSnapshot {
    return {
      activeSession: this.activeSession,
      sessions: this.sessions,
    };
  }

  hydrate(data: SessionServiceSnapshot): void {
    this.activeSession = data.activeSession;
    this.sessions = data.sessions ?? [];
  }
}

export { SessionService };

/**
 * Shared singleton instance of the session service.
 */
export const sessionService: SessionServiceInterface = SessionService.create({
  className: 'SessionService',
});
