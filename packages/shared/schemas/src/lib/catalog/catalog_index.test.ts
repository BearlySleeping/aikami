// packages/shared/schemas/src/lib/catalog/catalog_index.test.ts
//
// Schema validation tests for the R2 catalog index (C-395 AC-2).
//
// These assert the *shape contract* the publish pipeline and C-396/C-397
// consumers rely on: the root index carries category summaries only, shards
// carry per-asset entries, license strings are verbatim arrays (never a
// single SPDX string), and empty attribution arrays are representable but
// gated by the publish preflight (AC-4) — never by the schema.

import { describe, expect, test } from 'bun:test';
import { Value } from 'typebox/value';
import {
  CatalogAssetCreditSchema,
  CatalogAssetEntrySchema,
  CatalogIndexRootSchema,
  CatalogIndexShardSchema,
} from './catalog_index.ts';

// ---------------------------------------------------------------------------
// CatalogAssetEntrySchema
// ---------------------------------------------------------------------------

const VALID_ENTRY = {
  tag: 'lpc:hat:magic:celestial_adult:thrust',
  hash: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
  sizeBytes: 4821,
  category: 'lpc',
  subcategory: 'hat/magic',
  ext: '.webp',
  licenses: ['OGA-BY 3.0', 'CC-BY-SA 3.0', 'GPL 3.0'],
  authors: ['bluecarrot16', 'Stephen Challener (Redshrike)'],
  sourceUrls: ['https://opengameart.org/content/lpc-character-bases'],
};

