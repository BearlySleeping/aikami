// apps/frontend/client/src/lib/services/chat/chat_storage.test.ts
//
// Unit tests for the local SQLite chat repository (C-386a AC-1/AC-3).
// Verifies chat turns are written to and read from the local `chat_history`
// table plus the `chats` metadata table — no Firestore in the path.

// biome-ignore-all lint/style/noNonNullAssertion: regex capture parsing in the in-memory fake DB

import { beforeEach, describe, expect, mock, test } from 'bun:test';

// ── In-memory fake LocalDatabaseInterface ─────────────────────────────
// Supports the SQL shapes used by chat_storage: multi-column WHERE,
// INSERT OR IGNORE, UPDATE with datetime('now'), DELETE, transactions.

type Row = Record<string, unknown>;
const tables = new Map<string, Row[]>();

const table = (name: string): Row[] => {
  if (!tables.has(name)) {
    tables.set(name, []);
  }
  return tables.get(name)!;
};

const _where = (row: Row, cols: string[], args: readonly unknown[]): boolean =>
  cols.every((c, i) => row[c] === args[i]);

const fakeDb = {
  async query(options: { sql: string; args: readonly unknown[] }) {
    const sql = options.sql.trim();
    const fromMatch = sql.match(/FROM\s+(\w+)/i);
    if (!fromMatch) {
      return { rows: [] };
    }
    const tableName = fromMatch[1]!.toLowerCase();
    const rows = table(tableName);

    // Extract WHERE column list: `WHERE col1 = ? AND col2 = ?` or single.
    const whereMatch = sql.match(/WHERE\s+(.+?)(?:\s+ORDER BY|\s*$)/i);
    let filtered = rows;
    if (whereMatch) {
      const whereClause = whereMatch[1]!;
      const cols = [...whereClause.matchAll(/(\w+)\s*=\s*\?/g)].map((m) => m[1]!.toLowerCase());
      if (cols.length > 0) {
        filtered = rows.filter((r) => _where(r, cols, options.args));
      }
    }

    const orderMatch = sql.match(/ORDER BY\s+(\w+)\s*(ASC|DESC)?/i);
    if (orderMatch) {
      const col = orderMatch[1]!.toLowerCase();
      const dir = orderMatch[2]?.toUpperCase();
      filtered = [...filtered].sort((a, b) => {
        const av = String(a[col] ?? '');
        const bv = String(b[col] ?? '');
        return dir === 'DESC' ? bv.localeCompare(av) : av.localeCompare(bv);
      });
    }

    const limitMatch = sql.match(/LIMIT\s+(\d+)/i);
    if (limitMatch) {
      filtered = filtered.slice(0, Number(limitMatch[1]));
    }
    return { rows: filtered };
  },

  async execute(options: { sql: string; args: readonly unknown[] }) {
    const sql = options.sql.trim();

    const insertMatch = sql.match(
      /INSERT(?:\s+OR\s+(IGNORE|REPLACE))?\s+INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i,
    );
    if (insertMatch) {
      const mode = insertMatch[1]?.toUpperCase() as 'IGNORE' | 'REPLACE' | undefined;
      const name = insertMatch[2]!.toLowerCase();
      const cols = insertMatch[3]!.split(',').map((c) => c.trim().toLowerCase());
      const row: Row = {};
      for (let i = 0; i < cols.length; i++) {
        row[cols[i]] = options.args[i];
      }
      const rows = table(name);
      const keyIdx = cols.indexOf('id');
      if (keyIdx >= 0) {
        const existing = rows.findIndex((r) => r.id === options.args[keyIdx]);
        if (existing >= 0) {
          if (mode === 'IGNORE') {
            return;
          }
          rows[existing] = { ...rows[existing], ...row };
          return;
        }
      }
      rows.push(row);
      return;
    }

    const deleteMatch = sql.match(/^DELETE\s+FROM\s+(\w+)\s+WHERE\s+(.+)$/i);
    if (deleteMatch) {
      const name = deleteMatch[1]!.toLowerCase();
      const whereClause = deleteMatch[2]!;
      const cols = [...whereClause.matchAll(/(\w+)\s*=\s*\?/g)].map((m) => m[1]!.toLowerCase());
      const remaining = table(name).filter((r) => !_where(r, cols, options.args));
      tables.set(name, remaining);
      return;
    }

    const updateMatch = sql.match(/UPDATE\s+(\w+)\s+SET\s+(.+?)\s+WHERE\s+(\w+)\s*=\s*\?/i);
    if (updateMatch) {
      const name = updateMatch[1]!.toLowerCase();
      const whereCol = updateMatch[3]!.toLowerCase();
      const whereVal = options.args[options.args.length - 1];
      const row = table(name).find((r) => r[whereCol] === whereVal);
      if (row) {
        const setPairs = updateMatch[2]!.split(',').map((s) => s.trim());
        let argIdx = 0;
        for (const pair of setPairs) {
          const eqIdx = pair.indexOf('=');
          if (eqIdx >= 0) {
            const key = pair.slice(0, eqIdx).trim().toLowerCase();
            if (!pair.includes("datetime('now')")) {
              row[key] = options.args[argIdx++];
            }
          }
        }
      }
      return;
    }
  },

  async transaction(queries: readonly { sql: string; args: readonly unknown[] }[]) {
    for (const q of queries) {
      await this.execute(q);
    }
  },
  async sync() {},
  async close() {},
};

mock.module('@aikami/frontend/storage', () => ({
  getLocalDatabase: mock(async () => fakeDb),
}));

// ── Service under test ────────────────────────────────────────────────

import type { ChatStorageInterface } from './chat_storage.svelte.ts';
import { chatStorage } from './chat_storage.svelte.ts';

