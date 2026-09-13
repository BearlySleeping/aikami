// apps/frontend/hub/src/lib/server/api/tests/asset_publish.test.ts
//
// C-513 — Community asset publishing: reserve → private upload → commit →
// moderation + promotion. Uses the same in-memory libsql D1 + mock R2 harness
// as `map_studio.test.ts`.
//
// Coverage map:
//   AC-1  reserve/upload/commit, private intake, no catalog write, rollback
//   AC-2  licence/provenance gate fails closed at reserve
//   AC-3  moderation controls visibility; promotion is idempotent
//   AC-5  owner delete delists without deleting a shared object
//   AC-6  pending bytes are private at delivery (anonymous + cross-account)
//   AC-7  scoped rights distinguish game use from standalone distribution
//   AC-8  reserve/upload/commit idempotent across D1 and R2 failures
//   AC-9  a completed generation job is not a publication
//   AC-14 the D1 migration applies additively and its constraints bite

// biome-ignore-all lint/style/useNamingConvention: Cloudflare binding names are SCREAMING_SNAKE_CASE

import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAX_UPLOAD_SIZE } from '@aikami/constants';
import { stripImageMetadata } from '@aikami/utils';
import { type Client, createClient } from '@libsql/client';

mock.module('../better_auth.ts', () => ({
  getBetterAuth: () => ({
    api: {
      getSession: async ({ headers }: { headers: Headers }) => {
        const cookie = headers.get('cookie');
        return cookie?.startsWith('asset-user=')
          ? { user: { id: decodeURIComponent(cookie.slice('asset-user='.length)) } }
          : undefined;
      },
    },
    handler: () => new Response(undefined, { status: 404 }),
  }),
}));

const BASE_URL = 'http://localhost:5173';

/** Minimal D1Database shim over an in-memory libsql client (as in auth.test). */
const createMockD1 = (dbClient: Client) => {
  const faults: Array<{ pattern: RegExp; message: string }> = [];
  const prepareStatement = (sql: string) => ({
    bind: (...params: never[]) => {
      const checkFault = (): void => {
        for (const fault of faults) {
          if (fault.pattern.test(sql)) {
            throw new Error(fault.message);
          }
        }
      };
      return {
        all: async () => {
          checkFault();
          const res = await dbClient.execute({ sql, args: params as never[] });
          return { results: res.rows };
        },
        first: async () => {
          checkFault();
          const res = await dbClient.execute({ sql, args: params as never[] });
          return res.rows[0] ?? null;
        },
        run: async () => {
          checkFault();
          await dbClient.execute({ sql, args: params as never[] });
          return { meta: { last_row_id: 0, changes: 0 } };
        },
        raw: async () => {
          checkFault();
          const res = await dbClient.execute({ sql, args: params as never[] });
          return res.rows;
        },
      };
    },
  });
  return {
    binding: {
      prepare: prepareStatement,
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
    faults,
  };
};

/** Coerces a mock R2 value to bytes. */
const toBytes = (value: string | ArrayBuffer | Uint8Array<ArrayBufferLike>): ArrayBuffer => {
  if (typeof value === 'string') {
    return new TextEncoder().encode(value).buffer;
  }
  if (value instanceof Uint8Array) {
    return value.slice().buffer as ArrayBuffer;
  }
  return value;
};

type StoredObject = { bytes: ArrayBuffer; contentType?: string };

/** In-memory R2 bucket; `failPut` injects an R2 failure. */
const createMockR2 = () => {
  const store = new Map<string, StoredObject>();
  let failPut = false;
  return {
    store,
    failPut: (value: boolean) => {
      failPut = value;
    },
    put: async (
      key: string,
      value: string | ArrayBuffer | Uint8Array<ArrayBufferLike>,
      options?: { httpMetadata?: { contentType?: string } },
    ) => {
      if (failPut) {
        throw new Error('R2 put failed');
      }
      const bytes = toBytes(value);
      store.set(key, { bytes, contentType: options?.httpMetadata?.contentType });
      return { key };
    },
    get: async (key: string) => {
      const entry = store.get(key);
      if (!entry) {
        return null;
      }
      return {
        arrayBuffer: async () => entry.bytes,
        httpMetadata: { contentType: entry.contentType },
      };
    },
    delete: async (key: string) => {
      store.delete(key);
    },
    list: async () => ({ objects: [] }),
  };
};

type AssetCommunityEnv = {
  DB: import('@cloudflare/workers-types').D1Database;
  CATALOG_BUCKET: import('@cloudflare/workers-types').R2Bucket;
  UPLOADS_BUCKET: import('@cloudflare/workers-types').R2Bucket;
};

let client: Client;
let db: ReturnType<typeof createMockD1>;
let uploads: ReturnType<typeof createMockR2>;
let catalog: ReturnType<typeof createMockR2>;
let app: import('../index.ts').App;

const MODERATOR_ID = 'moderator-0000-0000-0000-000000000001';
const CATALOG_ORIGIN = 'https://assets.test';

const applyD1Migrations = async (): Promise<void> => {
  const dir = join(
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
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(dir, file), 'utf8');
    for (const statement of sql.split('--> statement-breakpoint')) {
      const trimmed = statement.trim();
      if (trimmed) {
        await client.execute(trimmed);
      }
    }
  }
};

