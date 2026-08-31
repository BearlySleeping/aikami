// apps/frontend/hub/src/lib/views/catalog/__tests__/preview_kind.test.ts
//
// C-446 AC-2: previewKindForEntry dispatch — every category maps to the
// correct preview kind, and unknown categories return 'none'.

import { describe, expect, test } from 'bun:test';
import type { CatalogAssetEntry } from '@aikami/schemas';
import { previewKindForEntry } from '../preview_kind.ts';

type EntryOverrides = Partial<Omit<CatalogAssetEntry, 'category'>> & { category?: string };

const makeEntry = (overrides: EntryOverrides): CatalogAssetEntry =>
  ({
    tag: 'test:asset',
    hash: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    sizeBytes: 1024,
    category: 'lpc',
    ext: '.webp',
    licenses: ['CC-BY-SA 3.0'],
    authors: ['Test Author'],
    sourceUrls: [],
    ...overrides,
  }) as CatalogAssetEntry;

describe('previewKindForEntry', () => {
  test('lpc category → lpc', () => {
    expect(previewKindForEntry(makeEntry({ category: 'lpc' }))).toBe('lpc');
  });

  test('tilesets category → tileset', () => {
    expect(previewKindForEntry(makeEntry({ category: 'tilesets' }))).toBe('tileset');
  });

  test('maps category → map', () => {
    expect(previewKindForEntry(makeEntry({ category: 'maps' }))).toBe('map');
  });

  test('props category → prop', () => {
    expect(previewKindForEntry(makeEntry({ category: 'props' }))).toBe('prop');
  });

  test('sprites category → prop', () => {
    expect(previewKindForEntry(makeEntry({ category: 'sprites' }))).toBe('prop');
  });

  test('contentPacks category → pack', () => {
    expect(previewKindForEntry(makeEntry({ category: 'contentPacks' }))).toBe('pack');
  });

  test('music category → none', () => {
    expect(previewKindForEntry(makeEntry({ category: 'music' }))).toBe('none');
  });

  test('sfx category → none', () => {
    expect(previewKindForEntry(makeEntry({ category: 'sfx' }))).toBe('none');
  });

  test('ambient category → none', () => {
    expect(previewKindForEntry(makeEntry({ category: 'ambient' }))).toBe('none');
  });

  test('backgrounds category → none', () => {
    expect(previewKindForEntry(makeEntry({ category: 'backgrounds' }))).toBe('none');
  });

  test('unknown category → none', () => {
    expect(previewKindForEntry(makeEntry({ category: 'unknown_category' }))).toBe('none');
  });

  test('empty category → none', () => {
    expect(previewKindForEntry(makeEntry({ category: '' }))).toBe('none');
  });
});
