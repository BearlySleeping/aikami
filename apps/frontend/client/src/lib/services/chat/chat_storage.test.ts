// apps/frontend/client/src/lib/services/chat/chat_storage.test.ts
//
// Real-adapter contract tests for the local SQLite chat repository (C-386a).
//
// These run `chatStorage` against a real in-memory WASM libSQL database with
// the production migrations applied, instead of a handwritten regex SQL fake.
// That makes duplicate `INSERT OR IGNORE` handling, AUTOINCREMENT ordering and
// transaction rollback observable exactly as they are on the player device —
// the three semantics a regex fake has historically approximated incorrectly.
//
// The global `@aikami/frontend/storage` mock from test_setup.ts is overridden
// here so `getLocalDatabase()` returns the real adapter.

import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { applyMigrations } from '@aikami/frontend/storage/migrations';
import type { LocalDatabaseInterface } from '@aikami/frontend/storage/storage_adapter';
import { WasmStorageAdapter } from '@aikami/frontend/storage/wasm_storage_adapter';

// ── Real in-memory database with production schema ─────────────────────

const realAdapter = new WasmStorageAdapter({ databasePath: ':memory:' });
await realAdapter.open();
await applyMigrations(realAdapter);

/** Mutable handle so individual tests can swap in a fault-injecting adapter. */
let activeDatabase: LocalDatabaseInterface = realAdapter;

mock.module('@aikami/frontend/storage', () => ({
  getLocalDatabase: mock(async () => activeDatabase),
  closeLocalDatabase: mock(async () => {}),
  resetLocalDatabase: mock(() => {}),
}));

const { chatStorage } = await import('./chat_storage.svelte.ts');

const clearChatTables = async (): Promise<void> => {
  await realAdapter.execute({ sql: 'DELETE FROM chat_history', args: [] });
  await realAdapter.execute({ sql: 'DELETE FROM chats', args: [] });
};

const countRows = async (table: 'chats' | 'chat_history'): Promise<number> => {
  const result = await realAdapter.query({ sql: `SELECT COUNT(*) AS n FROM ${table}`, args: [] });
  const row = result.rows[0] as { n?: number } | undefined;
  return Number(row?.n ?? 0);
};

beforeEach(async () => {
  activeDatabase = realAdapter;
  await clearChatTables();
});

afterAll(async () => {
  await realAdapter.close();
});

// ── Tests ──────────────────────────────────────────────────────────────

