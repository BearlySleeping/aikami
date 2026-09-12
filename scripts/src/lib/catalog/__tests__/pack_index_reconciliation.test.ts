// scripts/src/lib/catalog/__tests__/pack_index_reconciliation.test.ts
//
// Gate 6 (C-496): the pack listing in `content/packs/index.json` must not
// drift from the manifest it caches. Before this guard the listing advertised
// 2.1.0 while the authored manifest was 4.1.0, so a save's pinned version and
// the published listing could disagree.

import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PACKS_DIR = join(import.meta.dir, '../../../../..', 'content/packs');
const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

describe('pack index reconciliation', () => {
  test('index.json entry matches its manifest version, name and updatedAt', () => {
    const index = JSON.parse(readFileSync(join(PACKS_DIR, 'index.json'), 'utf-8')) as {
      packs: Array<{ id: string; name: string; version: string; updatedAt: string }>;
    };
    const manifest = JSON.parse(
      readFileSync(join(PACKS_DIR, 'emberwatch/manifest.json'), 'utf-8'),
    ) as { id: string; name: string; version: string; updatedAt: string };

    const entry = index.packs.find((p) => p.id === manifest.id);
    expect(entry, `index.json has an entry for ${manifest.id}`).toBeDefined();
    expect(entry?.version).toBe(manifest.version);
    expect(entry?.updatedAt).toBe(manifest.updatedAt);
    expect(entry?.name).toBe(manifest.name);
  });

  test('asset_hashes.json hashes are fresh for the manifest and every map', () => {
    const hashes = JSON.parse(readFileSync(join(PACKS_DIR, 'asset_hashes.json'), 'utf-8')) as {
      hashes: Record<string, { hash: string }>;
    };
    const manifest = JSON.parse(
      readFileSync(join(PACKS_DIR, 'emberwatch/manifest.json'), 'utf-8'),
    ) as { maps: Record<string, { file: string }> };

    const manifestBytes = readFileSync(join(PACKS_DIR, 'emberwatch/manifest.json'));
    expect(hashes.hashes['emberwatch:manifest']?.hash).toBe(sha256(manifestBytes));

    for (const [mapId, entry] of Object.entries(manifest.maps)) {
      const tag = `emberwatch:maps:${mapId}`;
      const mapBytes = readFileSync(join(PACKS_DIR, 'emberwatch', entry.file));
      expect(hashes.hashes[tag]?.hash, `${tag} hash is stale`).toBe(sha256(mapBytes));
    }
  });
});
