// apps/frontend/hub/src/lib/server/api/health_db.test.ts
//
// C-394 AC-1: GET /api/health/db handler behavior.
//
// Tests the handler directly (the Elysia mount is a one-liner). The three
// states are covered locally:
//   • ok          — NEON_DATABASE_URL points at the local C-387 postgres
//   • unconfigured— env var absent (degraded mode, self-hosting path)
//   • unreachable — env var points at a dead host (no 500, no crash)
//
// The Neon production half (version reports 18.x against the real pooled
// endpoint) is verified against Cloud Run in the AC-1 evidence path.

import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { closePool } from '@aikami/backend-database';
import type { DbHealthResponse } from './health_db.ts';

const LOCAL_URL = 'postgresql://localhost:5433/aikami_dev?sslmode=disable';

const setEnv = (value: string | undefined): void => {
  mock.module('$env/dynamic/private', () => ({
    // biome-ignore lint/complexity/useLiteralKeys: env key is a SCREAMING_SNAKE_CASE literal by platform convention
    env: { ['NEON_DATABASE_URL']: value } as Record<string, string | undefined>,
  }));
};

describe('/api/health/db handler (AC-1)', () => {
  beforeEach(async () => {
    await closePool();
    setEnv(undefined);
  });

  test('unconfigured: NEON_DATABASE_URL absent → structured degraded status', async () => {
    setEnv(undefined);
    const { handleDbHealth, hasPool } = await import('./health_db.ts');
    const response = (await handleDbHealth()) as DbHealthResponse;
    expect(response.status).toBe('unconfigured');
    // Lazy invariant: merely CALLING the handler must not create a pool.
    expect(hasPool()).toBe(false);
  });

  test('ok: local postgres reachable → reports version, host and round-trip ms', async () => {
    setEnv(LOCAL_URL);
    const { handleDbHealth } = await import('./health_db.ts');
    const response = (await handleDbHealth()) as DbHealthResponse;

    expect(response.status).toBe('ok');
    if (response.status === 'ok') {
      // The local engine is pinned to 18 (C-394 AC-2) — same major as Neon.
      expect(response.databaseVersion).toMatch(/^18\./);
      expect(response.host).toBe('localhost');
      expect(typeof response.roundTripMs).toBe('number');
      expect(response.roundTripMs).toBeGreaterThanOrEqual(0);
    }
  });

  test('unreachable: dead host → structured degraded status, not a throw', async () => {
    setEnv('postgresql://localhost:59999/aikami_dev?sslmode=disable');
    const { handleDbHealth } = await import('./health_db.ts');
    const response = (await handleDbHealth()) as DbHealthResponse;
    expect(response.status).toBe('unreachable');
  });
});
