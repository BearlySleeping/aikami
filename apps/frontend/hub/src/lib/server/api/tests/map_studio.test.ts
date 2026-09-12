// apps/frontend/hub/src/lib/server/api/tests/map_studio.test.ts
//
// C-508: Map Studio Phase 3 — per-user drafts + community map publishing.
// Uses the same in-memory libsql D1 + mock R2 harness as save_backup.test.ts.

// biome-ignore-all lint/style/useNamingConvention: Cloudflare binding names are SCREAMING_SNAKE_CASE

import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCENE_DOCUMENT_KIND, SCENE_SCHEMA_VERSION } from '@aikami/constants';
import { type Client, createClient } from '@libsql/client';

mock.module('$env/dynamic/private', () => ({
  env: {
    BETTER_AUTH_URL: 'http://localhost:5173',
    BETTER_AUTH_SECRET: 'test-secret-that-is-long-enough-for-better-auth',
  } as Record<string, string | undefined>,
}));

mock.module('../better_auth.ts', () => ({
  getBetterAuth: () => ({
    api: {
      getSession: async ({ headers }: { headers: Headers }) => {
        const cookie = headers.get('cookie');
        return cookie?.startsWith('map-user=')
          ? { user: { id: decodeURIComponent(cookie.slice('map-user='.length)) } }
          : undefined;
      },
    },
    handler: () => new Response(undefined, { status: 404 }),
  }),
}));

const BASE_URL = 'http://localhost:5173';

/** Minimal D1Database shim over an in-memory libsql client (as in auth.test). */
const createMockD1 = (dbClient: Client) => {
  const prepareStatement = (sql: string) => ({
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
        await dbClient.execute({ sql, args: params as never[] });
        return { meta: { last_row_id: 0, changes: 0 } };
      },
      raw: async () => {
        const res = await dbClient.execute({ sql, args: params as never[] });
        return res.rows;
      },
    }),
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
  };
};

/** In-memory R2 bucket that accepts string or byte values. */
const createMockR2 = () => {
  const store = new Map<string, string>();
  let failPut = false;
  return {
    store,
    failPut: (v: boolean) => {
      failPut = v;
    },
    put: async (key: string, value: string | ArrayBuffer | Uint8Array<ArrayBufferLike>) => {
      if (failPut) {
        throw new Error('R2 put failed');
      }
      store.set(
        key,
        typeof value === 'string' ? value : new TextDecoder().decode(value as ArrayBuffer),
      );
      return { key };
    },
    get: async (key: string) => store.get(key) ?? null,
    delete: async (key: string) => {
      store.delete(key);
    },
  };
};

type MapStudioEnv = {
  DB: import('@cloudflare/workers-types').D1Database;
  CATALOG_BUCKET: import('@cloudflare/workers-types').R2Bucket;
};

let client: Client;
let app: import('../index.ts').App;
let r2: ReturnType<typeof createMockR2>;

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

