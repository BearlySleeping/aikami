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

  // Two lpc assets + one music asset + one tileset (excluded from catalog).
  writeFileSync(
    join(dir, 'lpc', 'hat', 'magic', 'celestial_adult.thrust.webp'),
    Buffer.from('lpc-thrust-bytes'),
  );
  writeFileSync(
    join(dir, 'lpc', 'hat', 'magic', 'celestial_adult.idle.webp'),
    Buffer.from('lpc-idle-bytes'),
  );
  writeFileSync(join(dir, 'music', 'exploration', 'bgm_explore.webm'), Buffer.from('music-bytes'));
  writeFileSync(
    join(dir, 'sprites', 'combat', 'enemy_portrait.webp'),
    Buffer.from('portrait-bytes'),
  );

  const hashOf = (bytes: string): string => {
    // Deterministic 64-hex hash: sha256 of the content via crypto.
    const { createHash } = require('node:crypto') as typeof import('node:crypto');
    return createHash('sha256').update(bytes).digest('hex');
  };

  const hThrust = hashOf('lpc-thrust-bytes');
  const hIdle = hashOf('lpc-idle-bytes');
  const hMusic = hashOf('music-bytes');
  const hPortrait = hashOf('portrait-bytes');
  const hTileset = hashOf('tileset-bytes');

  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify({
      scannedAt: '2026-08-15T00:00:00.000Z',
      count: 5,
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
        // tilesets stay OUT of the catalog (contract Edge Cases)
        'sprites:tilesets:atlas': {
          tag: 'sprites:tilesets:atlas',
          category: 'sprites',
          subcategory: 'tilesets',
          name: 'atlas',
          path: 'sprites/tilesets/atlas.webp',
          ext: '.webp',
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
        'lpc:hat:magic:celestial_adult:thrust': { hash: hThrust, sizeBytes: 15 },
        'lpc:hat:magic:celestial_adult:idle': { hash: hIdle, sizeBytes: 13 },
        'music:exploration:bgm_explore': { hash: hMusic, sizeBytes: 10 },
        'sprites:combat:enemy_portrait': { hash: hPortrait, sizeBytes: 14 },
        'sprites:tilesets:atlas': { hash: hTileset, sizeBytes: 13 },
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
      },
    }),
  );

  return dir;
};

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
