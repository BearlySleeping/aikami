// scripts/src/lib/catalog/__tests__/fixtures.ts
//
// Shared fixture helpers for catalog pipeline tests (C-395).
// Builds a minimal game-data directory (manifest.json + asset_hashes.json +
// asset_credits.json) plus a fake in-memory R2 client.

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { R2ClientLike } from '../upload.ts';

export const makeFixtureGameData = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'catalog-fixture-'));
  mkdirSync(join(dir, 'music', 'exploration'), { recursive: true });
  mkdirSync(join(dir, 'lpc', 'hat', 'magic'), { recursive: true });
  mkdirSync(join(dir, 'sprites', 'combat'), { recursive: true });
  mkdirSync(join(dir, 'sprites', 'tilesets'), { recursive: true });
  mkdirSync(join(dir, 'maps'), { recursive: true });

  // Buffers the fixture files are written from — sizeBytes below is DERIVED
  // from these so the manifest never drifts from the actual file bytes.
  const thrustBytes = 'lpc-thrust-bytes';
  const idleBytes = 'lpc-idle-bytes';
  const musicBytes = 'music-bytes';
  const portraitBytes = 'portrait-bytes';
  const tilesetBytes = 'tileset-bytes';
  const tilesetJsonBytes = 'tileset-json-bytes';
  const mapBytes = 'map-bytes';

  // Two lpc assets + one music asset + one portrait + tilesets + maps.
  writeFileSync(
    join(dir, 'lpc', 'hat', 'magic', 'celestial_adult.thrust.webp'),
    Buffer.from(thrustBytes),
  );
  writeFileSync(
    join(dir, 'lpc', 'hat', 'magic', 'celestial_adult.idle.webp'),
    Buffer.from(idleBytes),
  );
  writeFileSync(join(dir, 'music', 'exploration', 'bgm_explore.webm'), Buffer.from(musicBytes));
  writeFileSync(join(dir, 'sprites', 'combat', 'enemy_portrait.webp'), Buffer.from(portraitBytes));
  // C-433: tilesets are now catalog assets (reversing C-395 exclusion).
  writeFileSync(join(dir, 'sprites', 'tilesets', 'atlas.webp'), Buffer.from(tilesetBytes));
  writeFileSync(join(dir, 'sprites', 'tilesets', 'atlas.json'), Buffer.from(tilesetJsonBytes));
  // C-433: maps are now catalog assets.
  writeFileSync(join(dir, 'maps', 'sandbox_zone_a.json'), Buffer.from(mapBytes));

  const hashOf = (bytes: string): string => {
    // Deterministic 64-hex hash: sha256 of the content via crypto.
    const { createHash } = require('node:crypto') as typeof import('node:crypto');
    return createHash('sha256').update(bytes).digest('hex');
  };

  const hThrust = hashOf(thrustBytes);
  const hIdle = hashOf(idleBytes);
  const hMusic = hashOf(musicBytes);
  const hPortrait = hashOf(portraitBytes);
  const hTileset = hashOf(tilesetBytes);
  const hTilesetJson = hashOf(tilesetJsonBytes);
  const hMap = hashOf(mapBytes);

  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify({
      scannedAt: '2026-08-15T00:00:00.000Z',
      count: 7,
      assets: {
        'lpc:hat:magic:celestial_adult:thrust': {
          tag: 'lpc:hat:magic:celestial_adult:thrust',
          category: 'lpc',
          subcategory: 'hat/magic',
          name: 'celestial_adult.thrust',
          path: 'lpc/hat/magic/celestial_adult.thrust.webp',
          ext: '.webp',
        },
        'lpc:hat:magic:celestial_adult:idle': {
          tag: 'lpc:hat:magic:celestial_adult:idle',
          category: 'lpc',
          subcategory: 'hat/magic',
          name: 'celestial_adult.idle',
          path: 'lpc/hat/magic/celestial_adult.idle.webp',
          ext: '.webp',
        },
        'music:exploration:bgm_explore': {
          tag: 'music:exploration:bgm_explore',
          category: 'music',
          subcategory: 'exploration',
          name: 'bgm_explore',
          path: 'music/exploration/bgm_explore.webm',
          ext: '.webm',
        },
        'sprites:combat:enemy_portrait': {
          tag: 'sprites:combat:enemy_portrait',
          category: 'sprites',
          subcategory: 'combat',
          name: 'enemy_portrait',
          path: 'sprites/combat/enemy_portrait.webp',
          ext: '.webp',
        },
        // C-433: tilesets are now catalog assets (reversing C-395 exclusion).
        // Tags include extension to disambiguate atlas.webp from atlas.json.
        'sprites:tilesets:atlas.webp': {
          tag: 'sprites:tilesets:atlas.webp',
          category: 'tilesets',
          subcategory: 'tilesets',
          name: 'atlas',
          path: 'sprites/tilesets/atlas.webp',
          ext: '.webp',
        },
        'sprites:tilesets:atlas.json': {
          tag: 'sprites:tilesets:atlas.json',
          category: 'tilesets',
          subcategory: 'tilesets',
          name: 'atlas',
          path: 'sprites/tilesets/atlas.json',
          ext: '.json',
        },
        // C-433: maps are now catalog assets.
        'maps:sandbox_zone_a': {
          tag: 'maps:sandbox_zone_a',
          category: 'maps',
          subcategory: '',
          name: 'sandbox_zone_a',
          path: 'maps/sandbox_zone_a.json',
          ext: '.json',
        },
      },
      byCategory: {},
    }),
  );

  writeFileSync(
    join(dir, 'asset_hashes.json'),
    JSON.stringify({
      scannedAt: '2026-08-15T00:00:00.000Z',
      hashes: {
        'lpc:hat:magic:celestial_adult:thrust': {
          hash: hThrust,
          sizeBytes: Buffer.byteLength(thrustBytes),
        },
        'lpc:hat:magic:celestial_adult:idle': {
          hash: hIdle,
          sizeBytes: Buffer.byteLength(idleBytes),
        },
        'music:exploration:bgm_explore': {
          hash: hMusic,
          sizeBytes: Buffer.byteLength(musicBytes),
        },
        'sprites:combat:enemy_portrait': {
          hash: hPortrait,
          sizeBytes: Buffer.byteLength(portraitBytes),
        },
        'sprites:tilesets:atlas.webp': { hash: hTileset, sizeBytes: 13 },
        'sprites:tilesets:atlas.json': { hash: hTilesetJson, sizeBytes: 17 },
        'maps:sandbox_zone_a': { hash: hMap, sizeBytes: 8 },
      },
    }),
  );

  writeFileSync(
    join(dir, 'asset_credits.json'),
    JSON.stringify({
      scannedAt: '2026-08-15T00:00:00.000Z',
      credits: {
        'lpc:hat:magic:celestial_adult:thrust': {
          licenses: ['OGA-BY 3.0', 'CC-BY-SA 3.0'],
          authors: ['bluecarrot16'],
          sourceUrls: ['https://opengameart.org/content/lpc'],
          source: 'lpc',
        },
        'lpc:hat:magic:celestial_adult:idle': {
          licenses: ['OGA-BY 3.0', 'CC-BY-SA 3.0'],
          authors: ['bluecarrot16'],
          sourceUrls: ['https://opengameart.org/content/lpc'],
          source: 'lpc',
        },
        'music:exploration:bgm_explore': {
          licenses: ['MIT'],
          authors: ['Aikami Studio'],
          sourceUrls: [],
          source: 'project',
        },
        'sprites:combat:enemy_portrait': {
          licenses: ['MIT'],
          authors: ['Aikami Studio'],
          sourceUrls: [],
          source: 'project',
        },
        // C-433: tilesets and maps attribution.
        'sprites:tilesets:atlas.webp': {
          licenses: ['MIT'],
          authors: ['Aikami Studio'],
          sourceUrls: [],
          source: 'project',
        },
        'sprites:tilesets:atlas.json': {
          licenses: ['MIT'],
          authors: ['Aikami Studio'],
          sourceUrls: [],
          source: 'project',
        },
        'maps:sandbox_zone_a': {
          licenses: ['MIT'],
          authors: ['Aikami Studio'],
          sourceUrls: [],
          source: 'project',
        },
      },
    }),
  );

  return dir;
};

