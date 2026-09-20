// scripts/src/lib/catalog/__tests__/publisher_consumer_integration.test.ts
//
// C-496 / C-523 — publisher → consumer integration.
//
// The core defect this test exists to catch: the publisher wrote immutable
// `seed/<sha256>/<filename>` objects and advanced `index/v1/release.json`, while
// the game read the mutable legacy aliases `seed/asset_seed.json` directly. A
// green publish could therefore leave the game reading stale bytes.
//
// This test runs the REAL `runCatalogPublish` into an in-memory object store,
// then resolves it through the REAL shared `resolveReleaseGraph` — the same
// function the client's `release_resolver.ts` calls at boot. It deliberately
// does NOT hand the consumer a manufactured `seed/asset_seed.json`: the store
// only contains what the publisher actually wrote, so a regression that stops
// writing the release graph (or writes only legacy aliases) fails here.

import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveReleaseGraph } from '@aikami/schemas';
import { runCatalogPublish, runPackLockPublish } from '../pipeline.ts';
import { FakeR2Client, makeFixtureGameData, noPreviousRelease } from './fixtures.ts';

const ORIGIN_URL = 'https://assets.example.test';

/**
 * A content-packs fixture whose Emberwatch manifest is a valid
 * `ContentPackManifest` with an atlas + one required audio binding, so the
 * publisher actually produces a pack lock with image and audio pins.
 *
 * @param gameDataDir - The game-data root whose credits file the attribution
 *   preflight reads; content-pack tags are merged into it.
 */