const request = (
  method: string,
  path: string,
  body?: unknown,
  cookie?: string,
  headers: Record<string, string> = {},
  rawBody?: BodyInit | Uint8Array,
) => {
  const requestHeaders: Record<string, string> = {
    ...(cookie ? { cookie } : {}),
    ...headers,
  };
  const init: RequestInit = { method, headers: requestHeaders };
  if (body !== undefined) {
    requestHeaders['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  } else if (rawBody !== undefined) {
    init.body = rawBody as unknown as BodyInit;
  }
  return new Request(`${BASE_URL}${path}`, init);
};

/** Test bodies must already match the declared staging size. */
const declaredBytes = { 'content-length': String(0) };

const signInCookie = async (email: string): Promise<string> => {
  const accountId = crypto.randomUUID();
  await client.execute({
    sql: 'INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    args: [accountId, 'Asset User', email, 1, Date.now(), Date.now()],
  });
  return `asset-user=${encodeURIComponent(accountId)}`;
};

const signInAs = async (accountId: string, email: string): Promise<string> => {
  const existing = await client.execute({
    sql: 'SELECT id FROM user WHERE id = ?',
    args: [accountId],
  });
  if (existing.rows.length === 0) {
    await client.execute({
      sql: 'INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      args: [accountId, 'Asset User', email, 1, Date.now(), Date.now()],
    });
  }
  return `asset-user=${encodeURIComponent(accountId)}`;
};

/** Original, shareable-licence provenance — the base publishable case. */
const originalProvenance = (overrides: Record<string, unknown> = {}) => ({
  source: 'original',
  license: 'CC-BY-4.0',
  author: ['Test Creator'],
  ...overrides,
});

/** A rights decision permitting every scope (the C-518 seam). */
const permissiveRights = (overrides: Record<string, unknown> = {}) => ({
  inference: { permitted: true, evidence: 'test' },
  gameInclusion: { permitted: true, evidence: 'test' },
  standaloneDistribution: { permitted: true, evidence: 'test' },
  ...overrides,
});

const reserveBody = (overrides: Record<string, unknown> = {}) => {
  const bytes = new TextEncoder().encode('fixture-asset-bytes');
  return {
    category: 'portraits',
    tag: 'portraits:test-fixture',
    title: 'Test Fixture',
    ext: '.webp',
    sizeBytes: bytes.byteLength,
    provenance: originalProvenance(),
    ...overrides,
  };
};

const sha256Of = async (bytes: Uint8Array): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

const fixtureBytes = new TextEncoder().encode('fixture-asset-bytes');
const FIXTURE_SHA = await sha256Of(fixtureBytes);

const publish = async (
  cookie: string,
  overrides: Record<string, unknown> = {},
  bytes: Uint8Array = fixtureBytes,
): Promise<{ slug: string; revision: number; response: Response }> => {
  const reserveRes = await app.handle(
    request(
      'POST',
      '/api/assets/community',
      reserveBody({ ...overrides, sizeBytes: bytes.byteLength }),
      cookie,
    ),
  );
  const reserved = (await reserveRes.json()) as { slug: string; revision: number };
  const uploadRes = await app.handle(
    request(
      'PUT',
      `/api/assets/community/${reserved.slug}/upload`,
      undefined,
      cookie,
      {
        'content-type': 'application/octet-stream',
        'content-length': String(bytes.byteLength),
      },
      bytes,
    ),
  );
  return { slug: reserved.slug, revision: reserved.revision, response: uploadRes };
};

beforeAll(async () => {
  client = createClient({ url: ':memory:' });
  await applyD1Migrations();
  db = createMockD1(client);
  uploads = createMockR2();
  catalog = createMockR2();
  const { createApp } = await import('../index.ts');
  app = createApp({
    assetCommunityEnv: {
      DB: db.binding as unknown as AssetCommunityEnv['DB'],
      CATALOG_BUCKET: catalog as unknown as AssetCommunityEnv['CATALOG_BUCKET'],
      UPLOADS_BUCKET: uploads as unknown as AssetCommunityEnv['UPLOADS_BUCKET'],
      moderationAccountIds: [MODERATOR_ID],
      catalogOriginUrl: CATALOG_ORIGIN,
    },
  });
});

afterAll(async () => {
  await client.close();
});

// The declared size must match the fixture bytes for every happy-path request.
beforeAll(() => {
  declaredBytes['content-length'] = String(fixtureBytes.byteLength);
});

describe('AC-1: reserve, private upload, and commit', () => {
  test('reserve requires a session', async () => {
    const res = await app.handle(request('POST', '/api/assets/community', reserveBody()));
    expect(res.status).toBe(401);
  });

  test('reserve validates metadata and reserves (slug, revision) with no R2 write', async () => {
    const cookie = await signInCookie('ac1-reserve@example.com');
    catalog.store.clear();
    uploads.store.clear();

    const res = await app.handle(
      request('POST', '/api/assets/community', reserveBody({ title: 'Reserve Me' }), cookie),
    );
    expect(res.status).toBe(201);
    const result = (await res.json()) as {
      slug: string;
      revision: number;
      uploadPath: string;
      stagingState: string;
    };
    expect(result.slug).toBe('reserve-me');
    expect(result.revision).toBe(1);
    expect(result.stagingState).toBe('reserved');
    expect(result.uploadPath).toBe('/api/assets/community/reserve-me/upload');

    const rows = await client.execute(
      "SELECT state, staging_key FROM asset_publish_staging WHERE slug = 'reserve-me'",
    );
    expect(rows.rows[0]?.state).toBe('reserved');
    expect(String(rows.rows[0]?.staging_key)).toMatch(/^staging\/[^/]+\/[^/]+$/);
    // Nothing is public yet: no intake object and no catalog object.
    expect(uploads.store.size).toBe(0);
    expect(catalog.store.size).toBe(0);
  });

  test('an invalid category/ext pair is rejected at reserve', async () => {
    const cookie = await signInCookie('ac1-bad-ext@example.com');
    const res = await app.handle(
      request(
        'POST',
        '/api/assets/community',
        reserveBody({ category: 'music', ext: '.png' }),
        cookie,
      ),
    );
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe('invalid-argument');
  });

  test('upload computes the hash, lands the object in the private intake bucket, and commits a pending row', async () => {
    const cookie = await signInCookie('ac1-publish@example.com');
    catalog.store.clear();
    const { slug, response } = await publish(cookie, { title: 'Upload Me' });

    expect(response.status).toBe(201);
    const result = (await response.json()) as {
      slug: string;
      revision: number;
      sha256: string;
      moderationState: string;
      deliveryUrl: string;
    };
    expect(result.sha256).toBe(FIXTURE_SHA);
    expect(result.moderationState).toBe('pending');
    expect(result.deliveryUrl).toBe(`/api/assets/community/${slug}/raw`);

    // Bytes are in the private intake plane ...
    const stagingKey = [...uploads.store.keys()][0] as string;
    expect(stagingKey).toMatch(/^staging\/[^/]+\//);
    // ... and NOT in the public catalog bucket. No public URL exists.
    expect(catalog.store.size).toBe(0);

    const row = await client.execute(
      `SELECT moderation_state, sha256, r2_key, promoted_at FROM community_assets WHERE slug = '${slug}'`,
    );
    expect(row.rows[0]?.moderation_state).toBe('pending');
    expect(row.rows[0]?.sha256).toBe(FIXTURE_SHA);
    expect(row.rows[0]?.r2_key).toBeNull();
    expect(row.rows[0]?.promoted_at).toBeNull();

    const staging = await client.execute(
      `SELECT state, sha256 FROM asset_publish_staging WHERE slug = '${slug}'`,
    );
    expect(staging.rows[0]?.state).toBe('committed');
    expect(staging.rows[0]?.sha256).toBe(FIXTURE_SHA);
  });

  test('an oversized Content-Length is rejected before the body is read', async () => {
    const cookie = await signInCookie('ac1-oversize@example.com');
    const uploadsBefore = uploads.store.size;
    const reserveRes = await app.handle(
      request('POST', '/api/assets/community', reserveBody({ title: 'Too Big' }), cookie),
    );
    const reserved = (await reserveRes.json()) as { slug: string };

    // A body that throws if it is ever consumed — proving the pre-buffer check.
    const unreadable = new ReadableStream({
      pull() {
        throw new Error('body must not be read');
      },
    });

    const res = await app.handle(
      new Request(`${BASE_URL}/api/assets/community/${reserved.slug}/upload`, {
        method: 'PUT',
        headers: {
          cookie,
          'content-type': 'application/octet-stream',
          'content-length': String(MAX_UPLOAD_SIZE + 1),
        },
        body: unreadable,
      }),
    );
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: string }).error).toBe('asset_too_large');
    expect(uploads.store.size).toBe(uploadsBefore);
  });

  test('a declared size that does not match Content-Length fails closed and rolls back', async () => {
    const cookie = await signInCookie('ac1-size-mismatch@example.com');
    const uploadsBefore = uploads.store.size;
    const reserveRes = await app.handle(
      request('POST', '/api/assets/community', reserveBody({ title: 'Mismatch' }), cookie),
    );
    const reserved = (await reserveRes.json()) as { slug: string };

    const res = await app.handle(
      request(
        'PUT',
        `/api/assets/community/${reserved.slug}/upload`,
        undefined,
        cookie,
        { 'content-type': 'application/octet-stream', 'content-length': '7' },
        new TextEncoder().encode('7-bytes'),
      ),
    );
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe('size-mismatch');
    const staging = await client.execute(
      `SELECT state FROM asset_publish_staging WHERE slug = '${reserved.slug}'`,
    );
    expect(staging.rows[0]?.state).toBe('rolled_back');
    expect(uploads.store.size).toBe(uploadsBefore);
  });

  test('an R2 failure rolls the reservation back with no visible row', async () => {
    const cookie = await signInCookie('ac1-r2-fail@example.com');
    const reserveRes = await app.handle(
      request('POST', '/api/assets/community', reserveBody({ title: 'R2 Down' }), cookie),
    );
    const reserved = (await reserveRes.json()) as { slug: string };

    uploads.failPut(true);
    const res = await app.handle(
      request(
        'PUT',
        `/api/assets/community/${reserved.slug}/upload`,
        undefined,
        cookie,
        { 'content-type': 'application/octet-stream', ...declaredBytes },
        fixtureBytes,
      ),
    );
    uploads.failPut(false);

    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toBe('upload-failed');
    const staging = await client.execute(
      `SELECT state FROM asset_publish_staging WHERE slug = '${reserved.slug}'`,
    );
    expect(staging.rows[0]?.state).toBe('rolled_back');
    const committed = await client.execute(
      `SELECT id FROM community_assets WHERE slug = '${reserved.slug}'`,
    );
    expect(committed.rows).toHaveLength(0);
  });
});

