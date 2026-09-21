// apps/frontend/hub/src/lib/views/community/__tests__/community_category_load.test.ts
//
// C-513 AC-4: the public community browse page renders ONLY approved, promoted
// revisions.
//
// The page's `load` and the JSON listing route share one query
// (`listCommunityAssets`), so this suite exercises the real predicate against a
// real D1 built from the migration chain — not a stubbed listing.
//
// The rendered-HTML guarantee is asserted the only way it can be asserted
// without a Svelte compiler in the bun runner: the ViewModel's `rows` are the
// sole input to the view's `{#each}` (the template reads no other data), so a
// tag that is absent from the serialized rows cannot appear in the HTML. Each
// test asserts that serialized form directly, alongside the page data.

// biome-ignore-all lint/style/useNamingConvention: Cloudflare binding names are SCREAMING_SNAKE_CASE, and the D1 mock mirrors the platform's `last_row_id` metadata key

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Client, createClient } from '@libsql/client';

// The page resolves its bindings through `getWorkerEnv()` (src/lib/server/
// worker_env.ts), which reads the `cloudflare:workers` virtual module — not the
// `platform` argument. The preload mock exposes a single mutable bindings
// object (`globalThis.__workerBindings`); mutating it switches the deployment
// between "configured" and "binding missing" per test.

type WorkerBindings = Record<string, unknown>;

const setWorkerBindings = (bindings: WorkerBindings | undefined): void => {
  const target = (globalThis as { __workerBindings?: WorkerBindings }).__workerBindings;
  if (!target) {
    throw new Error('__workerBindings missing — is src/lib/test_preload.ts preloaded?');
  }
  for (const key of Object.keys(target)) {
    delete target[key];
  }
  Object.assign(target, bindings ?? {});
};

// ---------------------------------------------------------------------------
// D1 + R2 harness (the shape asset_publish.test.ts uses)
// ---------------------------------------------------------------------------

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
          await dbClient.execute({ sql, args: params as never[] });
          return { meta: { last_row_id: 0, changes: 0 } };
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

const createMockR2 = () => ({
  put: async () => ({ key: 'x' }),
  get: async () => null,
  delete: async () => undefined,
  list: async () => ({ objects: [] }),
});

type TestEnv = {
  DB: App.Platform['env']['DB'];
  CATALOG_BUCKET: App.Platform['env']['CATALOG_BUCKET'];
  UPLOADS_BUCKET: App.Platform['env']['UPLOADS_BUCKET'];
};

let client: Client;
let d1: ReturnType<typeof createMockD1>;
let env: TestEnv;

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

const applyD1Migrations = async (): Promise<void> => {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    for (const statement of sql.split('--> statement-breakpoint')) {
      const trimmed = statement.trim();
      if (trimmed) {
        await client.execute(trimmed);
      }
    }
  }
};

const OWNER_ID = 'community-browse-owner';

/** Inserts one community_assets row and returns its slug. */
const insertAsset = async (options: {
  slug: string;
  revision?: number;
  category?: string;
  tag: string;
  title: string;
  moderationState: 'pending' | 'approved' | 'rejected';
  promoted?: boolean;
}): Promise<string> => {
  const {
    slug,
    revision = 1,
    category = 'music',
    tag,
    title,
    moderationState,
    promoted = false,
  } = options;
  const sha = 'a'.repeat(64);
  await client.execute({
    sql: `INSERT INTO community_assets
            (id, owner_account_id, slug, revision, title, category, tag, sha256, r2_key,
             size_bytes, ext, provenance_json, license, moderation_state,
             promoted_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      crypto.randomUUID(),
      OWNER_ID,
      slug,
      revision,
      title,
      category,
      tag,
      sha,
      promoted ? `assets/${sha.slice(0, 2)}/${sha}.webp` : null,
      2048,
      '.webp',
      JSON.stringify({ source: 'original', license: 'CC-BY-4.0', author: ['Row Author'] }),
      'CC-BY-4.0',
      moderationState,
      promoted ? Date.now() : null,
      Date.now(),
      Date.now(),
    ],
  });
  return slug;
};

const loadPage = async (options: { category: string; cursor?: string; withEnv?: boolean }) => {
  const { load } = await import('../../../../routes/(public)/community/[category]/+page.server.ts');
  const url = new URL(`http://localhost/community/${options.category}`);
  if (options.cursor !== undefined) {
    url.searchParams.set('cursor', options.cursor);
  }
  setWorkerBindings(options.withEnv === false ? undefined : (env as unknown as WorkerBindings));
  return load({
    params: { category: options.category },
    url,
    setHeaders: () => undefined,
    depends: () => undefined,
  } as never);
};

const statusOf = async (run: () => Promise<unknown>): Promise<number | undefined> => {
  try {
    await run();
    return undefined;
  } catch (cause) {
    return (cause as { status?: number }).status;
  }
};

beforeAll(async () => {
  client = createClient({ url: ':memory:' });
  await applyD1Migrations();
  await client.execute({
    sql: 'INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    args: [OWNER_ID, 'Browse Owner', 'browse@example.com', 1, Date.now(), Date.now()],
  });
  d1 = createMockD1(client);
  env = {
    DB: d1.binding as unknown as TestEnv['DB'],
    CATALOG_BUCKET: createMockR2() as unknown as TestEnv['CATALOG_BUCKET'],
    UPLOADS_BUCKET: createMockR2() as unknown as TestEnv['UPLOADS_BUCKET'],
  };
});

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  await client.execute('DELETE FROM community_assets');
});

