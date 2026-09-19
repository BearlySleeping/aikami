// scripts/src/lib/catalog/__tests__/catalog_carry_forward.test.ts
//
// Carry-forward: the previous COMPLETE release plus this candidate's
// authoritative changes must equal the new candidate release.
//
// The failure this guards against is silent and looks like success: rebuilding
// the index from a de-bundled checkout produced "0 uploaded, 74 skipped, 0
// failed" while replacing a ~12,700-entry catalog with ~74 entries.

import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CatalogAssetEntry } from '@aikami/schemas';
import type { CatalogEntry } from '../catalog_entries.ts';
import { generateCatalogIndex } from '../index_generation.ts';
import {
  mergeCatalogEntries,
  PreviousReleaseError,
  resolvePreviousRelease,
} from '../published_catalog.ts';
import { runSeedPublish } from '../seed_publish.ts';
import { FakeR2Client } from './fixtures.ts';

const ORIGIN = 'https://assets.example.test';

const sha256 = (input: string | Uint8Array): string =>
  createHash('sha256').update(input).digest('hex');

const bytes = (input: string): Uint8Array => new TextEncoder().encode(input);

/** A local scan entry, as `scan_assets.ts` would produce. */
const localEntry = (options: { tag: string; category: string; hash?: string }): CatalogEntry => ({
  tag: options.tag,
  hash: options.hash ?? sha256(`local:${options.tag}`),
  sizeBytes: 100,
  category: options.category,
  ext: '.webp',
  path: `${options.category}/${options.tag}.webp`,
  rootDir: '/tmp/fake',
  licenses: ['MIT'],
  authors: ['Aikami Studio'],
  sourceUrls: [],
});

/** A carried entry, as a previous release's shard would carry it. */
const carriedEntry = (options: {
  tag: string;
  category: string;
  hash?: string;
  licenses?: string[];
  authors?: string[];
}): CatalogAssetEntry =>
  ({
    tag: options.tag,
    hash: options.hash ?? sha256(`carried:${options.tag}`),
    sizeBytes: 42,
    category: options.category,
    ext: '.webp',
    licenses: options.licenses ?? ['OGA-BY 3.0'],
    authors: options.authors ?? ['bluecarrot16'],
    sourceUrls: ['https://opengameart.org/content/lpc-character-bases'],
  }) as CatalogAssetEntry;

// ---------------------------------------------------------------------------
// mergeCatalogEntries
// ---------------------------------------------------------------------------