const hashOfFixture = (bytes: string): string => {
  const { createHash } = require('node:crypto') as typeof import('node:crypto');
  return createHash('sha256').update(bytes).digest('hex');
};

/**
 * Fixture sha256 hashes (of the literal buffers in makeFixtureGameData),
 * exported so tests can assert exact content-addressed keys derived from
 * them rather than re-hashing inline.
 */
/**
 * Create a fixture content-packs directory with a manifest and pack content.
 * C-433: content-packs are scanned from a separate root.
 */
export const makeFixtureContentPacks = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'catalog-content-packs-'));
  mkdirSync(join(dir, 'emberwatch', 'maps'), { recursive: true });

  const manifestBytes = 'pack-manifest-bytes';
  const innBytes = 'inn-map-bytes';

  writeFileSync(join(dir, 'index.json'), Buffer.from('registry-bytes'));
  writeFileSync(join(dir, 'emberwatch', 'manifest.json'), Buffer.from(manifestBytes));
  writeFileSync(join(dir, 'emberwatch', 'maps', 'inn.json'), Buffer.from(innBytes));

  const hashOf = (bytes: string): string => {
    const { createHash } = require('node:crypto') as typeof import('node:crypto');
    return createHash('sha256').update(bytes).digest('hex');
  };

  const hRegistry = hashOf('registry-bytes');
  const hManifest = hashOf(manifestBytes);
  const hInn = hashOf(innBytes);

  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify({
      scannedAt: '2026-08-15T00:00:00.000Z',
      count: 3,
      assets: {
        'index.json': {
          tag: 'index.json',
          category: 'content_packs',
          subcategory: '',
          name: 'index',
          path: 'index.json',
          ext: '.json',
        },
        'emberwatch:manifest.json': {
          tag: 'emberwatch:manifest.json',
          category: 'content_packs',
          subcategory: 'emberwatch',
          name: 'manifest',
          path: 'emberwatch/manifest.json',
          ext: '.json',
        },
        'emberwatch:maps:inn.json': {
          tag: 'emberwatch:maps:inn.json',
          category: 'content_packs',
          subcategory: 'emberwatch/maps',
          name: 'inn',
          path: 'emberwatch/maps/inn.json',
          ext: '.json',
        },
      },
      byCategory: {},
    }),
  );

  writeFileSync(
    join(dir, 'asset_hashes.json'),
    JSON.stringify({
      scannedAt: '2026-08-15T00:00:00.000Z',
      hashes: {
        'index.json': { hash: hRegistry, sizeBytes: 14 },
        'emberwatch:manifest.json': { hash: hManifest, sizeBytes: 19 },
        'emberwatch:maps:inn.json': { hash: hInn, sizeBytes: 12 },
      },
    }),
  );

  writeFileSync(
    join(dir, 'asset_credits.json'),
    JSON.stringify({
      scannedAt: '2026-08-15T00:00:00.000Z',
      credits: {
        'index.json': {
          licenses: ['MIT'],
          authors: ['Aikami Studio'],
          sourceUrls: [],
          source: 'project',
        },
        'emberwatch:manifest.json': {
          licenses: ['MIT'],
          authors: ['Aikami Studio'],
          sourceUrls: [],
          source: 'project',
        },
        'emberwatch:maps:inn.json': {
          licenses: ['MIT'],
          authors: ['Aikami Studio'],
          sourceUrls: [],
          source: 'project',
        },
      },
    }),
  );

  return dir;
};

