// apps/frontend/client/src/lib/services/game/player_journal_service.svelte.ts
//
// Player-written journal entry CRUD backed by Turso SQLite.
// Separate from C-339 quest auto-journal — this is player-authored content.
//
// Contract: C-344 Complete Session Recaps, Checkpoints, and Long-Campaign Lifecycle

import { getLocalDatabase } from '@aikami/frontend/repositories';
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import type { PlayerJournalEntry } from '$types';
import { registerSerializable, type SerializableService } from './serializable_service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PlayerJournalServiceOptions = BaseFrontendClassOptions;

export type PlayerJournalServiceInterface = BaseFrontendClassInterface & {
  /** All journal entries for the current campaign, sorted by createdAt descending. */
  readonly entries: PlayerJournalEntry[];

  /** Creates a new journal entry and persists it to Turso. */
  createEntry(options: {
    campaignId: string;
    sessionNumber: number;
    title: string;
    content: string;
    tags?: readonly string[];
  }): Promise<PlayerJournalEntry>;

  /** Loads all journal entries for a campaign. */
  loadEntries(options: { campaignId: string }): Promise<void>;

  /** Updates an existing journal entry. */
  updateEntry(options: {
    id: string;
    title?: string;
    content?: string;
    tags?: readonly string[];
  }): Promise<void>;

  /** Deletes a journal entry by ID. */
  deleteEntry(options: { id: string }): Promise<void>;

  /** Clears all entries (for reset). */
  reset(): void;
};

// ---------------------------------------------------------------------------
// Validation constants
// ---------------------------------------------------------------------------

const TITLE_MIN_LENGTH = 1;
const TITLE_MAX_LENGTH = 100;
const CONTENT_MIN_LENGTH = 1;
const CONTENT_MAX_LENGTH = 10_000;

// ---------------------------------------------------------------------------
// Serialization snapshot
// ---------------------------------------------------------------------------

