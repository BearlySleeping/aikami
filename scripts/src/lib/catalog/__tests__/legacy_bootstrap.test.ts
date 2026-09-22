// scripts/src/lib/catalog/__tests__/legacy_bootstrap.test.ts
//
// The first immutable production release must not silently discard the legacy
// mutable catalog.
//
// Production has never published `index/v1/release.json`. What it serves is the
// pre-C-496 mutable surface: a 108-entry root index, its mutable shards, and a
// 12,729-row compact boot seed. The local checkout holds a few dozen tags.
//
// Rebuilding from the local scan alone would replace a complete boot seed with
// the local subset and the publish log would read "74 uploaded, 0 failed".
//
// Every fixture here is in-memory. No test touches a real bucket or origin.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CatalogAssetEntry } from '@aikami/schemas';
import { bootstrapLegacyCatalog } from '../legacy_bootstrap.ts';
import { runCatalogPublish } from '../pipeline.ts';
import { FakeR2Client, makeFixtureGameData } from './fixtures.ts';
import { buildLegacyCatalog, buildReleaseGraph, entry, seedRow } from './release_graph_fixture.ts';

const ORIGIN = 'https://assets.bearlysleeping.com';

/** The observed production shape, scaled down but structurally identical. */
const legacyFixture = (options: Partial<Parameters<typeof buildLegacyCatalog>[0]> = {}) =>
  buildLegacyCatalog({
    originUrl: ORIGIN,
    categories: {
      contentPacks: [entry({ tag: 'emberwatch:manifest', category: 'contentPacks', ext: '.json' })],
      lpc: [
        entry({ tag: 'lpc:hat:magic:celestial:thrust', category: 'lpc' }),
        entry({ tag: 'lpc:hat:magic:celestial:idle', category: 'lpc' }),
      ],
      portraits: [entry({ tag: 'portraits:npc:aragon:neutral', category: 'portraits' })],
    },
    ...options,
  });