const request = (method: string, path: string, body?: unknown, cookie?: string) =>
  new Request(`${BASE_URL}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

const signInCookie = async (email: string): Promise<string> => {
  const accountId = crypto.randomUUID();
  await client.execute({
    sql: 'INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    args: [accountId, 'Map Studio User', email, 1, Date.now(), Date.now()],
  });
  return `map-user=${encodeURIComponent(accountId)}`;
};

/** A schema-valid native scene document the studio can export. */
const sceneDocument = (id = 'studio-scene'): string =>
  JSON.stringify({
    kind: SCENE_DOCUMENT_KIND,
    schemaVersion: SCENE_SCHEMA_VERSION,
    id,
    assetLock: 'pack:emberwatch',
    extent: { width: 2, height: 2, tileSize: 32 },
    surface: { mode: 'baked', palette: ['', 'grass.png'], grid: [0, 1, 1, 0] },
    layers: [],
    placements: [],
    navigation: {},
  });

beforeAll(async () => {
  client = createClient({ url: ':memory:' });
  await applyD1Migrations();
  r2 = createMockR2();
  const mapStudioEnv = {
    DB: createMockD1(client).binding as unknown as MapStudioEnv['DB'],
    CATALOG_BUCKET: r2 as unknown as MapStudioEnv['CATALOG_BUCKET'],
  };
  const { createApp } = await import('../index.ts');
  app = createApp({ mapStudioEnv });
});

afterAll(async () => {
  await client.close();
});

describe('map drafts (C-508)', () => {
  test('draft routes require a session', async () => {
    const res = await app.handle(request('GET', '/api/maps/drafts'));
    expect(res.status).toBe(401);
  });

  test('create → list → get → update → delete round-trips a draft', async () => {
    const cookie = await signInCookie('draft@example.com');

    const createRes = await app.handle(
      request('POST', '/api/maps/drafts', { name: 'My Map', document: sceneDocument() }, cookie),
    );
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id: string; document: string };
    expect(created.document).toContain(SCENE_DOCUMENT_KIND);

    const listRes = await app.handle(request('GET', '/api/maps/drafts', undefined, cookie));
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as Array<{ id: string; name: string }>;
    expect(list.some((draft) => draft.id === created.id)).toBe(true);

    const getRes = await app.handle(
      request('GET', `/api/maps/drafts/${created.id}`, undefined, cookie),
    );
    expect(getRes.status).toBe(200);

    const updateRes = await app.handle(
      request('PUT', `/api/maps/drafts/${created.id}`, { name: 'Renamed' }, cookie),
    );
    expect(updateRes.status).toBe(200);
    expect(((await updateRes.json()) as { name: string }).name).toBe('Renamed');

    const deleteRes = await app.handle(
      request('DELETE', `/api/maps/drafts/${created.id}`, undefined, cookie),
    );
    expect(deleteRes.status).toBe(200);
  });

  test('another user cannot read or delete a draft (404)', async () => {
    const owner = await signInCookie('owner@example.com');
    const created = (await (
      await app.handle(
        request('POST', '/api/maps/drafts', { name: 'Private', document: sceneDocument() }, owner),
      )
    ).json()) as { id: string };

    const intruder = await signInCookie('intruder@example.com');
    const getRes = await app.handle(
      request('GET', `/api/maps/drafts/${created.id}`, undefined, intruder),
    );
    expect(getRes.status).toBe(404);
    const deleteRes = await app.handle(
      request('DELETE', `/api/maps/drafts/${created.id}`, undefined, intruder),
    );
    expect(deleteRes.status).toBe(404);
  });

  test('rejects an invalid scene document with 422', async () => {
    const cookie = await signInCookie('bad-doc@example.com');
    const res = await app.handle(
      request('POST', '/api/maps/drafts', { name: 'Bad', document: '{"kind":"nope"}' }, cookie),
    );
    expect(res.status).toBe(422);
  });
});

describe('community publishing (C-508)', () => {
  test('publishing requires a session', async () => {
    const res = await app.handle(
      request('POST', '/api/maps/community', { title: 'X', document: sceneDocument() }),
    );
    expect(res.status).toBe(401);
  });

  test('publish uploads the document and lists it publicly', async () => {
    const cookie = await signInCookie('publisher@example.com');
    const res = await app.handle(
      request(
        'POST',
        '/api/maps/community',
        { title: 'Village Reprise', document: sceneDocument('village-reprise') },
        cookie,
      ),
    );
    expect(res.status).toBe(201);
    const result = (await res.json()) as { slug: string; revision: number; documentHash: string };
    expect(result.slug).toBe('village-reprise');
    expect(result.revision).toBe(1);
    expect(result.documentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(r2.store.has(`community/village-reprise/1.json`)).toBe(true);

    const listRes = await app.handle(request('GET', '/api/maps/community'));
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as { items: Array<{ slug: string }> };
    expect(list.items.some((entry) => entry.slug === result.slug)).toBe(true);

    const getRes = await app.handle(request('GET', `/api/maps/community/${result.slug}`));
    expect(getRes.status).toBe(200);
    const doc = (await getRes.json()) as { document: string; revision: number };
    expect(doc.revision).toBe(1);
    expect(doc.document).toContain(SCENE_DOCUMENT_KIND);
  });

  test('re-publishing the same slug bumps the revision', async () => {
    const cookie = await signInCookie('reviser@example.com');
    await app.handle(
      request(
        'POST',
        '/api/maps/community',
        { title: 'Bump', document: sceneDocument('bump-1') },
        cookie,
      ),
    );
    const second = await app.handle(
      request(
        'POST',
        '/api/maps/community',
        { title: 'Bump', document: sceneDocument('bump-2') },
        cookie,
      ),
    );
    expect(second.status).toBe(200);
    const result = (await second.json()) as { slug: string; revision: number };
    expect(result.revision).toBe(2);
    expect(r2.store.has('community/bump/2.json')).toBe(true);
    const revisions = await client.execute(
      "SELECT revision FROM community_maps WHERE slug = 'bump' ORDER BY revision",
    );
    expect(revisions.rows.map((row) => Number(row.revision))).toEqual([1, 2]);
  });

  test('concurrent publishes reserve distinct immutable revisions', async () => {
    const cookie = await signInCookie('concurrent-reviser@example.com');
    const [first, second] = await Promise.all([
      app.handle(
        request(
          'POST',
          '/api/maps/community',
          { title: 'Concurrent', document: sceneDocument('concurrent-1') },
          cookie,
        ),
      ),
      app.handle(
        request(
          'POST',
          '/api/maps/community',
          { title: 'Concurrent', document: sceneDocument('concurrent-2') },
          cookie,
        ),
      ),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 201]);
    const bodies = (await Promise.all([first.json(), second.json()])) as Array<{
      revision: number;
    }>;
    expect(bodies.map((body) => body.revision).sort()).toEqual([1, 2]);
    expect(r2.store.has('community/concurrent/1.json')).toBe(true);
    expect(r2.store.has('community/concurrent/2.json')).toBe(true);
  });

  test('another user cannot claim an existing slug (409)', async () => {
    const owner = await signInCookie('slug-owner@example.com');
    await app.handle(
      request('POST', '/api/maps/community', { title: 'Taken', document: sceneDocument() }, owner),
    );
    const other = await signInCookie('slug-other@example.com');
    const res = await app.handle(
      request(
        'POST',
        '/api/maps/community',
        { title: 'Taken', slug: 'taken', document: sceneDocument() },
        other,
      ),
    );
    expect(res.status).toBe(409);
  });

  test('rejects invalid explicit slugs and derives one for an empty slug', async () => {
    const cookie = await signInCookie('slug-validation@example.com');
    for (const slug of ['Uppercase', 'has whitespace']) {
      const response = await app.handle(
        request(
          'POST',
          '/api/maps/community',
          { title: 'Slug validation', slug, document: sceneDocument() },
          cookie,
        ),
      );
      expect(response.status).toBe(400);
    }
    const derived = await app.handle(
      request(
        'POST',
        '/api/maps/community',
        { title: 'Empty Slug', slug: '', document: sceneDocument() },
        cookie,
      ),
    );
    expect(derived.status).toBe(201);
    expect(((await derived.json()) as { slug: string }).slug).toBe('empty-slug');
  });

  test('lists bounded cursor pages in descending update order', async () => {
    const first = await app.handle(request('GET', '/api/maps/community?limit=1'));
    expect(first.status).toBe(200);
    const firstPage = (await first.json()) as {
      items: Array<{ slug: string }>;
      nextCursor?: string;
    };
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.nextCursor).toBeDefined();
    const second = await app.handle(
      request('GET', `/api/maps/community?limit=1&cursor=${firstPage.nextCursor}`),
    );
    const secondPage = (await second.json()) as { items: Array<{ slug: string }> };
    expect(second.status).toBe(200);
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.items[0]?.slug).not.toBe(firstPage.items[0]?.slug);
  });

  test('uses the draft byte limit without weakening the publish limit', async () => {
    const cookie = await signInCookie('document-limits@example.com');
    const document = `${sceneDocument('large-valid')}${' '.repeat(600 * 1024)}`;
    const draft = await app.handle(
      request('POST', '/api/maps/drafts', { name: 'Large', document }, cookie),
    );
    expect(draft.status).toBe(413);
    const publish = await app.handle(
      request('POST', '/api/maps/community', { title: 'Large Valid', document }, cookie),
    );
    expect(publish.status).toBe(201);
  });

  test('an invalid pack context is rejected by the validatePack gate (422)', async () => {
    const cookie = await signInCookie('pack-gate@example.com');
    const res = await app.handle(
      request(
        'POST',
        '/api/maps/community',
        {
          title: 'Gated',
          document: sceneDocument(),
          packContext: { manifest: { id: 'bad', name: 'Bad' } },
        },
        cookie,
      ),
    );
    expect(res.status).toBe(422);
  });
});