describe('CatalogAssetEntrySchema', () => {
  test('accepts a valid entry with all fields', () => {
    expect(Value.Check(CatalogAssetEntrySchema, VALID_ENTRY)).toBe(true);
  });

  test('accepts an entry without optional subcategory and licenseNote', () => {
    const entry = { ...VALID_ENTRY };
    delete entry.subcategory;
    expect(Value.Check(CatalogAssetEntrySchema, entry)).toBe(true);
  });

  test('accepts verbatim multi-license strings — never SPDX-normalised (AC-4)', () => {
    // The licenses field must remain an ARRAY of verbatim strings — a single
    // string would silently break the multi-license contract (AC-4).
    expect(Array.isArray(VALID_ENTRY.licenses)).toBe(true);
    expect(VALID_ENTRY.licenses.every((license) => typeof license === 'string')).toBe(true);
    expect(VALID_ENTRY.licenses).toEqual(['OGA-BY 3.0', 'CC-BY-SA 3.0', 'GPL 3.0']);
    // Replacing the array with a single string fails schema validation.
    expect(Value.Check(CatalogAssetEntrySchema, { ...VALID_ENTRY, licenses: 'OGA-BY 3.0' })).toBe(
      false,
    );
  });

  test('accepts empty arrays for licenses/authors/sourceUrls (gate is the preflight, not the schema)', () => {
    const entry = { ...VALID_ENTRY, licenses: [], authors: [], sourceUrls: [] };
    expect(Value.Check(CatalogAssetEntrySchema, entry)).toBe(true);
  });

  test('rejects entry with missing tag', () => {
    const entry = { ...VALID_ENTRY };
    delete entry.tag;
    expect(Value.Check(CatalogAssetEntrySchema, entry)).toBe(false);
  });

  test('rejects non-sha256 hash', () => {
    const entry = { ...VALID_ENTRY, hash: 'not-a-hash' };
    expect(Value.Check(CatalogAssetEntrySchema, entry)).toBe(false);
  });

  test('rejects negative sizeBytes', () => {
    const entry = { ...VALID_ENTRY, sizeBytes: -1 };
    expect(Value.Check(CatalogAssetEntrySchema, entry)).toBe(false);
  });

  test('rejects unknown category — only the nine known categories are valid', () => {
    const entry = { ...VALID_ENTRY, category: 'unknown_category' };
    expect(Value.Check(CatalogAssetEntrySchema, entry)).toBe(false);
  });

  test('rejects extension without leading dot', () => {
    const entry = { ...VALID_ENTRY, ext: 'webp' };
    expect(Value.Check(CatalogAssetEntrySchema, entry)).toBe(false);
  });

  test('rejects single-string license — the field must be an array (AC-4)', () => {
    const entry = { ...VALID_ENTRY, licenses: 'OGA-BY 3.0' };
    expect(Value.Check(CatalogAssetEntrySchema, entry)).toBe(false);
  });

  test('accepts an optional thumbnailHash (C-396 AC-5)', () => {
    const entry = {
      ...VALID_ENTRY,
      thumbnailHash: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    };
    expect(Value.Check(CatalogAssetEntrySchema, entry)).toBe(true);
  });

  test('rejects a non-sha256 thumbnailHash', () => {
    const entry = { ...VALID_ENTRY, thumbnailHash: 'not-a-hash' };
    expect(Value.Check(CatalogAssetEntrySchema, entry)).toBe(false);
    // Uppercase hex and off-by-one lengths must also fail (the pattern is
    // exactly 64 lowercase hex chars — case-sensitivity is a contract).
    expect(
      Value.Check(CatalogAssetEntrySchema, {
        ...VALID_ENTRY,
        thumbnailHash: '9F86D081884C7D659A2FEAA0C55AD015A3BF4F1B2B0B822CD15D6C15B0F00A08',
      }),
    ).toBe(false);
    expect(
      Value.Check(CatalogAssetEntrySchema, {
        ...VALID_ENTRY,
        thumbnailHash: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a0',
      }),
    ).toBe(false);
    expect(
      Value.Check(CatalogAssetEntrySchema, {
        ...VALID_ENTRY,
        thumbnailHash: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08' + '0',
      }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CatalogAssetCreditSchema
// ---------------------------------------------------------------------------

describe('CatalogAssetCreditSchema', () => {
  test('accepts a valid credit', () => {
    const credit = {
      licenses: ['OGA-BY 3.0', 'CC-BY-SA 3.0'],
      authors: ['bluecarrot16', 'ElizaWy'],
      sourceUrls: ['https://opengameart.org/content/lpc-character-bases'],
      licenseNote: 'see details at https://opengameart.org/content/lpc-character-bases',
    };
    expect(Value.Check(CatalogAssetCreditSchema, credit)).toBe(true);
  });

  test('accepts a credit without licenseNote', () => {
    const credit = {
      licenses: ['OGA-BY 3.0'],
      authors: ['bluecarrot16'],
      sourceUrls: [],
    };
    expect(Value.Check(CatalogAssetCreditSchema, credit)).toBe(true);
  });

  test('accepts genuinely-unknown empty arrays', () => {
    const credit = { licenses: [], authors: [], sourceUrls: [] };
    expect(Value.Check(CatalogAssetCreditSchema, credit)).toBe(true);
  });

  test('rejects missing sourceUrls', () => {
    const credit = { licenses: ['OGA-BY 3.0'], authors: ['bluecarrot16'] };
    expect(Value.Check(CatalogAssetCreditSchema, credit)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CatalogIndexRootSchema
// ---------------------------------------------------------------------------

const VALID_ROOT = {
  schemaVersion: 1,
  publishedAt: '2026-08-15T12:00:00.000Z',
  originUrl: 'https://assets.bearlysleeping.com',
  totalCount: 12707,
  categories: [
    { id: 'lpc', count: 12699 },
    { id: 'music', count: 8 },
  ],
};

describe('CatalogIndexRootSchema', () => {
  test('accepts a valid root index', () => {
    expect(Value.Check(CatalogIndexRootSchema, VALID_ROOT)).toBe(true);
  });

  test('rejects wrong schemaVersion', () => {
    const root = { ...VALID_ROOT, schemaVersion: 2 };
    expect(Value.Check(CatalogIndexRootSchema, root)).toBe(false);
  });

  test('rejects missing originUrl', () => {
    const root = { ...VALID_ROOT };
    delete root.originUrl;
    expect(Value.Check(CatalogIndexRootSchema, root)).toBe(false);
  });

  test('rejects per-asset entries in the root — summaries only (AC-2)', () => {
    const root = { ...VALID_ROOT, entries: [VALID_ENTRY] };
    expect(Value.Check(CatalogIndexRootSchema, root)).toBe(false);
  });

  test('rejects a category summary carrying an entry array', () => {
    const root = {
      ...VALID_ROOT,
      categories: [{ id: 'lpc', count: 12699, entries: [VALID_ENTRY] }],
    };
    expect(Value.Check(CatalogIndexRootSchema, root)).toBe(false);
  });

  test('rejects negative totalCount', () => {
    const root = { ...VALID_ROOT, totalCount: -1 };
    expect(Value.Check(CatalogIndexRootSchema, root)).toBe(false);
  });

  test('accepts an empty categories array', () => {
    const root = { ...VALID_ROOT, totalCount: 0, categories: [] };
    expect(Value.Check(CatalogIndexRootSchema, root)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// CatalogIndexShardSchema
// ---------------------------------------------------------------------------

const VALID_SHARD = {
  schemaVersion: 1,
  publishedAt: '2026-08-15T12:00:00.000Z',
  originUrl: 'https://assets.bearlysleeping.com',
  id: 'lpc',
  category: 'lpc',
  entries: [VALID_ENTRY],
};

describe('CatalogIndexShardSchema', () => {
  test('accepts a valid shard', () => {
    expect(Value.Check(CatalogIndexShardSchema, VALID_SHARD)).toBe(true);
  });

  // Cross-field consistency (shard.category === entry.category) is a generator
  // invariant asserted in scripts/src/lib/catalog/__tests__/index_generation.test.ts,
  // not a schema-level property — the schema only validates each field's shape.

  test('rejects shard with nested entries inside an entry', () => {
    const shard = {
      ...VALID_SHARD,
      entries: [{ ...VALID_ENTRY, entries: [] }],
    };
    expect(Value.Check(CatalogIndexShardSchema, shard)).toBe(false);
  });

  test('accepts an empty shard', () => {
    const shard = { ...VALID_SHARD, entries: [] };
    expect(Value.Check(CatalogIndexShardSchema, shard)).toBe(true);
  });

  test('accepts a shard WITHOUT id — the live C-395 index predates the field (C-396)', () => {
    const shard = { ...VALID_SHARD };
    delete shard.id;
    expect(Value.Check(CatalogIndexShardSchema, shard)).toBe(true);
  });

  test('rejects wrong schemaVersion', () => {
    const shard = { ...VALID_SHARD, schemaVersion: 0 };
    expect(Value.Check(CatalogIndexShardSchema, shard)).toBe(false);
  });
});