describe('legacy bootstrap — reading the mutable catalog', () => {
  test('an origin with no legacy catalog has nothing to migrate', async () => {
    const outcome = await bootstrapLegacyCatalog({
      originUrl: ORIGIN,
      reader: async () => undefined,
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.applied).toBe(false);
    }
  });

  test('every legacy entry is carried, with the seed as a pinned dependency', async () => {
    const fixture = legacyFixture();
    const outcome = await bootstrapLegacyCatalog({ originUrl: ORIGIN, reader: fixture.reader });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok || !outcome.applied) {
      throw new Error('expected an applied migration');
    }
    expect(outcome.plan.entries.map((e) => e.tag).sort()).toEqual([
      'emberwatch:manifest',
      'lpc:hat:magic:celestial:idle',
      'lpc:hat:magic:celestial:thrust',
      'portraits:npc:aragon:neutral',
    ]);
    expect(outcome.plan.dependencies.has('seed/asset_seed.json')).toBe(true);
    expect(outcome.plan.carriedTags).toHaveLength(4);
    expect(outcome.plan.replacedTags).toHaveLength(0);
  });

  test('a tag the current candidate produces is classified as REPLACED, not carried', async () => {
    const fixture = legacyFixture();
    const outcome = await bootstrapLegacyCatalog({
      originUrl: ORIGIN,
      reader: fixture.reader,
      currentTags: new Set(['emberwatch:manifest']),
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok || !outcome.applied) {
      throw new Error('expected an applied migration');
    }
    expect(outcome.plan.replacedTags).toEqual(['emberwatch:manifest']);
    expect(outcome.plan.carriedTags).not.toContain('emberwatch:manifest');
    // The legacy entry is still returned — the CALLER decides precedence, and
    // the ordinary merge already makes a local entry win for its own tag.
    expect(outcome.plan.entries.map((e) => e.tag)).toContain('emberwatch:manifest');
  });

  test('seed rows the candidate does not produce are counted as carried', async () => {
    const fixture = legacyFixture({
      categories: { lpc: [entry({ tag: 'lpc:a', category: 'lpc' })] },
      seedRows: [seedRow({ tag: 'lpc:a' }), seedRow({ tag: 'lpc:b' }), seedRow({ tag: 'lpc:c' })],
    });
    const outcome = await bootstrapLegacyCatalog({
      originUrl: ORIGIN,
      reader: fixture.reader,
      currentTags: new Set(['lpc:a']),
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok || !outcome.applied) {
      throw new Error('expected an applied migration');
    }
    expect(outcome.plan.carriedSeedRows).toBe(2);
  });

  test('the offline-core declaration and the installed lock are carried when valid', async () => {
    const fixture = legacyFixture({
      offlineCore: JSON.stringify({
        schemaVersion: 1,
        tags: ['lpc:a'],
        rationale: { 'lpc:a': 'legacy boot asset' },
      }),
      packLock: JSON.stringify({
        schemaVersion: 'catalog.release.v1',
        releaseId: 'legacy',
        assets: [{ id: 'lpc:a', imageHash: 'a'.repeat(64), definitionHash: 'b'.repeat(64) }],
      }),
    });
    const outcome = await bootstrapLegacyCatalog({ originUrl: ORIGIN, reader: fixture.reader });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok || !outcome.applied) {
      throw new Error('expected an applied migration');
    }
    expect(outcome.plan.dependencies.has('seed/offline_core.json')).toBe(true);
    expect(outcome.plan.dependencies.has('index/v1/pack_lock.json')).toBe(true);
    expect(outcome.plan.rejected).toEqual([]);
  });

  test('a legacy object that fails its schema is REJECTED and named, not silently used', async () => {
    const fixture = legacyFixture({
      offlineCore: JSON.stringify({
        schemaVersion: 1,
        tags: ['lpc:a'],
        rationale: { 'lpc:a': 'legacy boot asset' },
      }),
      packLock: JSON.stringify({ schemaVersion: 'catalog.release.v1', assets: [] }),
    });
    const outcome = await bootstrapLegacyCatalog({ originUrl: ORIGIN, reader: fixture.reader });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok || !outcome.applied) {
      throw new Error('expected an applied migration');
    }
    expect(outcome.plan.rejected.map((r) => r.key)).toEqual(['index/v1/pack_lock.json']);
    expect(outcome.plan.dependencies.has('index/v1/pack_lock.json')).toBe(false);
  });

  test('invalid offline-core declarations are rejected before becoming dependencies', async () => {
    for (const offlineCore of ['null', JSON.stringify({ unrelated: true })]) {
      const fixture = legacyFixture({ offlineCore });
      const outcome = await bootstrapLegacyCatalog({ originUrl: ORIGIN, reader: fixture.reader });

      expect(outcome.ok).toBe(true);
      if (!outcome.ok || !outcome.applied) {
        throw new Error('expected an applied migration');
      }
      expect(outcome.plan.rejected.map((rejection) => rejection.key)).toContain(
        'seed/offline_core.json',
      );
      expect(outcome.plan.dependencies.has('seed/offline_core.json')).toBe(false);
    }
  });
});

describe('legacy bootstrap — fail closed', () => {
  test('a root that fails its schema is refused', async () => {
    const fixture = legacyFixture({ corruptRoot: true });
    const outcome = await bootstrapLegacyCatalog({ originUrl: ORIGIN, reader: fixture.reader });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe('legacy-root-invalid');
    }
  });

  test('a shard the root declares but that is absent is refused', async () => {
    const fixture = legacyFixture({ dropShard: 'lpc' });
    const outcome = await bootstrapLegacyCatalog({ originUrl: ORIGIN, reader: fixture.reader });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe('legacy-shard-unreadable');
      expect(outcome.reason).toContain('lpc');
    }
  });

  test('a shard that is not valid JSON is refused', async () => {
    const fixture = legacyFixture({ corruptShard: 'lpc' });
    const outcome = await bootstrapLegacyCatalog({ originUrl: ORIGIN, reader: fixture.reader });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe('legacy-shard-invalid');
    }
  });

  test('a shard whose entry count disagrees with the root is refused', async () => {
    const fixture = legacyFixture({ miscountShard: 'lpc' });
    const outcome = await bootstrapLegacyCatalog({ originUrl: ORIGIN, reader: fixture.reader });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe('legacy-shard-count-mismatch');
    }
  });

  test('an absent boot seed is refused — it is the complete inventory', async () => {
    const fixture = legacyFixture({ omitSeed: true });
    const outcome = await bootstrapLegacyCatalog({ originUrl: ORIGIN, reader: fixture.reader });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe('legacy-seed-unreadable');
    }
  });

  test('a boot seed that is not a compact seed document is refused', async () => {
    const fixture = legacyFixture({ seed: JSON.stringify({ sv: 1, g: 'x', o: '', r: 'nope' }) });
    const outcome = await bootstrapLegacyCatalog({ originUrl: ORIGIN, reader: fixture.reader });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe('legacy-seed-invalid');
    }
  });

  test('an index/seed identity conflict is refused, and the tags are named', async () => {
    // The two legacy surfaces describe the same assets. If they disagree about
    // a tag's bytes there is no correct choice between them.
    const fixture = legacyFixture({
      categories: { lpc: [entry({ tag: 'lpc:a', category: 'lpc', hash: 'a'.repeat(64) })] },
      seedRows: [seedRow({ tag: 'lpc:a', hash: 'b'.repeat(64) })],
    });
    const outcome = await bootstrapLegacyCatalog({ originUrl: ORIGIN, reader: fixture.reader });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe('legacy-identity-conflict');
      expect(outcome.reason).toContain('lpc:a');
    }
  });

  test('an index tag absent from the seed is an identity conflict', async () => {
    const fixture = legacyFixture({
      categories: { lpc: [entry({ tag: 'lpc:index-only', category: 'lpc' })] },
      seedRows: [seedRow({ tag: 'lpc:another-tag' })],
    });
    const outcome = await bootstrapLegacyCatalog({ originUrl: ORIGIN, reader: fixture.reader });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe('legacy-identity-conflict');
      expect(outcome.reason).toContain('lpc:index-only');
      expect(outcome.reason).toContain('seed=missing');
    }
  });

  test('a reader that throws is a refusal, not an empty catalog', async () => {
    const outcome = await bootstrapLegacyCatalog({
      originUrl: ORIGIN,
      reader: async () => {
        throw new Error('HTTP 500');
      },
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe('legacy-root-unreadable');
    }
  });
});

