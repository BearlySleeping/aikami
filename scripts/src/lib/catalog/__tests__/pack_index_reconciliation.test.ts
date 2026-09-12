// scripts/src/lib/catalog/__tests__/pack_index_reconciliation.test.ts
//
// Gate 6 (C-496): the pack listing in `content/packs/index.json` must not
// drift from the manifest it caches. Before this guard the listing advertised
// 2.1.0 while the authored manifest was 4.1.0, so a save's pinned version and
// the published listing could disagree.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PACKS_DIR = join(import.meta.dir, '../../../../..', 'content/packs');

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
});
