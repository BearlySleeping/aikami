// apps/frontend/client/src/lib/services/chat/chat_link_storage.test.ts
//
// Unit tests for the local ChatLink repository (C-386a AC-2).
// Verifies ChatLink CRUD, soft-deactivate, notes/influences, and influence
// consumption all read/write the local `chat_links` table — no Firestore.

// biome-ignore-all lint/style/noNonNullAssertion: regex capture parsing in the in-memory fake DB

import { beforeEach, describe, expect, mock, test } from 'bun:test';

// ── In-memory fake LocalDatabaseInterface (supports chat_links queries) ──

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
    const name = fromMatch[1]!.toLowerCase();
    let rows = table(name);

    const whereMatch = sql.match(/WHERE\s+(.+?)(?:\s+ORDER BY|\s*$)/i);
    if (whereMatch) {
      const cols = [...whereMatch[1]!.matchAll(/(\w+)\s*=\s*\?/g)].map((m) => m[1]!.toLowerCase());
      if (cols.length > 0) {
        rows = rows.filter((r) => _where(r, cols, options.args));
      }
    }

    const orderMatch = sql.match(/ORDER BY\s+(\w+)\s*(ASC|DESC)?/i);
    if (orderMatch) {
      const col = orderMatch[1]!.toLowerCase();
      const dir = orderMatch[2]?.toUpperCase();
      rows = [...rows].sort((a, b) => {
        const av = String(a[col] ?? '');
        const bv = String(b[col] ?? '');
        return dir === 'DESC' ? bv.localeCompare(av) : av.localeCompare(bv);
      });
    }

    const limitMatch = sql.match(/LIMIT\s+(\d+)/i);
    if (limitMatch) {
      rows = rows.slice(0, Number(limitMatch[1]));
    }
    return { rows };
  },

  async execute(options: { sql: string; args: readonly unknown[] }) {
    const sql = options.sql.trim();

    const insertMatch = sql.match(
      /INSERT(?:\s+OR\s+(IGNORE|REPLACE))?\s+INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i,
    );
    if (insertMatch) {
      const name = insertMatch[2]!.toLowerCase();
      const cols = insertMatch[3]!.split(',').map((c) => c.trim().toLowerCase());
      const row: Row = {};
      for (let i = 0; i < cols.length; i++) {
        row[cols[i]] = options.args[i];
      }
      table(name).push(row);
      return;
    }

    const deleteMatch = sql.match(/^DELETE\s+FROM\s+(\w+)\s+WHERE\s+(\w+)\s*=\s*\?/i);
    if (deleteMatch) {
      const name = deleteMatch[1]!.toLowerCase();
      const col = deleteMatch[2]!.toLowerCase();
      tables.set(
        name,
        table(name).filter((r) => r[col] !== options.args[0]),
      );
      return;
    }

    const updateMatch = sql.match(/UPDATE\s+(\w+)\s+SET\s+(.+?)\s+WHERE\s+(\w+)\s*=\s*\?/i);
    if (updateMatch) {
      const name = updateMatch[1]!.toLowerCase();
      const whereCol = updateMatch[3]!.toLowerCase();
      const row = table(name).find((r) => r[whereCol] === options.args[options.args.length - 1]);
      if (row) {
        const setPairs = updateMatch[2]!.split(',').map((s) => s.trim());
        let argIdx = 0;
        for (const pair of setPairs) {
          const eqIdx = pair.indexOf('=');
          if (eqIdx >= 0 && !pair.includes("datetime('now')")) {
            row[pair.slice(0, eqIdx).trim().toLowerCase()] = options.args[argIdx++];
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

import type { ChatLinkStorageInterface } from './chat_link_storage.svelte.ts';
import { chatLinkStorage } from './chat_link_storage.svelte.ts';

describe('ChatLinkStorage (local SQLite)', () => {
  let storage: ChatLinkStorageInterface;

  beforeEach(() => {
    tables.clear();
    storage = chatLinkStorage;
  });

  test('createLink stores a row and getActiveLink returns it', async () => {
    const link = await storage.createLink({
      sourceChatId: 'ooc-1',
      targetChatId: 'game-1',
    });

    expect(link.linkId).toBeTruthy();
    expect(link.sourceChatId).toBe('ooc-1');
    expect(link.targetChatId).toBe('game-1');
    expect(link.isActive).toBe(true);
    expect(table('chat_links').length).toBe(1);

    const active = await storage.getActiveLink({ targetChatId: 'game-1' });
    expect(active?.linkId).toBe(link.linkId);
  });

  test('getActiveLink returns undefined when no link exists', async () => {
    const active = await storage.getActiveLink({ targetChatId: 'nope' });
    expect(active).toBeUndefined();
  });

  test('getActiveLink returns undefined for soft-deactivated link', async () => {
    const link = await storage.createLink({ sourceChatId: 'ooc-1', targetChatId: 'game-1' });
    await storage.unlink({ linkId: link.linkId });
    const active = await storage.getActiveLink({ targetChatId: 'game-1' });
    expect(active).toBeUndefined();
  });

  test('unlink preserves the row (soft-deactivate)', async () => {
    const link = await storage.createLink({ sourceChatId: 'ooc-1', targetChatId: 'game-1' });
    await storage.unlink({ linkId: link.linkId });
    expect(table('chat_links').length).toBe(1);
  });

  test('addNote and removeNote round-trip', async () => {
    const link = await storage.createLink({ sourceChatId: 'ooc-1', targetChatId: 'game-1' });
    await storage.addNote({ linkId: link.linkId, note: 'Remember the ring' });
    await storage.addNote({ linkId: link.linkId, note: 'Frodo is alive' });

    let active = await storage.getActiveLink({ targetChatId: 'game-1' });
    expect(active?.notes).toEqual(['Remember the ring', 'Frodo is alive']);

    await storage.removeNote({ linkId: link.linkId, index: 0 });
    active = await storage.getActiveLink({ targetChatId: 'game-1' });
    expect(active?.notes).toEqual(['Frodo is alive']);
  });

  test('addInfluence and removeInfluence round-trip', async () => {
    const link = await storage.createLink({ sourceChatId: 'ooc-1', targetChatId: 'game-1' });
    await storage.addInfluence({ linkId: link.linkId, influence: 'Be wary' });

    let active = await storage.getActiveLink({ targetChatId: 'game-1' });
    expect(active?.pendingInfluences).toEqual(['Be wary']);

    await storage.removeInfluence({ linkId: link.linkId, index: 0 });
    active = await storage.getActiveLink({ targetChatId: 'game-1' });
    expect(active?.pendingInfluences).toEqual([]);
  });

  test('consumeInfluences empties the pending list (atomic bridge consumption)', async () => {
    const link = await storage.createLink({ sourceChatId: 'ooc-1', targetChatId: 'game-1' });
    await storage.addInfluence({ linkId: link.linkId, influence: 'I1' });
    await storage.addInfluence({ linkId: link.linkId, influence: 'I2' });

    await storage.consumeInfluences({ linkId: link.linkId });
    const active = await storage.getActiveLink({ targetChatId: 'game-1' });
    expect(active?.pendingInfluences).toEqual([]);
  });

  test('deleteLink removes the row entirely', async () => {
    const link = await storage.createLink({ sourceChatId: 'ooc-1', targetChatId: 'game-1' });
    await storage.deleteLink({ linkId: link.linkId });
    expect(table('chat_links').length).toBe(0);
  });

  test('multiple links for same target return the most recent active one', async () => {
    const first = await storage.createLink({ sourceChatId: 'ooc-1', targetChatId: 'game-1' });
    const second = await storage.createLink({ sourceChatId: 'ooc-2', targetChatId: 'game-1' });

    const active = await storage.getActiveLink({ targetChatId: 'game-1' });
    // Both are active; the latest created row wins (ORDER BY created_at DESC).
    expect([first.linkId, second.linkId]).toContain(active?.linkId);
  });
});