const makeValidContentPacks = (gameDataDir: string): string => {
  const dir = mkdtempSync(join(tmpdir(), 'catalog-publish-valid-packs-'));
  mkdirSync(join(dir, 'emberwatch', 'maps'), { recursive: true });

  const atlasBytes = 'atlas-texture-bytes';
  const mapBytes = 'village-map-bytes';
  const audioBytes = 'village-ward-audio-bytes';

  const { createHash } = require('node:crypto') as typeof import('node:crypto');
  const hashOf = (value: string): string => createHash('sha256').update(value).digest('hex');

  writeFileSync(join(dir, 'index.json'), Buffer.from('registry-bytes'));
  writeFileSync(join(dir, 'emberwatch', 'maps', 'village.json'), Buffer.from(mapBytes));
  writeFileSync(join(dir, 'emberwatch', 'atlas.webp'), Buffer.from(atlasBytes));
  writeFileSync(join(dir, 'emberwatch', 'village_ward.webm'), Buffer.from(audioBytes));

  const manifest = {
    id: 'emberwatch',
    name: 'Emberwatch',
    version: '9.9.9',
    updatedAt: '2026-09-16T00:00:00.000Z',
    startingMapId: 'village',
    maps: {
      village: { file: 'maps/village.json', name: 'Village' },
    },
    npcs: {},
    items: {},
    dialogues: {},
    atlas: { textureUrl: `${ORIGIN_URL}/game-data/sprites/tilesets/atlas.webp` },
    audio: {
      schemaVersion: 'pack.audio.v1',
      bindings: [
        {
          cueId: 'village.music',
          target: 'music',
          context: 'village',
          source: {
            kind: 'asset',
            tag: 'music:exploration:village_ward',
            sha256: hashOf(audioBytes),
          },
          resolution: 'required',
          fallback: 'silence',
        },
      ],
    },
  };
  writeFileSync(join(dir, 'emberwatch', 'manifest.json'), JSON.stringify(manifest));

  const hRegistry = hashOf('registry-bytes');
  const hManifest = hashOf(JSON.stringify(manifest));
  const hMap = hashOf(mapBytes);
  const hAtlas = hashOf(atlasBytes);
  const hAudio = hashOf(audioBytes);

  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify({
      scannedAt: '2026-09-16T00:00:00.000Z',
      count: 5,
      assets: {
        'index.json': {
          tag: 'index.json',
          category: 'contentPacks',
          subcategory: '',
          name: 'index',
          path: 'index.json',
          ext: '.json',
        },
        'emberwatch:manifest': {
          tag: 'emberwatch:manifest',
          category: 'contentPacks',
          subcategory: 'emberwatch',
          name: 'manifest',
          path: 'emberwatch/manifest.json',
          ext: '.json',
        },
        'emberwatch:maps:village': {
          tag: 'emberwatch:maps:village',
          category: 'contentPacks',
          subcategory: 'emberwatch/maps',
          name: 'village',
          path: 'emberwatch/maps/village.json',
          ext: '.json',
        },
        'sprites:tilesets:atlas.webp': {
          tag: 'sprites:tilesets:atlas.webp',
          category: 'tilesets',
          subcategory: 'tilesets',
          name: 'atlas',
          path: 'emberwatch/atlas.webp',
          ext: '.webp',
        },
        'music:exploration:village_ward': {
          tag: 'music:exploration:village_ward',
          category: 'music',
          subcategory: 'exploration',
          name: 'village_ward',
          path: 'emberwatch/village_ward.webm',
          ext: '.webm',
        },
      },
      byCategory: {},
    }),
  );

  const credit = {
    licenses: ['MIT'],
    authors: ['Aikami Studio'],
    sourceUrls: [],
    source: 'project',
  };
  writeFileSync(
    join(dir, 'asset_hashes.json'),
    JSON.stringify({
      scannedAt: '2026-09-16T00:00:00.000Z',
      hashes: {
        'index.json': { hash: hRegistry, sizeBytes: Buffer.byteLength('registry-bytes') },
        'emberwatch:manifest': {
          hash: hManifest,
          sizeBytes: Buffer.byteLength(JSON.stringify(manifest)),
        },
        'emberwatch:maps:village': { hash: hMap, sizeBytes: Buffer.byteLength(mapBytes) },
        'sprites:tilesets:atlas.webp': { hash: hAtlas, sizeBytes: Buffer.byteLength(atlasBytes) },
        'music:exploration:village_ward': {
          hash: hAudio,
          sizeBytes: Buffer.byteLength(audioBytes),
        },
      },
    }),
  );
  writeFileSync(
    join(dir, 'asset_credits.json'),
    JSON.stringify({
      scannedAt: '2026-09-16T00:00:00.000Z',
      credits: {
        'index.json': credit,
        'emberwatch:manifest': credit,
        'emberwatch:maps:village': credit,
        'sprites:tilesets:atlas.webp': credit,
        'music:exploration:village_ward': credit,
      },
    }),
  );

  // The attribution preflight reads `asset_credits.json` from the GAME-DATA
  // root only (see pipeline.ts#loadCreditsByTag), so content-pack tags must
  // also be credited there or the preflight aborts before any upload.
  const gameDataCreditsPath = join(gameDataDir, 'asset_credits.json');
  const existing = JSON.parse(readFileSync(gameDataCreditsPath, 'utf8')) as {
    scannedAt?: string;
    credits: Record<string, unknown>;
  };
  existing.credits = {
    ...existing.credits,
    'index.json': credit,
    'emberwatch:manifest': credit,
    'emberwatch:maps:village': credit,
    'sprites:tilesets:atlas.webp': credit,
    'music:exploration:village_ward': credit,
  };
  writeFileSync(gameDataCreditsPath, JSON.stringify(existing));

  return dir;
};

/** A reader over the fake store, exactly as a client fetch would read it. */
const storeReader = (client: FakeR2Client) => async (key: string) => {
  const object = client.objects.get(key);
  return object ? object.body : undefined;
};

