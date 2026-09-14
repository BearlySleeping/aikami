// apps/frontend/hub/src/lib/server/api/tests/asset_generation_runner.test.ts
//
// C-522 AC-2/AC-4/AC-7 (Hub API level): pairing, ownership, claim CAS, fences.
//
// Runs the real handlers against a real SQLite schema applied from
// `drizzle-d1/*.sql`, so the assertions are about D1 behaviour (conditional
// UPDATE, unique indexes, CHECK constraints), not about a hand-rolled fake.
// Same in-memory libsql D1 + mock R2 harness as `map_studio.test.ts`.

// biome-ignore-all lint/style/useNamingConvention: Cloudflare binding names are SCREAMING_SNAKE_CASE

import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Client, createClient } from '@libsql/client';

mock.module('$env/dynamic/private', () => ({
  env: {
    BETTER_AUTH_URL: 'http://localhost:5173',
    BETTER_AUTH_SECRET: 'test-secret-that-is-long-enough-for-better-auth',
  } as Record<string, string | undefined>,
}));

/**
 * Session resolution is stubbed at the Better Auth boundary: a cookie of the
 * form `gen-user=<accountId>` signs that account in. Everything below the
 * boundary — ownership checks, CAS, fences — is the real code.
 */
mock.module('../better_auth.ts', () => ({
  getBetterAuth: () => ({
    api: {
      getSession: async ({ headers }: { headers: Headers }) => {
        const cookie = headers.get('cookie');
        return cookie?.startsWith('gen-user=')
          ? { user: { id: decodeURIComponent(cookie.slice('gen-user='.length)) } }
          : undefined;
      },
    },
    handler: () => new Response(undefined, { status: 404 }),
  }),
}));