describe('AC-2 / AC-7: licence, provenance and scoped-rights gate', () => {
  test('generated provenance without a rights decision fails closed', async () => {
    const cookie = await signInCookie('ac2-generated@example.com');
    catalog.store.clear();
    uploads.store.clear();
    const res = await app.handle(
      request(
        'POST',
        '/api/assets/community',
        reserveBody({
          title: 'Generated No Rights',
          provenance: { source: 'generated:sd', lineage: ['generated:sd'] },
        }),
        cookie,
      ),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string; missing: string[] };
    expect(body.error).toBe('rights-unresolved');
    expect(body.missing).toContain('standaloneDistribution');
    expect(uploads.store.size).toBe(0);
    expect(catalog.store.size).toBe(0);
    const staging = await client.execute(
      "SELECT id FROM asset_publish_staging WHERE slug = 'generated-no-rights'",
    );
    expect(staging.rows).toHaveLength(0);
  });

  test('a proprietary licence on original work is refused', async () => {
    const cookie = await signInCookie('ac2-proprietary@example.com');
    const res = await app.handle(
      request(
        'POST',
        '/api/assets/community',
        reserveBody({
          title: 'Proprietary',
          provenance: originalProvenance({ license: 'proprietary' }),
        }),
        cookie,
      ),
    );
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe('rights-unresolved');
  });

  test('a local filesystem path in provenance is refused', async () => {
    const cookie = await signInCookie('ac2-local-path@example.com');
    const res = await app.handle(
      request(
        'POST',
        '/api/assets/community',
        reserveBody({
          title: 'Local Path',
          provenance: originalProvenance({ source: '/home/creator/refs/hero.png' }),
        }),
        cookie,
      ),
    );
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe('provenance-local-path');
  });

  test('AC-7: game-use-only rights identify the unmet standalone-distribution requirement', async () => {
    const cookie = await signInCookie('ac7-game-use-only@example.com');
    uploads.store.clear();
    catalog.store.clear();
    const res = await app.handle(
      request(
        'POST',
        '/api/assets/community',
        reserveBody({
          title: 'Game Use Only',
          provenance: { source: 'generated:sd' },
          rights: permissiveRights({
            standaloneDistribution: {
              permitted: false,
              evidence: 'model licence forbids output redistribution',
            },
          }),
        }),
        cookie,
      ),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string; missing: string[] };
    expect(body.error).toBe('rights-denied');
    expect(body.missing).toEqual(['standaloneDistribution']);
    // Nothing was uploaded.
    expect(uploads.store.size).toBe(0);
    expect(catalog.store.size).toBe(0);
  });

  test('a fully-scoped rights decision lets a generated asset publish', async () => {
    const cookie = await signInCookie('ac7-permitted@example.com');
    const res = await app.handle(
      request(
        'POST',
        '/api/assets/community',
        reserveBody({
          title: 'Permitted Generated',
          provenance: { source: 'generated:sd', lineage: ['generated:sd'] },
          rights: permissiveRights(),
        }),
        cookie,
      ),
    );
    expect(res.status).toBe(201);
  });
});

