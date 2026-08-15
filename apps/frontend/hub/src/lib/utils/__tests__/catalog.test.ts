// apps/frontend/hub/src/lib/utils/__tests__/catalog.test.ts
//
// Unit tests for hub catalog display helpers (C-396 AC-3).
import { describe, expect, test } from 'bun:test';
import type { CatalogAssetEntry } from '@aikami/schemas';
import {
  assetDisplayName,
  formatBytes,
  hasNoLicense,
  isUnknownLicense,
  matchesCatalogQuery,
  resolveThumbnailUrl,
} from '../catalog.ts';

const makeEntry = (overrides: Partial<CatalogAssetEntry> = {}): CatalogAssetEntry => ({
  tag: 'lpc:hat:magic:celestial_adult:thrust',
  hash: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
  sizeBytes: 1024,
  category: 'lpc',
  subcategory: 'hat/magic',
  ext: '.webp',
  licenses: ['CC-BY-SA 3.0', 'GPL 3.0'],
  authors: ['bluecarrot16'],
  sourceUrls: ['https://opengameart.org/content/lpc'],
  ...overrides,
});

describe('assetDisplayName', () => {
  test('strips category and subcategory prefixes, joins the remainder', () => {
    expect(assetDisplayName(makeEntry())).toBe('celestial_adult · thrust');
    expect(
      assetDisplayName(
        makeEntry({
          tag: 'sprites:combat:enemy_portrait',
          category: 'sprites',
          subcategory: 'combat',
        }),
      ),
    ).toBe('enemy_portrait');
    expect(
      assetDisplayName(
        makeEntry({
          tag: 'music:exploration:bgm_combat',
          category: 'music',
          subcategory: 'exploration',
        }),
      ),
    ).toBe('bgm_combat');
  });

  test('falls back to the raw tag when nothing can be stripped', () => {
    expect(assetDisplayName(makeEntry({ tag: 'unknown-shape', category: 'lpc' }))).toBe(
      'unknown-shape',
    );
  });
});

describe('license helpers', () => {
  test('isUnknownLicense recognises only the literal "unknown"', () => {
    expect(isUnknownLicense('unknown')).toBe(true);
    expect(isUnknownLicense('Unknown')).toBe(true);
    expect(isUnknownLicense('UNKNOWN')).toBe(true);
    expect(isUnknownLicense('CC-BY-SA 3.0')).toBe(false);
    expect(isUnknownLicense('')).toBe(false);
  });

  test('hasNoLicense is true for empty and all-unknown arrays', () => {
    expect(hasNoLicense(makeEntry({ licenses: [] }))).toBe(true);
    expect(hasNoLicense(makeEntry({ licenses: ['unknown'] }))).toBe(true);
    expect(hasNoLicense(makeEntry({ licenses: ['CC-BY-SA 3.0'] }))).toBe(false);
    expect(hasNoLicense(makeEntry({ licenses: ['unknown', 'CC-BY-SA 3.0'] }))).toBe(false);
  });
});

describe('formatBytes', () => {
  test('formats byte sizes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(4821)).toBe('4.7 KB');
    expect(formatBytes(2_613_085)).toBe('2.5 MB');
  });
});

describe('resolveThumbnailUrl', () => {
  test('resolves the content-addressed thumbnail URL from thumbnailHash', () => {
    const entry = makeEntry({
      thumbnailHash: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    });
    expect(resolveThumbnailUrl('https://assets.bearlysleeping.com', entry)).toBe(
      'https://assets.bearlysleeping.com/thumbnails/9f/9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08.webp',
    );
  });

  test('normalises a trailing-slash origin — exactly one separator before thumbnails', () => {
    const entry = makeEntry({
      thumbnailHash: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    });
    expect(resolveThumbnailUrl('https://assets.bearlysleeping.com/', entry)).toBe(
      'https://assets.bearlysleeping.com/thumbnails/9f/9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08.webp',
    );
  });

  test('returns undefined when the entry has no thumbnailHash', () => {
    expect(resolveThumbnailUrl('https://assets.bearlysleeping.com', makeEntry())).toBeUndefined();
  });
});

describe('matchesCatalogQuery', () => {
  test('matches against tag, name, subcategory, authors and licenses', () => {
    const entry = makeEntry();
    expect(matchesCatalogQuery(entry, 'thrust')).toBe(true);
    expect(matchesCatalogQuery(entry, 'bluecarrot16')).toBe(true);
    expect(matchesCatalogQuery(entry, 'gpl')).toBe(true);
    expect(matchesCatalogQuery(entry, 'hat/magic')).toBe(true);
    expect(matchesCatalogQuery(entry, 'zzz-nonexistent')).toBe(false);
    expect(matchesCatalogQuery(entry, '')).toBe(true);
  });
});
