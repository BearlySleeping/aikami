// apps/frontend/hub/src/lib/server/api/tests/theme_publish.test.ts
//
// C-530 — Hub theme publishing: reserve → private upload → server validation →
// immutable pending version → moderation + promotion, and the revocation marker.
// Uses the same in-memory libsql D1 + mock R2 harness as `asset_publish.test.ts`.
//
// Coverage map:
//   AC-1  reserve/upload/commit, private intake, exactly one immutable version
//   AC-2  one named negative case per enumerated rejection
//   AC-3  moderation controls public delivery; promotion is idempotent;
//         approved+promoted bytes are byte-identical to the uploaded digest
//   AC-9  the 0012 migration is additive and its constraints bite

// biome-ignore-all lint/style/useNamingConvention: Cloudflare binding names are SCREAMING_SNAKE_CASE

import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { THEME_MAX_ENTRIES } from '@aikami/constants';
import { type Client, createClient } from '@libsql/client';

mock.module('../better_auth.ts', () => ({
  getBetterAuth: () => ({
    api: {
      getSession: async ({ headers }: { headers: Headers }) => {
        const cookie = headers.get('cookie');
        return cookie?.startsWith('theme-user=')
          ? { user: { id: decodeURIComponent(cookie.slice('theme-user='.length)) } }
          : undefined;
      },
    },
    handler: () => new Response(undefined, { status: 404 }),
  }),
}));

const BASE_URL = 'http://localhost:5173';

/** Minimal D1Database shim over an in-memory libsql client. */
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

type StoredObject = { bytes: ArrayBuffer; contentType?: string };

const toBytes = (value: string | ArrayBuffer | Uint8Array<ArrayBufferLike>): ArrayBuffer => {
  if (typeof value === 'string') {
    return new TextEncoder().encode(value).buffer;
  }
  if (value instanceof Uint8Array) {
    return value.slice().buffer as ArrayBuffer;
  }
  return value;
};

