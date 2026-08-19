// scripts/src/lib/catalog/__tests__/index_generation.test.ts
//
// Catalog index generation tests (C-395 AC-2): root index validation +
// size budgets, shard validation + size budgets, totalCount correctness,
// shard splitting for oversized categories, and cross-field consistency
// (shard.category === entry.category).

import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { CatalogIndexRootSchema, CatalogIndexShardSchema } from '@aikami/schemas';
import { Value } from 'typebox/value';
import type { CatalogEntry } from '../catalog_entries.ts';
import {
  generateCatalogIndex,
  ROOT_INDEX_MAX_GZIP_BYTES,
  SHARD_MAX_GZIP_BYTES,
} from '../index_generation.ts';

const ORIGIN = 'https://assets.example.test';

const makeEntry = (options: {
  tag: string;
  category: string;
  subcategory?: string;
  ext?: string;
}): CatalogEntry => ({
  tag: options.tag,
  hash: createHash('sha256').update(options.tag).digest('hex'),
  sizeBytes: 100,
  category: options.category,
  subcategory: options.subcategory,
  ext: options.ext ?? '.webp',
  path: `${options.category}/${options.tag}.webp`,
  licenses: ['OGA-BY 3.0', 'CC-BY-SA 3.0'],
  authors: ['bluecarrot16', 'Stephen Challener (Redshrike)'],
  sourceUrls: ['https://opengameart.org/content/lpc-character-bases'],
});

const gzipBytesOf = (json: string): number => gzipSync(Buffer.from(json, 'utf8')).byteLength;

