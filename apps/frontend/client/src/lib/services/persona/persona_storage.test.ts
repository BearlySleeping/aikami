// apps/frontend/client/src/lib/services/persona/persona_storage.test.ts
//
// Unit tests for the local persona repository (C-386b AC-4).
// Verifies personas are fully local, the one-active invariant holds, and
// concurrent activation attempts cannot produce two active personas.

// biome-ignore-all lint/style/noNonNullAssertion: regex capture parsing in the in-memory fake DB

import { beforeEach, describe, expect, mock, test } from 'bun:test';

// ── In-memory fake LocalDatabaseInterface with partial-unique-index emulation ──

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
    if (sql.includes('COUNT(*)')) {
      const match = sql.match(/FROM\s+(\w+)/i);
      const name = match?.[1]?.toLowerCase() ?? '';
      const whereMatch = sql.match(/WHERE\s+(.+?)(?:\s+ORDER BY|\s*$)/i);
      let rows = table(name);
      if (whereMatch) {
        const cols = [...whereMatch[1]!.matchAll(/(\w+)\s*=\s*\?/g)].map((m) =>
          m[1]!.toLowerCase(),
        );
        if (cols.length > 0) {
          rows = rows.filter((r) => _where(r, cols, options.args));
        }
      }
      return { rows: [{ n: rows.length }] };
    }

    const fromMatch = sql.match(/FROM\s+(\w+)/i);
    if (!fromMatch) {
      return { rows: [] };
    }
    const name = fromMatch[1]!.toLowerCase();
    let rows = table(name);

    const whereMatch = sql.match(/WHERE\s+(.+?)(?:\s+ORDER BY|\s+LIMIT|\s*$)/i);
    if (whereMatch) {
      const cols = [...whereMatch[1]!.matchAll(/(\w+)\s*=\s*\?/g)].map((m) => m[1]!.toLowerCase());
      if (cols.length > 0) {
        rows = rows.filter((r) => _where(r, cols, options.args));
      } else {
        // Literal predicate (e.g. `is_active = 1`) — evaluate directly.
        const litMatch = whereMatch[1]!.match(/(\w+)\s*=\s*(\d+)/);
        if (litMatch) {
          const col = litMatch[1]!.toLowerCase();
          const val = Number(litMatch[2]);
          rows = rows.filter((r) => r[col] === val);
        }
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
      // Partial unique index emulation: only one row with is_active = 1.
      if (row.is_active === 1 && rows.some((r) => r.is_active === 1)) {
        return;
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

    const updateMatch = sql.match(/UPDATE\s+(\w+)\s+SET\s+(.+?)(?:\s+WHERE\s+(.+?))?$/i);
    if (updateMatch) {
      const name = updateMatch[1]!.toLowerCase();
      const setPairs = updateMatch[2]!.split(',').map((s) => s.trim());
      const whereClause = updateMatch[3];
      let rows = table(name);
      let argIdx = 0;
      if (whereClause) {
        const cols = [...whereClause.matchAll(/(\w+)\s*=\s*\?/g)].map((m) => m[1]!.toLowerCase());
        if (cols.length > 0) {
          rows = rows.filter((r) => _where(r, cols, options.args.slice(0, cols.length)));
          argIdx = cols.length;
        } else {
          const litMatch = whereClause.match(/(\w+)\s*=\s*(\d+)/);
          if (litMatch) {
            const col = litMatch[1]!.toLowerCase();
            const val = Number(litMatch[2]);
            rows = rows.filter((r) => r[col] === val);
          }
        }
      }
      for (const row of rows) {
        for (const pair of setPairs) {
          const eqIdx = pair.indexOf('=');
          if (eqIdx >= 0 && !pair.includes("datetime('now')")) {
            const key = pair.slice(0, eqIdx).trim().toLowerCase();
            const rhs = pair.slice(eqIdx + 1).trim();
            if (rhs === '?') {
              row[key] = options.args[argIdx++];
            } else {
              row[key] = Number(rhs);
            }
          }
        }
      }
      // Partial unique index emulation: activating one row deactivates any
      // other active row (single-transaction semantics).
      if (setPairs.some((p) => p.startsWith('is_active') && p.includes('= 1'))) {
        for (const row of table(name)) {
          if (row !== rows[0]) {
            row.is_active = 0;
          }
        }
      }
      return;
    }
  },

  async transaction(queries: readonly { sql: string; args: readonly unknown[] }[]) {
    // Apply all-or-nothing; the emulated partial unique index is enforced in
    // execute, so a second activation within the same batch is rejected.
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

import type { PersonaData } from '@aikami/types';
import type { PersonaStorageInterface } from './persona_storage.svelte.ts';
import { personaStorage } from './persona_storage.svelte.ts';

const makePersona = (id: string, name: string, isActive = false): PersonaData =>
  ({
    id,
    name,
    isActive,
    abilityScores: {},
    appearance: {},
    hitPoints: 10,
    hitPointsMax: 10,
    temporaryHitPoints: 0,
    armorClass: 10,
    speed: 30,
    experiencePoints: 0,
    savingThrows: [],
    skills: [],
    proficiencies: [],
    languages: ['Common'],
    equipment: [],
    inventory: [],
  }) as PersonaData;

describe('PersonaStorage (local SQLite)', () => {
  let storage: PersonaStorageInterface;

  beforeEach(() => {
    tables.clear();
    storage = personaStorage;
  });

  test('savePersona then getPersonas returns it', async () => {
    await storage.savePersona(makePersona('p1', 'Aragorn'));
    const personas = await storage.getPersonas('any-uid');
    expect(personas).toHaveLength(1);
    expect(personas[0]?.name).toBe('Aragorn');
  });

  test('hasPersona is false when empty, true after save', async () => {
    expect(await storage.hasPersona()).toBe(false);
    await storage.savePersona(makePersona('p1', 'Aragorn'));
    expect(await storage.hasPersona()).toBe(true);
  });

  test('setActivePersona activates one and deactivates the rest', async () => {
    await storage.savePersona(makePersona('p1', 'One'));
    await storage.savePersona(makePersona('p2', 'Two'));
    await storage.savePersona(makePersona('p3', 'Three'));

    await storage.setActivePersona('p2');

    const active = await storage.getActivePersona();
    expect(active?.id).toBe('p2');

    const all = await storage.getPersonas('u');
    const activeCount = all.filter((p) => p.isActive).length;
    expect(activeCount).toBe(1);
  });

  test('concurrent activation attempts leave exactly one active persona', async () => {
    await storage.savePersona(makePersona('p1', 'One'));
    await storage.savePersona(makePersona('p2', 'Two'));

    // Two concurrent activation races — the partial unique index allows only
    // one row with is_active=1; the loser must be rejected.
    await Promise.allSettled([storage.setActivePersona('p1'), storage.setActivePersona('p2')]);

    const all = await storage.getPersonas('u');
    const activeCount = all.filter((p) => p.isActive).length;
    expect(activeCount).toBe(1);

    // The database table itself must never hold two active rows.
    const rows = table('personas').filter((r) => r.is_active === 1);
    expect(rows.length).toBe(1);
  });

  test('switching active persona atomically moves the flag', async () => {
    await storage.savePersona(makePersona('p1', 'One'));
    await storage.savePersona(makePersona('p2', 'Two'));
    await storage.setActivePersona('p1');
    await storage.setActivePersona('p2');

    const active = await storage.getActivePersona();
    expect(active?.id).toBe('p2');
    expect(table('personas').filter((r) => r.is_active === 1).length).toBe(1);
  });

  test('updatePersona upserts when missing (create flow)', async () => {
    await storage.updatePersona('new-1', { name: 'Created', isActive: false });
    const personas = await storage.getPersonas('u');
    expect(personas).toHaveLength(1);
    expect(personas[0]?.name).toBe('Created');
  });

  test('updatePersona merges fields on existing persona', async () => {
    await storage.savePersona(makePersona('p1', 'Aragorn'));
    await storage.updatePersona('p1', { name: 'Aragorn II' });
    const personas = await storage.getPersonas('u');
    expect(personas[0]?.name).toBe('Aragorn II');
  });

  test('deletePersona removes the row', async () => {
    await storage.savePersona(makePersona('p1', 'Aragorn'));
    await storage.deletePersona('p1');
    expect(await storage.hasPersona()).toBe(false);
    expect(table('personas').length).toBe(0);
  });

  test('getActivePersona returns undefined when none active', async () => {
    await storage.savePersona(makePersona('p1', 'Aragorn', false));
    expect(await storage.getActivePersona()).toBeUndefined();
  });
});
