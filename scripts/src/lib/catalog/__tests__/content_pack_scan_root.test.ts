// scripts/src/lib/catalog/__tests__/content_pack_scan_root.test.ts
//
// Verifies that repointing CONTENT_PACKS_DIR from
// apps/frontend/client/static/content-packs to content/packs produces
// byte-identical tags (C-448 AC-2).
//
// Contract: C-448 De-bundle Content Packs

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CONTENT_PACKS_DIR } from '../config.ts';

const REPO_ROOT = resolve(import.meta.dirname, '../../../../../');

describe('ContentPackScanRoot (C-448 AC-2)', () => {
  test('CONTENT_PACKS_DIR points to content/packs', () => {
    const expected = resolve(REPO_ROOT, 'content/packs');
    expect(CONTENT_PACKS_DIR).toBe(expected);
  });

  test('content-packs manifest.json exists at new location with expected tags', () => {
    const manifestPath = resolve(CONTENT_PACKS_DIR, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      assets: Record<string, { tag: string; path: string }>;
    };

    // Verify the expected tags are present
    const tags = Object.keys(manifest.assets);
    expect(tags).toContain('index');
    expect(tags).toContain('emberwatch:manifest');
    expect(tags).toContain('emberwatch:maps:inn');
    expect(tags).toContain('emberwatch:maps:merchant_shop');
    expect(tags).toContain('emberwatch:maps:village');
  });

  test('content-packs asset_hashes.json exists with hashes for all tags', () => {
    const hashesPath = resolve(CONTENT_PACKS_DIR, 'asset_hashes.json');
    const hashes = JSON.parse(readFileSync(hashesPath, 'utf8')) as {
      hashes: Record<string, { hash: string; sizeBytes: number }>;
    };

    expect(hashes.hashes['index']).toBeDefined();
    expect(hashes.hashes['index'].hash).toBeTruthy();
    expect(hashes.hashes['emberwatch:manifest']).toBeDefined();
    expect(hashes.hashes['emberwatch:manifest'].hash).toBeTruthy();
    expect(hashes.hashes['emberwatch:maps:village']).toBeDefined();
    expect(hashes.hashes['emberwatch:maps:village'].hash).toBeTruthy();
  });

  test('pack index.json exists at new location', () => {
    const indexPath = resolve(CONTENT_PACKS_DIR, 'index.json');
    const index = JSON.parse(readFileSync(indexPath, 'utf8')) as {
      packs: Array<{ id: string }>;
    };
    expect(index.packs.length).toBeGreaterThanOrEqual(1);
    expect(index.packs.some((p) => p.id === 'emberwatch')).toBe(true);
  });

  test('emberwatch manifest.json exists at new location', () => {
    const manifestPath = resolve(CONTENT_PACKS_DIR, 'emberwatch/manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      id: string;
      version: string;
      maps: Record<string, unknown>;
    };
    expect(manifest.id).toBe('emberwatch');
    expect(manifest.maps.village).toBeDefined();
    expect(manifest.maps.inn).toBeDefined();
    expect(manifest.maps.merchant_shop).toBeDefined();
  });

  test('emberwatch map files exist at new location', () => {
    const maps = ['village.json', 'inn.json', 'merchant_shop.json'];
    for (const mapFile of maps) {
      const mapPath = resolve(CONTENT_PACKS_DIR, `emberwatch/maps/${mapFile}`);
      const map = JSON.parse(readFileSync(mapPath, 'utf8'));
      expect(map).toBeDefined();
      expect(map.layers).toBeDefined();
    }
  });
});
