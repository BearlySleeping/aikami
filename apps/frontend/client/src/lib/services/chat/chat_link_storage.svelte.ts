// apps/frontend/client/src/lib/services/chat/chat_link_storage.svelte.ts
//
// Local SQLite-backed ChatLink repository. Replaces the Firestore
// `chats/{targetChatId}/chatLinks/*` path (C-244) with plain typed queries
// against the local `chat_links` table. The ChatLink document is stored as
// JSON in the `data` column (shape governed by ChatLinkSchema) with the
// queried columns (link_id, target_chat_id) explicit.
//
// Contract: C-386a — Firestore Removal, ChatLink local-first.
// biome-ignore-all lint/style/useNamingConvention: SQL column names are snake_case

import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import { getLocalDatabase } from '@aikami/frontend/storage';
import { ChatLinkSchema } from '@aikami/schemas';
import type { ChatLink } from '@aikami/types';
import { Value } from 'typebox/value';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ChatLinkStorageOptions = BaseFrontendClassOptions;

export type ChatLinkStorageInterface = BaseFrontendClassInterface & {
  /** Gets the active ChatLink for a given game chat, or undefined. */
  getActiveLink(options: { targetChatId: string }): Promise<ChatLink | undefined>;

  /** Creates a new ChatLink between an OOC source chat and a game target chat. */
  createLink(options: { sourceChatId: string; targetChatId: string }): Promise<ChatLink>;

  /** Soft-deactivates a ChatLink (preserves notes/influences for re-link). */
  unlink(options: { linkId: string }): Promise<void>;

  /** Adds a durable note to an active ChatLink. */
  addNote(options: { linkId: string; note: string }): Promise<void>;

  /** Removes a durable note from an active ChatLink by index. */
  removeNote(options: { linkId: string; index: number }): Promise<void>;

  /** Adds a pending influence to an active ChatLink. */
  addInfluence(options: { linkId: string; influence: string }): Promise<void>;

  /** Removes a pending influence from an active ChatLink by index. */
  removeInfluence(options: { linkId: string; index: number }): Promise<void>;

  /** Consumes all pending influences (sets the array to empty). */
  consumeInfluences(options: { linkId: string }): Promise<void>;

  /** Deletes a ChatLink document. */
  deleteLink(options: { linkId: string }): Promise<void>;
};

// ---------------------------------------------------------------------------
// Row shape
// ---------------------------------------------------------------------------