describe('first production publication preserves the legacy inventory', () => {
  let gameDataDir: string;
  let contentPacksDir: string;
  let client: FakeR2Client;

  beforeEach(() => {
    gameDataDir = makeFixtureGameData();
    contentPacksDir = mkdtempSync(join(tmpdir(), 'legacy-bootstrap-packs-'));
    client = new FakeR2Client();
  });

  afterEach(() => {
    rmSync(contentPacksDir, { recursive: true, force: true });
  });

  const productionConfig = () => ({
    accessKeyId: 'test',
    secretAccessKey: 'test',
    endpoint: 'https://test.r2.cloudflarestorage.com',
    bucket: 'aikami-catalog',
    originUrl: ORIGIN,
    releaseTarget: {
      mode: 'production',
      bucket: 'aikami-catalog',
      originUrl: ORIGIN,
      expectedBucket: 'aikami-catalog',
      viaTestSeam: false,
      warnings: [],
    },
  });

  /** The published root document, read back out of the fake bucket. */
  const publishedRoot = (): { totalCount: number; categories: { id: string; count: number }[] } => {
    const key = [...client.objects.keys()].find(
      (candidate) =>
        candidate.startsWith('index/v1/revisions/') && candidate.endsWith('/catalog.json'),
    );
    if (!key) {
      throw new Error('no immutable root index was published');
    }
    return JSON.parse(new TextDecoder().decode(client.objects.get(key)?.body)) as never;
  };

  const publishedSeed = (): { r: { t: string }[] } => {
    const key = [...client.objects.keys()].find((candidate) =>
      candidate.endsWith('/asset_seed.json'),
    );
    if (!key) {
      throw new Error('no seed was published');
    }
    return JSON.parse(new TextDecoder().decode(client.objects.get(key)?.body)) as never;
  };

  test('a first production publish unions the legacy entries into the new root', async () => {
    const legacy = legacyFixture();
    const report = await runCatalogPublish({
      config: productionConfig() as never,
      client,
      gameDataDir,
      contentPacksDir,
      releaseReader: legacy.reader,
    });

    expect(report.ok).toBe(true);
    const root = publishedRoot();
    // The fixture game-data contributes 7 local entries; the legacy catalog
    // contributes 4, none of which the fixture produces.
    expect(root.totalCount).toBeGreaterThanOrEqual(11);
    const total = root.categories.reduce((sum, category) => sum + category.count, 0);
    expect(total).toBe(root.totalCount);
  });

  test('a first production publish unions the legacy seed rows into the new seed', async () => {
    const legacy = legacyFixture({
      seedRows: [
        seedRow({ tag: 'lpc:legacy:one' }),
        seedRow({ tag: 'lpc:legacy:two' }),
        seedRow({ tag: 'lpc:legacy:three' }),
      ],
      categories: { lpc: [entry({ tag: 'lpc:legacy:one', category: 'lpc' })] },
    });
    const report = await runCatalogPublish({
      config: productionConfig() as never,
      client,
      gameDataDir,
      contentPacksDir,
      releaseReader: legacy.reader,
    });

    expect(report.ok).toBe(true);
    expect(report.seed?.failed).toBe(0);
    const tags = publishedSeed().r.map((row) => row.t);
    // The legacy rows survive even though this checkout cannot produce them.
    expect(tags).toContain('lpc:legacy:two');
    expect(tags).toContain('lpc:legacy:three');
  });

  test('a legacy catalog that cannot be migrated aborts BEFORE any upload', async () => {
    const legacy = legacyFixture({ omitSeed: true });
    const report = await runCatalogPublish({
      config: productionConfig() as never,
      client,
      gameDataDir,
      contentPacksDir,
      releaseReader: legacy.reader,
    });

    expect(report.ok).toBe(false);
    expect(client.putCount).toBe(0);
    expect(client.objects.size).toBe(0);
  });

  test('once a verified release exists, the legacy catalog is NOT consulted', async () => {
    // Both surfaces are served. The verified release must win outright: the
    // legacy-only tag must not appear in the new root.
    const verified = buildReleaseGraph({
      entries: [entry({ tag: 'release:only', category: 'sprites' })],
      originUrl: ORIGIN,
    });
    const legacy = legacyFixture({
      categories: { lpc: [entry({ tag: 'legacy:only', category: 'lpc' })] },
      seedRows: [seedRow({ tag: 'legacy:only' })],
    });
    const both: typeof legacy.reader = async (key) => {
      const fromRelease = await verified.reader(key);
      return fromRelease ?? legacy.reader(key);
    };

    const report = await runCatalogPublish({
      config: productionConfig() as never,
      client,
      gameDataDir,
      contentPacksDir,
      releaseReader: both,
    });

    expect(report.ok).toBe(true);
    const tags = publishedSeed().r.map((row) => row.t);
    expect(tags).not.toContain('legacy:only');
  });

  test('staging carries the legacy library from its canonical origin', async () => {
    // Staging has no legacy surface of its own, so a staging release carries
    // the de-bundled library (C-435) from the canonical origin it lives at —
    // production. This is a READ source: the publish still writes only to
    // staging's bucket. Without this, a staging release has no LPC registry and
    // every character renders as its fallback.
    const legacy = legacyFixture();
    const report = await runCatalogPublish({
      config: {
        ...productionConfig(),
        releaseTarget: { ...productionConfig().releaseTarget, mode: 'staging' },
      } as never,
      client,
      gameDataDir,
      contentPacksDir,
      releaseReader: legacy.reader,
    });

    expect(report.ok).toBe(true);
    const tags = publishedSeed().r.map((row) => row.t);
    expect(tags).toContain('lpc:hat:magic:celestial:thrust');
  });
});

