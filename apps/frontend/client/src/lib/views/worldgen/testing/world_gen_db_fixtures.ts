// apps/frontend/client/src/lib/views/worldgen/testing/world_gen_db_fixtures.ts
//
// G01 — device-database fixtures, kept OUT of `world_gen_fixtures.ts`.
//
// The compiled-browser lane (vitest, real Chromium) has no `@aikami/frontend/storage`
// alias, so anything that reaches the real repository must live in its own
// module. Tests that only need orchestration import the light fixture file and
// never pull `@aikami/frontend/storage` (and therefore `bun:sqlite`) into the
// browser graph.

import { Database, type SQLQueryBindings } from 'bun:sqlite';
import type { LocalDatabaseInterface, QueryResult, SqlQuery } from '@aikami/frontend/storage';
import { AIKAMI_MIGRATIONS, createWorldGenDraftRepository } from '@aikami/frontend/storage';
import type { WorldGenDraftStore } from '../../../services/worldgen/types/world_gen_draft_service.types.ts';

/**
 * A real local database (in-memory SQLite, real migrations) behind the real
 * repository. Used wherever the test must prove the production persistence
 * boundary rather than an in-memory stand-in.
 */
export const createRealDatabase = (): LocalDatabaseInterface => {
  const db = new Database(':memory:');
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
      throw new Error('importBytes is not exercised by world-generation tests.');
    },
    close: async (): Promise<void> => {
      db.close();
    },
  };
};

/** The production repository over {@link createRealDatabase}. */
export const createRealStore = (
  db: LocalDatabaseInterface,
): WorldGenDraftStore & { count: () => Promise<number> } => createWorldGenDraftRepository(db);