export const FIXTURE_HASHES = {
  thrust: hashOfFixture('lpc-thrust-bytes'),
  idle: hashOfFixture('lpc-idle-bytes'),
  music: hashOfFixture('music-bytes'),
  portrait: hashOfFixture('portrait-bytes'),
  tileset: hashOfFixture('tileset-bytes'),
  tilesetJson: hashOfFixture('tileset-json-bytes'),
  map: hashOfFixture('map-bytes'),
} as const;

/** In-memory fake R2 client for pipeline tests. */
export class FakeR2Client implements R2ClientLike {
  readonly objects = new Map<
    string,
    { body: Uint8Array; contentType: string; cacheControl: string }
  >();
  /** Throw on putObject for keys matching this substring (failure injection). */
  failOnKey?: string;
  /** Number of putObject calls. */
  putCount = 0;

  async listKeys(prefix: string): Promise<string[]> {
    return [...this.objects.keys()].filter((key) => key.startsWith(prefix));
  }

  async putObject(options: {
    key: string;
    body: Uint8Array;
    contentType: string;
    cacheControl: string;
  }): Promise<void> {
    this.putCount++;
    if (this.failOnKey && options.key.includes(this.failOnKey)) {
      throw new Error(`injected failure for ${options.key}`);
    }
    this.objects.set(options.key, {
      body: options.body,
      contentType: options.contentType,
      cacheControl: options.cacheControl,
    });
  }
}