type ChatLinkRow = {
  link_id: string;
  target_chat_id: string;
  data: string;
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class ChatLinkStorage
  extends BaseFrontendClass<ChatLinkStorageOptions>
  implements ChatLinkStorageInterface
{
  /** @inheritdoc */
  async getActiveLink(options: { targetChatId: string }): Promise<ChatLink | undefined> {
    const db = await getLocalDatabase();
    const result = await db.query({
      sql: 'SELECT * FROM chat_links WHERE target_chat_id = ? ORDER BY created_at DESC LIMIT 1',
      args: [options.targetChatId],
    });
    if (result.rows.length === 0) {
      return undefined;
    }

    const link = this._parseLink(result.rows[0] as unknown as ChatLinkRow); // guard-ignore lint/type-safety/casting: DB row parsing - Turso query returns unknown rows, schema validated at insert time
    if (!link?.isActive) {
      return undefined;
    }
    return link;
  }

  /** @inheritdoc */
  async createLink(options: { sourceChatId: string; targetChatId: string }): Promise<ChatLink> {
    const now = Date.now();
    const link: ChatLink = {
      linkId: crypto.randomUUID(),
      sourceChatId: options.sourceChatId,
      targetChatId: options.targetChatId,
      notes: [],
      pendingInfluences: [],
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };

    const db = await getLocalDatabase();
    await db.execute({
      sql: 'INSERT INTO chat_links (link_id, target_chat_id, data) VALUES (?, ?, ?)',
      args: [link.linkId, link.targetChatId, JSON.stringify(link)],
    });

    this.debug('createLink:created', { linkId: link.linkId });
    return link;
  }

  /** @inheritdoc */
  async unlink(options: { linkId: string }): Promise<void> {
    const link = await this._getLink(options.linkId);
    if (!link) {
      return;
    }
    const updated = { ...link, isActive: false, updatedAt: Date.now() };
    await this._updateLink(updated);
    this.debug('unlink:deactivated', { linkId: options.linkId });
  }

  /** @inheritdoc */
  async addNote(options: { linkId: string; note: string }): Promise<void> {
    const link = await this._getLink(options.linkId);
    if (!link) {
      return;
    }
    const updated = { ...link, notes: [...link.notes, options.note], updatedAt: Date.now() };
    await this._updateLink(updated);
    this.debug('addNote:added', { linkId: options.linkId });
  }

  /** @inheritdoc */
  async removeNote(options: { linkId: string; index: number }): Promise<void> {
    const link = await this._getLink(options.linkId);
    if (!link) {
      return;
    }
    const updated = {
      ...link,
      notes: link.notes.filter((_, i) => i !== options.index),
      updatedAt: Date.now(),
    };
    await this._updateLink(updated);
    this.debug('removeNote:removed', { linkId: options.linkId, index: options.index });
  }

  /** @inheritdoc */
  async addInfluence(options: { linkId: string; influence: string }): Promise<void> {
    const link = await this._getLink(options.linkId);
    if (!link) {
      return;
    }
    const updated = {
      ...link,
      pendingInfluences: [...link.pendingInfluences, options.influence],
      updatedAt: Date.now(),
    };
    await this._updateLink(updated);
    this.debug('addInfluence:added', { linkId: options.linkId });
  }

  /** @inheritdoc */
  async removeInfluence(options: { linkId: string; index: number }): Promise<void> {
    const link = await this._getLink(options.linkId);
    if (!link) {
      return;
    }
    const updated = {
      ...link,
      pendingInfluences: link.pendingInfluences.filter((_, i) => i !== options.index),
      updatedAt: Date.now(),
    };
    await this._updateLink(updated);
    this.debug('removeInfluence:removed', { linkId: options.linkId, index: options.index });
  }

  /** @inheritdoc */
  async consumeInfluences(options: { linkId: string }): Promise<void> {
    const link = await this._getLink(options.linkId);
    if (!link) {
      return;
    }
    if (link.pendingInfluences.length === 0) {
      return;
    }
    const updated = { ...link, pendingInfluences: [], updatedAt: Date.now() };
    await this._updateLink(updated);
    this.debug('consumeInfluences:consumed', { linkId: options.linkId });
  }

  /** @inheritdoc */
  async deleteLink(options: { linkId: string }): Promise<void> {
    const db = await getLocalDatabase();
    await db.execute({
      sql: 'DELETE FROM chat_links WHERE link_id = ?',
      args: [options.linkId],
    });
    this.debug('deleteLink:deleted', { linkId: options.linkId });
  }

  // ── Private helpers ────────────────────────────────────────────────

  private async _getLink(linkId: string): Promise<ChatLink | undefined> {
    const db = await getLocalDatabase();
    const result = await db.query({
      sql: 'SELECT * FROM chat_links WHERE link_id = ?',
      args: [linkId],
    });
    if (result.rows.length === 0) {
      return undefined;
    }
    return this._parseLink(result.rows[0] as unknown as ChatLinkRow); // guard-ignore lint/type-safety/casting: DB row parsing - Turso query returns unknown rows, schema validated at insert time
  }

  private async _updateLink(link: ChatLink): Promise<void> {
    const db = await getLocalDatabase();
    await db.execute({
      sql: "UPDATE chat_links SET data = ?, updated_at = datetime('now') WHERE link_id = ?",
      args: [JSON.stringify(link), link.linkId],
    });
  }

  private _parseLink(row: ChatLinkRow): ChatLink | undefined {
    try {
      const parsed = JSON.parse(row.data) as unknown;
      if (!Value.Check(ChatLinkSchema, parsed)) {
        this.warn('_parseLink:schema-validation-failed', { linkId: row.link_id });
        return undefined;
      }
      return parsed as ChatLink;
    } catch {
      return undefined;
    }
  }
}

/** Shared singleton instance. */
export const chatLinkStorage: ChatLinkStorageInterface = ChatLinkStorage.create({
  className: 'ChatLinkStorage',
});
