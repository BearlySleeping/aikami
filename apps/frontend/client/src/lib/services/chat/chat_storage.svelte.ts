// apps/frontend/client/src/lib/services/chat/chat_storage.svelte.ts
//
// Local SQLite-backed chat repository. Replaces the Firestore chat document
// with plain typed queries against the local `chats`
// metadata table plus the existing `chat_history` turn table. Messages are
// stored once, in `chat_history`; `chats` only holds the per-chat metadata
// that Firestore used to own (npcId, npcName, affection, stats, background).
//
// Contract: C-386a — Firestore Removal, chat local-first.
// biome-ignore-all lint/style/useNamingConvention: SQL column names are snake_case

import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import { getLocalDatabase } from '@aikami/frontend/storage';
import type { ChatData, MessageData } from '@aikami/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ChatStorageOptions = BaseFrontendClassOptions;

export type ChatStorageInterface = BaseFrontendClassInterface & {
  /** Gets the chat document for a specific NPC and user. */
  getChat(options: { uid: string; npcId: string }): Promise<ChatData | undefined>;

  /** Gets an existing chat or creates a new one if it doesn't exist. */
  getOrCreateChat(options: {
    uid: string;
    npcId: string;
    npcName: string;
    npcAvatarUrl?: string;
  }): Promise<ChatData>;

  /** Creates or updates a chat document with a new message. */
  addMessage(options: {
    chatId: string;
    uid: string;
    npcId: string;
    message: string;
    sender: 'user' | 'ai';
  }): Promise<void>;

  /** Gets all messages from a chat. */
  getMessages(options: { uid: string; npcId: string }): Promise<MessageData[]>;

  /** Deletes a chat document. */
  deleteChat(options: { uid: string; npcId: string }): Promise<void>;

  /** Deletes a chat document by its ID. */
  deleteChatById(options: { chatId: string }): Promise<void>;

  /** Gets a chat by ID. */
  getChatById(options: { chatId: string }): Promise<
    | {
        id: string;
        npcId: string;
        npcName: string;
        npcAvatarUrl?: string;
        affection: number;
        stats?: Record<string, unknown>;
        messages?: unknown[];
      }
    | undefined
  >;

  /** Updates a chat document. */
  updateChat(options: {
    chatId: string;
    messages?: MessageData[];
    affection?: number;
    backgroundImageUrl?: string;
  }): Promise<void>;

  /** Lists all chats for the current user (export path). */
  listChats(): Promise<ChatData[]>;
};

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

type ChatRow = {
  id: string;
  npc_id: string;
  npc_name: string;
  npc_avatar_url: string | null;
  uid: string;
  visibility: string;
  affection: number;
  stats_json: string;
  background_image_url: string | null;
};