describe('ChatStorage (real adapter contract)', () => {
  test('getOrCreateChat creates a chat and getChat reads it back', async () => {
    const created = await chatStorage.getOrCreateChat({
      uid: 'user-1',
      npcId: 'npc-1',
      npcName: 'Gandalf',
    });

    expect(created.id).toBeTruthy();
    expect(created.npcId).toBe('npc-1');
    expect(created.npcName).toBe('Gandalf');
    expect(created.messages).toEqual([]);

    const found = await chatStorage.getChat({ uid: 'user-1', npcId: 'npc-1' });
    expect(found?.id).toBe(created.id);
    expect(await countRows('chats')).toBe(1);
  });

  test('getOrCreateChat returns existing chat on second call', async () => {
    const first = await chatStorage.getOrCreateChat({
      uid: 'user-1',
      npcId: 'npc-1',
      npcName: 'Gandalf',
    });
    const second = await chatStorage.getOrCreateChat({
      uid: 'user-1',
      npcId: 'npc-1',
      npcName: 'Gandalf',
    });
    expect(second.id).toBe(first.id);
    expect(await countRows('chats')).toBe(1);
  });

  test('addMessage writes an ordered turn to chat_history', async () => {
    const chat = await chatStorage.getOrCreateChat({
      uid: 'user-1',
      npcId: 'npc-1',
      npcName: 'Gandalf',
    });

    await chatStorage.addMessage({
      chatId: chat.id,
      uid: 'user-1',
      npcId: 'npc-1',
      message: 'Hello there',
      sender: 'user',
    });
    await chatStorage.addMessage({
      chatId: chat.id,
      uid: 'user-1',
      npcId: 'npc-1',
      message: 'A wizard is never late.',
      sender: 'ai',
    });

    const messages = await chatStorage.getMessages({ uid: 'user-1', npcId: 'npc-1' });
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ text: 'Hello there', sender: 'user' });
    expect(messages[1]).toMatchObject({ text: 'A wizard is never late.', sender: 'ai' });

    expect(await countRows('chat_history')).toBe(2);
    expect(await countRows('chats')).toBe(1);
  });

  test('getChatById returns chat with messages and metadata', async () => {
    const chat = await chatStorage.getOrCreateChat({
      uid: 'user-1',
      npcId: 'npc-1',
      npcName: 'Gandalf',
    });
    await chatStorage.addMessage({
      chatId: chat.id,
      uid: 'user-1',
      npcId: 'npc-1',
      message: 'You shall not pass!',
      sender: 'ai',
    });

    const found = await chatStorage.getChatById({ chatId: chat.id });
    expect(found?.id).toBe(chat.id);
    expect(found?.npcName).toBe('Gandalf');
    expect(found?.messages).toHaveLength(1);
  });

  test('getChatById returns undefined for missing chat', async () => {
    expect(await chatStorage.getChatById({ chatId: 'missing' })).toBeUndefined();
  });

  test('updateChat updates affection and backgroundImageUrl', async () => {
    const chat = await chatStorage.getOrCreateChat({
      uid: 'user-1',
      npcId: 'npc-1',
      npcName: 'Gandalf',
    });

    await chatStorage.updateChat({
      chatId: chat.id,
      affection: 7,
      backgroundImageUrl: 'http://img/foo.png',
    });

    const found = await chatStorage.getChatById({ chatId: chat.id });
    expect(found?.affection).toBe(7);
    expect(found?.backgroundImageUrl).toBe('http://img/foo.png');
  });

  test('updateChat rewrites the message set', async () => {
    const chat = await chatStorage.getOrCreateChat({
      uid: 'user-1',
      npcId: 'npc-1',
      npcName: 'Gandalf',
    });
    await chatStorage.addMessage({
      chatId: chat.id,
      uid: 'user-1',
      npcId: 'npc-1',
      message: 'old',
      sender: 'user',
    });

    await chatStorage.updateChat({
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

    const found = await chatStorage.getChatById({ chatId: chat.id });
    expect(found?.messages).toHaveLength(2);
    expect(await countRows('chat_history')).toBe(2);
  });

  test('deleteChatById removes metadata and history rows', async () => {
    const chat = await chatStorage.getOrCreateChat({
      uid: 'user-1',
      npcId: 'npc-1',
      npcName: 'Gandalf',
    });
    await chatStorage.addMessage({
      chatId: chat.id,
      uid: 'user-1',
      npcId: 'npc-1',
      message: 'bye',
      sender: 'user',
    });

    await chatStorage.deleteChatById({ chatId: chat.id });

    expect(await countRows('chats')).toBe(0);
    expect(await countRows('chat_history')).toBe(0);
    expect(await chatStorage.getChatById({ chatId: chat.id })).toBeUndefined();
  });

  test('deleteChat deletes by npc+uid pair', async () => {
    const chat = await chatStorage.getOrCreateChat({
      uid: 'user-1',
      npcId: 'npc-1',
      npcName: 'Gandalf',
    });
    await chatStorage.deleteChat({ uid: 'user-1', npcId: 'npc-1' });
    expect(await countRows('chats')).toBe(0);
    expect(chat.id).toBeTruthy();
  });

  test('listChats returns only chats in the requested account scope', async () => {
    await chatStorage.getOrCreateChat({ uid: 'u1', npcId: 'n1', npcName: 'One' });
    await chatStorage.getOrCreateChat({ uid: 'u1', npcId: 'n2', npcName: 'Two' });
    await chatStorage.getOrCreateChat({ uid: 'u2', npcId: 'n3', npcName: 'Other account' });

    const chats = await chatStorage.listChats('u1');
    expect(chats).toHaveLength(2);
    expect(chats.every((chat) => chat.uid === 'u1')).toBe(true);
  });

  test('a failed transaction rolls back the whole chat turn (no partial write)', async () => {
    const chat = await chatStorage.getOrCreateChat({
      uid: 'user-1',
      npcId: 'npc-1',
      npcName: 'Gandalf',
    });
    await chatStorage.addMessage({
      chatId: chat.id,
      uid: 'user-1',
      npcId: 'npc-1',
      message: 'original',
      sender: 'user',
    });
    const historyBefore = await countRows('chat_history');

    // Fault injection: every transaction runs the repository's real statements
    // and then a statement against a missing table, forcing libSQL to abort
    // and roll back. A no-rollback fake would leave the turn written.
    activeDatabase = new Proxy(realAdapter, {
      get(target, property, receiver) {
        if (property === 'transaction') {
          return async (queries: readonly { sql: string; args: readonly unknown[] }[]) => {
            await target.transaction([
              ...queries,
              { sql: 'INSERT INTO missing_table (id) VALUES (1)', args: [] },
            ]);
          };
        }
        return Reflect.get(target, property, receiver);
      },
    });

    await expect(
      chatStorage.addMessage({
        chatId: chat.id,
        uid: 'user-1',
        npcId: 'npc-1',
        message: 'must not persist',
        sender: 'user',
      }),
    ).rejects.toThrow();

    activeDatabase = realAdapter;
    expect(await countRows('chat_history')).toBe(historyBefore);
    expect(await chatStorage.getMessages({ uid: 'user-1', npcId: 'npc-1' })).toHaveLength(1);
  });
});