describe('AC-3: moderation controls visibility and gates promotion', () => {
  test('pending is not public; approval promotes into the catalog and publishes', async () => {
    const owner = await signInCookie('ac3-owner@example.com');
    const stranger = await signInCookie('ac3-stranger@example.com');
    catalog.store.clear();
    const { slug, revision } = await publish(owner, { title: 'Moderation Target' });
    expect(revision).toBe(1);

    // Public listing: absent.
    const publicBefore = (await (
      await app.handle(request('GET', '/api/assets/community'))
    ).json()) as { items: Array<{ slug: string }> };
    expect(publicBefore.items.some((item) => item.slug === slug)).toBe(false);

    // No object in the public bucket, so no public URL could exist.
    expect(catalog.store.size).toBe(0);

    // The stranger cannot see the pending row either — by slug or by listing.
    const strangerGet = await app.handle(
      request('GET', `/api/assets/community/${slug}`, undefined, stranger),
    );
    expect(strangerGet.status).toBe(404);
    const strangerMine = (await (
      await app.handle(request('GET', '/api/assets/community?mine=1', undefined, stranger))
    ).json()) as { items: Array<{ slug: string }> };
    expect(strangerMine.items.some((item) => item.slug === slug)).toBe(false);

    // The owner does see it.
    const ownerMine = (await (
      await app.handle(request('GET', '/api/assets/community?mine=1', undefined, owner))
    ).json()) as { items: Array<{ slug: string; moderationState: string }> };
    expect(ownerMine.items.find((item) => item.slug === slug)?.moderationState).toBe('pending');

    // Approve.
    const moderatorCookie = await signInAs(MODERATOR_ID, 'moderator@example.com');
    const approve = await app.handle(
      request(
        'POST',
        `/api/assets/community/${slug}/moderation`,
        { decision: 'approved' },
        moderatorCookie,
      ),
    );
    expect(approve.status).toBe(200);
    const approved = (await approve.json()) as { promotedAt: string; deliveryUrl: string };
    expect(approved.deliveryUrl).toBe(
      `${CATALOG_ORIGIN}/assets/${FIXTURE_SHA.slice(0, 2)}/${FIXTURE_SHA}.webp`,
    );

    // The content-addressed catalog object now exists.
    expect(catalog.store.has(`assets/${FIXTURE_SHA.slice(0, 2)}/${FIXTURE_SHA}.webp`)).toBe(true);

    const promoted = await client.execute(
      `SELECT promoted_at, r2_key, moderation_state FROM community_assets WHERE slug = '${slug}'`,
    );
    expect(promoted.rows[0]?.moderation_state).toBe('approved');
    expect(promoted.rows[0]?.promoted_at).not.toBeNull();
    expect(promoted.rows[0]?.r2_key).not.toBeNull();

    // Now it is public for everyone.
    const publicAfter = (await (
      await app.handle(request('GET', '/api/assets/community'))
    ).json()) as { items: Array<{ slug: string; deliveryUrl?: string }> };
    const listed = publicAfter.items.find((item) => item.slug === slug);
    expect(listed).toBeDefined();
    expect(listed?.deliveryUrl).toContain('assets.test');
  });

  test('approving twice is idempotent: one object, one revision', async () => {
    const owner = await signInCookie('ac3-idempotent@example.com');
    const moderatorCookie = await signInAs(MODERATOR_ID, 'moderator2@example.com');
    const { slug } = await publish(owner, { title: 'Idempotent Promotion' });

    for (let i = 0; i < 2; i++) {
      const res = await app.handle(
        request(
          'POST',
          `/api/assets/community/${slug}/moderation`,
          { decision: 'approved' },
          moderatorCookie,
        ),
      );
      expect(res.status).toBe(200);
    }

    const rows = await client.execute(
      `SELECT revision FROM community_assets WHERE slug = '${slug}'`,
    );
    expect(rows.rows).toHaveLength(1);
    expect(catalog.store.has(`assets/${FIXTURE_SHA.slice(0, 2)}/${FIXTURE_SHA}.webp`)).toBe(true);
    expect(uploads.store.size).toBeGreaterThan(0);
  });

  test('rejection leaves the bytes private and records the reason', async () => {
    const owner = await signInCookie('ac3-rejected@example.com');
    const moderatorCookie = await signInAs(MODERATOR_ID, 'moderator3@example.com');
    catalog.store.clear();
    const { slug } = await publish(owner, { title: 'Rejected Asset' });

    const reject = await app.handle(
      request(
        'POST',
        `/api/assets/community/${slug}/moderation`,
        { decision: 'rejected', note: 'not in scope for the curated catalog' },
        moderatorCookie,
      ),
    );
    expect(reject.status).toBe(200);

    const row = await client.execute(
      `SELECT moderation_state, moderation_note, promoted_at, r2_key FROM community_assets WHERE slug = '${slug}'`,
    );
    expect(row.rows[0]?.moderation_state).toBe('rejected');
    expect(String(row.rows[0]?.moderation_note)).toContain('not in scope');
    expect(row.rows[0]?.promoted_at).toBeNull();
    expect(row.rows[0]?.r2_key).toBeNull();
    expect(catalog.store.size).toBe(0);

    const publicList = (await (
      await app.handle(request('GET', '/api/assets/community'))
    ).json()) as { items: Array<{ slug: string }> };
    expect(publicList.items.some((item) => item.slug === slug)).toBe(false);
  });

  test('a non-moderator cannot transition anything (403)', async () => {
    const owner = await signInCookie('ac3-nonmod-owner@example.com');
    const { slug } = await publish(owner, { title: 'Non Moderator' });
    const res = await app.handle(
      request('POST', `/api/assets/community/${slug}/moderation`, { decision: 'approved' }, owner),
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe('not-moderator');
    const row = await client.execute(
      `SELECT moderation_state FROM community_assets WHERE slug = '${slug}'`,
    );
    expect(row.rows[0]?.moderation_state).toBe('pending');
  });
});

describe('AC-6: pending bytes are private at delivery', () => {
  test('anonymous and cross-account fetches of pending bytes fail', async () => {
    const owner = await signInCookie('ac6-owner@example.com');
    const intruder = await signInCookie('ac6-intruder@example.com');
    catalog.store.clear();
    const { slug } = await publish(owner, { title: 'Private Pending' });

    const hash = FIXTURE_SHA;
    // The bytes are not in the public bucket at their content-addressed key.
    expect(catalog.store.has(`assets/${hash.slice(0, 2)}/${hash}.webp`)).toBe(false);
    expect(catalog.store.has(`assets/${hash}.webp`)).toBe(false);

    // The owner-only route refuses everyone but the owner.
    const anon = await app.handle(request('GET', `/api/assets/community/${slug}/raw`));
    expect(anon.status).toBe(401);
    const crossAccount = await app.handle(
      request('GET', `/api/assets/community/${slug}/raw`, undefined, intruder),
    );
    expect(crossAccount.status).toBe(404);

    // Metadata is not public either.
    const anonMeta = await app.handle(request('GET', `/api/assets/community/${slug}`));
    expect(anonMeta.status).toBe(404);

    // The owner can retrieve the pending bytes.
    const ownerRaw = await app.handle(
      request('GET', `/api/assets/community/${slug}/raw`, undefined, owner),
    );
    expect(ownerRaw.status).toBe(200);
    expect(await ownerRaw.text()).toBe('fixture-asset-bytes');
  });
});

describe('AC-5: owner delete delists without deleting a shared object', () => {
  test('a delist keeps a promoted object another revision still references', async () => {
    const moderatorCookie = await signInAs(MODERATOR_ID, 'moderator4@example.com');
    const ownerA = await signInCookie('ac5-owner-a@example.com');
    const ownerB = await signInCookie('ac5-owner-b@example.com');

    // Distinct bytes so the content address is unique to this test: the shared
    // mock catalog bucket also holds the other suites' promoted fixtures.
    const sharedBytes = new TextEncoder().encode('shared-bytes-ac5');
    const sharedSha = await sha256Of(sharedBytes);

    const a = await publish(ownerA, { title: 'Shared Bytes A' }, sharedBytes);
    const b = await publish(ownerB, { title: 'Shared Bytes B' }, sharedBytes);
    expect(a.slug).not.toBe(b.slug);

    for (const slug of [a.slug, b.slug]) {
      const res = await app.handle(
        request(
          'POST',
          `/api/assets/community/${slug}/moderation`,
          { decision: 'approved' },
          moderatorCookie,
        ),
      );
      expect(res.status).toBe(200);
    }
    const key = `assets/${sharedSha.slice(0, 2)}/${sharedSha}.webp`;
    expect(catalog.store.has(key)).toBe(true);

    const deleteRes = await app.handle(
      request('DELETE', `/api/assets/community/${a.slug}`, undefined, ownerA),
    );
    expect(deleteRes.status).toBe(200);

    // Delisted for A ...
    const list = (await (await app.handle(request('GET', '/api/assets/community'))).json()) as {
      items: Array<{ slug: string }>;
    };
    expect(list.items.some((item) => item.slug === a.slug)).toBe(false);
    // ... but B's identical bytes still resolve: the shared object was kept.
    expect(list.items.some((item) => item.slug === b.slug)).toBe(true);
    expect(catalog.store.has(key)).toBe(true);

    // Once the last reference goes, the object is reclaimed.
    const lastDelete = await app.handle(
      request('DELETE', `/api/assets/community/${b.slug}`, undefined, ownerB),
    );
    expect(lastDelete.status).toBe(200);
    expect(catalog.store.has(key)).toBe(false);
  });

  test('a non-owner cannot delete (404, and the row survives)', async () => {
    const owner = await signInCookie('ac5-owner-c@example.com');
    const other = await signInCookie('ac5-other@example.com');
    const { slug } = await publish(owner, { title: 'Delete Guard' });
    const res = await app.handle(
      request('DELETE', `/api/assets/community/${slug}`, undefined, other),
    );
    expect(res.status).toBe(404);
    const rows = await client.execute(`SELECT id FROM community_assets WHERE slug = '${slug}'`);
    expect(rows.rows).toHaveLength(1);
  });
});

describe('AC-8: reserve/upload/commit is idempotent across D1 and R2 failures', () => {
  test('a D1 failure after a successful PUT leaves a recoverable uploaded row, and retry commits exactly one revision', async () => {
    const cookie = await signInCookie('ac8-commit-fail@example.com');
    const reserveRes = await app.handle(
      request('POST', '/api/assets/community', reserveBody({ title: 'Commit Failure' }), cookie),
    );
    const reserved = (await reserveRes.json()) as { slug: string };

    // Fail the commit INSERT only — the PUT has already succeeded.
    db.faults.push({ pattern: /INSERT INTO .?community_assets/i, message: 'D1 write failed' });
    const failed = await app.handle(
      request(
        'PUT',
        `/api/assets/community/${reserved.slug}/upload`,
        undefined,
        cookie,
        { 'content-type': 'application/octet-stream', ...declaredBytes },
        fixtureBytes,
      ),
    );
    db.faults.length = 0;

    expect(failed.status).toBe(502);
    expect(((await failed.json()) as { error: string }).error).toBe('commit-failed');

    const recoverable = await client.execute(
      `SELECT state, sha256 FROM asset_publish_staging WHERE slug = '${reserved.slug}'`,
    );
    expect(recoverable.rows[0]?.state).toBe('uploaded');
    expect(recoverable.rows[0]?.sha256).toBe(FIXTURE_SHA);
    // No visible row was created.
    const visible = await client.execute(
      `SELECT id FROM community_assets WHERE slug = '${reserved.slug}'`,
    );
    expect(visible.rows).toHaveLength(0);

    // Retry resumes rather than duplicating.
    const retry = await app.handle(
      request(
        'PUT',
        `/api/assets/community/${reserved.slug}/upload`,
        undefined,
        cookie,
        { 'content-type': 'application/octet-stream', ...declaredBytes },
        fixtureBytes,
      ),
    );
    expect(retry.status).toBe(201);
    expect(((await retry.json()) as { sha256: string }).sha256).toBe(FIXTURE_SHA);

    const committed = await client.execute(
      `SELECT revision FROM community_assets WHERE slug = '${reserved.slug}'`,
    );
    expect(committed.rows).toHaveLength(1);

    const staging = await client.execute(
      `SELECT state FROM asset_publish_staging WHERE slug = '${reserved.slug}'`,
    );
    expect(staging.rows[0]?.state).toBe('committed');
  });

  test('a failed promotion is retryable and promotes at most once', async () => {
    const owner = await signInCookie('ac8-promote-fail@example.com');
    const moderatorCookie = await signInAs(MODERATOR_ID, 'moderator5@example.com');
    const { slug } = await publish(owner, { title: 'Promotion Failure' });

    catalog.failPut(true);
    const failed = await app.handle(
      request(
        'POST',
        `/api/assets/community/${slug}/moderation`,
        { decision: 'approved' },
        moderatorCookie,
      ),
    );
    catalog.failPut(false);
    expect(failed.status).toBe(502);

    const stillPending = await client.execute(
      `SELECT moderation_state, promoted_at FROM community_assets WHERE slug = '${slug}'`,
    );
    expect(stillPending.rows[0]?.moderation_state).toBe('pending');
    expect(stillPending.rows[0]?.promoted_at).toBeNull();

    const retry = await app.handle(
      request(
        'POST',
        `/api/assets/community/${slug}/moderation`,
        { decision: 'approved' },
        moderatorCookie,
      ),
    );
    expect(retry.status).toBe(200);

    const rows = await client.execute(
      `SELECT revision FROM community_assets WHERE slug = '${slug}'`,
    );
    expect(rows.rows).toHaveLength(1);
    const key = `assets/${FIXTURE_SHA.slice(0, 2)}/${FIXTURE_SHA}.webp`;
    expect(catalog.store.has(key)).toBe(true);
  });

  test('a concurrent duplicate reserve does not create two live reservations', async () => {
    const cookie = await signInCookie('ac8-reserve-race@example.com');
    const [first, second] = await Promise.all([
      app.handle(request('POST', '/api/assets/community', reserveBody({ title: 'Race' }), cookie)),
      app.handle(request('POST', '/api/assets/community', reserveBody({ title: 'Race' }), cookie)),
    ]);
    expect([first.status, second.status].every((status) => status === 201)).toBe(true);
    const live = await client.execute(
      "SELECT COUNT(*) AS count FROM asset_publish_staging WHERE slug = 'race' AND state <> 'rolled_back'",
    );
    expect(Number(live.rows[0]?.count)).toBe(1);
  });
});

describe('AC-9: a completed generation job is not a publication', () => {
  test('completing a generation job with auto-publish off writes no community rows', async () => {
    const { recordGenerationJobCompletion } = await import('../asset_generation_seam.ts');
    const rowsBefore = await client.execute('SELECT COUNT(*) AS count FROM community_assets');
    const stagingBefore = await client.execute(
      'SELECT COUNT(*) AS count FROM asset_publish_staging',
    );

    recordGenerationJobCompletion({
      jobId: 'job-1',
      ownerAccountId: 'owner-1',
      candidateCount: 4,
    });

    const rowsAfter = await client.execute('SELECT COUNT(*) AS count FROM community_assets');
    const stagingAfter = await client.execute(
      'SELECT COUNT(*) AS count FROM asset_publish_staging',
    );
    expect(Number(rowsAfter.rows[0]?.count)).toBe(Number(rowsBefore.rows[0]?.count));
    expect(Number(stagingAfter.rows[0]?.count)).toBe(Number(stagingBefore.rows[0]?.count));
  });
});

describe('AC-14: the D1 migration is additive and its constraints bite', () => {
  test('existing tables survive and the new constraints reject bad rows', async () => {
    // Prior rows from earlier suites are still intact after 0009 was applied.
    const users = await client.execute('SELECT COUNT(*) AS count FROM user');
    expect(Number(users.rows[0]?.count)).toBeGreaterThan(0);

    const duplicate = await client.execute(
      "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name IN ('asset_publish_staging','community_assets')",
    );
    expect(Number(duplicate.rows[0]?.count)).toBe(2);

    // Non-url-safe slug is rejected by the CHECK constraint.
    await expect(
      client.execute({
        sql: 'INSERT INTO community_assets (id, owner_account_id, slug, revision, title, category, tag, sha256, size_bytes, ext, provenance_json, moderation_state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        args: [
          crypto.randomUUID(),
          await firstUserId(),
          'Not Url Safe',
          1,
          'Bad',
          'portraits',
          'portraits:bad',
          FIXTURE_SHA,
          10,
          '.webp',
          '{}',
          'pending',
          Date.now(),
          Date.now(),
        ],
      }),
    ).rejects.toThrow();
  });

  test('the moderation state CHECK rejects an unknown state', async () => {
    await expect(
      client.execute({
        sql: 'INSERT INTO community_assets (id, owner_account_id, slug, revision, title, category, tag, sha256, size_bytes, ext, provenance_json, moderation_state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        args: [
          crypto.randomUUID(),
          await firstUserId(),
          'valid-slug',
          1,
          'Bad State',
          'portraits',
          'portraits:bad-state',
          FIXTURE_SHA,
          10,
          '.webp',
          '{}',
          'delisted',
          Date.now(),
          Date.now(),
        ],
      }),
    ).rejects.toThrow();
  });
});

