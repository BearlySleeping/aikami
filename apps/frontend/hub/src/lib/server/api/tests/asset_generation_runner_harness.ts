// apps/frontend/hub/src/lib/server/api/tests/asset_generation_runner_harness.ts
//
// C-522: the D1 + R2 + Request harness shared by
// `asset_generation_runner.test.ts`.
//
// Extracted so the test module stays inside the source-file-size budget. Same
// in-memory libsql D1 + mock R2 harness as `map_studio.test.ts`.

// biome-ignore-all lint/style/useNamingConvention: Cloudflare binding names are SCREAMING_SNAKE_CASE

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Client } from '@libsql/client';

export const BASE_URL = 'http://localhost:5173';

export const MIGRATIONS_DIR = join(
  import.meta.dir,
  '..',
  '..',
  '..',
  '..',
  '..',
  '..',
  '..',
  '..',
  'packages',
  'backend',
  'database',
  'drizzle-d1',
);

/** Migration files in application order. */
export const migrationFiles = (limit?: number): string[] => {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();
  return limit === undefined ? files : files.slice(0, limit);
};

export const applyMigration = async (dbClient: Client, file: string): Promise<void> => {
  const migrationSql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
  for (const statement of migrationSql.split('--> statement-breakpoint')) {
    const trimmed = statement.trim();
    if (trimmed) {
      await dbClient.execute(trimmed);
    }
  }
};

/**
 * Minimal D1Database shim over in-memory libsql.
 *
 * Unlike the older harnesses this one reports `rowsAffected` as
 * `meta.changes` — the C-522 claim arbitrates on exactly that value, so a
 * shim that always answered 0 would make the CAS untestable.
 */
export const createMockD1 = (dbClient: Client) => ({
  binding: {
    prepare: (sql: string) => ({
      bind: (...params: never[]) => ({
        all: async () => {
          const res = await dbClient.execute({ sql, args: params as never[] });
          return { results: res.rows };
        },
        first: async () => {
          const res = await dbClient.execute({ sql, args: params as never[] });
          return res.rows[0] ?? null;
        },
        run: async () => {
          const res = await dbClient.execute({ sql, args: params as never[] });
          return { meta: { last_row_id: 0, changes: res.rowsAffected ?? 0 } };
        },
        raw: async () => {
          const res = await dbClient.execute({ sql, args: params as never[] });
          return res.rows;
        },
      }),
    }),
    exec: async (sql: string) => {
      await dbClient.execute(sql);
    },
    batch: async (statements: Array<{ sql: string; params?: unknown[] }>) =>
      Promise.all(
        statements.map((statement) =>
          dbClient.execute({ sql: statement.sql, args: (statement.params ?? []) as never[] }),
        ),
      ),
  },
});

/** In-memory R2 bucket that round-trips bytes. */
export const createMockR2 = () => {
  const store = new Map<string, Uint8Array>();
  return {
    store,
    put: async (
      key: string,
      value: string | ArrayBuffer | Uint8Array<ArrayBufferLike>,
      options?: { httpMetadata?: { contentType?: string } },
    ) => {
      const bytes =
        typeof value === 'string'
          ? new TextEncoder().encode(value)
          : new Uint8Array(value as ArrayBufferLike);
      store.set(key, bytes);
      return { key, httpMetadata: options?.httpMetadata };
    },
    get: async (key: string) => {
      const bytes = store.get(key);
      if (!bytes) {
        return null;
      }
      return { arrayBuffer: async () => bytes.buffer.slice(0) as ArrayBuffer };
    },
    delete: async (key: string) => {
      store.delete(key);
    },
  };
};

export type RunnerEnv = {
  DB: import('@cloudflare/workers-types').D1Database;
  UPLOADS_BUCKET?: import('@cloudflare/workers-types').R2Bucket;
};

export const request = (
  method: string,
  path: string,
  body?: unknown,
  extra: Record<string, string> = {},
) =>
  new Request(`${BASE_URL}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...extra,
    },
    ...(body !== undefined && typeof body !== 'string' ? { body: JSON.stringify(body) } : {}),
    ...(typeof body === 'string' ? { body } : {}),
  });