describe('legacy bootstrap — the real production shape', () => {
  test('a 108-entry index over a much larger seed carries both', async () => {
    // The real state: the index holds 108 entries, the seed holds 12,729 rows.
    // The seed is the complete inventory; the index is a truncated browse
    // surface. Neither may be dropped.
    const indexEntries: CatalogAssetEntry[] = Array.from({ length: 108 }, (_, i) =>
      entry({ tag: `lpc:index:${String(i).padStart(3, '0')}`, category: 'lpc' }),
    );
    const seedRows = [
      ...indexEntries.map((item) =>
        seedRow({ tag: item.tag, hash: item.hash, category: item.category }),
      ),
      ...Array.from({ length: 12729 - indexEntries.length }, (_, i) =>
        seedRow({ tag: `lpc:seed-only:${String(i).padStart(5, '0')}`, category: 'lpc' }),
      ),
    ];
    const fixture = buildLegacyCatalog({
      originUrl: ORIGIN,
      categories: { lpc: indexEntries },
      seedRows,
    });

    const outcome = await bootstrapLegacyCatalog({ originUrl: ORIGIN, reader: fixture.reader });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok || !outcome.applied) {
      throw new Error('expected an applied migration');
    }
    expect(outcome.plan.entries).toHaveLength(108);
    expect(outcome.plan.carriedSeedRows).toBe(12729);
  });
});