const firstUserId = async (): Promise<string> => {
  const rows = await client.execute('SELECT id FROM user LIMIT 1');
  return String(rows.rows[0]?.id);
};

// ---------------------------------------------------------------------------
// Security/privacy QR — rate-limit publish per account
// ---------------------------------------------------------------------------

/** The window the hub enforces, mirrored here so the test documents the budget. */
const PUBLISH_MAX_HITS = 30;

describe('Security/privacy: publish is rate-limited per account', () => {
  test('a reserve burst from one account is refused with 429 once its window is full', async () => {
    const cookie = await signInCookie('rate-limit-burst@example.com');

    const statuses: number[] = [];
    for (let attempt = 0; attempt < PUBLISH_MAX_HITS + 1; attempt++) {
      const res = await app.handle(
        request(
          'POST',
          '/api/assets/community',
          reserveBody({ title: `Burst ${attempt}` }),
          cookie,
        ),
      );
      statuses.push(res.status);
    }

    // The whole budget is usable — the limiter is a window, not a cooldown —
    // and only the hit past it is refused.
    expect(statuses.slice(0, PUBLISH_MAX_HITS).every((status) => status === 201)).toBe(true);
    expect(statuses[PUBLISH_MAX_HITS]).toBe(429);
  });

  test('the refusal body is the documented rate_limited code', async () => {
    const cookie = await signInCookie('rate-limit-body@example.com');
    let last: Response | undefined;
    for (let attempt = 0; attempt < PUBLISH_MAX_HITS + 1; attempt++) {
      last = await app.handle(
        request('POST', '/api/assets/community', reserveBody({ title: `Body ${attempt}` }), cookie),
      );
    }
    expect(last).toBeDefined();
    if (!last) {
      throw new Error('the burst produced no response');
    }
    expect(last.status).toBe(429);
    expect(((await last.json()) as { error: string }).error).toBe('rate_limited');
  });

  test('the limit is per account — an exhausted account does not affect another', async () => {
    const exhausted = await signInCookie('rate-limit-exhausted@example.com');
    for (let attempt = 0; attempt < PUBLISH_MAX_HITS + 1; attempt++) {
      await app.handle(
        request(
          'POST',
          '/api/assets/community',
          reserveBody({ title: `Exhausted ${attempt}` }),
          exhausted,
        ),
      );
    }

    const fresh = await signInCookie('rate-limit-fresh@example.com');
    const res = await app.handle(
      request('POST', '/api/assets/community', reserveBody({ title: 'Fresh Account' }), fresh),
    );
    expect(res.status).toBe(201);
  });

  test('one publish spends the reserve and the upload from the same per-account budget', async () => {
    const cookie = await signInCookie('rate-limit-budget@example.com');

    // Hits 1 and 2: the two hops of a single publish.
    const { response } = await publish(cookie, { title: 'Budget Publish' });
    expect(response.status).toBe(201);

    const statuses: number[] = [];
    for (let attempt = 0; attempt < PUBLISH_MAX_HITS - 1; attempt++) {
      const res = await app.handle(
        request(
          'POST',
          '/api/assets/community',
          reserveBody({ title: `After Publish ${attempt}` }),
          cookie,
        ),
      );
      statuses.push(res.status);
    }

    // 28 more reserves fill the window exactly (2 + 28 = 30) and the next is
    // refused — proving both hops are metered, and that the brake leaves room
    // for a normal publish followed by a long tail of retries and re-publishes.
    expect(statuses.slice(0, PUBLISH_MAX_HITS - 2).every((status) => status === 201)).toBe(true);
    expect(statuses[PUBLISH_MAX_HITS - 2]).toBe(429);
  });
});