type PlayerJournalSnapshot = {
  entries: PlayerJournalEntry[];
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class PlayerJournalService
  extends BaseFrontendClass<PlayerJournalServiceOptions>
  implements PlayerJournalServiceInterface, SerializableService<PlayerJournalSnapshot>
{
  entries = $state<PlayerJournalEntry[]>([]);

  constructor(options: PlayerJournalServiceOptions) {
    super(options);
    registerSerializable('playerJournal', this as unknown as SerializableService<unknown>);
  }

  /** @inheritdoc */
  async createEntry(options: {
    campaignId: string;
    sessionNumber: number;
    title: string;
    content: string;
    tags?: readonly string[];
  }): Promise<PlayerJournalEntry> {
    const { campaignId, sessionNumber, title, content, tags = [] } = options;

    // Validate
    const trimmedTitle = title.trim();
    const trimmedContent = content.trim();

    if (trimmedTitle.length < TITLE_MIN_LENGTH || trimmedTitle.length > TITLE_MAX_LENGTH) {
      throw new Error(`Title must be ${TITLE_MIN_LENGTH}–${TITLE_MAX_LENGTH} characters`);
    }
    if (trimmedContent.length < CONTENT_MIN_LENGTH || trimmedContent.length > CONTENT_MAX_LENGTH) {
      throw new Error(`Content must be ${CONTENT_MIN_LENGTH}–${CONTENT_MAX_LENGTH} characters`);
    }

    const now = new Date().toISOString();
    const entry: PlayerJournalEntry = {
      id: crypto.randomUUID(),
      campaignId,
      sessionNumber,
      title: trimmedTitle,
      content: trimmedContent,
      tags,
      createdAt: now,
      updatedAt: now,
    };

    const db = await getLocalDatabase();
    await db.execute({
      sql: `INSERT OR REPLACE INTO journal_entries (id, campaign_id, session_number, title, content, tags_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        entry.id,
        campaignId,
        sessionNumber,
        trimmedTitle,
        trimmedContent,
        JSON.stringify(tags),
        now,
        now,
      ],
    });

    this.entries = [entry, ...this.entries];
    this.debug('journal:created', { id: entry.id, title: trimmedTitle });

    return entry;
  }

  /** @inheritdoc */
  async loadEntries(options: { campaignId: string }): Promise<void> {
    const { campaignId } = options;

    const db = await getLocalDatabase();
    const result = await db.query({
      sql: 'SELECT id, campaign_id, session_number, title, content, tags_json, created_at, updated_at FROM journal_entries WHERE campaign_id = ? ORDER BY created_at DESC',
      args: [campaignId],
    });

    this.entries = result.rows.map((row: Record<string, unknown>) => ({
      id: row.id as string,
      campaignId: row.campaign_id as string,
      sessionNumber: row.session_number as number,
      title: row.title as string,
      content: row.content as string,
      tags: JSON.parse(row.tags_json as string) as readonly string[],
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    }));
  }

  /** @inheritdoc */
  async updateEntry(options: {
    id: string;
    title?: string;
    content?: string;
    tags?: readonly string[];
  }): Promise<void> {
    const { id, title, content, tags } = options;

    const trimmedTitle = title?.trim();
    if (
      trimmedTitle !== undefined &&
      (trimmedTitle.length < TITLE_MIN_LENGTH || trimmedTitle.length > TITLE_MAX_LENGTH)
    ) {
      throw new Error(`Title must be ${TITLE_MIN_LENGTH}–${TITLE_MAX_LENGTH} characters`);
    }

    const trimmedContent = content?.trim();
    if (
      trimmedContent !== undefined &&
      (trimmedContent.length < CONTENT_MIN_LENGTH || trimmedContent.length > CONTENT_MAX_LENGTH)
    ) {
      throw new Error(`Content must be ${CONTENT_MIN_LENGTH}–${CONTENT_MAX_LENGTH} characters`);
    }

    const now = new Date().toISOString();
    const db = await getLocalDatabase();

    // Build atomic UPDATE with only supplied fields
    const setClauses: string[] = [];
    const args: (string | number)[] = [];

    if (trimmedTitle !== undefined) {
      setClauses.push('title = ?');
      args.push(trimmedTitle);
    }
    if (trimmedContent !== undefined) {
      setClauses.push('content = ?');
      args.push(trimmedContent);
    }
    if (tags !== undefined) {
      setClauses.push('tags_json = ?');
      args.push(JSON.stringify(tags));
    }

    // Always update updated_at
    setClauses.push('updated_at = ?');
    args.push(now);

    // Add id for WHERE clause
    args.push(id);

    await db.execute({
      sql: `UPDATE journal_entries SET ${setClauses.join(', ')} WHERE id = ?`,
      args,
    });

    // Update in-memory
    const idx = this.entries.findIndex((e) => e.id === id);
    if (idx !== -1) {
      const existing = this.entries[idx];
      this.entries[idx] = {
        ...existing,
        title: trimmedTitle ?? existing.title,
        content: trimmedContent ?? existing.content,
        tags: tags ?? existing.tags,
        updatedAt: now,
      };
    }

    this.debug('journal:updated', { id });
  }

  /** @inheritdoc */
  async deleteEntry(options: { id: string }): Promise<void> {
    const { id } = options;

    const db = await getLocalDatabase();
    await db.execute({ sql: 'DELETE FROM journal_entries WHERE id = ?', args: [id] });

    this.entries = this.entries.filter((e) => e.id !== id);
    this.debug('journal:deleted', { id });
  }

  /** @inheritdoc */
  reset(): void {
    this.entries = [];
  }

  // ── SerializableService ─────────────────────────────────────────────

  serialize(): PlayerJournalSnapshot {
    return { entries: this.entries };
  }

  hydrate(data: PlayerJournalSnapshot): void {
    this.entries = data.entries ?? [];
  }
}

export { PlayerJournalService };

/**
 * Shared singleton instance of the player journal service.
 */
export const playerJournalService: PlayerJournalServiceInterface = PlayerJournalService.create({
  className: 'PlayerJournalService',
});