type HistoryRow = {
  id: number;
  session_id: string;
  role: string;
  content: string;
  created_at: string;
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class ChatStorage extends BaseFrontendClass<ChatStorageOptions> implements ChatStorageInterface {
  /** @inheritdoc */
  async getChat(options: { uid: string; npcId: string }): Promise<ChatData | undefined> {
    const { uid, npcId } = options;
    const db = await getLocalDatabase();
    const result = await db.query({
      sql: 'SELECT * FROM chats WHERE npc_id = ? AND uid = ? LIMIT 1',
      args: [npcId, uid],
    });
    if (result.rows.length === 0) {
      return undefined;
    }
    return await this._chatFromRow(result.rows[0] as unknown as ChatRow); // guard-ignore lint/type-safety/casting: DB row parsing - Turso query returns unknown rows, schema validated at insert time
  }

  /** @inheritdoc */
  async getOrCreateChat(options: {
    uid: string;
    npcId: string;
    npcName: string;
    npcAvatarUrl?: string;
  }): Promise<ChatData> {
    const { uid, npcId, npcName, npcAvatarUrl } = options;

    const existing = await this.getChat({ uid, npcId });
    if (existing) {
      this.debug('getOrCreateChat:found-existing', { chatId: existing.id });
      return existing;
    }

    const chatId = crypto.randomUUID();
    await this._insertChat({
      chatId,
      uid,
      npcId,
      npcName,
      npcAvatarUrl,
    });
    this.debug('getOrCreateChat:created', { chatId });

    return {
      id: chatId,
      npcId,
      npcName,
      npcAvatarUrl,
      uid,
      visibility: 'private',
      messages: [],
      messageCount: 0,
      affection: 0,
      stats: {},
    };
  }

  /** @inheritdoc */
  async addMessage(options: {
    chatId: string;
    uid: string;
    npcId: string;
    message: string;
    sender: 'user' | 'ai';
  }): Promise<void> {
    const { chatId, uid, npcId, message, sender } = options;
    const db = await getLocalDatabase();

    // Ensure a metadata row exists (e.g. legacy chats created before v2).
    const existing = await this.getChatById({ chatId });
    if (!existing) {
      await this._insertChat({ chatId, uid, npcId, npcName: npcId });
    }

    await db.transaction([
      {
        sql: 'INSERT INTO chat_history (session_id, role, content) VALUES (?, ?, ?)',
        args: [chatId, sender === 'user' ? 'user' : 'assistant', message],
      },
      {
        sql: "UPDATE chats SET updated_at = datetime('now') WHERE id = ?",
        args: [chatId],
      },
    ]);
  }

  /** @inheritdoc */
  async getMessages(options: { uid: string; npcId: string }): Promise<MessageData[]> {
    const chat = await this.getChat(options);
    return chat?.messages ?? [];
  }

  /** @inheritdoc */
  async deleteChat(options: { uid: string; npcId: string }): Promise<void> {
    const chat = await this.getChat(options);
    if (chat?.id) {
      await this.deleteChatById({ chatId: chat.id });
    }
  }

  /** @inheritdoc */
  async deleteChatById(options: { chatId: string }): Promise<void> {
    const { chatId } = options;
    const db = await getLocalDatabase();
    await db.transaction([
      { sql: 'DELETE FROM chat_history WHERE session_id = ?', args: [chatId] },
      { sql: 'DELETE FROM chats WHERE id = ?', args: [chatId] },
    ]);
  }

  /** @inheritdoc */
  async getChatById(options: { chatId: string }): Promise<
    | {
        id: string;
        npcId: string;
        npcName: string;
        npcAvatarUrl?: string;
        affection: number;
        stats?: Record<string, unknown>;
        messages?: unknown[];
      }
    | undefined
  > {
    const { chatId } = options;
    const db = await getLocalDatabase();
    const result = await db.query({
      sql: 'SELECT * FROM chats WHERE id = ?',
      args: [chatId],
    });
    if (result.rows.length === 0) {
      return undefined;
    }
    return await this._chatFromRow(result.rows[0] as unknown as ChatRow); // guard-ignore lint/type-safety/casting: DB row parsing - Turso query returns unknown rows, schema validated at insert time
  }

  /** @inheritdoc */
  async updateChat(options: {
    chatId: string;
    messages?: MessageData[];
    affection?: number;
    backgroundImageUrl?: string;
  }): Promise<void> {
    const { chatId, messages, affection, backgroundImageUrl } = options;
    const db = await getLocalDatabase();

    const queries = [];
    if (messages !== undefined) {
      // Rewrite the full message set in one transaction: delete the session's
      // turns, then re-insert the updated array.
      queries.push({ sql: 'DELETE FROM chat_history WHERE session_id = ?', args: [chatId] });
      for (const message of messages) {
        queries.push({
          sql: 'INSERT INTO chat_history (session_id, role, content) VALUES (?, ?, ?)',
          args: [chatId, message.sender === 'user' ? 'user' : 'assistant', message.text],
        });
      }
    }

    const updates: string[] = [];
    const args: unknown[] = [];
    if (affection !== undefined) {
      updates.push('affection = ?');
      args.push(affection);
    }
    if (backgroundImageUrl !== undefined) {
      updates.push('background_image_url = ?');
      args.push(backgroundImageUrl);
    }
    if (updates.length > 0) {
      args.push(chatId);
      queries.push({
        sql: `UPDATE chats SET ${updates.join(', ')}, updated_at = datetime('now') WHERE id = ?`,
        args,
      });
    }

    if (queries.length > 0) {
      await db.transaction(queries);
    }
  }

  /** @inheritdoc */
  async listChats(): Promise<ChatData[]> {
    const db = await getLocalDatabase();
    const result = await db.query({
      sql: 'SELECT * FROM chats ORDER BY updated_at DESC',
      args: [],
    });
    const chats: ChatData[] = [];
    for (const row of result.rows) {
      const chat = await this._chatFromRow(row as unknown as ChatRow); // guard-ignore lint/type-safety/casting: DB row parsing - Turso query returns unknown rows, schema validated at insert time
      if (chat) {
        chats.push(chat);
      }
    }
    return chats;
  }

  // ── Private helpers ────────────────────────────────────────────────

  private async _insertChat(options: {
    chatId: string;
    uid: string;
    npcId: string;
    npcName: string;
    npcAvatarUrl?: string;
  }): Promise<void> {
    const { chatId, uid, npcId, npcName, npcAvatarUrl } = options;
    const db = await getLocalDatabase();
    await db.execute({
      sql: `INSERT OR IGNORE INTO chats (id, npc_id, npc_name, npc_avatar_url, uid, visibility)
            VALUES (?, ?, ?, ?, ?, 'private')`,
      args: [chatId, npcId, npcName, npcAvatarUrl ?? null, uid],
    });
  }

  private async _chatFromRow(row: ChatRow): Promise<ChatData> {
    const db = await getLocalDatabase();
    const history = await db.query({
      sql: 'SELECT * FROM chat_history WHERE session_id = ? ORDER BY id ASC',
      args: [row.id],
    });

    const messages: MessageData[] = (history.rows as unknown as HistoryRow[]).map((h) => ({ // guard-ignore lint/type-safety/casting: DB row parsing - Turso query returns unknown rows, schema validated at insert time
      id: String(h.id),
      text: h.content,
      sender: h.role === 'user' ? ('user' as const) : ('ai' as const),
      createdAt: new Date(h.created_at),
      attachments: [],
      metadata: {},
    }));

    return {
      id: row.id,
      npcId: row.npc_id,
      npcName: row.npc_name,
      npcAvatarUrl: row.npc_avatar_url ?? undefined,
      uid: row.uid,
      visibility: (row.visibility as 'private' | 'public') ?? 'private',
      messages,
      messageCount: messages.length,
      affection: row.affection,
      stats: this._parseStats(row.stats_json),
      backgroundImageUrl: row.background_image_url ?? undefined,
    };
  }

  private _parseStats(statsJson: string): Record<string, unknown> {
    try {
      const parsed = JSON.parse(statsJson) as unknown;
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
}

/** Shared singleton instance. */
export const chatStorage: ChatStorageInterface = ChatStorage.create({
  className: 'ChatStorage',
});
