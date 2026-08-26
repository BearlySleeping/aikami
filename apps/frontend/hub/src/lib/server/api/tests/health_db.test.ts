// apps/frontend/hub/src/lib/server/api/tests/health_db.test.ts
//
// C-436 AC-4: DB health reports the binding.
//
// Tests three states: healthy D1 (ok with roundTripMs), absent binding
// (unconfigured), and throwing D1 (unreachable). Verifies the response
// never contains a credential, connection string, or internal identifier.

import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';

// ── Mock D1 helpers ─────────────────────────────────────────────────────

const createMockD1 = (shouldThrow: boolean = false): unknown => {
  const prepareStatement = (sql: string) => ({
    bind: (...params: unknown[]) => ({
      all: async () => {
        if (shouldThrow) {
          throw new Error('D1 query failed');
        }
        return { results: [] };
      },
      first: async () => {
        if (shouldThrow) {
          throw new Error('D1 query failed');
        }
        return null;
      },
      run: async () => {
        if (shouldThrow) {
          throw new Error('D1 query failed');
        }
        return {};
      },
      raw: async () => {
        if (shouldThrow) {
          throw new Error('D1 query failed');
        }
        return [];
      },
    }),
  });
  return {
    prepare: prepareStatement,
    exec: async (_sql: string) => {},
    batch: async (_statements: Array<{ sql: string; params?: unknown[] }>) => [],
  };
};

let setHealthDbEnv: (env: { DB: unknown } | undefined) => void;

beforeAll(async () => {
  const mod = await import('../health_db.ts');
  setHealthDbEnv = mod.setHealthDbEnv;
});

afterAll(() => {
  setHealthDbEnv(undefined);
});

describe('DB health — C-436 AC-4 (D1 binding)', () => {
  test('unconfigured (DB binding absent) → { status: unconfigured }', async () => {
    setHealthDbEnv(undefined);
    const { handleDbHealth } = await import('../health_db.ts');
    const result = await handleDbHealth();
    expect(result).toEqual({ status: 'unconfigured' });
  });

  test('healthy D1 → { status: ok, roundTripMs }', async () => {
    setHealthDbEnv({ DB: createMockD1(false) });
    const { handleDbHealth } = await import('../health_db.ts');
    const result = await handleDbHealth();
    expect(result).toEqual(
      expect.objectContaining({ status: 'ok', roundTripMs: expect.any(Number) }),
    );
  });

  test('throwing D1 → { status: unreachable }', async () => {
    setHealthDbEnv({ DB: createMockD1(true) });
    const { handleDbHealth } = await import('../health_db.ts');
    const result = await handleDbHealth();
    expect(result).toEqual({ status: 'unreachable' });
  });

  test('response never contains a credential or connection string', async () => {
    setHealthDbEnv({ DB: createMockD1(false) });
    const { handleDbHealth } = await import('../health_db.ts');
    const result = await handleDbHealth();
    const json = JSON.stringify(result);
    expect(json).not.toContain('postgres');
    expect(json).not.toContain('neon');
    expect(json).not.toContain('localhost');
    expect(json).not.toContain('connection');
    expect(json).not.toContain('credential');
    expect(json).not.toContain('secret');
  });
});