const BASE_URL = 'http://localhost:5173';
const MIGRATIONS_DIR = join(
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
const migrationFiles = (limit?: number): string[] => {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();
  return limit === undefined ? files : files.slice(0, limit);
};

const applyMigration = async (dbClient: Client, file: string): Promise<void> => {
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
const createMockD1 = (dbClient: Client) => ({
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
const createMockR2 = () => {
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

type RunnerEnv = {
  DB: import('@cloudflare/workers-types').D1Database;
  UPLOADS_BUCKET?: import('@cloudflare/workers-types').R2Bucket;
};

let client: Client;
let app: import('../index.ts').App;
let r2: ReturnType<typeof createMockR2>;

const request = (
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

/** Create an account row and return its session cookie. */
const signInCookie = async (email: string): Promise<string> => {
  const accountId = crypto.randomUUID();
  await client.execute({
    sql: 'INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    args: [accountId, 'Generation User', email, 1, Date.now(), Date.now()],
  });
  return `gen-user=${encodeURIComponent(accountId)}`;
};

const bearer = (token: string): Record<string, string> => ({
  authorization: `Bearer ${token}`,
});

const BUDGET = {
  gpuConcurrency: 1,
  candidateLimitPerItem: 1,
  maxCandidatesPerRun: 8,
  hostedBudgetUsd: 0,
  maxDurationSeconds: 0,
  maxPixels: 4_194_304,
  maxRetainedBytes: 33_554_432,
  maxRequestedAudioSecondsPerCandidatePass: 0,
};

const spec = (overrides: Record<string, unknown> = {}) => ({
  itemId: 'brief-item-1',
  recipeId: 'portrait',
  modality: 'image',
  providerProfileId: 'local-sdcpp',
  preparationProfile: 'image-default',
  referenceIds: ['ref-1'],
  seed: 42,
  candidateLimit: 1,
  budget: BUDGET,
  prompt: 'a hero portrait',
  ...overrides,
});

/** Mint a pairing code for a session and return it. */
const mintCode = async (cookie: string): Promise<string> => {
  const res = await app.handle(
    request('POST', '/api/generation/runners/pairing-code', undefined, { cookie }),
  );
  expect(res.status).toBe(201);
  const body = (await res.json()) as { code: string };
  return body.code;
};

/** Pair a device and return its id + plaintext token (returned exactly once). */
const pairDevice = async (options: {
  cookie: string;
  deviceId: string;
  modalities?: string[];
  resourceGroups?: string[];
  artifactUploadEnabled?: boolean;
}): Promise<{ deviceId: string; token: string }> => {
  const code = await mintCode(options.cookie);
  const res = await app.handle(
    request('POST', '/api/generation/runners/pair', {
      schemaVersion: 1,
      code,
      deviceId: options.deviceId,
      label: 'Studio desktop',
      platform: 'linux',
      modalities: options.modalities ?? ['image'],
      resourceGroups: options.resourceGroups ?? ['gpu:0'],
      ...(options.artifactUploadEnabled === undefined
        ? {}
        : { artifactUploadEnabled: options.artifactUploadEnabled }),
    }),
  );
  expect(res.status).toBe(201);
  const body = (await res.json()) as { token: string; device: { deviceId: string } };
  return { deviceId: body.device.deviceId, token: body.token };
};

/** Enqueue a dispatch for an owner and return its id. */
const createDispatch = async (options: {
  cookie: string;
  deviceId: string;
  jobId: string;
  attempt?: number;
  specOverrides?: Record<string, unknown>;
}): Promise<string> => {
  const res = await app.handle(
    request(
      'POST',
      '/api/generation/dispatches',
      {
        deviceId: options.deviceId,
        jobId: options.jobId,
        requestKey: `${options.jobId}:k`,
        effectiveSpecHash: 'a'.repeat(64),
        attempt: options.attempt ?? 1,
        spec: spec(options.specOverrides),
      },
      { cookie: options.cookie },
    ),
  );
  expect(res.status).toBe(201);
  const body = (await res.json()) as { dispatchId: string };
  return body.dispatchId;
};

const claim = async (options: {
  token: string;
  deviceId: string;
  resourceGroup?: string;
  modalities?: string[];
}) =>
  app.handle(
    request(
      'POST',
      '/api/generation/runners/claim',
      {
        schemaVersion: 1,
        deviceId: options.deviceId,
        resourceGroup: options.resourceGroup ?? 'gpu:0',
        runnerNow: new Date().toISOString(),
        leaseTtlMs: 300_000,
        modalities: options.modalities ?? ['image'],
      },
      bearer(options.token),
    ),
  );

beforeAll(async () => {
  client = createClient({ url: ':memory:' });
  for (const file of migrationFiles()) {
    await applyMigration(client, file);
  }
  r2 = createMockR2();
  const env: RunnerEnv = {
    DB: createMockD1(client).binding as unknown as RunnerEnv['DB'],
    UPLOADS_BUCKET: r2 as unknown as RunnerEnv['UPLOADS_BUCKET'],
  };
  const { createApp } = await import('../index.ts');
  app = createApp({ generationRunnerEnv: env });
});

afterAll(async () => {
  await client.close();
});

describe('AC-7: the pairing/dispatch migration is additive', () => {
  test('identity and save-backup rows are identical before and after 0011', async () => {
    // A dedicated database, migrated only to the pre-C-522 revision, so the
    // count is a real before/after rather than a same-database comparison.
    const isolated = createClient({ url: ':memory:' });
    const files = migrationFiles();
    const pairingMigration = files.findIndex((file) => file.startsWith('0011_'));
    expect(pairingMigration).toBeGreaterThan(0);
    for (const file of files.slice(0, pairingMigration)) {
      await applyMigration(isolated, file);
    }

    await isolated.execute({
      sql: 'INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      args: ['mig-user-1', 'Before', 'before@example.com', 1, Date.now(), Date.now()],
    });
    await isolated.execute({
      sql: 'INSERT INTO account_backups (id, account_id, r2_key, size_bytes, checksum_sha256, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      args: ['backup-1', 'mig-user-1', 'saves/1.json', 128, 'c'.repeat(64), Date.now()],
    });
    const before = await isolated.execute(
      'SELECT (SELECT COUNT(*) FROM user) AS users, (SELECT COUNT(*) FROM account_backups) AS backups',
    );

    await applyMigration(isolated, files[pairingMigration]);

    const after = await isolated.execute(
      'SELECT (SELECT COUNT(*) FROM user) AS users, (SELECT COUNT(*) FROM account_backups) AS backups',
    );
    expect(Number(after.rows[0]?.users)).toBe(Number(before.rows[0]?.users));
    expect(Number(after.rows[0]?.backups)).toBe(Number(before.rows[0]?.backups));

    // The new tables exist and are empty — additive, not a rewrite.
    const tables = await isolated.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'runner_%' OR name = 'generation_dispatches' OR name = 'generation_candidates'",
    );
    const names = tables.rows.map((row) => String(row.name)).sort();
    expect(names).toEqual([
      'generation_candidates',
      'generation_dispatches',
      'runner_artifact_tickets',
      'runner_devices',
      'runner_pairing_codes',
    ]);
    await isolated.close();
  });

  test('the unique/CHECK constraints actually bite', async () => {
    const accountId = crypto.randomUUID();
    await client.execute({
      sql: 'INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      args: [accountId, 'Constraints', `${accountId}@example.com`, 1, Date.now(), Date.now()],
    });
    await client.execute({
      sql: "INSERT INTO runner_devices (id, owner_account_id, label, platform, modalities_json, resource_groups_json, token_hash, token_expires_at, artifact_upload_enabled, created_at, last_seen_at) VALUES (?, ?, 'x', 'linux', '[]', '[]', ?, ?, 0, ?, ?)",
      args: ['dev-constraints-1', accountId, 'd'.repeat(64), Date.now(), Date.now(), Date.now()],
    });
    // One token hash may back at most one device.
    await expect(
      client.execute({
        sql: "INSERT INTO runner_devices (id, owner_account_id, label, platform, modalities_json, resource_groups_json, token_hash, token_expires_at, artifact_upload_enabled, created_at, last_seen_at) VALUES (?, ?, 'y', 'linux', '[]', '[]', ?, ?, 0, ?, ?)",
        args: ['dev-constraints-2', accountId, 'd'.repeat(64), Date.now(), Date.now(), Date.now()],
      }),
    ).rejects.toThrow();
    // A status outside the shared C-519 lifecycle is refused by the DB too.
    await expect(
      client.execute({
        sql: "INSERT INTO generation_dispatches (id, owner_account_id, device_id, job_id, request_key, effective_spec_hash, attempt, modality, spec_json, status, candidate_count, created_at, updated_at) VALUES (?, ?, ?, 'j', 'k', ?, 1, 'image', '{}', 'invented', 0, ?, ?)",
        args: ['dsp-bad', accountId, 'dev-constraints-1', 'e'.repeat(64), Date.now(), Date.now()],
      }),
    ).rejects.toThrow();
  });
});

describe('AC-2: pairing, ownership and revocation', () => {
  test('pairing requires a real, unconsumed, unexpired code', async () => {
    const cookie = await signInCookie('pair-gate@example.com');
    const bad = await app.handle(
      request('POST', '/api/generation/runners/pair', {
        schemaVersion: 1,
        code: 'ZZZZ-ZZZZ-ZZZZ',
        deviceId: 'dev_bad_code_0001',
        label: 'x',
        platform: 'linux',
        modalities: ['image'],
        resourceGroups: ['gpu:0'],
      }),
    );
    expect(bad.status).toBe(403);
    expect((await bad.json()).code).toBe('pairing_code_invalid');

    const { deviceId } = await pairDevice({ cookie, deviceId: 'dev_replay_000001' });
    expect(deviceId).toBe('dev_replay_000001');

    // An expired code is refused even though the row still exists.
    const expired = await app.handle(
      request('POST', '/api/generation/runners/pairing-code', undefined, { cookie }),
    );
    const expiredBody = (await expired.json()) as { code: string };
    await client.execute({
      sql: 'UPDATE runner_pairing_codes SET expires_at = ? WHERE code = ?',
      args: [Date.now() - 1000, expiredBody.code],
    });
    const expiredPair = await app.handle(
      request('POST', '/api/generation/runners/pair', {
        schemaVersion: 1,
        code: expiredBody.code,
        deviceId: 'dev_expired_00001',
        label: 'x',
        platform: 'linux',
        modalities: ['image'],
        resourceGroups: ['gpu:0'],
      }),
    );
    expect(expiredPair.status).toBe(403);
    expect((await expiredPair.json()).code).toBe('pairing_code_invalid');
  });

  test('a pairing code is single-use', async () => {
    const cookie = await signInCookie('pair-once@example.com');
    const code = await mintCode(cookie);
    const pairBody = {
      schemaVersion: 1,
      code,
      deviceId: 'dev_once_00000001',
      label: 'x',
      platform: 'linux',
      modalities: ['image'],
      resourceGroups: ['gpu:0'],
    };
    const first = await app.handle(request('POST', '/api/generation/runners/pair', pairBody));
    expect(first.status).toBe(201);
    const second = await app.handle(
      request('POST', '/api/generation/runners/pair', {
        ...pairBody,
        deviceId: 'dev_once_00000002',
      }),
    );
    expect(second.status).toBe(403);
    expect((await second.json()).code).toBe('pairing_code_invalid');
  });

  test('the creator-visible device list never carries a credential', async () => {
    const cookie = await signInCookie('device-list@example.com');
    await pairDevice({ cookie, deviceId: 'dev_list_00000001' });

    const anonymous = await app.handle(request('GET', '/api/generation/runners'));
    expect(anonymous.status).toBe(401);

    const res = await app.handle(request('GET', '/api/generation/runners', undefined, { cookie }));
    expect(res.status).toBe(200);
    const listed = (await res.json()) as Array<Record<string, unknown>>;
    expect(listed).toHaveLength(1);
    expect(listed[0]?.deviceId).toBe('dev_list_00000001');
    expect(listed[0]?.online).toBe(true);
    expect(listed[0]?.revoked).toBe(false);
    expect(listed[0]?.tokenHash).toBeUndefined();
    expect(JSON.stringify(listed)).not.toContain('rt_');

    // Another account sees nothing.
    const other = await signInCookie('device-list-other@example.com');
    const otherRes = await app.handle(
      request('GET', '/api/generation/runners', undefined, { cookie: other }),
    );
    expect((await otherRes.json()) as unknown[]).toHaveLength(0);
  });

  test('crossed owners cannot see or steer each others work', async () => {
    const alice = await signInCookie('alice@example.com');
    const bob = await signInCookie('bob@example.com');
    const aliceDevice = await pairDevice({ cookie: alice, deviceId: 'dev_alice_0000001' });
    const bobDevice = await pairDevice({ cookie: bob, deviceId: 'dev_bob_00000001' });
    const dispatchId = await createDispatch({
      cookie: alice,
      deviceId: aliceDevice.deviceId,
      jobId: 'job-alice-1',
    });

    // Bob cannot read it, cancel it, list its artifacts, or claim it.
    const read = await app.handle(
      request('GET', `/api/generation/dispatches/${dispatchId}`, undefined, { cookie: bob }),
    );
    expect(read.status).toBe(404);
    const cancel = await app.handle(
      request('POST', `/api/generation/dispatches/${dispatchId}/cancel`, undefined, {
        cookie: bob,
      }),
    );
    expect(cancel.status).toBe(404);
    const artifacts = await app.handle(
      request('GET', `/api/generation/dispatches/${dispatchId}/artifacts`, undefined, {
        cookie: bob,
      }),
    );
    expect(artifacts.status).toBe(404);

    // Bob's own token cannot claim Alice's dispatch, because the dispatch is
    // routed to her device and the claim is scoped to the authenticated device.
    const bobClaim = await claim({ token: bobDevice.token, deviceId: bobDevice.deviceId });
    expect(bobClaim.status).toBe(200);
    const bobClaimBody = (await bobClaim.json()) as { claimed: boolean };
    expect(bobClaimBody.claimed).toBe(false);

    // Bob cannot enqueue onto Alice's device either.
    const crossDispatch = await app.handle(
      request(
        'POST',
        '/api/generation/dispatches',
        {
          deviceId: aliceDevice.deviceId,
          jobId: 'job-crossed',
          requestKey: 'job-crossed:k',
          effectiveSpecHash: 'b'.repeat(64),
          spec: spec(),
        },
        { cookie: bob },
      ),
    );
    expect(crossDispatch.status).toBe(403);
    expect((await crossDispatch.json()).code).toBe('owner_mismatch');

    // And Bob cannot revoke Alice's device.
    const revoke = await app.handle(
      request('DELETE', `/api/generation/runners/${aliceDevice.deviceId}`, undefined, {
        cookie: bob,
      }),
    );
    expect(revoke.status).toBe(404);
  });

  test('a revoked device cannot claim, and its pending job is not destroyed', async () => {
    const cookie = await signInCookie('revoke@example.com');
    const device = await pairDevice({ cookie, deviceId: 'dev_revoke_000001' });
    await createDispatch({ cookie, deviceId: device.deviceId, jobId: 'job-revoked' });

    const revoke = await app.handle(
      request('DELETE', `/api/generation/runners/${device.deviceId}`, undefined, { cookie }),
    );
    expect(revoke.status).toBe(200);
    expect(((await revoke.json()) as { revoked: boolean }).revoked).toBe(true);

    const afterRevoke = await claim({ token: device.token, deviceId: device.deviceId });
    expect(afterRevoke.status).toBe(403);
    expect((await afterRevoke.json()).code).toBe('device_revoked');

    // The queued dispatch still exists with its payload intact — revocation
    // stops dispatch, it does not delete the creator's work.
    const rows = await client.execute({
      sql: "SELECT status, spec_json FROM generation_dispatches WHERE job_id = 'job-revoked'",
    });
    expect(rows.rows).toHaveLength(1);
    expect(String(rows.rows[0]?.status)).toBe('queued');
    expect(String(rows.rows[0]?.spec_json)).toContain('portrait');
  });

  test('an expired credential is refused like a revoked one', async () => {
    const cookie = await signInCookie('expiry@example.com');
    const device = await pairDevice({ cookie, deviceId: 'dev_expired_cred1' });
    await client.execute({
      sql: 'UPDATE runner_devices SET token_expires_at = ? WHERE id = ?',
      args: [Date.now() - 1000, device.deviceId],
    });
    const res = await claim({ token: device.token, deviceId: device.deviceId });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('device_revoked');
  });

  test('a matched-format but unknown token is unauthorized', async () => {
    const res = await app.handle(
      request(
        'POST',
        '/api/generation/runners/claim',
        {
          schemaVersion: 1,
          deviceId: 'dev_unknown_000001',
          resourceGroup: 'gpu:0',
          runnerNow: new Date().toISOString(),
          leaseTtlMs: 1000,
          modalities: ['image'],
        },
        bearer(`rt_dev_unknown_000001.${'0'.repeat(48)}`),
      ),
    );
    expect(res.status).toBe(401);
  });
});

describe('AC-4: claim CAS, fencing and reconnect', () => {
  test('one dispatch is claimed exactly once, with a fence', async () => {
    const cookie = await signInCookie('claim@example.com');
    const device = await pairDevice({ cookie, deviceId: 'dev_claim_00000001' });
    const dispatchId = await createDispatch({
      cookie,
      deviceId: device.deviceId,
      jobId: 'job-claim-1',
    });

    const first = await claim({ token: device.token, deviceId: device.deviceId });
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as {
      claimed: boolean;
      dispatch: { dispatchId: string; attempt: number; status: string };
      fence: { lease: { leaseId: string; owner: string; resourceGroup: string } };
    };
    expect(firstBody.claimed).toBe(true);
    expect(firstBody.dispatch.dispatchId).toBe(dispatchId);
    expect(firstBody.dispatch.status).toBe('running');
    expect(firstBody.fence.lease.owner).toBe(device.deviceId);
    expect(firstBody.fence.lease.resourceGroup).toBe('gpu:0');

    // The second poll finds nothing: the row is no longer queued.
    const second = await claim({ token: device.token, deviceId: device.deviceId });
    const secondBody = (await second.json()) as { claimed: boolean; reason: string };
    expect(secondBody.claimed).toBe(false);
    expect(secondBody.reason).toContain('no queued dispatch');

    // One lease id, one row (the unique index is what makes that a guarantee).
    const leases = await client.execute(
      'SELECT COUNT(*) AS count FROM generation_dispatches WHERE lease_id IS NOT NULL',
    );
    expect(Number(leases.rows[0]?.count)).toBe(1);
  });

  test('a capability mismatch is refused before the claim', async () => {
    const cookie = await signInCookie('capability@example.com');
    const device = await pairDevice({
      cookie,
      deviceId: 'dev_capability_001',
      modalities: ['audio'],
      resourceGroups: ['gpu:1'],
    });
    await createDispatch({ cookie, deviceId: device.deviceId, jobId: 'job-image-only' });

    const wrongGroup = await claim({
      token: device.token,
      deviceId: device.deviceId,
      resourceGroup: 'gpu:0',
    });
    expect(wrongGroup.status).toBe(409);
    expect((await wrongGroup.json()).code).toBe('capability_mismatch');

    const wrongModality = await claim({
      token: device.token,
      deviceId: device.deviceId,
      resourceGroup: 'gpu:1',
      modalities: ['audio'],
    });
    const body = (await wrongModality.json()) as { claimed: boolean; reason: string };
    expect(body.claimed).toBe(false);
    expect(body.reason).toContain('capability');
  });

  test('a stale attempt and a foreign lease are both refused by name', async () => {
    const cookie = await signInCookie('fence@example.com');
    const device = await pairDevice({ cookie, deviceId: 'dev_fence_00000001' });
    const dispatchId = await createDispatch({
      cookie,
      deviceId: device.deviceId,
      jobId: 'job-fence-1',
    });
    const claimed = (await (
      await claim({ token: device.token, deviceId: device.deviceId })
    ).json()) as {
      fence: { attempt: number; lease: { leaseId: string } };
    };
    const leaseId = claimed.fence.lease.leaseId;

    const stale = await app.handle(
      request(
        'POST',
        '/api/generation/runners/status',
        {
          schemaVersion: 1,
          deviceId: device.deviceId,
          dispatchId,
          attempt: 2,
          leaseId,
          status: 'succeeded',
          candidateCount: 1,
          runnerNow: new Date().toISOString(),
        },
        bearer(device.token),
      ),
    );
    expect(stale.status).toBe(409);
    expect((await stale.json()).code).toBe('stale_attempt');

    const wrongLease = await app.handle(
      request(
        'POST',
        '/api/generation/runners/status',
        {
          schemaVersion: 1,
          deviceId: device.deviceId,
          dispatchId,
          attempt: 1,
          leaseId: crypto.randomUUID(),
          status: 'succeeded',
          candidateCount: 1,
          runnerNow: new Date().toISOString(),
        },
        bearer(device.token),
      ),
    );
    expect(wrongLease.status).toBe(409);
    expect((await wrongLease.json()).code).toBe('lease_not_held');

    // The refused updates changed nothing — the newer attempt cannot be
    // overwritten by a runner that lost the fence.
    const row = await client.execute({
      sql: 'SELECT status, candidate_count, lease_id FROM generation_dispatches WHERE id = ?',
      args: [dispatchId],
    });
    expect(String(row.rows[0]?.status)).toBe('running');
    expect(Number(row.rows[0]?.candidate_count)).toBe(0);
    expect(String(row.rows[0]?.lease_id)).toBe(leaseId);

    // The honest update succeeds.
    const ok = await app.handle(
      request(
        'POST',
        '/api/generation/runners/status',
        {
          schemaVersion: 1,
          deviceId: device.deviceId,
          dispatchId,
          attempt: 1,
          leaseId,
          status: 'awaiting_review',
          candidateCount: 1,
          candidateId: 'candidate-fence-1',
          preparedHash: 'f'.repeat(64),
          runnerNow: new Date().toISOString(),
        },
        bearer(device.token),
      ),
    );
    expect(ok.status).toBe(200);
    const okBody = (await ok.json()) as { ok: boolean; status: string };
    expect(okBody.ok).toBe(true);
    expect(okBody.status).toBe('awaiting_review');
    // A terminal status releases the lease.
    const after = await client.execute({
      sql: 'SELECT lease_id FROM generation_dispatches WHERE id = ?',
      args: [dispatchId],
    });
    expect(after.rows[0]?.lease_id).toBeNull();
  });

  test('an expired lease is a reconcile signal, not a silent overwrite', async () => {
    const cookie = await signInCookie('lease-expiry@example.com');
    const device = await pairDevice({ cookie, deviceId: 'dev_lease_exp_0001' });
    const dispatchId = await createDispatch({
      cookie,
      deviceId: device.deviceId,
      jobId: 'job-lease-expiry',
    });
    const claimed = (await (
      await claim({ token: device.token, deviceId: device.deviceId })
    ).json()) as {
      fence: { lease: { leaseId: string } };
    };
    await client.execute({
      sql: 'UPDATE generation_dispatches SET lease_expires_at = ? WHERE id = ?',
      args: [Date.now() - 1000, dispatchId],
    });
    const res = await app.handle(
      request(
        'POST',
        '/api/generation/runners/status',
        {
          schemaVersion: 1,
          deviceId: device.deviceId,
          dispatchId,
          attempt: 1,
          leaseId: claimed.fence.lease.leaseId,
          status: 'succeeded',
          candidateCount: 1,
          runnerNow: new Date().toISOString(),
        },
        bearer(device.token),
      ),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('lease_expired');
    // The local result is never destroyed by expiry — the row is untouched.
    const row = await client.execute({
      sql: 'SELECT status FROM generation_dispatches WHERE id = ?',
      args: [dispatchId],
    });
    expect(String(row.rows[0]?.status)).toBe('running');
  });

  test('re-submitting the same locked request does not create a second dispatch', async () => {
    const cookie = await signInCookie('idempotent@example.com');
    const device = await pairDevice({ cookie, deviceId: 'dev_idempotent_01' });
    const body = {
      deviceId: device.deviceId,
      jobId: 'job-idempotent',
      requestKey: 'job-idempotent:k',
      effectiveSpecHash: 'a'.repeat(64),
      spec: spec(),
    };
    const first = await app.handle(request('POST', '/api/generation/dispatches', body, { cookie }));
    expect(first.status).toBe(201);
    const second = await app.handle(
      request('POST', '/api/generation/dispatches', body, { cookie }),
    );
    expect(second.status).toBe(200);
    const rows = await client.execute({
      sql: "SELECT COUNT(*) AS count FROM generation_dispatches WHERE job_id = 'job-idempotent'",
    });
    expect(Number(rows.rows[0]?.count)).toBe(1);
  });

  test('a dispatch spec with an unknown field is refused outright', async () => {
    const cookie = await signInCookie('allowlist@example.com');
    const device = await pairDevice({ cookie, deviceId: 'dev_allowlist_0001' });
    for (const smuggled of [
      { command: 'rm -rf /' },
      { engineUrl: 'http://127.0.0.1:8188/' },
      { callbackUrl: 'https://example.invalid/hook' },
    ]) {
      const res = await app.handle(
        request(
          'POST',
          '/api/generation/dispatches',
          {
            deviceId: device.deviceId,
            jobId: `job-smuggle-${Object.keys(smuggled)[0]}`,
            requestKey: 'k',
            effectiveSpecHash: 'a'.repeat(64),
            spec: spec(smuggled),
          },
          { cookie },
        ),
      );
      expect(res.status).toBe(422);
    }
  });
});

describe('AC-2/AC-3: candidates and artifacts stay private', () => {
  const setup = async (email: string, deviceId: string, upload: boolean) => {
    const cookie = await signInCookie(email);
    const device = await pairDevice({
      cookie,
      deviceId,
      artifactUploadEnabled: upload,
    });
    const dispatchId = await createDispatch({
      cookie,
      deviceId: device.deviceId,
      jobId: `job-${deviceId}`,
    });
    const claimed = (await (
      await claim({ token: device.token, deviceId: device.deviceId })
    ).json()) as { fence: { attempt: number; lease: { leaseId: string } } };
    return { cookie, device, dispatchId, fence: claimed.fence };
  };

  test('recording a candidate writes a private row and publishes nothing', async () => {
    const { cookie, device, dispatchId, fence } = await setup(
      'candidate@example.com',
      'dev_candidate_0001',
      false,
    );
    const communityBefore = await client.execute('SELECT COUNT(*) AS count FROM community_assets');

    const res = await app.handle(
      request(
        'POST',
        '/api/generation/runners/candidates',
        {
          schemaVersion: 1,
          deviceId: device.deviceId,
          dispatchId,
          attempt: fence.attempt,
          leaseId: fence.lease.leaseId,
          candidateId: 'candidate-1',
          preparedHash: 'b'.repeat(64),
          seed: 7,
          engineId: 'sdcpp',
          mimeType: 'image/png',
          bytes: 2048,
          provenanceState: 'partial',
          runnerNow: new Date().toISOString(),
        },
        bearer(device.token),
      ),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { published: number; candidate: { status: string } };
    expect(body.published).toBe(0);
    expect(body.candidate.status).toBe('pending');

    const communityAfter = await client.execute('SELECT COUNT(*) AS count FROM community_assets');
    expect(Number(communityAfter.rows[0]?.count)).toBe(Number(communityBefore.rows[0]?.count));
    const staging = await client.execute(
      "SELECT COUNT(*) AS count FROM asset_publish_staging WHERE state <> 'rolled_back'",
    );
    expect(Number(staging.rows[0]?.count)).toBe(0);

    // The private prompt is not copied into the candidate row.
    const provenance = await client.execute({
      sql: 'SELECT provenance_json FROM generation_candidates WHERE id = ?',
      args: ['candidate-1'],
    });
    expect(String(provenance.rows[0]?.provenance_json)).not.toContain('a hero portrait');

    // Re-reporting the same bytes resolves to the same candidate.
    const again = await app.handle(
      request(
        'POST',
        '/api/generation/runners/candidates',
        {
          schemaVersion: 1,
          deviceId: device.deviceId,
          dispatchId,
          attempt: fence.attempt,
          leaseId: fence.lease.leaseId,
          candidateId: 'candidate-1-retry',
          preparedHash: 'b'.repeat(64),
          seed: 7,
          provenanceState: 'partial',
          runnerNow: new Date().toISOString(),
        },
        bearer(device.token),
      ),
    );
    expect(again.status).toBe(201);
    const count = await client.execute({
      sql: 'SELECT COUNT(*) AS count FROM generation_candidates WHERE prepared_hash = ?',
      args: ['b'.repeat(64)],
    });
    expect(Number(count.rows[0]?.count)).toBe(1);

    // The owner can review it — privately.
    const list = await app.handle(
      request('GET', '/api/generation/candidates', undefined, { cookie }),
    );
    expect(((await list.json()) as unknown[]).length).toBe(1);
    const review = await app.handle(
      request(
        'POST',
        '/api/generation/candidates/candidate-1/review',
        { decision: 'accept' },
        { cookie },
      ),
    );
    expect(review.status).toBe(200);
    const reviewBody = (await review.json()) as {
      published: number;
      candidate: { status: string };
    };
    expect(reviewBody.published).toBe(0);
    expect(reviewBody.candidate.status).toBe('accepted');
    const communityFinal = await client.execute('SELECT COUNT(*) AS count FROM community_assets');
    expect(Number(communityFinal.rows[0]?.count)).toBe(Number(communityBefore.rows[0]?.count));
  });

  test('artifact upload is off by default and refuses a disabled device', async () => {
    const { device, dispatchId, fence } = await setup(
      'artifact-off@example.com',
      'dev_artifact_off1',
      false,
    );
    const res = await app.handle(
      request(
        'POST',
        '/api/generation/runners/artifact',
        {
          schemaVersion: 1,
          deviceId: device.deviceId,
          dispatchId,
          attempt: fence.attempt,
          leaseId: fence.lease.leaseId,
          candidateId: 'candidate-off',
          kind: 'image',
          mimeType: 'image/png',
          bytes: 128,
          sha256: 'c'.repeat(64),
          runnerNow: new Date().toISOString(),
        },
        bearer(device.token),
      ),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('upload_disabled');
  });

  test('an enabled device stages privately and the owner can retrieve it', async () => {
    const { cookie, device, dispatchId, fence } = await setup(
      'artifact-on@example.com',
      'dev_artifact_on01',
      true,
    );
    const payload = new TextEncoder().encode('pretend-png-bytes');
    const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', payload))]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');

    const ticketRes = await app.handle(
      request(
        'POST',
        '/api/generation/runners/artifact',
        {
          schemaVersion: 1,
          deviceId: device.deviceId,
          dispatchId,
          attempt: fence.attempt,
          leaseId: fence.lease.leaseId,
          candidateId: 'candidate-on',
          kind: 'image',
          mimeType: 'image/png',
          bytes: payload.byteLength,
          sha256,
          runnerNow: new Date().toISOString(),
        },
        bearer(device.token),
      ),
    );
    expect(ticketRes.status).toBe(201);
    const ticketBody = (await ticketRes.json()) as {
      ticket: { ticketId: string; stagingKey: string };
    };
    // Private staging namespace — never the content-addressed public one.
    expect(ticketBody.ticket.stagingKey.startsWith('generation-staging/')).toBe(true);
    expect(ticketBody.ticket.stagingKey.startsWith('assets/')).toBe(false);

    const upload = await app.handle(
      new Request(`${BASE_URL}/api/generation/runner-artifacts/${ticketBody.ticket.ticketId}`, {
        method: 'PUT',
        headers: { ...bearer(device.token), 'content-type': 'image/png' },
        body: payload,
      }),
    );
    expect(upload.status).toBe(200);

    // A mismatched hash is refused — byte identity is verified, not asserted.
    const otherTicket = await app.handle(
      request(
        'POST',
        '/api/generation/runners/artifact',
        {
          schemaVersion: 1,
          deviceId: device.deviceId,
          dispatchId,
          attempt: fence.attempt,
          leaseId: fence.lease.leaseId,
          candidateId: 'candidate-on-2',
          kind: 'image',
          mimeType: 'image/png',
          bytes: 4,
          sha256: 'a'.repeat(64),
          runnerNow: new Date().toISOString(),
        },
        bearer(device.token),
      ),
    );
    const otherId = ((await otherTicket.json()) as { ticket: { ticketId: string } }).ticket
      .ticketId;
    const badUpload = await app.handle(
      new Request(`${BASE_URL}/api/generation/runner-artifacts/${otherId}`, {
        method: 'PUT',
        headers: { ...bearer(device.token), 'content-type': 'image/png' },
        body: new TextEncoder().encode('nope'),
      }),
    );
    expect(badUpload.status).toBe(422);

    // The owner retrieves it; a stranger cannot.
    const raw = await app.handle(
      request(
        'GET',
        `/api/generation/runner-artifacts/${ticketBody.ticket.ticketId}/raw`,
        undefined,
        {
          cookie,
        },
      ),
    );
    expect(raw.status).toBe(200);
    expect(raw.headers.get('cache-control')).toBe('private, no-store');
    expect(new Uint8Array(await raw.arrayBuffer()).byteLength).toBe(payload.byteLength);

    const stranger = await signInCookie('stranger@example.com');
    const denied = await app.handle(
      request(
        'GET',
        `/api/generation/runner-artifacts/${ticketBody.ticket.ticketId}/raw`,
        undefined,
        {
          cookie: stranger,
        },
      ),
    );
    expect(denied.status).toBe(404);
  });

  test('the artifact list marks expiry instead of offering a dead link', async () => {
    const { cookie, device, dispatchId, fence } = await setup(
      'artifact-expiry@example.com',
      'dev_artifact_exp1',
      true,
    );
    await app.handle(
      request(
        'POST',
        '/api/generation/runners/artifact',
        {
          schemaVersion: 1,
          deviceId: device.deviceId,
          dispatchId,
          attempt: fence.attempt,
          leaseId: fence.lease.leaseId,
          candidateId: 'candidate-exp',
          kind: 'image',
          mimeType: 'image/png',
          bytes: 32,
          sha256: 'd'.repeat(64),
          runnerNow: new Date().toISOString(),
        },
        bearer(device.token),
      ),
    );
    const listed = await app.handle(
      request('GET', `/api/generation/dispatches/${dispatchId}/artifacts`, undefined, { cookie }),
    );
    const entries = (await listed.json()) as Array<{ expired: boolean; uploaded: boolean }>;
    expect(entries).toHaveLength(1);
    expect(entries[0]?.uploaded).toBe(false);
    expect(entries[0]?.expired).toBe(false);

    await client.execute({
      sql: 'UPDATE runner_artifact_tickets SET expires_at = ? WHERE dispatch_id = ?',
      args: [Date.now() - 1000, dispatchId],
    });
    const refreshed = await app.handle(
      request('GET', `/api/generation/dispatches/${dispatchId}/artifacts`, undefined, { cookie }),
    );
    expect(((await refreshed.json()) as Array<{ expired: boolean }>)[0]?.expired).toBe(true);
  });
});

describe('AC-6: cancellation and availability are truthful', () => {
  test('a cancel request is recorded as a request, never as a confirmation', async () => {
    const cookie = await signInCookie('cancel@example.com');
    const device = await pairDevice({ cookie, deviceId: 'dev_cancel_0000001' });
    const dispatchId = await createDispatch({
      cookie,
      deviceId: device.deviceId,
      jobId: 'job-cancel-1',
    });
    const res = await app.handle(
      request('POST', `/api/generation/dispatches/${dispatchId}/cancel`, undefined, { cookie }),
    );
    expect(res.status).toBe(202);
    const body = (await res.json()) as {
      cancellation: { requested: boolean; confirmed: boolean };
    };
    expect(body.cancellation.requested).toBe(true);
    expect(body.cancellation.confirmed).toBe(false);

    // A terminal dispatch cannot be reopened by a late cancel.
    await client.execute({
      sql: "UPDATE generation_dispatches SET status = 'succeeded' WHERE id = ?",
      args: [dispatchId],
    });
    const late = await app.handle(
      request('POST', `/api/generation/dispatches/${dispatchId}/cancel`, undefined, { cookie }),
    );
    expect(late.status).toBe(409);
  });

  test('availability names the reason and always offers a remedy', async () => {
    const cookie = await signInCookie('availability@example.com');
    const anonymous = await app.handle(request('GET', '/api/generation/runners/availability'));
    expect(anonymous.status).toBe(401);

    const none = await app.handle(
      request('GET', '/api/generation/runners/availability', undefined, { cookie }),
    );
    const noneBody = (await none.json()) as { available: boolean; code: string; remedy: string };
    expect(noneBody.available).toBe(false);
    expect(noneBody.code).toBe('no_runner_paired');
    expect(noneBody.remedy).toContain('runner:pair');

    const device = await pairDevice({ cookie, deviceId: 'dev_avail_00000001' });
    const online = await app.handle(
      request('GET', '/api/generation/runners/availability', undefined, { cookie }),
    );
    const onlineBody = (await online.json()) as { available: boolean; mode: string };
    expect(onlineBody.available).toBe(true);
    expect(onlineBody.mode).toBe('paired_outbound');

    // Stale last-seen is offline, not "available but silent".
    await client.execute({
      sql: 'UPDATE runner_devices SET last_seen_at = ? WHERE id = ?',
      args: [Date.now() - 3_600_000, device.deviceId],
    });
    const offline = (await (
      await app.handle(
        request('GET', '/api/generation/runners/availability', undefined, { cookie }),
      )
    ).json()) as { available: boolean; code: string; remedy: string };
    expect(offline.available).toBe(false);
    expect(offline.code).toBe('runner_offline');
    expect(offline.remedy.length).toBeGreaterThan(0);

    await app.handle(
      request('DELETE', `/api/generation/runners/${device.deviceId}`, undefined, { cookie }),
    );
    const revoked = (await (
      await app.handle(
        request('GET', '/api/generation/runners/availability', undefined, { cookie }),
      )
    ).json()) as { code: string };
    expect(revoked.code).toBe('runner_revoked');
  });
});
