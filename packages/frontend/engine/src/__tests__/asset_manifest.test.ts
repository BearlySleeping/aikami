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
const HASHES_PATH = join(
  import.meta.dir,
  '../../../../../apps/frontend/client/static/game-data/asset_hashes.json',
);
const manifestTest = existsSync(MANIFEST_PATH) ? test : test.skip;
const manifestAndHashesTest =
  existsSync(MANIFEST_PATH) && existsSync(HASHES_PATH) ? test : test.skip;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Asset manifest — AC-6: non-derivable data only', () => {
  let manifest: AssetManifest;

  manifestTest('manifest.json exists and parses', () => {
    manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8')) as AssetManifest;
    expect(manifest.count).toBeGreaterThan(0);
    expect(typeof manifest.assets).toBe('object');
  });

  manifestTest('every tag derives to the same path as the manifest entry', () => {
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

  manifestAndHashesTest('every tag has a hash entry in the sidecar', () => {
    const hashes = JSON.parse(readFileSync(HASHES_PATH, 'utf-8')) as {
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

  manifestTest('manifest size is under 1 MB uncompressed', () => {
    const stats = readFileSync(MANIFEST_PATH, 'utf-8').length;
    expect(stats).toBeLessThan(1_000_000);
  });
});