describe('ChatStorage (local SQLite)', () => {
  let storage: ChatStorageInterface;

  beforeEach(() => {
    tables.clear();
    storage = chatStorage;
  });

  test('getOrCreateChat creates a chat and getChat reads it back', async () => {
    const created = await storage.getOrCreateChat({
      uid: 'user-1',
      npcId: 'npc-1',
      npcName: 'Gandalf',
    });

    expect(created.id).toBeTruthy();
    expect(created.npcId).toBe('npc-1');
    expect(created.npcName).toBe('Gandalf');
    expect(created.messages).toEqual([]);

    const found = await storage.getChat({ uid: 'user-1', npcId: 'npc-1' });
    expect(found?.id).toBe(created.id);
  });

  test('getOrCreateChat returns existing chat on second call', async () => {
    const first = await storage.getOrCreateChat({
      uid: 'user-1',
      npcId: 'npc-1',
      npcName: 'Gandalf',
    });
    const second = await storage.getOrCreateChat({
      uid: 'user-1',
      npcId: 'npc-1',
      npcName: 'Gandalf',
    });
    expect(second.id).toBe(first.id);
  });

  test('addMessage writes a turn to chat_history and getMessages reads it back', async () => {
    const chat = await storage.getOrCreateChat({
      uid: 'user-1',
      npcId: 'npc-1',
      npcName: 'Gandalf',
    });

    await storage.addMessage({
      chatId: chat.id,
      uid: 'user-1',
      npcId: 'npc-1',
      message: 'Hello there',
      sender: 'user',
    });
    await storage.addMessage({
      chatId: chat.id,
      uid: 'user-1',
      npcId: 'npc-1',
      message: 'A wizard is never late.',
      sender: 'ai',
    });

    const messages = await storage.getMessages({ uid: 'user-1', npcId: 'npc-1' });
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ text: 'Hello there', sender: 'user' });
    expect(messages[1]).toMatchObject({ text: 'A wizard is never late.', sender: 'ai' });

    // The underlying table is chat_history — no dual store.
    expect(table('chat_history').length).toBe(2);
    expect(table('chats').length).toBe(1);
  });

  test('getChatById returns chat with messages and metadata', async () => {
    const chat = await storage.getOrCreateChat({
      uid: 'user-1',
      npcId: 'npc-1',
      npcName: 'Gandalf',
    });
    await storage.addMessage({
      chatId: chat.id,
      uid: 'user-1',
      npcId: 'npc-1',
      message: 'You shall not pass!',
      sender: 'ai',
    });

    const found = await storage.getChatById({ chatId: chat.id });
    expect(found?.id).toBe(chat.id);
    expect(found?.npcName).toBe('Gandalf');
    expect(found?.messages).toHaveLength(1);
  });

  test('getChatById returns undefined for missing chat', async () => {
    const found = await storage.getChatById({ chatId: 'missing' });
    expect(found).toBeUndefined();
  });

  test('updateChat updates affection and backgroundImageUrl', async () => {
    const chat = await storage.getOrCreateChat({
      uid: 'user-1',
      npcId: 'npc-1',
      npcName: 'Gandalf',
    });

    await storage.updateChat({
      chatId: chat.id,
      affection: 7,
      backgroundImageUrl: 'http://img/foo.png',
    });

    const found = await storage.getChatById({ chatId: chat.id });
    expect(found?.affection).toBe(7);
    expect(found?.backgroundImageUrl).toBe('http://img/foo.png');
  });

  test('updateChat rewrites the message set', async () => {
    const chat = await storage.getOrCreateChat({
      uid: 'user-1',
      npcId: 'npc-1',
      npcName: 'Gandalf',
    });
    await storage.addMessage({
      chatId: chat.id,
      uid: 'user-1',
      npcId: 'npc-1',
      message: 'old',
      sender: 'user',
    });

    await storage.updateChat({
      chatId: chat.id,
      messages: [
        {
          id: 'm1',
          text: 'edited',
          sender: 'user',
          createdAt: new Date(),
          attachments: [],
          metadata: {},
        },
        {
          id: 'm2',
          text: 'reply',
          sender: 'ai',
          createdAt: new Date(),
          attachments: [],
          metadata: {},
        },
      ],
    });

    const found = await storage.getChatById({ chatId: chat.id });
    expect(found?.messages).toHaveLength(2);
    expect(table('chat_history').length).toBe(2);
  });

  test('deleteChatById removes metadata and history rows', async () => {
    const chat = await storage.getOrCreateChat({
      uid: 'user-1',
      npcId: 'npc-1',
      npcName: 'Gandalf',
    });
    await storage.addMessage({
      chatId: chat.id,
      uid: 'user-1',
      npcId: 'npc-1',
      message: 'bye',
      sender: 'user',
    });

    await storage.deleteChatById({ chatId: chat.id });

    expect(table('chats').length).toBe(0);
    expect(table('chat_history').length).toBe(0);
    expect(await storage.getChatById({ chatId: chat.id })).toBeUndefined();
  });

  test('deleteChat deletes by npc+uid pair', async () => {
    const chat = await storage.getOrCreateChat({
      uid: 'user-1',
      npcId: 'npc-1',
      npcName: 'Gandalf',
    });
    await storage.deleteChat({ uid: 'user-1', npcId: 'npc-1' });
    expect(table('chats').length).toBe(0);
    expect(chat.id).toBeTruthy();
  });

  test('listChats returns all chats sorted by updated_at desc', async () => {
    await storage.getOrCreateChat({ uid: 'u1', npcId: 'n1', npcName: 'One' });
    await storage.getOrCreateChat({ uid: 'u1', npcId: 'n2', npcName: 'Two' });
    const chats = await storage.listChats();
    expect(chats).toHaveLength(2);
  });
});