// ---------------------------------------------------------------------------
// Security/privacy QR — embedded metadata is stripped before hashing
// ---------------------------------------------------------------------------

/** UTF-8 encodes `text` to a plain byte array (fixture building). */
const asciiBytes = (text: string): number[] => [...new TextEncoder().encode(text)];

/** Latin-1 decodes bytes so a leaked path can be searched for. */
const toLatin1 = (bytes: Uint8Array): string => {
  let text = '';
  for (const byte of bytes) {
    text += String.fromCharCode(byte);
  }
  return text;
};

/** One JPEG marker segment: `FF <marker> <u16 length> <payload>`. */
const fixtureJpegSegment = (marker: number, payload: number[]): number[] => {
  const length = payload.length + 2;
  return [0xff, marker, (length >> 8) & 0xff, length & 0xff, ...payload];
};

/** The creator-machine path embedded into every strip fixture. */
const EXIF_LOCAL_PATH = '/home/creator/art/hero.png';

/** A JPEG whose EXIF (APP1) and COM segments carry the creator's local path. */
const jpegWithExif = (): Uint8Array =>
  Uint8Array.from([
    0xff,
    0xd8,
    ...fixtureJpegSegment(0xe0, [
      ...asciiBytes('JFIF\0'),
      0x01,
      0x01,
      0x00,
      0x00,
      0x01,
      0x00,
      0x01,
      0x00,
      0x00,
    ]),
    ...fixtureJpegSegment(0xe1, [...asciiBytes('Exif\0\0'), ...asciiBytes(EXIF_LOCAL_PATH)]),
    ...fixtureJpegSegment(0xfe, asciiBytes(EXIF_LOCAL_PATH)),
    ...fixtureJpegSegment(0xda, [0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]),
    0x00,
    0x01,
    0x02,
    0xff,
    0xd9,
  ]);