describe('generateCatalogIndex (AC-2)', () => {
  test('root index carries category summaries only and validates', () => {
    const { root } = generateCatalogIndex({
      entries: [
        makeEntry({ tag: 'lpc:a', category: 'lpc', subcategory: 'hat' }),
        makeEntry({ tag: 'lpc:b', category: 'lpc', subcategory: 'head' }),
        makeEntry({ tag: 'music:c', category: 'music' }),
      ],
      originUrl: ORIGIN,
      publishedAt: '2026-08-15T00:00:00.000Z',
    });

    expect(Value.Check(CatalogIndexRootSchema, root)).toBe(true);
    expect(root.schemaVersion).toBe(1);
    expect(root.originUrl).toBe(ORIGIN);
    expect(root.totalCount).toBe(3);
    expect(root.categories).toEqual([
      { id: 'lpc', count: 2 },
      { id: 'music', count: 1 },
    ]);
    // Root carries NO per-asset entries.
    expect('entries' in root).toBe(false);
  });

  test('shard entries validate and carry verbatim license arrays', () => {
    const { shards } = generateCatalogIndex({
      entries: [makeEntry({ tag: 'lpc:a', category: 'lpc', subcategory: 'hat' })],
      originUrl: ORIGIN,
    });

    expect(shards).toHaveLength(1);
    expect(shards[0].key).toBe('index/v1/lpc.json');
    const shard = JSON.parse(shards[0].json) as { entries: unknown[] };
    expect(Value.Check(CatalogIndexShardSchema, JSON.parse(shards[0].json))).toBe(true);
    const entry = shard.entries[0] as { licenses: string[]; authors: string[] };
    expect(entry.licenses).toEqual(['OGA-BY 3.0', 'CC-BY-SA 3.0']);
    expect(entry.authors).toContain('bluecarrot16');
  });

  test('every shard entry hash resolves to a content-addressed key pattern', () => {
    const entries = [
      makeEntry({ tag: 'lpc:a', category: 'lpc', subcategory: 'hat' }),
      makeEntry({ tag: 'music:b', category: 'music' }),
    ];
    const { shards } = generateCatalogIndex({ entries, originUrl: ORIGIN });
    for (const shard of shards) {
      const parsed = JSON.parse(shard.json) as { entries: { hash: string }[] };
      for (const entry of parsed.entries) {
        expect(entry.hash).toMatch(/^[a-f0-9]{64}$/);
      }
    }
  });

  test('root index stays under 256 KB gzipped with a full-size category', () => {
    // 500 entries ≈ way past the tiny root (which only holds summaries).
    const entries = Array.from({ length: 500 }, (_, i) =>
      makeEntry({ tag: `lpc:tag${i}`, category: 'lpc', subcategory: `sub${i % 10}` }),
    );
    const { root } = generateCatalogIndex({ entries, originUrl: ORIGIN });
    const rootGzip = gzipBytesOf(JSON.stringify(root));
    expect(rootGzip).toBeLessThan(ROOT_INDEX_MAX_GZIP_BYTES);
  });

  test('shard size budget is asserted — oversized categories split by subcategory', () => {
    // A single category with many entries must NOT ship as one 1 MB shard.
    // ~30k entries with content varied enough to defeat gzip compression
    // forces the whole-category shard past the 1 MB budget (the real
    // 12,699-asset LPC shard measures 639 KB gzipped and fits in one shard).
    const entries = Array.from({ length: 30000 }, (_, i) => ({
      ...makeEntry({ tag: `lpc:tag${i}`, category: 'lpc', subcategory: `sub${i % 12}` }),
      licenseNote: `note ${i} ${createHash('sha1').update(String(i)).digest('hex').slice(0, 8)}`,
    }));
    const { root, shards } = generateCatalogIndex({ entries, originUrl: ORIGIN });

    // The whole-category shard would exceed 1 MB gzipped, so it is split.
    expect(shards.length).toBeGreaterThan(1);

    for (const shard of shards) {
      expect(shard.gzipBytes).toBeLessThan(SHARD_MAX_GZIP_BYTES);
      expect(shard.key).toMatch(/^index\/v1\/lpc__sub\d+\.json$/);
    }
    // Root now has one summary row per sub-shard, each validating.
    expect(root.categories.length).toBe(12);
    const total = root.categories.reduce<number>((sum, c) => sum + c.count, 0);
    expect(total).toBe(30000);
    for (const shard of shards) {
      expect(Value.Check(CatalogIndexShardSchema, JSON.parse(shard.json))).toBe(true);
    }
  });

  test('subcategories that collide after naive normalization produce distinct shard ids', () => {
    // "hat/magic", "hat-magic" and "hat magic" all collapsed to "hat-magic"
    // under the old sanitizer — colliding shard ids and R2 keys. The encoded
    // fragment must keep them distinct.
    const colliding = ['hat/magic', 'hat-magic', 'hat magic'];
    const entries = Array.from({ length: 30000 }, (_, i) => ({
      ...makeEntry({ tag: `lpc:tag${i}`, category: 'lpc', subcategory: colliding[i % 3] }),
      licenseNote: `note ${i} ${createHash('sha1').update(String(i)).digest('hex').slice(0, 8)}`,
    }));
    const { shards } = generateCatalogIndex({ entries, originUrl: ORIGIN });

    // The whole-category shard must exceed 1 MB gzipped so it splits into
    // exactly the three colliding subcategory groups.
    expect(shards.length).toBe(3);
    const ids = shards.map((shard) => shard.id);
    expect(new Set(ids).size).toBe(3);
    const keys = shards.map((shard) => shard.key);
    expect(new Set(keys).size).toBe(3);
    for (const shard of shards) {
      expect(shard.gzipBytes).toBeLessThan(SHARD_MAX_GZIP_BYTES);
      expect(Value.Check(CatalogIndexShardSchema, JSON.parse(shard.json))).toBe(true);
    }
  });

  test('cross-field consistency: shard.category equals every entry category', () => {
    const entries = [
      makeEntry({ tag: 'lpc:a', category: 'lpc', subcategory: 'hat' }),
      makeEntry({ tag: 'music:b', category: 'music' }),
    ];
    const { shards } = generateCatalogIndex({ entries, originUrl: ORIGIN });
    for (const shard of shards) {
      const parsed = JSON.parse(shard.json) as {
        category: string;
        entries: { category: string }[];
      };
      for (const entry of parsed.entries) {
        expect(entry.category).toBe(parsed.category);
      }
    }
  });

  test('totalCount equals the number of published assets', () => {
    const entries = [
      makeEntry({ tag: 'lpc:a', category: 'lpc' }),
      makeEntry({ tag: 'lpc:b', category: 'lpc' }),
      makeEntry({ tag: 'sprites:c', category: 'sprites' }),
    ];
    const { root } = generateCatalogIndex({ entries, originUrl: ORIGIN });
    expect(root.totalCount).toBe(3);
  });
});