describe('C-513 AC-4: the public browse page lists approved + promoted only', () => {
  test('an approved, promoted asset is listed with attribution, licence and its CDN URL', async () => {
    await insertAsset({
      slug: 'tavern-theme',
      tag: 'music:community:tavern-theme',
      title: 'Tavern Theme',
      moderationState: 'approved',
      promoted: true,
    });

    const data = (await loadPage({ category: 'music' })) as {
      assets: Array<{ tag: string; license?: string; deliveryUrl?: string }>;
      categoryLabel: string;
    };

    expect(data.assets).toHaveLength(1);
    expect(data.assets[0]?.tag).toBe('music:community:tavern-theme');
    expect(data.assets[0]?.license).toBe('CC-BY-4.0');
    // The public content-addressed URL is what the page renders as "Source".
    expect(data.assets[0]?.deliveryUrl).toContain('/assets/aa/');

    const { getCommunityCategoryViewModel } = await import(
      '../community_category_view_model.svelte.ts'
    );
    const viewModel = getCommunityCategoryViewModel({
      data: data as never,
      className: 'CommunityCategoryViewModel',
    });
    expect(viewModel.rows[0]?.attribution).toBe('Row Author');
    expect(viewModel.rows[0]?.license).toBe('CC-BY-4.0');
  });

  test('pending, rejected and un-promoted rows never reach the page — nor the serialized rows the view renders', async () => {
    await insertAsset({
      slug: 'approved-one',
      tag: 'music:community:approved-one',
      title: 'Approved One',
      moderationState: 'approved',
      promoted: true,
    });
    await insertAsset({
      slug: 'pending-one',
      tag: 'music:community:pending-one',
      title: 'Pending One',
      moderationState: 'pending',
    });
    await insertAsset({
      slug: 'rejected-one',
      tag: 'music:community:rejected-one',
      title: 'Rejected One',
      moderationState: 'rejected',
    });
    // Approved by a moderator but never promoted: the bytes are still in the
    // private intake bucket, so there is no public URL and no listing.
    await insertAsset({
      slug: 'approved-unpromoted',
      tag: 'music:community:approved-unpromoted',
      title: 'Approved Unpromoted',
      moderationState: 'approved',
      promoted: false,
    });

    const data = (await loadPage({ category: 'music' })) as {
      assets: Array<{ tag: string }>;
    };
    expect(data.assets.map((asset) => asset.tag)).toEqual(['music:community:approved-one']);

    const { getCommunityCategoryViewModel } = await import(
      '../community_category_view_model.svelte.ts'
    );
    const viewModel = getCommunityCategoryViewModel({
      data: data as never,
      className: 'CommunityCategoryViewModel',
    });
    // The view's {#each} iterates exactly this, and reads nothing else.
    const rendered = JSON.stringify(viewModel.rows);
    expect(rendered).toContain('music:community:approved-one');
    for (const unreviewed of [
      'pending-one',
      'rejected-one',
      'approved-unpromoted',
      'Pending One',
      'Rejected One',
    ]) {
      expect(rendered).not.toContain(unreviewed);
    }
  });

  test('a newer pending revision does not hide the previously approved revision', async () => {
    await insertAsset({
      slug: 'revisioned',
      revision: 1,
      tag: 'music:community:revisioned:v1',
      title: 'Approved Revision',
      moderationState: 'approved',
      promoted: true,
    });
    await insertAsset({
      slug: 'revisioned',
      revision: 2,
      tag: 'music:community:revisioned:v2',
      title: 'Pending Revision',
      moderationState: 'pending',
    });

    const data = (await loadPage({ category: 'music' })) as {
      assets: Array<{ tag: string }>;
    };
    // Revision 1 stays browsable; revision 2 is invisible until approved.
    expect(data.assets.map((asset) => asset.tag)).toEqual(['music:community:revisioned:v1']);
  });

  test('the listing is scoped to the requested category', async () => {
    await insertAsset({
      slug: 'music-asset',
      category: 'music',
      tag: 'music:community:song',
      title: 'A Song',
      moderationState: 'approved',
      promoted: true,
    });
    await insertAsset({
      slug: 'sfx-asset',
      category: 'sfx',
      tag: 'sfx:community:clang',
      title: 'A Clang',
      moderationState: 'approved',
      promoted: true,
    });

    const music = (await loadPage({ category: 'music' })) as { assets: Array<{ tag: string }> };
    expect(music.assets.map((asset) => asset.tag)).toEqual(['music:community:song']);

    const sfx = (await loadPage({ category: 'sfx' })) as { assets: Array<{ tag: string }> };
    expect(sfx.assets.map((asset) => asset.tag)).toEqual(['sfx:community:clang']);
  });

  test('an empty category renders the empty state rather than an error', async () => {
    const data = (await loadPage({ category: 'ambient' })) as { assets: unknown[] };
    expect(data.assets).toEqual([]);
  });
});

describe('C-513 AC-4: the browse page degrades explicitly, never with a 500', () => {
  test('an unknown category is a 404 (checked before any binding)', async () => {
    const status = await statusOf(() => loadPage({ category: 'not-a-category', withEnv: false }));
    expect(status).toBe(404);
  });

  test('a missing intake binding is a 503, not a 500', async () => {
    const status = await statusOf(() => loadPage({ category: 'music', withEnv: false }));
    expect(status).toBe(503);
  });

  test('a malformed cursor is a 400', async () => {
    const status = await statusOf(() => loadPage({ category: 'music', cursor: 'not-a-cursor' }));
    expect(status).toBe(400);
  });
});