/** Reserves and uploads `bytes` as-is, declaring the caller's own byte length. */
const uploadRawBytes = async (options: {
  cookie: string;
  title: string;
  bytes: Uint8Array;
}): Promise<{ slug: string; response: Response }> => {
  const reserveRes = await app.handle(
    request(
      'POST',
      '/api/assets/community',
      reserveBody({
        title: options.title,
        category: 'backgrounds',
        ext: '.jpg',
        sizeBytes: options.bytes.byteLength,
      }),
      options.cookie,
    ),
  );
  const reserved = (await reserveRes.json()) as { slug: string };
  const response = await app.handle(
    request(
      'PUT',
      `/api/assets/community/${reserved.slug}/upload`,
      undefined,
      options.cookie,
      {
        'content-type': 'application/octet-stream',
        'content-length': String(options.bytes.byteLength),
      },
      options.bytes,
    ),
  );
  return { slug: reserved.slug, response };
};

describe('Security/privacy: the hub strips embedded metadata before hashing', () => {
  test('an already-stripped upload is stored and hashed as the bytes it received', async () => {
    const cookie = await signInCookie('strip-honest@example.com');
    const stripped = stripImageMetadata(jpegWithExif()).bytes;

    const { slug, response } = await uploadRawBytes({
      cookie,
      title: 'Stripped Upload',
      bytes: stripped,
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { sha256: string };

    // The hub hashed exactly the bytes it stored: no second strip, no drift.
    expect(body.sha256).toBe(await sha256Of(stripped));

    const staging = await client.execute(
      `SELECT staging_key, sha256 FROM asset_publish_staging WHERE slug = '${slug}'`,
    );
    expect(staging.rows[0]?.sha256).toBe(await sha256Of(stripped));

    const stagingKey = String(staging.rows[0]?.staging_key);
    const stored = uploads.store.get(stagingKey)?.bytes;
    expect(stored).toBeDefined();
    expect((stored as ArrayBuffer).byteLength).toBe(stripped.byteLength);
    // The creator's path is in neither the reserved row nor the stored object.
    expect(toLatin1(new Uint8Array(stored as ArrayBuffer))).not.toContain(EXIF_LOCAL_PATH);
  });

  test('a client that skipped stripping is refused instead of stored at a different length', async () => {
    const cookie = await signInCookie('strip-skipping@example.com');
    const raw = jpegWithExif();
    const strippedLength = stripImageMetadata(raw).bytes.byteLength;
    expect(strippedLength).toBeLessThan(raw.byteLength);

    const { slug, response } = await uploadRawBytes({
      cookie,
      title: 'Unstripped Upload',
      bytes: raw,
    });

    // Verbatim bytes with a truthful Content-Length pass the pre-buffer size
    // check, then shrink under the defensive strip — which would desync the
    // reserved size from the stored object, so it fails closed.
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: string; detail?: string };
    expect(body.error).toBe('size-mismatch');
    expect(body.detail).toBe('embedded metadata present');

    const staging = await client.execute(
      `SELECT state, staging_key FROM asset_publish_staging WHERE slug = '${slug}'`,
    );
    expect(staging.rows[0]?.state).toBe('rolled_back');
    expect(uploads.store.has(String(staging.rows[0]?.staging_key))).toBe(false);

    const committed = await client.execute(
      `SELECT id FROM community_assets WHERE slug = '${slug}'`,
    );
    expect(committed.rows).toHaveLength(0);
  });
});
