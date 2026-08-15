// packages/backend/database/tests/connection.test.ts
//
// C-394 AC-1: the pooled connection factory.
//
// What this proves locally (the Neon half — reported server version, host,
// round-trip ms — is verified against Cloud Run in the AC-1 evidence path):
//   • the pool is created LAZILY — a module-level `new Pool()` that eagerly
//     connects would turn a database outage into a boot failure;
//   • a healthy round-trip query works against the real local PostgreSQL;
//   • the health-route identity parts (host, pooled flag) parse correctly
//     and never leak credentials;
//   • an unreachable database degrades cleanly (rejected query, no crash).

import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import {
  closePool,
  describeConnectionString,
  getPool,
  getPoolIfExists,
} from '../src/lib/connection.ts';
import { isPostgresReachable, TEST_CONNECTION_URL } from './helpers.ts';

const reachable = await isPostgresReachable();

beforeEach(() => {
  closePool().catch(() => {});
});

afterAll(async () => {
  await closePool();
});

describe('describeConnectionString', () => {
  test('parses host and detects the Neon pooled endpoint', () => {
    const pooled = describeConnectionString(
      'postgresql://user:pass@ep-foo-pooler.c-2.eu-west-2.aws.neon.tech/neondb?sslmode=require',
    );
    expect(pooled.host).toBe('ep-foo-pooler.c-2.eu-west-2.aws.neon.tech');
    expect(pooled.isPooled).toBe(true);
  });

  test('flags a direct endpoint as non-pooled', () => {
    const direct = describeConnectionString(
      'postgresql://user:pass@ep-foo.c-2.eu-west-2.aws.neon.tech/neondb?sslmode=require',
    );
    expect(direct.host).toBe('ep-foo.c-2.eu-west-2.aws.neon.tech');
    expect(direct.isPooled).toBe(false);
  });

  test('never exposes credentials', () => {
    const result = describeConnectionString(
      'postgresql://secretuser:secretpass@db.example.com:5433/aikami_dev?sslmode=disable',
    );
    expect(result.host).toBe('db.example.com');
    expect(JSON.stringify(result)).not.toMatch(/secretuser|secretpass/);
  });

  test('falls back on an unparseable string instead of throwing', () => {
    const result = describeConnectionString('not-a-url');
    expect(result.host).toBe('(unparseable)');
  });
});

describe('getPool (lazy creation)', () => {
  test('creates nothing at module load — getPoolIfExists is undefined until first getPool', () => {
    expect(getPoolIfExists()).toBeUndefined();
  });

  test('getPool returns the same shared instance and caps the pool size', () => {
    const pool = getPool({ connectionString: TEST_CONNECTION_URL, max: 5 });
    expect(pool).toBe(getPool({ connectionString: TEST_CONNECTION_URL, max: 5 }));
    expect(pool.options.max).toBe(5);
  });

  test('closePool resets the module state', async () => {
    getPool({ connectionString: TEST_CONNECTION_URL });
    expect(getPoolIfExists()).toBeDefined();
    await closePool();
    expect(getPoolIfExists()).toBeUndefined();
  });
});

describe('round trip against the real local PostgreSQL', () => {
  test('a SELECT 1 through the pool succeeds when postgres is up', async () => {
    if (!reachable) {
      // biome-ignore lint/suspicious/noConsole: clear skip notice for the test runner (postgres not running)
      console.warn(
        'SKIP: local postgres (localhost:5433) is not running — start it with bun postgres:start',
      );
      return;
    }
    const pool = getPool({ connectionString: TEST_CONNECTION_URL });
    const result = await pool.query<{ '?column?': number }>('SELECT 1');
    expect(result.rows[0]?.['?column?']).toBe(1);
  });

  test('an unreachable host rejects the query without crashing the process', async () => {
    const pool = getPool({
      connectionString: 'postgresql://localhost:59999/aikami_dev?sslmode=disable',
      max: 1,
    });
    // A closed port rejects with ECONNREFUSED — the pool surfaces it as a
    // rejected query, never an unhandled crash.
    await expect(pool.query('SELECT 1')).rejects.toThrow();
  });
});
