// apps/frontend/client/src/lib/services/agent/agent_registry_storage.test.ts
//
// Unit tests for the local custom-agent repository (C-386b AC-6).
// Verifies every AgentRegistryServiceInterface operation completes against
// the local `custom_agents` table only.

// biome-ignore-all lint/style/noNonNullAssertion: regex capture parsing in the in-memory fake DB

import { beforeEach, describe, expect, mock, test } from 'bun:test';

// ── In-memory fake LocalDatabaseInterface (custom_agents capable) ──

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

import type { CustomAgentDefinition } from '$types';
import type { AgentRegistryStorageInterface } from './agent_registry_storage.svelte.ts';
import { agentRegistryStorage } from './agent_registry_storage.svelte.ts';

const makeAgent = (id: string, name: string, folder?: string): CustomAgentDefinition =>
  ({
    formatVersion: '1.0.0',
    type: 'agent_definition',
    id,
    name,
    folder,
    phase: 'post',
    promptTemplate: 'template',
    outputSchema: {},
    resultType: 'custom',
    timeout: 15_000,
    enabled: true,
    isBuiltIn: false,
    uid: 'user-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }) as CustomAgentDefinition;

describe('AgentRegistryStorage (local SQLite)', () => {
  let storage: AgentRegistryStorageInterface;

  beforeEach(() => {
    tables.clear();
    storage = agentRegistryStorage;
  });

  test('createAgent then getAgent returns it', async () => {
    await storage.createAgent(makeAgent('a1', 'Scholar'));
    const agent = await storage.getAgent({ id: 'a1' });
    expect(agent?.name).toBe('Scholar');
    expect(table('custom_agents').length).toBe(1);
  });

  test('getAgent returns undefined for missing agent', async () => {
    expect(await storage.getAgent({ id: 'missing' })).toBeUndefined();
  });

  test('updateAgent merges fields', async () => {
    await storage.createAgent(makeAgent('a1', 'Scholar'));
    await storage.updateAgent({ ...makeAgent('a1', 'Scholar Master'), description: 'desc' });
    const agent = await storage.getAgent({ id: 'a1' });
    expect(agent?.name).toBe('Scholar Master');
    expect(agent?.description).toBe('desc');
  });

  test('deleteAgent removes the row', async () => {
    await storage.createAgent(makeAgent('a1', 'Scholar'));
    await storage.deleteAgent({ id: 'a1' });
    expect(await storage.getAgent({ id: 'a1' })).toBeUndefined();
    expect(table('custom_agents').length).toBe(0);
  });

  test('listAgents returns all agents', async () => {
    await storage.createAgent(makeAgent('a1', 'One'));
    await storage.createAgent(makeAgent('a2', 'Two'));
    const agents = await storage.listAgents();
    expect(agents).toHaveLength(2);
  });

  test('listAgents filters by folder', async () => {
    await storage.createAgent(makeAgent('a1', 'One', 'combat'));
    await storage.createAgent(makeAgent('a2', 'Two', 'rp'));
    await storage.createAgent(makeAgent('a3', 'Three'));

    const combat = await storage.listAgents({ folder: 'combat' });
    expect(combat).toHaveLength(1);
    expect(combat[0]?.id).toBe('a1');

    const none = await storage.listAgents({ folder: 'nonexistent' });
    expect(none).toHaveLength(0);
  });
});
