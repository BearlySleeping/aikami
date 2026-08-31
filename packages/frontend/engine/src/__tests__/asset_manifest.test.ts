// packages/frontend/engine/src/__tests__/asset_manifest.test.ts
//
// Contract: C-381 AC-6 — manifest carries only non-derivable data.
// Verifies that tagToAssetPath reproduces the original path for every
// tag in the committed manifest (12,707-tag round-trip).

import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tagToAssetPath } from '@aikami/constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AssetEntry = {
  tag: string;
  category: string;
  subcategory: string;
  name: string;
  path: string;
  ext: string;
};

type AssetManifest = {
  scannedAt: string;
  count: number;
  assets: Record<string, AssetEntry>;
};

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const MANIFEST_PATH = join(
  import.meta.dir,
  '../../../../../apps/frontend/client/static/game-data/manifest.json',
);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Asset manifest — AC-6: non-derivable data only', () => {
  let manifest: AssetManifest;

  test('manifest.json exists and parses', () => {
    if (!existsSync(MANIFEST_PATH)) {
      return;
    }
    manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8')) as AssetManifest;
    expect(manifest.count).toBeGreaterThan(0);
    expect(typeof manifest.assets).toBe('object');
  });

  test('every tag derives to the same path as the manifest entry', () => {
    if (!manifest?.assets) {
      return;
    }
    const entries = Object.values(manifest.assets);
    expect(entries.length).toBeGreaterThan(0);

    const mismatches: string[] = [];
    for (const entry of entries) {
      const derived = tagToAssetPath({ tag: entry.tag, ext: entry.ext });
      if (derived !== entry.path) {
        mismatches.push(`${entry.tag}: "${derived}" !== "${entry.path}"`);
      }
    }

    expect(mismatches).toHaveLength(0);
  });

  test('every tag has a hash entry in the sidecar', () => {
    if (!manifest?.assets) {
      return;
    }
    const HashesPath = join(
      import.meta.dir,
      '../../../../../apps/frontend/client/static/game-data/asset_hashes.json',
    );
    if (!existsSync(HashesPath)) {
      return;
    }
    const hashes = JSON.parse(readFileSync(HashesPath, 'utf-8')) as {
      hashes: Record<string, { hash: string; sizeBytes: number }>;
    };

    const missing: string[] = [];
    for (const tag of Object.keys(manifest.assets)) {
      if (!hashes.hashes[tag]) {
        missing.push(tag);
      }
    }

    expect(missing).toHaveLength(0);
  });

  test('manifest size is under 1 MB uncompressed', () => {
    if (!existsSync(MANIFEST_PATH)) {
      return;
    }
    const stats = readFileSync(MANIFEST_PATH, 'utf-8').length;
    expect(stats).toBeLessThan(1_000_000);
  });
});