describe('publisher → consumer release resolution (C-496)', () => {
  test('a real publish resolves through the real release graph, not a legacy alias', async () => {
    const gameDataDir = makeFixtureGameData();
    const contentPacksDir = makeValidContentPacks(gameDataDir);
    const client = new FakeR2Client();

    const report = await runCatalogPublish({
      releaseReader: noPreviousRelease,
      config: {
        accessKeyId: 'test',
        secretAccessKey: 'test',
        endpoint: 'https://test.r2.cloudflarestorage.com',
        bucket: 'aikami-catalog',
        originUrl: ORIGIN_URL,
      },
      client,
      gameDataDir,
      contentPacksDir,
    });
    expect(report.ok).toBe(true);
    expect(report.releaseWritten).toBe(true);

    // The store must NOT contain the mutable legacy seed alias — the whole
    // point is that the game reads the release graph, not `seed/<name>`.
    expect(client.objects.has('seed/asset_seed.json')).toBe(false);

    const graph = await resolveReleaseGraph({ reader: storeReader(client) });
    expect(graph).toBeDefined();
    if (!graph) {
      throw new Error('release graph did not resolve');
    }

    // The pinned seed dependency is content-addressed and hash-verified.
    const seedKey = graph.pointer.dependencies.find((dependency) =>
      dependency.key.endsWith('/asset_seed.json'),
    )?.key;
    expect(seedKey).toMatch(/^seed\/[0-9a-f]{64}\/asset_seed\.json$/);
    expect(new TextDecoder().decode(graph.seedBytes)).toContain('seed');

    // A tampered seed is rejected by the shared resolver — the client would
    // fail closed rather than boot on stale bytes.
    const tampered = new FakeR2Client();
    for (const [key, object] of client.objects) {
      tampered.objects.set(key, object);
    }
    if (seedKey) {
      tampered.objects.set(seedKey, {
        body: new TextEncoder().encode('{"sv":1,"g":"x","o":"x","r":[]}'),
        contentType: 'application/json',
        cacheControl: 'public, max-age=31536000, immutable',
      });
    }
    await expect(resolveReleaseGraph({ reader: storeReader(tampered) })).rejects.toThrow(
      /integrity failure/,
    );
  });

  test('the publisher writes the per-pack lock and pins it in the release graph', async () => {
    const gameDataDir = makeFixtureGameData();
    const contentPacksDir = makeValidContentPacks(gameDataDir);
    const client = new FakeR2Client();

    const report = await runCatalogPublish({
      releaseReader: noPreviousRelease,
      config: {
        accessKeyId: 'test',
        secretAccessKey: 'test',
        endpoint: 'https://test.r2.cloudflarestorage.com',
        bucket: 'aikami-catalog',
        originUrl: ORIGIN_URL,
      },
      client,
      gameDataDir,
      contentPacksDir,
    });

    expect(report.packLock.written).toBe(true);
    expect(report.packLock.assetPins).toBeGreaterThan(0);

    expect(report.packLock.key).toMatch(/^index\/v1\/revisions\/[0-9a-f]{64}\/pack_lock\.json$/);
    // The immutable lock revision is the object pinned by the release graph.
    const lockObject = client.objects.get(report.packLock.key);
    expect(lockObject).toBeDefined();
    const graph = await resolveReleaseGraph({ reader: storeReader(client) });
    expect(
      graph?.pointer.dependencies.some((dependency) => dependency.key === report.packLock.key),
    ).toBe(true);
    expect(graph?.documents.has(report.packLock.key)).toBe(true);

    // Compatibility alias moves only after the release pointer is active.
    expect(client.objects.get('index/v1/pack_lock.json')?.body).toEqual(lockObject?.body);
    expect(client.putKeys.indexOf('index/v1/pack_lock.json')).toBeGreaterThan(
      client.putKeys.indexOf('index/v1/release.json'),
    );

    const lock = JSON.parse(new TextDecoder().decode(lockObject?.body)) as {
      audioAssets?: { id: string }[];
    };
    expect(lock.audioAssets?.map((pin) => pin.id)).toContain('village.music');
  });

  test('a failed release-pointer advance never replaces the legacy pack-lock alias', async () => {
    const gameDataDir = makeFixtureGameData();
    const contentPacksDir = makeValidContentPacks(gameDataDir);
    const client = new FakeR2Client();
    client.failOnKey = 'index/v1/release.json';

    const report = await runCatalogPublish({
      releaseReader: noPreviousRelease,
      config: {
        accessKeyId: 'test',
        secretAccessKey: 'test',
        endpoint: 'https://test.r2.cloudflarestorage.com',
        bucket: 'aikami-catalog',
        originUrl: ORIGIN_URL,
      },
      client,
      gameDataDir,
      contentPacksDir,
    });

    expect(report.releaseWritten).toBe(false);
    expect(report.packLock.key).toMatch(/\/revisions\//);
    expect(client.objects.has(report.packLock.key)).toBe(true);
    expect(client.objects.has('index/v1/pack_lock.json')).toBe(false);
  });

  test('pack lock publication requires the selected pack manifest row', async () => {
    const gameDataDir = makeFixtureGameData();
    const contentPacksDir = makeValidContentPacks(gameDataDir);

    await expect(
      runPackLockPublish({
        client: new FakeR2Client(),
        contentPacksDir,
        seedRows: [{ tag: 'another-pack:manifest', hash: 'a'.repeat(64) }],
        releaseId: 'release-test',
      }),
    ).rejects.toThrow(/emberwatch:manifest/);
  });
});