describe('mergeCatalogEntries — absence is not deletion', () => {
  test('a carried entry survives a local candidate that does not mention it', () => {
    // THE core regression. The local checkout carries 2 tags; the previous
    // release carried 5. All 5 must survive.
    const carried = ['a', 'b', 'c', 'd', 'e'].map((tag) =>
      carriedEntry({ tag, category: 'tilesets' }),
    );
    const { entries, report } = mergeCatalogEntries({
      local: [localEntry({ tag: 'a', category: 'tilesets' })],
      carried,
    });

    expect(entries).toHaveLength(5);
    expect(report).toEqual({ carried: 4, replaced: 1, added: 0, retired: 0, total: 5 });
    expect(entries.map((entry) => entry.tag).sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  test('a local entry wins for its own tag', () => {
    const carried = [carriedEntry({ tag: 'emberwatch:maps:village', category: 'contentPacks' })];
    const local = localEntry({
      tag: 'emberwatch:maps:village',
      category: 'contentPacks',
      hash: sha256('the new village'),
    });

    const { entries, report } = mergeCatalogEntries({ local: [local], carried });

    expect(entries).toHaveLength(1);
    expect(entries[0]?.hash).toBe(sha256('the new village'));
    expect(entries[0]?.authors).toEqual(['Aikami Studio']);
    expect(report.replaced).toBe(1);
    expect(report.carried).toBe(0);
  });

  test('unchanged carried entries keep their exact hash and metadata', () => {
    const untouched = carriedEntry({
      tag: 'sprites:lpc:body',
      category: 'sprites',
      hash: sha256('verbatim'),
      licenses: ['CC-BY-SA 3.0'],
      authors: ['Stephen Challener (Redshrike)'],
    });
    const { entries } = mergeCatalogEntries({
      local: [localEntry({ tag: 'emberwatch:manifest', category: 'contentPacks' })],
      carried: [untouched],
    });

    const survivor = entries.find((entry) => entry.tag === 'sprites:lpc:body');
    expect(survivor).toEqual(untouched);
  });

  test('local additions in several categories are all present', () => {
    const carried = [
      carriedEntry({ tag: 'sprites:a', category: 'sprites' }),
      carriedEntry({ tag: 'music:b', category: 'music' }),
    ];
    const { entries, report } = mergeCatalogEntries({
      local: [
        localEntry({ tag: 'emberwatch:maps:inn', category: 'contentPacks' }),
        localEntry({ tag: 'emberwatch:maps:old_road', category: 'contentPacks' }),
        localEntry({ tag: 'portraits:x:neutral', category: 'portraits' }),
      ],
      carried,
    });

    expect(report).toEqual({ carried: 2, replaced: 0, added: 3, retired: 0, total: 5 });
    expect(new Set(entries.map((entry) => entry.category))).toEqual(
      new Set(['sprites', 'music', 'contentPacks', 'portraits']),
    );
  });

  test('a tag requires an explicit retirement to be removed', () => {
    const carried = [
      carriedEntry({ tag: 'keep', category: 'sprites' }),
      carriedEntry({ tag: 'drop', category: 'sprites' }),
    ];

    const withoutDeclaration = mergeCatalogEntries({ local: [], carried });
    expect(withoutDeclaration.entries).toHaveLength(2);
    expect(withoutDeclaration.report.retired).toBe(0);

    const withDeclaration = mergeCatalogEntries({ local: [], carried, retire: ['drop'] });
    expect(withDeclaration.entries.map((entry) => entry.tag)).toEqual(['keep']);
    expect(withDeclaration.report.retired).toBe(1);
  });

  test('retiring a tag the release does not carry is a no-op, not a failure', () => {
    const { report } = mergeCatalogEntries({
      local: [],
      carried: [carriedEntry({ tag: 'keep', category: 'sprites' })],
      retire: ['never-existed'],
    });
    expect(report.retired).toBe(0);
    expect(report.total).toBe(1);
  });

  test('duplicate tags in the candidate collapse to the last one, deterministically', () => {
    // scan_assets keys by tag, so a duplicate should not reach here — but if it
    // does, the merge must not double-count or emit two entries for one tag.
    const { entries, report } = mergeCatalogEntries({
      local: [
        localEntry({ tag: 'dupe', category: 'sprites', hash: sha256('first') }),
        localEntry({ tag: 'dupe', category: 'sprites', hash: sha256('second') }),
      ],
      carried: [],
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.hash).toBe(sha256('second'));
    expect(report.added).toBe(2);
    expect(report.total).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// generateCatalogIndex carry-forward
// ---------------------------------------------------------------------------

describe('generateCatalogIndex — carried entries reach the index', () => {
  test('THE SHIPPED FAILURE: ~12k published, ~74 local, nothing collapses', () => {
    // Representative fixture: 3 categories of carried entries plus a small
    // local candidate. The assertion that matters is the CARDINALITY one — the
    // candidate must not be able to shrink the catalog to its own scan size.
    const carried: CatalogAssetEntry[] = [
      ...Array.from({ length: 40 }, (_, i) =>
        carriedEntry({ tag: `sprites:lpc:${i}`, category: 'sprites' }),
      ),
      ...Array.from({ length: 25 }, (_, i) =>
        carriedEntry({ tag: `music:bed:${i}`, category: 'music' }),
      ),
      ...Array.from({ length: 9 }, (_, i) =>
        carriedEntry({ tag: `tilesets:sheet:${i}`, category: 'tilesets' }),
      ),
    ];
    const local = [
      localEntry({ tag: 'emberwatch:manifest', category: 'contentPacks' }),
      localEntry({ tag: 'emberwatch:maps:village', category: 'contentPacks' }),
      localEntry({ tag: 'emberwatch:maps:inn', category: 'contentPacks' }),
    ];

    const { root, merge } = generateCatalogIndex({
      entries: local,
      originUrl: ORIGIN,
      carriedEntries: carried,
    });

    expect(carried).toHaveLength(74);
    expect(local).toHaveLength(3);

    // The catalog cannot collapse to the local scan cardinality.
    expect(root.totalCount).toBe(77);
    expect(root.totalCount).not.toBe(local.length);
    expect(merge).toEqual({ carried: 74, replaced: 0, added: 3, retired: 0, total: 77 });
  });

  test('root totalCount counts the merged set, not the local candidate', () => {
    const { root } = generateCatalogIndex({
      entries: [localEntry({ tag: 'only-local', category: 'contentPacks' })],
      originUrl: ORIGIN,
      carriedEntries: [
        carriedEntry({ tag: 'c1', category: 'sprites' }),
        carriedEntry({ tag: 'c2', category: 'sprites' }),
      ],
    });
    expect(root.totalCount).toBe(3);
  });

  test('category shard counts include carried entries', () => {
    const { root, shards } = generateCatalogIndex({
      entries: [localEntry({ tag: 'local:sprites', category: 'sprites' })],
      originUrl: ORIGIN,
      carriedEntries: [
        carriedEntry({ tag: 'carried:a', category: 'sprites' }),
        carriedEntry({ tag: 'carried:b', category: 'sprites' }),
        carriedEntry({ tag: 'carried:m', category: 'music' }),
      ],
    });

    const byId = new Map(root.categories.map((category) => [category.id, category.count]));
    expect(byId.get('sprites')).toBe(3);
    expect(byId.get('music')).toBe(1);

    const spritesShard = shards.find((shard) => shard.id === 'sprites');
    const parsed = JSON.parse(shards.find((shard) => shard.id === 'sprites')?.json ?? '{}') as {
      entries: CatalogAssetEntry[];
    };
    expect(spritesShard).toBeDefined();
    expect(parsed.entries).toHaveLength(3);
  });

  test('a category that exists ONLY in the carried set still gets a shard', () => {
    const { root, shards } = generateCatalogIndex({
      entries: [localEntry({ tag: 'local', category: 'contentPacks' })],
      originUrl: ORIGIN,
      carriedEntries: [carriedEntry({ tag: 'lpc:body', category: 'sprites' })],
    });

    expect(root.categories.map((category) => category.id).sort()).toEqual([
      'contentPacks',
      'sprites',
    ]);
    expect(shards.map((shard) => shard.id).sort()).toEqual(['contentPacks', 'sprites']);
  });

  test('a local replacement wins inside the generated shard', () => {
    const { shards } = generateCatalogIndex({
      entries: [localEntry({ tag: 'shared', category: 'sprites', hash: sha256('new bytes') })],
      originUrl: ORIGIN,
      carriedEntries: [
        carriedEntry({ tag: 'shared', category: 'sprites', hash: sha256('old bytes') }),
      ],
    });

    const parsed = JSON.parse(shards[0]?.json ?? '{}') as { entries: CatalogAssetEntry[] };
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0]?.hash).toBe(sha256('new bytes'));
  });

  test('with no previous release the index is exactly the local candidate', () => {
    const { root, merge } = generateCatalogIndex({
      entries: [
        localEntry({ tag: 'a', category: 'sprites' }),
        localEntry({ tag: 'b', category: 'music' }),
      ],
      originUrl: ORIGIN,
    });
    expect(root.totalCount).toBe(2);
    expect(merge).toEqual({ carried: 0, replaced: 0, added: 2, retired: 0, total: 2 });
  });

  test('retirement is honoured through generateCatalogIndex', () => {
    const { root, merge } = generateCatalogIndex({
      entries: [],
      originUrl: ORIGIN,
      carriedEntries: [
        carriedEntry({ tag: 'keep', category: 'sprites' }),
        carriedEntry({ tag: 'drop', category: 'sprites' }),
      ],
      retireTags: ['drop'],
    });
    expect(root.totalCount).toBe(1);
    expect(merge.retired).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// resolvePreviousRelease — fail closed
// ---------------------------------------------------------------------------

/** Builds a syntactically valid, hash-consistent release graph + reader. */
const buildRelease = (options: {
  entries: CatalogAssetEntry[];
  seed?: string;
  extraDependencies?: { key: string; body: string }[];
}) => {
  const shardBody = JSON.stringify({
    schemaVersion: 1,
    publishedAt: '2026-01-01T00:00:00.000Z',
    originUrl: ORIGIN,
    id: 'sprites',
    category: 'sprites',
    entries: options.entries,
  });
  const rootBody = JSON.stringify({
    schemaVersion: 1,
    publishedAt: '2026-01-01T00:00:00.000Z',
    originUrl: ORIGIN,
    totalCount: options.entries.length,
    categories: [{ id: 'sprites', count: options.entries.length }],
  });
  const seedBody = options.seed ?? '{"sv":1,"r":[]}';

  const documents = new Map<string, Uint8Array>([
    ['index/v1/catalog.json', bytes(rootBody)],
    ['index/v1/sprites.json', bytes(shardBody)],
    ['seed/asset_seed.json', bytes(seedBody)],
    ...(options.extraDependencies ?? []).map(
      (dependency) => [dependency.key, bytes(dependency.body)] as const,
    ),
  ]);

  const pointer = {
    schemaVersion: 'catalog.release.v1',
    releaseId: 'release-under-test',
    rootKey: 'index/v1/catalog.json',
    rootHash: sha256(rootBody),
    shards: [{ key: 'index/v1/sprites.json', hash: sha256(shardBody), category: 'sprites' }],
    dependencies: [
      { key: 'seed/asset_seed.json', hash: sha256(seedBody) },
      ...(options.extraDependencies ?? []).map((dependency) => ({
        key: dependency.key,
        hash: sha256(dependency.body),
      })),
    ],
    publishedAt: '2026-01-01T00:00:00.000Z',
  };

  const reader = async (key: string): Promise<Uint8Array | undefined> => {
    if (key === 'index/v1/release.json') {
      return bytes(JSON.stringify(pointer));
    }
    return documents.get(key);
  };

  return { reader, documents, pointer, rootBody, shardBody };
};

describe('resolvePreviousRelease — verified, or not at all', () => {
  test('a consistent release resolves and carries its entries', async () => {
    const entries = [
      carriedEntry({ tag: 'a', category: 'sprites' }),
      carriedEntry({ tag: 'b', category: 'sprites' }),
    ];
    const { reader } = buildRelease({ entries });

    const previous = await resolvePreviousRelease({ originUrl: ORIGIN, reader });

    expect(previous?.releaseId).toBe('release-under-test');
    expect(previous?.entries.map((entry) => entry.tag).sort()).toEqual(['a', 'b']);
    expect(previous?.dependencies.has('seed/asset_seed.json')).toBe(true);
  });

  test('a required dependency is carried forward byte-for-byte', async () => {
    // The de-bundled checkout has no local lpc_credits.json. The previous
    // release pins one; it must survive with its exact hash.
    const lpcCredits = '{"credits":{"sprites:lpc:body":{"licenses":["CC-BY-SA 3.0"]}}}';
    const { reader } = buildRelease({
      entries: [carriedEntry({ tag: 'a', category: 'sprites' })],
      extraDependencies: [{ key: 'seed/lpc_credits.json', body: lpcCredits }],
    });

    const previous = await resolvePreviousRelease({ originUrl: ORIGIN, reader });
    const carried = previous?.dependencies.get('seed/lpc_credits.json');

    expect(carried).toBeDefined();
    expect(new TextDecoder().decode(carried as Uint8Array)).toBe(lpcCredits);
    expect(sha256(carried as Uint8Array)).toBe(sha256(lpcCredits));
  });

  test('no release pointer is a first publish, not a failure', async () => {
    const previous = await resolvePreviousRelease({
      originUrl: ORIGIN,
      reader: async () => undefined,
    });
    expect(previous).toBeUndefined();
  });

  test('a corrupt pointer fails closed', async () => {
    await expect(
      resolvePreviousRelease({
        originUrl: ORIGIN,
        reader: async (key) => (key === 'index/v1/release.json' ? bytes('{not json') : undefined),
      }),
    ).rejects.toBeInstanceOf(PreviousReleaseError);
  });

  test('a schema-invalid pointer fails closed rather than falling back', async () => {
    await expect(
      resolvePreviousRelease({
        originUrl: ORIGIN,
        reader: async (key) =>
          key === 'index/v1/release.json'
            ? bytes(JSON.stringify({ schemaVersion: 'nope' }))
            : undefined,
      }),
    ).rejects.toBeInstanceOf(PreviousReleaseError);
  });

  test('a corrupt ROOT hash fails closed', async () => {
    const { reader, documents } = buildRelease({
      entries: [carriedEntry({ tag: 'a', category: 'sprites' })],
    });
    documents.set('index/v1/catalog.json', bytes('{"tampered":true}'));

    await expect(resolvePreviousRelease({ originUrl: ORIGIN, reader })).rejects.toBeInstanceOf(
      PreviousReleaseError,
    );
  });

  test('a corrupt SHARD hash fails closed', async () => {
    const { reader, documents } = buildRelease({
      entries: [carriedEntry({ tag: 'a', category: 'sprites' })],
    });
    documents.set('index/v1/sprites.json', bytes('{"entries":[]}'));

    await expect(resolvePreviousRelease({ originUrl: ORIGIN, reader })).rejects.toBeInstanceOf(
      PreviousReleaseError,
    );
  });

  test('a corrupt DEPENDENCY hash fails closed', async () => {
    const { reader, documents } = buildRelease({
      entries: [carriedEntry({ tag: 'a', category: 'sprites' })],
    });
    documents.set('seed/asset_seed.json', bytes('{"sv":1,"r":[],"tampered":true}'));

    await expect(resolvePreviousRelease({ originUrl: ORIGIN, reader })).rejects.toBeInstanceOf(
      PreviousReleaseError,
    );
  });

  test('a missing shard object fails closed', async () => {
    const { reader, documents } = buildRelease({
      entries: [carriedEntry({ tag: 'a', category: 'sprites' })],
    });
    documents.delete('index/v1/sprites.json');

    await expect(resolvePreviousRelease({ originUrl: ORIGIN, reader })).rejects.toBeInstanceOf(
      PreviousReleaseError,
    );
  });

  test('a transport failure is not mistaken for an absent release', async () => {
    await expect(
      resolvePreviousRelease({
        originUrl: ORIGIN,
        reader: async () => {
          throw new Error('ECONNRESET');
        },
      }),
    ).rejects.toBeInstanceOf(PreviousReleaseError);
  });
});

// ---------------------------------------------------------------------------
// runSeedPublish — a required dependency is carried, never dropped
// ---------------------------------------------------------------------------

describe('runSeedPublish — completeness, not leniency', () => {
  /** A game-data dir holding only the files a de-bundled checkout still has. */
  const makePartialGameData = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'carry-forward-seed-'));
    writeFileSync(join(dir, 'asset_seed.json'), JSON.stringify({ sv: 1, r: [] }));
    writeFileSync(join(dir, 'offline_core.json'), JSON.stringify({ tags: [] }));
    writeFileSync(join(dir, 'asset_credits.json'), JSON.stringify({ credits: {} }));
    writeFileSync(join(dir, 'audio_tracks.json'), JSON.stringify({ tracks: [] }));
    // lpc_credits.json and lpc_credits_supplement.json are NOT here — the LPC
    // library is no longer committed (C-435), exactly as in a real checkout.
    return dir;
  };

  test('a file absent locally is carried from the previous verified release', async () => {
    const client = new FakeR2Client();
    const lpcCredits = '{"credits":{"sprites:lpc:body":{"licenses":["CC-BY-SA 3.0"]}}}';
    const supplement = '{"credits":{"sprites:lpc:head":{"licenses":["CC-BY-SA 3.0"]}}}';
    const carried = new Map<string, Uint8Array>([
      [`seed/${sha256(lpcCredits)}/lpc_credits.json`, bytes(lpcCredits)],
      [`seed/${sha256(supplement)}/lpc_credits_supplement.json`, bytes(supplement)],
    ]);

    const report = await runSeedPublish({
      client,
      gameDataDir: makePartialGameData(),
      carriedDependencies: carried,
    });

    expect(report.failed).toBe(0);
    expect(report.carried).toBe(2);
    expect(report.uploaded).toBe(4);
    // The carried objects keep their EXACT previous key and hash, so the new
    // release pins byte-identical bytes to the ones already published.
    expect(report.objects.find((o) => o.key.endsWith('/lpc_credits.json'))).toEqual({
      key: `seed/${sha256(lpcCredits)}/lpc_credits.json`,
      hash: sha256(lpcCredits),
      carried: true,
    });
  });

  test('a required dependency missing from BOTH sides fails the release', async () => {
    const client = new FakeR2Client();

    const report = await runSeedPublish({
      client,
      gameDataDir: makePartialGameData(),
      carriedDependencies: new Map(),
    });

    // Two files are absent locally and unrepresented in the previous release:
    // the release cannot be complete, and must say so rather than quietly
    // publishing a graph with a hole in it.
    expect(report.failed).toBe(2);
    expect(report.carried).toBe(0);
  });

  test('a locally present file always wins over the carried copy', async () => {
    const client = new FakeR2Client();
    const stale = '{"credits":{"stale":true}}';
    const dir = makePartialGameData();
    const fresh = '{"credits":{"fresh":true}}';
    writeFileSync(join(dir, 'lpc_credits.json'), fresh);

    const report = await runSeedPublish({
      client,
      gameDataDir: dir,
      carriedDependencies: new Map([[`seed/${sha256(stale)}/lpc_credits.json`, bytes(stale)]]),
    });

    const entry = report.objects.find((o) => o.key.endsWith('/lpc_credits.json'));
    expect(entry?.hash).toBe(sha256(fresh));
    expect(entry?.carried).toBe(false);
  });
});