/** In-memory R2 bucket. */
const createMockR2 = () => {
  const store = new Map<string, StoredObject>();
  return {
    store,
    put: async (
      key: string,
      value: string | ArrayBuffer | Uint8Array<ArrayBufferLike>,
      options?: { httpMetadata?: { contentType?: string } },
    ) => {
      store.set(key, { bytes: toBytes(value), contentType: options?.httpMetadata?.contentType });
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

type ThemeEnv = {
  DB: import('@cloudflare/workers-types').D1Database;
  CATALOG_BUCKET: import('@cloudflare/workers-types').R2Bucket;
  UPLOADS_BUCKET: import('@cloudflare/workers-types').R2Bucket;
};

let client: Client;
let db: ReturnType<typeof createMockD1>;
let uploads: ReturnType<typeof createMockR2>;
let catalog: ReturnType<typeof createMockR2>;
let app: import('../index.ts').App;
let createApp: typeof import('../index.ts').createApp;

const MODERATOR_ID = 'moderator-0000-0000-0000-000000000002';

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

const signInAs = async (accountId: string, email: string): Promise<string> => {
  const existing = await client.execute({
    sql: 'SELECT id FROM user WHERE id = ?',
    args: [accountId],
  });
  if (existing.rows.length === 0) {
    await client.execute({
      sql: 'INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      args: [accountId, 'Theme User', email, 1, Date.now(), Date.now()],
    });
  }
  return `theme-user=${encodeURIComponent(accountId)}`;
};

// ── ZIP builder (hostile-capable) ───────────────────────────────────────

const encoder = new TextEncoder();

type ZipInput = {
  readonly path: string;
  readonly text?: string;
  readonly data?: Uint8Array;
  readonly isDirectory?: boolean;
  readonly isSymlink?: boolean;
  readonly declaredExpandedBytes?: number;
  readonly method?: 'store' | 'deflate';
};

const u16 = (value: number): number[] => [value & 0xff, (value >> 8) & 0xff];
const u32 = (value: number): number[] => [
  value & 0xff,
  (value >>> 8) & 0xff,
  (value >>> 16) & 0xff,
  (value >>> 24) & 0xff,
];

const crc32 = (bytes: Uint8Array): number => {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
};

/** The UNIX mode bits a ZIP central-directory entry declares. */
const unixModeFor = (input: ZipInput): number => {
  if (input.isSymlink) {
    return 0o120777;
  }
  return input.isDirectory ? 0o040755 : 0o100644;
};

const buildZip = (inputs: readonly ZipInput[]): Uint8Array => {
  const chunks: number[] = [];
  const central: number[] = [];
  for (const input of inputs) {
    const nameBytes = [...encoder.encode(input.path)];
    const raw =
      input.data ?? (input.isDirectory ? new Uint8Array() : encoder.encode(input.text ?? ''));
    const stored = input.method === 'store' || input.isDirectory === true;
    const payload = stored ? raw : new Uint8Array(deflateRawSync(raw));
    const declared = input.declaredExpandedBytes ?? raw.byteLength;
    const localOffset = chunks.length;
    chunks.push(
      ...u32(0x04034b50),
      ...u16(20),
      ...u16(0),
      ...u16(stored ? 0 : 8),
      ...u16(0),
      ...u16(0),
      ...u32(crc32(raw)),
      ...u32(payload.byteLength),
      ...u32(declared),
      ...u16(nameBytes.length),
      ...u16(0),
      ...nameBytes,
      ...payload,
    );
    const unixMode = unixModeFor(input);
    central.push(
      ...u32(0x02014b50),
      ...u16(0x031e),
      ...u16(20),
      ...u16(0),
      ...u16(stored ? 0 : 8),
      ...u16(0),
      ...u16(0),
      ...u32(crc32(raw)),
      ...u32(payload.byteLength),
      ...u32(declared),
      ...u16(nameBytes.length),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(unixMode << 16),
      ...u32(localOffset),
      ...nameBytes,
    );
  }
  const directoryOffset = chunks.length;
  return new Uint8Array([
    ...chunks,
    ...central,
    ...u32(0x06054b50),
    ...u16(0),
    ...u16(0),
    ...u16(inputs.length),
    ...u16(inputs.length),
    ...u32(central.length),
    ...u32(directoryOffset),
    ...u16(0),
  ]);
};

const tokenFile = (variant: 'light' | 'dark'): string =>
  JSON.stringify({
    profileVersion: 1,
    variant,
    tokens: {
      'color.base-100': {
        $type: 'color',
        $value: variant === 'dark' ? 'oklch(0.13 0.015 260)' : 'oklch(0.985 0.006 270)',
      },
      'color.base-content': {
        $type: 'color',
        $value: variant === 'dark' ? 'oklch(0.9 0.01 270)' : 'oklch(0.2 0.01 270)',
      },
      'font.body': { $type: 'fontFamily', $value: 'sans' },
      'weight.body': { $type: 'fontWeight', $value: 400 },
    },
  });

const manifestJson = (overrides: Record<string, unknown> = {}): string =>
  JSON.stringify({
    schemaVersion: 1,
    kind: 'aikami-theme',
    id: 'fixture-theme',
    version: '1.0.0',
    themeApiRange: '>=1.0 <2.0',
    name: 'Fixture Theme',
    author: { displayName: 'Fixture Author' },
    license: 'CC-BY-4.0',
    variants: { light: 'tokens/light.json', dark: 'tokens/dark.json' },
    assets: [],
    ...overrides,
  });

/** A valid, minimal theme package. */
const validPackage = (overrides: Record<string, unknown> = {}): Uint8Array =>
  buildZip([
    { path: 'theme.json', text: manifestJson(overrides) },
    { path: 'tokens/light.json', text: tokenFile('light') },
    { path: 'tokens/dark.json', text: tokenFile('dark') },
  ]);

const sha256Of = async (bytes: Uint8Array): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

const reserveBody = (sizeBytes: number, overrides: Record<string, unknown> = {}) => ({
  themeId: 'fixture-theme',
  version: '1.0.0',
  sizeBytes,
  provenance: { source: 'original', license: 'CC-BY-4.0', author: ['Fixture Author'] },
  ...overrides,
});

/** Reserves then uploads a package; returns both responses. */
const publish = async (
  cookie: string,
  bytes: Uint8Array,
  reserveOverrides: Record<string, unknown> = {},
): Promise<{ reserve: Response; upload: Response }> => {
  const reserve = await app.handle(
    request('POST', '/api/assets/themes', reserveBody(bytes.byteLength, reserveOverrides), cookie),
  );
  const reserved = (await reserve.json()) as { themeId?: string; version?: string };
  if (!reserved.themeId || !reserved.version) {
    return { reserve, upload: new Response(null, { status: 0 }) };
  }
  const upload = await app.handle(
    request(
      'PUT',
      `/api/assets/themes/${reserved.themeId}/upload?version=${reserved.version}`,
      undefined,
      cookie,
      {
        'content-type': 'application/octet-stream',
        'content-length': String(bytes.byteLength),
      },
      bytes,
    ),
  );
  return { reserve, upload };
};

const ownerId = '11111111-1111-1111-1111-111111111111';
const otherId = '22222222-2222-2222-2222-222222222222';
let ownerCookie: string;
let otherCookie: string;
let moderatorCookie: string;

const createThemeEnv = (
  overrides: Partial<{ themePublishingEnabled: boolean }> = {},
): NonNullable<
  NonNullable<Parameters<typeof import('../index.ts').createApp>[0]>['assetThemeEnv']
> => ({
  DB: db.binding as unknown as ThemeEnv['DB'],
  CATALOG_BUCKET: catalog as unknown as ThemeEnv['CATALOG_BUCKET'],
  UPLOADS_BUCKET: uploads as unknown as ThemeEnv['UPLOADS_BUCKET'],
  moderationAccountIds: [MODERATOR_ID],
  catalogOriginUrl: 'https://assets.test',
  themePublishingEnabled: overrides.themePublishingEnabled ?? true,
});

beforeAll(async () => {
  client = createClient({ url: ':memory:' });
  await applyD1Migrations();
  db = createMockD1(client);
  uploads = createMockR2();
  catalog = createMockR2();
  ({ createApp } = await import('../index.ts'));
  app = createApp({ assetThemeEnv: createThemeEnv() });
  ownerCookie = await signInAs(ownerId, 'theme-owner@test');
  otherCookie = await signInAs(otherId, 'theme-other@test');
  moderatorCookie = await signInAs(MODERATOR_ID, 'theme-mod@test');
});

afterAll(async () => {
  await client.close();
});

describe('AC-1: creator publish and private staging', () => {
  test('reserve requires a session', async () => {
    const res = await app.handle(request('POST', '/api/assets/themes', reserveBody(1024)));
    expect(res.status).toBe(401);
  });

  test('reserve → upload commits exactly one immutable pending version', async () => {
    const bytes = validPackage();
    const { reserve, upload } = await publish(ownerCookie, bytes);
    expect(reserve.status).toBe(201);
    expect(upload.status).toBe(201);

    const committed = (await upload.json()) as {
      themeId: string;
      version: string;
      sha256: string;
      moderationState: string;
      deliveryUrl: string;
    };
    expect(committed.themeId).toBe('fixture-theme');
    expect(committed.version).toBe('1.0.0');
    expect(committed.sha256).toBe(await sha256Of(bytes));
    expect(committed.moderationState).toBe('pending');
    expect(committed.deliveryUrl).toContain('/api/assets/themes/fixture-theme/raw');

    const rows = await client.execute({
      sql: 'SELECT slug, version, moderation_state, promoted_at, r2_key, license FROM theme_versions',
      args: [],
    });
    expect(rows.rows.length).toBe(1);
    expect(rows.rows[0]?.moderation_state).toBe('pending');
    expect(rows.rows[0]?.promoted_at).toBeNull();
    expect(rows.rows[0]?.r2_key).toBeNull();
    expect(rows.rows[0]?.license).toBe('CC-BY-4.0');

    // The bytes are only in the private intake bucket.
    expect(uploads.store.size).toBe(1);
    expect(catalog.store.size).toBe(0);
  });

  test('a second publish of the same (themeId, version) is a named duplicate-version', async () => {
    const res = await app.handle(
      request('POST', '/api/assets/themes', reserveBody(1024), ownerCookie),
    );
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe('duplicate-version');
  });

  test('an unvalidated reservation stays nonpublic and unresolvable', async () => {
    const res = await app.handle(
      request('POST', '/api/assets/themes', reserveBody(1024), ownerCookie),
    );
    const reserved = (await res.json()) as { error?: string };
    // The pair already exists, so the reservation is refused before any write.
    expect(reserved.error).toBe('duplicate-version');
    const listing = await app.handle(request('GET', '/api/assets/themes'));
    const page = (await listing.json()) as { items: unknown[] };
    expect(page.items.length).toBe(0);
  });
});

describe('AC-2: server rejection and isolation', () => {
  test('a non-ZIP upload is refused with a named code', async () => {
    const bytes = encoder.encode('definitely not a zip');
    const { upload } = await publish(otherCookie, bytes, {
      themeId: 'not-a-zip',
      version: '1.0.0',
    });
    expect(upload.status).toBe(422);
    expect(((await upload.json()) as { error: string }).error).toBe('theme-invalid-package');
  });

  test('a symlink entry is a hostile-archive rejection', async () => {
    const bytes = buildZip([
      { path: 'theme.json', text: manifestJson({ id: 'hostile-theme' }) },
      { path: 'tokens/light.json', text: tokenFile('light') },
      { path: 'tokens/dark.json', text: tokenFile('dark') },
      { path: 'escape', isSymlink: true, data: encoder.encode('/etc/passwd') },
    ]);
    const { upload } = await publish(ownerCookie, bytes, {
      themeId: 'hostile-theme',
      version: '1.0.0',
    });
    expect(upload.status).toBe(422);
    expect(((await upload.json()) as { error: string }).error).toBe('theme-hostile-archive-entry');
  });

  test('a compression bomb is refused before decompression', async () => {
    const bytes = buildZip([
      { path: 'theme.json', text: manifestJson({ id: 'bomb-theme' }) },
      { path: 'tokens/light.json', text: tokenFile('light') },
      { path: 'tokens/dark.json', text: tokenFile('dark') },
      {
        path: 'assets/bomb.bin',
        data: encoder.encode('not-deflate'),
        declaredExpandedBytes: 8 * 1024 * 1024,
      },
    ]);
    const { upload } = await publish(ownerCookie, bytes, {
      themeId: 'bomb-theme',
      version: '1.0.0',
    });
    expect(upload.status).toBe(422);
    expect(((await upload.json()) as { error: string }).error).toBe('theme-compression-bomb');
  });

  test('an archive whose declared total expands past the budget is refused', async () => {
    const inputs: ZipInput[] = [{ path: 'theme.json', text: manifestJson({ id: 'fat-theme' }) }];
    for (let index = 0; index < THEME_MAX_ENTRIES - 1; index += 1) {
      inputs.push({
        path: `filler/${index}.bin`,
        data: encoder.encode('x'),
        declaredExpandedBytes: 300_000,
      });
    }
    const { upload } = await publish(ownerCookie, buildZip(inputs), {
      themeId: 'fat-theme',
      version: '1.0.0',
    });
    expect(upload.status).toBe(413);
    expect(((await upload.json()) as { error: string }).error).toBe('theme-expands-too-large');
  });

  test('an entry count past the limit is refused', async () => {
    const inputs: ZipInput[] = [{ path: 'theme.json', text: manifestJson({ id: 'many-theme' }) }];
    for (let index = 0; index <= THEME_MAX_ENTRIES; index += 1) {
      inputs.push({ path: `filler/${index}.txt`, text: 'x' });
    }
    const { upload } = await publish(ownerCookie, buildZip(inputs), {
      themeId: 'many-theme',
      version: '1.0.0',
    });
    expect(upload.status).toBe(413);
    expect(((await upload.json()) as { error: string }).error).toBe('theme-too-many-entries');
  });

  test('an unsupported themeApiRange is refused by name', async () => {
    const bytes = validPackage({ id: 'future-theme', themeApiRange: '>=3.0 <4.0' });
    const { upload } = await publish(ownerCookie, bytes, {
      themeId: 'future-theme',
      version: '1.0.0',
    });
    expect(upload.status).toBe(422);
    expect(((await upload.json()) as { error: string }).error).toBe('theme-unsupported-api');
  });

  test('a whitespace-only licence is refused as invalid-license', async () => {
    const bytes = validPackage({ id: 'nolicense-theme', license: '   ' });
    const { upload } = await publish(ownerCookie, bytes, {
      themeId: 'nolicense-theme',
      version: '1.0.0',
    });
    expect(upload.status).toBe(422);
    expect(((await upload.json()) as { error: string }).error).toBe('theme-invalid-license');
  });

  test('a package whose manifest identity differs from the reservation is refused', async () => {
    const bytes = validPackage({ id: 'someone-elses-theme' });
    const { upload } = await publish(ownerCookie, bytes, {
      themeId: 'mismatched-theme',
      version: '1.0.0',
    });
    expect(upload.status).toBe(422);
    expect(((await upload.json()) as { error: string }).error).toBe('theme-invalid-manifest');
  });

  test('a manifest/asset hash mismatch is refused by name', async () => {
    const payload = encoder.encode('pretend-png-bytes');
    const bytes = buildZip([
      {
        path: 'theme.json',
        text: manifestJson({
          id: 'hash-theme',
          assets: [
            {
              path: 'assets/logo.png',
              mediaType: 'image/png',
              bytes: payload.byteLength,
              sha256: '0'.repeat(64),
            },
          ],
        }),
      },
      { path: 'tokens/light.json', text: tokenFile('light') },
      { path: 'tokens/dark.json', text: tokenFile('dark') },
      { path: 'assets/logo.png', data: payload },
    ]);
    const { upload } = await publish(ownerCookie, bytes, {
      themeId: 'hash-theme',
      version: '1.0.0',
    });
    expect(upload.status).toBe(422);
    expect(((await upload.json()) as { error: string }).error).toBe('theme-hash-mismatch');
  });

  test("another owner's theme id is refused as theme-slug-taken", async () => {
    const res = await app.handle(
      request('POST', '/api/assets/themes', reserveBody(1024), otherCookie),
    );
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe('theme-slug-taken');
  });

  test('a declared size that does not match Content-Length fails closed and rolls back', async () => {
    const bytes = validPackage({ id: 'size-theme' });
    const reserve = await app.handle(
      request(
        'POST',
        '/api/assets/themes',
        reserveBody(bytes.byteLength + 10, { themeId: 'size-theme' }),
        ownerCookie,
      ),
    );
    expect(reserve.status).toBe(201);
    const upload = await app.handle(
      request(
        'PUT',
        '/api/assets/themes/size-theme/upload?version=1.0.0',
        undefined,
        ownerCookie,
        { 'content-type': 'application/octet-stream', 'content-length': String(bytes.byteLength) },
        bytes,
      ),
    );
    expect(upload.status).toBe(422);
    expect(((await upload.json()) as { error: string }).error).toBe('size-mismatch');

    const rows = await client.execute({
      sql: "SELECT state FROM theme_publish_staging WHERE slug = 'size-theme'",
      args: [],
    });
    expect(rows.rows[0]?.state).toBe('rolled_back');
    const versions = await client.execute({
      sql: "SELECT count(*) AS n FROM theme_versions WHERE slug = 'size-theme'",
      args: [],
    });
    expect(Number(versions.rows[0]?.n)).toBe(0);
  });

  test('the existing community route still refuses a .zip at reserve', async () => {
    // The theme family must not have widened the community path.
    const res = await app.handle(
      request(
        'POST',
        '/api/assets/community',
        {
          category: 'portraits',
          tag: 'portraits:fixture',
          title: 'Zip Fixture',
          ext: '.zip',
          sizeBytes: 1024,
          provenance: { source: 'original', license: 'CC-BY-4.0' },
        },
        ownerCookie,
      ),
    );
    expect(res.status).toBe(503);
  });
});

describe('AC-3: moderated discovery and real public bytes', () => {
  test('a non-moderator cannot transition anything (403)', async () => {
    const res = await app.handle(
      request(
        'POST',
        '/api/assets/themes/fixture-theme/moderation',
        { decision: 'approved' },
        ownerCookie,
      ),
    );
    expect(res.status).toBe(403);
  });

  test('pending bytes are not publicly deliverable', async () => {
    const res = await app.handle(
      request('GET', '/api/assets/themes/fixture-theme/public?version=1.0.0'),
    );
    expect(res.status).toBe(404);
  });

  test('pending bytes are not listable and not readable anonymously', async () => {
    const listing = await app.handle(request('GET', '/api/assets/themes'));
    expect(((await listing.json()) as { items: unknown[] }).items.length).toBe(0);

    const detail = await app.handle(request('GET', '/api/assets/themes/fixture-theme'));
    expect(detail.status).toBe(404);

    const raw = await app.handle(
      request('GET', '/api/assets/themes/fixture-theme/raw?version=1.0.0'),
    );
    expect(raw.status).toBe(404);
  });

  test('the owner can read its own pending bytes, another account cannot', async () => {
    const ownerRaw = await app.handle(
      request('GET', '/api/assets/themes/fixture-theme/raw?version=1.0.0', undefined, ownerCookie),
    );
    expect(ownerRaw.status).toBe(200);
    expect(await ownerRaw.headers.get('content-type')).toBe('application/zip');

    const otherRaw = await app.handle(
      request('GET', '/api/assets/themes/fixture-theme/raw?version=1.0.0', undefined, otherCookie),
    );
    expect(otherRaw.status).toBe(404);
  });

  test('approval promotes once and public bytes equal the uploaded digest', async () => {
    const bytes = validPackage();
    const expected = await sha256Of(bytes);

    const approve = await app.handle(
      request(
        'POST',
        '/api/assets/themes/fixture-theme/moderation',
        { decision: 'approved' },
        moderatorCookie,
      ),
    );
    expect(approve.status).toBe(200);
    const approved = (await approve.json()) as { moderationState: string; promotedAt: string };
    expect(approved.moderationState).toBe('approved');

    const again = await app.handle(
      request(
        'POST',
        '/api/assets/themes/fixture-theme/moderation',
        { decision: 'approved' },
        moderatorCookie,
      ),
    );
    expect(again.status).toBe(200);
    // Promotion happened exactly once: one object, one revision.
    expect(catalog.store.size).toBe(1);

    const publicRes = await app.handle(
      request('GET', '/api/assets/themes/fixture-theme/public?version=1.0.0'),
    );
    expect(publicRes.status).toBe(200);
    const delivered = new Uint8Array(await publicRes.arrayBuffer());
    expect(await sha256Of(delivered)).toBe(expected);
    expect(delivered.byteLength).toBe(bytes.byteLength);

    const listing = await app.handle(request('GET', '/api/assets/themes'));
    const page = (await listing.json()) as {
      items: Array<{ themeId: string; version: string; promoted: boolean; variants: string[] }>;
    };
    expect(page.items.length).toBe(1);
    expect(page.items[0]?.promoted).toBe(true);
    expect(page.items[0]?.variants.sort()).toEqual(['dark', 'light']);
  });

  test('the detail surface reports only declared facts', async () => {
    const res = await app.handle(request('GET', '/api/assets/themes/fixture-theme'));
    expect(res.status).toBe(200);
    const detail = (await res.json()) as {
      themeApiRange: string;
      themeApiSupported: boolean;
      variantFacts: Array<{ variant: string; fontFamily: string[]; fontWeight: number[] }>;
      hasHudPreset: boolean;
    };
    expect(detail.themeApiRange).toBe('>=1.0 <2.0');
    expect(detail.themeApiSupported).toBe(true);
    expect(detail.variantFacts.map((fact) => fact.variant).sort()).toEqual(['dark', 'light']);
    expect(detail.variantFacts[0]?.fontFamily).toEqual(['sans']);
    expect(detail.variantFacts[0]?.fontWeight).toEqual([400]);
    expect(detail.hasHudPreset).toBe(false);
  });

  test('rejection keeps the bytes private and the public URL 404s', async () => {
    const bytes = validPackage({ id: 'rejected-theme' });
    await publish(ownerCookie, bytes, { themeId: 'rejected-theme', version: '1.0.0' });
    const catalogObjectsBefore = catalog.store.size;

    const reject = await app.handle(
      request(
        'POST',
        '/api/assets/themes/rejected-theme/moderation',
        { decision: 'rejected', note: 'not a theme' },
        moderatorCookie,
      ),
    );
    expect(reject.status).toBe(200);

    const publicRes = await app.handle(
      request('GET', '/api/assets/themes/rejected-theme/public?version=1.0.0'),
    );
    expect(publicRes.status).toBe(404);
    // No promotion happened: the rejected bytes never entered the public bucket.
    expect(catalog.store.size).toBe(catalogObjectsBefore);
  });

  test('revocation withdraws public delivery without a fourth moderation state', async () => {
    const revoke = await app.handle(
      request(
        'POST',
        '/api/assets/themes/fixture-theme/revocation',
        { revoked: true, note: 'withdrawn' },
        moderatorCookie,
      ),
    );
    expect(revoke.status).toBe(200);

    const publicRes = await app.handle(
      request('GET', '/api/assets/themes/fixture-theme/public?version=1.0.0'),
    );
    expect(publicRes.status).toBe(404);

    const listing = await app.handle(request('GET', '/api/assets/themes'));
    expect(((await listing.json()) as { items: unknown[] }).items.length).toBe(0);

    // The audit trail survives: still `approved`, with a revocation marker.
    const rows = await client.execute({
      sql: "SELECT moderation_state, revoked_at FROM theme_versions WHERE slug = 'fixture-theme'",
      args: [],
    });
    expect(rows.rows[0]?.moderation_state).toBe('approved');
    expect(rows.rows[0]?.revoked_at).not.toBeNull();

    // Restoring clears the marker without re-copying bytes.
    const restore = await app.handle(
      request(
        'POST',
        '/api/assets/themes/fixture-theme/revocation',
        { revoked: false },
        moderatorCookie,
      ),
    );
    expect(restore.status).toBe(200);
    expect(catalog.store.size).toBe(1);
  });

  test('a non-moderator cannot revoke', async () => {
    const res = await app.handle(
      request(
        'POST',
        '/api/assets/themes/fixture-theme/revocation',
        { revoked: true },
        otherCookie,
      ),
    );
    expect(res.status).toBe(403);
  });
});

describe('AC-9: the feature gate and the additive migration', () => {
  test('with the gate off new publishes are refused and discovery is hidden', async () => {
    const gatedApp = createApp({
      assetThemeEnv: createThemeEnv({ themePublishingEnabled: false }),
    });

    const reserve = await gatedApp.handle(
      request(
        'POST',
        '/api/assets/themes',
        reserveBody(1024, { themeId: 'gated-theme', version: '1.0.0' }),
        ownerCookie,
      ),
    );
    expect(reserve.status).toBe(503);
    expect(((await reserve.json()) as { error: string }).error).toBe('theme-publishing-disabled');

    // Approved versions are NOT deleted and remain deliverable.
    const publicRes = await gatedApp.handle(
      request('GET', '/api/assets/themes/fixture-theme/public?version=1.0.0'),
    );
    expect(publicRes.status).toBe(200);
  });

  test('the 0012 migration is additive and its constraints bite', async () => {
    // Pre-existing community tables still exist and are usable.
    const community = await client.execute({
      sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('community_assets', 'asset_publish_staging', 'theme_versions', 'theme_publish_staging')",
      args: [],
    });
    expect(community.rows.map((row) => row.name).sort()).toEqual([
      'asset_publish_staging',
      'community_assets',
      'theme_publish_staging',
      'theme_versions',
    ]);

    // The existing three-state CHECK was NOT widened or rebuilt.
    const ddl = await client.execute({
      sql: "SELECT sql FROM sqlite_master WHERE name = 'community_assets'",
      args: [],
    });
    expect(String(ddl.rows[0]?.sql)).toContain(
      "moderation_state` IN ('pending', 'approved', 'rejected')",
    );

    // A fourth moderation state is still refused.
    await expect(
      client.execute({
        sql: "INSERT INTO theme_versions (id, owner_account_id, slug, version, name, author_display_name, license, theme_api_range, manifest_json, variants_json, variant_facts_json, asset_count, package_bytes, sha256, ext, provenance_json, moderation_state, has_hud_preset, created_at, updated_at) VALUES ('bad-1', ?, 'bad-state', '1.0.0', 'n', 'a', 'MIT', '>=1.0', '{}', '{}', '[]', 0, 1, ?, '.zip', '{}', 'removed', 0, 1, 1)",
        args: [ownerId, 'a'.repeat(64)],
      }),
    ).rejects.toThrow();

    // A revoked version must be approved.
    await expect(
      client.execute({
        sql: "INSERT INTO theme_versions (id, owner_account_id, slug, version, name, author_display_name, license, theme_api_range, manifest_json, variants_json, variant_facts_json, asset_count, package_bytes, sha256, ext, provenance_json, moderation_state, revoked_at, has_hud_preset, created_at, updated_at) VALUES ('bad-2', ?, 'bad-revoke', '1.0.0', 'n', 'a', 'MIT', '>=1.0', '{}', '{}', '[]', 0, 1, ?, '.zip', '{}', 'pending', 1, 0, 1, 1)",
        args: [ownerId, 'b'.repeat(64)],
      }),
    ).rejects.toThrow();

    // One live reservation per (owner, slug, version).
    await client.execute({
      sql: "INSERT INTO theme_publish_staging (id, owner_account_id, slug, version, size_bytes, staging_key, state, provenance_json, created_at, updated_at) VALUES ('s-1', ?, 'uniq-theme', '1.0.0', 10, 'staging/x/1', 'reserved', '{}', 1, 1)",
      args: [ownerId],
    });
    await expect(
      client.execute({
        sql: "INSERT INTO theme_publish_staging (id, owner_account_id, slug, version, size_bytes, staging_key, state, provenance_json, created_at, updated_at) VALUES ('s-2', ?, 'uniq-theme', '1.0.0', 10, 'staging/x/2', 'reserved', '{}', 1, 1)",
        args: [ownerId],
      }),
    ).rejects.toThrow();
  });
});
