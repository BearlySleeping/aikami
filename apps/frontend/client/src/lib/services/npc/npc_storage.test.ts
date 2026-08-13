// apps/frontend/client/src/lib/services/npc/npc_storage.test.ts
//
// Unit tests for the local NPC repository (C-386b AC-5).
// Verifies NPCs resolve fully from the local table — no Firestore calls.

// biome-ignore-all lint/style/noNonNullAssertion: regex capture parsing in the in-memory fake DB

import { beforeEach, describe, expect, mock, test } from 'bun:test';

// ── In-memory fake LocalDatabaseInterface (npcs-table capable) ──

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

import type { NpcStorageInterface } from './npc_storage.svelte.ts';
import { npcStorage } from './npc_storage.svelte.ts';

describe('NpcStorage (local SQLite)', () => {
  let storage: NpcStorageInterface;

  beforeEach(() => {
    tables.clear();
    storage = npcStorage;
  });

  test('createNpc then get returns it', async () => {
    const id = await storage.createNpc({
      uid: 'user-1',
      data: { name: 'Gandalf', race: 'Maiar', visibility: 'private' },
    });
    const npc = await storage.get({ npcId: id });
    expect(npc?.name).toBe('Gandalf');
    expect(npc?.race).toBe('Maiar');
    expect(npc?.visibility).toBe('private');
  });

  test('getSystemNpcs returns all NPCs', async () => {
    await storage.createNpc({ uid: 'u1', data: { name: 'One' } });
    await storage.createNpc({ uid: 'u1', data: { name: 'Two' } });
    const npcs = await storage.getSystemNpcs();
    expect(npcs).toHaveLength(2);
  });

  test('getUserNpcs is per-install (uid is API parity)', async () => {
    await storage.createNpc({ uid: 'u1', data: { name: 'One' } });
    const npcs = await storage.getUserNpcs({ uid: 'different-user' });
    expect(npcs).toHaveLength(1);
  });

  test('getPublicNpcs filters by visibility', async () => {
    await storage.createNpc({ uid: 'u1', data: { name: 'Public', visibility: 'public' } });
    await storage.createNpc({ uid: 'u1', data: { name: 'Private', visibility: 'private' } });
    const npcs = await storage.getPublicNpcs();
    expect(npcs).toHaveLength(1);
    expect(npcs[0]?.name).toBe('Public');
  });

  test('get returns undefined for missing NPC', async () => {
    expect(await storage.get({ npcId: 'missing' })).toBeUndefined();
  });

  test('updateNpc merges fields', async () => {
    const id = await storage.createNpc({ uid: 'u1', data: { name: 'Gandalf' } });
    await storage.updateNpc({ npcId: id, data: { name: 'Gandalf the Grey' } });
    const npc = await storage.get({ npcId: id });
    expect(npc?.name).toBe('Gandalf the Grey');
  });

  test('deleteNpc removes the row', async () => {
    const id = await storage.createNpc({ uid: 'u1', data: { name: 'Gandalf' } });
    await storage.deleteNpc({ npcId: id });
    expect(await storage.get({ npcId: id })).toBeUndefined();
  });

  test('forkNpc copies the source NPC', async () => {
    const id = await storage.createNpc({
      uid: 'u1',
      data: { name: 'Gandalf', race: 'Maiar', visibility: 'public' },
    });
    const forkId = await storage.forkNpc({ systemNpcId: id, uid: 'u2' });
    expect(forkId).not.toBe(id);
    const fork = await storage.get({ npcId: forkId });
    expect(fork?.name).toBe('Gandalf');
    expect(fork?.race).toBe('Maiar');
    expect(fork?.forkedFromNpcId).toBe(id);
  });

  test('forkNpc throws for missing source', async () => {
    expect(storage.forkNpc({ systemNpcId: 'missing', uid: 'u2' })).rejects.toThrow();
  });
});
