// packages/frontend/storage/src/lib/world_gen_drafts.test.ts
//
// G01 — WorldGenDraftRepository tests.
//
// These run against a REAL in-memory SQLite database (bun:sqlite) driven by the
// REAL migration list, not a hand-written schema and not a mock that asserts
// its own SQL strings. That matters: the draft store's job is to survive a
// device restart with no sign-in, so what is under test is the behaviour of the
// actual DDL — the CHECK constraint on `status`, the primary key, the
// upsert semantics and the ordering — rather than a list of literals.

import { Database, type SQLQueryBindings } from 'bun:sqlite';
import { beforeEach, describe, expect, test } from 'bun:test';
import type { WorldGenDraft } from '@aikami/schemas';
import { AIKAMI_MIGRATIONS } from './migrations.ts';
import type { LocalDatabaseInterface, QueryResult, SqlQuery } from './storage_adapter.ts';
import { createWorldGenDraftRepository, type WorldGenDraftRepository } from './world_gen_drafts.ts';

/**
 * A real SQLite database wrapped in the production {@link LocalDatabaseInterface}
 * contract. The DDL comes from {@link AIKAMI_MIGRATIONS} — the same list the
 * app applies at boot — so a schema change that breaks this table breaks boot.
 */
const createInMemoryDatabase = (): LocalDatabaseInterface => {
  const db = new Database(':memory:');
  db.run('PRAGMA foreign_keys = ON');
  for (const migration of AIKAMI_MIGRATIONS) {
    for (const statement of migration.statements) {
      db.run(statement);
    }
  }
  const bindings = (args: readonly unknown[]): SQLQueryBindings[] => args as SQLQueryBindings[];
  return {
    query: async ({ sql, args }: SqlQuery): Promise<QueryResult> => ({
      // `all` is typed as a spread of a bindings union; passing the array as a
      // single argument is the runtime-correct form the type does not model.
      rows: db.query(sql).all(...bindings(args)) as QueryResult['rows'],
    }),
    execute: async ({ sql, args }: SqlQuery): Promise<void> => {
      db.run(sql, bindings(args));
    },
    transaction: async (queries: readonly SqlQuery[]): Promise<void> => {
      db.run('BEGIN');
      try {
        for (const query of queries) {
          db.run(query.sql, bindings(query.args));
        }
        db.run('COMMIT');
      } catch (error) {
        db.run('ROLLBACK');
        throw error;
      }
    },
    sync: async (): Promise<void> => {},
    exportBytes: async (): Promise<Uint8Array> => new Uint8Array(db.serialize()),
    importBytes: async (): Promise<void> => {
      throw new Error('importBytes is not exercised by the draft repository.');
    },
    close: async (): Promise<void> => {
      db.close();
    },
  };
};

const draftFixture = (overrides: Partial<WorldGenDraft> = {}): WorldGenDraft => ({
  schemaVersion: 1,
  draftId: 'draft-1',
  runId: 'run-1',
  revision: 0,
  status: 'complete',
  preview: true,
  playable: false,
  createdAt: '2026-10-04T10:00:00.000Z',
  updatedAt: '2026-10-04T10:00:00.000Z',
  input: {
    genre: 'Fantasy',
    tone: 'Heroic',
    setting: 'A twilight valley.',
    difficulty: 'Medium',
    goals: 'Relight the wardstones.',
  },
  setting: {
    worldName: 'Duskhollow',
    worldDescription: 'A lantern-lit frontier town in a twilight valley.',
    themes: ['frontier'],
  },
  cast: [
    {
      id: 'npc_maren',
      name: 'Maren',
      race: 'Human',
      class: 'Innkeeper',
      role: 'Quest Giver',
      description: 'A weathered innkeeper.',
      personality: 'Sharp-tongued.',
    },
  ],
  places: [
    { id: 'place_market', name: 'The Ember Market', description: 'Warm bread.', npcIds: [] },
  ],
  arcs: [
    {
      id: 'arc_1',
      chapter: 'Chapter 1',
      description: 'The ward fades.',
      objectives: ['Find the wardstone'],
      questGiverIds: ['npc_maren'],
    },
  ],
  hudWidgets: [
    {
      id: 'hud_0-compass',
      slot: 'top-left',
      label: 'Compass',
      icon: 'compass',
      defaultVisibility: true,
    },
  ],
  checkpoints: [{ stage: 'setting', fingerprint: 'abc', completedAt: '2026-10-04T10:00:00.000Z' }],
  ...overrides,
});

describe('WorldGenDraftRepository — G01', () => {
  let db: LocalDatabaseInterface;
  let repository: WorldGenDraftRepository;

  beforeEach(() => {
    db = createInMemoryDatabase();
    repository = createWorldGenDraftRepository(db);
  });

  describe('durability', () => {
    test('a draft round-trips through the device store unchanged', async () => {
      const draft = draftFixture();
      await repository.upsert(draft);

      const loaded = await repository.get('draft-1');

      expect(loaded).toEqual(draft);
    });

    test('an older late write cannot replace a newer revision', async () => {
      await repository.upsert(draftFixture({ revision: 2, runId: 'new-run' }));
      await expect(
        repository.upsert(
          draftFixture({ revision: 1, runId: 'old-run', status: 'accepted_preview' }),
        ),
      ).rejects.toThrow('superseded');
      const loaded = await repository.get('draft-1');
      expect(loaded?.revision).toBe(2);
      expect(loaded?.runId).toBe('new-run');
      expect(loaded?.status).toBe('complete');
    });

    test('a late completion cannot downgrade acceptance at the same revision', async () => {
      await repository.upsert(draftFixture({ status: 'accepted_preview' }));
      await expect(repository.upsert(draftFixture({ status: 'complete' }))).rejects.toThrow(
        'superseded',
      );
      expect((await repository.get('draft-1'))?.status).toBe('accepted_preview');
    });

    test('unsafe revision numbers are refused before replacing a valid row', async () => {
      await repository.upsert(draftFixture());
      await expect(
        repository.upsert(draftFixture({ revision: Number.MAX_SAFE_INTEGER + 1 })),
      ).rejects.toThrow();
      expect((await repository.get('draft-1'))?.revision).toBe(0);
    });

    test('inconsistent indexed metadata is not adopted as a valid blueprint', async () => {
      await repository.upsert(draftFixture());
      await db.execute({
        sql: 'UPDATE worldgen_drafts SET revision = ? WHERE draft_id = ?',
        args: [7, 'draft-1'],
      });
      await expect(repository.get('draft-1')).rejects.toThrow('metadata disagrees');
    });

    test('upsert waits for the device durability flush', async () => {
      let release = (): void => {};
      let entered = (): void => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const ready = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const flushingRepository = createWorldGenDraftRepository({
        ...db,
        flush: async () => {
          entered();
          await gate;
        },
      });
      let complete = false;
      const writing = flushingRepository.upsert(draftFixture()).then(() => {
        complete = true;
      });
      await ready;
      expect(complete).toBe(false);
      release();
      await writing;
      expect(complete).toBe(true);
      expect(await repository.get('draft-1')).toEqual(draftFixture());
    });

    test('the stored draft keeps its narrative-preview invariants', async () => {
      await repository.upsert(draftFixture());
      const loaded = await repository.get('draft-1');

      expect(loaded?.preview).toBe(true);
      expect(loaded?.playable).toBe(false);
    });

    test('a second upsert of the same draft id replaces rather than duplicates', async () => {
      await repository.upsert(draftFixture());
      await repository.upsert(draftFixture({ status: 'accepted_preview', revision: 1 }));

      expect(await repository.count()).toBe(1);
      expect((await repository.get('draft-1'))?.status).toBe('accepted_preview');
    });

    test('get returns undefined for an unknown draft id', async () => {
      expect(await repository.get('missing')).toBeUndefined();
    });

    test('remove deletes the row', async () => {
      await repository.upsert(draftFixture());
      await repository.remove('draft-1');

      expect(await repository.count()).toBe(0);
      expect(await repository.get('draft-1')).toBeUndefined();
    });
  });

  describe('schema enforcement comes from the real DDL', () => {
    test('the status CHECK constraint rejects an unknown status', async () => {
      await expect(
        db.execute({
          sql: `INSERT OR REPLACE INTO worldgen_drafts
                (draft_id, schema_version, status, run_id, revision, input_json, blueprint_json, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            'draft-bad',
            1,
            'playable',
            'run-1',
            0,
            '{}',
            null,
            '2026-10-04T10:00:00.000Z',
            '2026-10-04T10:00:00.000Z',
          ],
        }),
      ).rejects.toThrow();
    });

    test('the draft table exists without any campaign or account column', async () => {
      const result = await db.query({
        sql: 'SELECT name FROM pragma_table_info(?)',
        args: ['worldgen_drafts'],
      });
      const columns = result.rows.map((row) => row.name as string);

      expect(columns).toContain('draft_id');
      expect(columns).toContain('blueprint_json');
      // A draft must be writable with no sign-in, so an owner/campaign column
      // here would silently make account state a persistence requirement.
      expect(columns).not.toContain('campaign_id');
      expect(columns).not.toContain('uid');
    });
  });

  describe('ordering', () => {
    test('list returns the most recently updated draft first', async () => {
      await repository.upsert(
        draftFixture({ draftId: 'older', updatedAt: '2026-10-04T09:00:00.000Z' }),
      );
      await repository.upsert(
        draftFixture({ draftId: 'newer', updatedAt: '2026-10-04T11:00:00.000Z' }),
      );

      const listed = await repository.list();

      expect(listed.map((entry) => entry.draftId)).toEqual(['newer', 'older']);
    });

    test('list honours a limit', async () => {
      await repository.upsert(draftFixture({ draftId: 'a' }));
      await repository.upsert(draftFixture({ draftId: 'b' }));

      expect((await repository.list(1)).length).toBe(1);
    });
  });
});
// ---------------------------------------------------------------------------
// Fail-closed validation
//
// Everything above proves the happy path against real DDL. Everything below
// proves that a row which is NOT a draft never becomes one on the way out.
// ---------------------------------------------------------------------------

describe('WorldGenDraftRepository — refuses what is not a draft (G01)', () => {
  let db: LocalDatabaseInterface;
  let repository: WorldGenDraftRepository;

  beforeEach(() => {
    db = createInMemoryDatabase();
    repository = createWorldGenDraftRepository(db);
  });

  /** Writes a raw blueprint straight into the column, bypassing the repo. */
  const corrupt = async (draftId: string, blueprint: string): Promise<void> => {
    await db.execute({
      sql: 'UPDATE worldgen_drafts SET blueprint_json = ? WHERE draft_id = ?',
      args: [blueprint, draftId],
    });
  };

  test('upsert refuses a draft that fails the structural schema', async () => {
    const broken = { ...draftFixture(), playable: true } as unknown as WorldGenDraft;

    await expect(repository.upsert(broken)).rejects.toThrow(/not storable/);
    expect(await repository.count()).toBe(0);
  });

  test('upsert refuses a draft with a dangling cross-reference', async () => {
    const broken = {
      ...draftFixture(),
      arcs: [
        {
          id: 'arc_1',
          chapter: 'Chapter 1',
          description: 'Points at nobody.',
          objectives: ['Do the thing'],
          questGiverIds: ['npc_nobody'],
        },
      ],
    } as unknown as WorldGenDraft;

    await expect(repository.upsert(broken)).rejects.toThrow(/not storable/);
    expect(await repository.count()).toBe(0);
  });

  test('upsert refuses a draft over the UTF-8 byte ceiling', async () => {
    const bloated = {
      ...draftFixture(),
      setting: {
        worldName: 'Duskhollow',
        worldDescription: '🌍'.repeat(90_000),
        themes: [],
      },
    } as unknown as WorldGenDraft;

    await expect(repository.upsert(bloated)).rejects.toThrow(/not storable/);
    expect(await repository.count()).toBe(0);
  });

  test('get refuses a truncated blueprint instead of casting it', async () => {
    const stored = draftFixture();
    await repository.upsert(stored);
    await corrupt(stored.draftId, '{"schemaVersion":1,"draftId":"draft-1"');

    await expect(repository.get(stored.draftId)).rejects.toThrow(/not storable/);
  });

  test('get refuses a blueprint that parses but is not a draft', async () => {
    const stored = draftFixture();
    await repository.upsert(stored);
    await corrupt(stored.draftId, JSON.stringify({ schemaVersion: 1, draftId: 'draft-1' }));

    await expect(repository.get(stored.draftId)).rejects.toThrow(/not storable/);
  });

  test('latest FAILS LOUD rather than silently skipping the bad row', async () => {
    const stored = draftFixture();
    await repository.upsert(stored);
    await corrupt(stored.draftId, 'not json at all');

    // The alternative — skipping and returning [] — makes a draft the user
    // believes is saved disappear with no message anywhere.
    await expect(repository.latest(1)).rejects.toThrow(/not storable/);
  });

  test('latest returns the newest row when every row is valid', async () => {
    const older = {
      ...draftFixture(),
      draftId: 'draft-older',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const newer = {
      ...draftFixture(),
      draftId: 'draft-newer',
      updatedAt: '2026-02-01T00:00:00.000Z',
    };
    await repository.upsert(older);
    await repository.upsert(newer);

    const [first] = await repository.latest(1);
    expect(first?.draftId).toBe('draft-newer');
  });

  test('a round-tripped draft is byte-identical to what was written', async () => {
    const stored = draftFixture();
    await repository.upsert(stored);

    expect(await repository.get(stored.draftId)).toEqual(stored);
  });
});
