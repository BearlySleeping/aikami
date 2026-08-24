// apps/frontend/client/src/lib/services/character/character_book_mapper.test.ts
//
// Unit tests for the character_book mapper (C-439).
// Standalone — no dependency on @aikami/utils or the import pipeline.

import { describe, expect, test } from 'bun:test';
import { normalizeCharacterBook } from './character_book_mapper.ts';

// ── Fixtures ───────────────────────────────────────────────────────────────

const SAMPLE_ENTRY = {
  keys: ['tavern', 'inn', 'drink'],
  content: 'The Silver Flagon is a cozy inn known for its spiced mead.',
  extensions: { source: 'lyra_card' },
  enabled: true,
  insertion_order: 1,
  case_sensitive: false,
  name: 'Silver Flagon',
  priority: 5,
  id: 101,
  comment: 'A key location',
  selective: false,
  secondary_keys: ['Silver Flagon'],
  constant: false,
  position: 'before_char' as const,
};

const DISABLED_ENTRY = {
  keys: ['disabled'],
  content: 'This should not appear.',
  extensions: {},
  enabled: false,
  insertion_order: 2,
  constant: false,
};

const CONSTANT_ENTRY = {
  keys: [],
  content: 'Always present lore about the world.',
  extensions: {},
  enabled: true,
  insertion_order: 3,
  constant: true,
};

// ── AC-2: Entry mapping ────────────────────────────────────────────────────

describe('normalizeCharacterBook — AC-2: entry mapping', () => {
  test('keys map to keywords, content maps directly', () => {
    const result = normalizeCharacterBook({
      book: { name: 'Test', description: '', extensions: {}, entries: [SAMPLE_ENTRY] },
      characterName: 'Test Char',
    });
    expect(result.entries[0].keywords).toEqual(['tavern', 'inn', 'drink']);
    expect(result.entries[0].content).toBe(
      'The Silver Flagon is a cozy inn known for its spiced mead.',
    );
  });

  test('insertion_order wins over priority when both present', () => {
    const result = normalizeCharacterBook({
      book: { name: 'Test', description: '', extensions: {}, entries: [SAMPLE_ENTRY] },
      characterName: 'Test Char',
    });
    // insertion_order=1, priority=5 → insertion_order wins
    expect(result.entries[0].priority).toBe(1);
  });

  test('unmapped fields are preserved in extensions', () => {
    const result = normalizeCharacterBook({
      book: { name: 'Test', description: '', extensions: {}, entries: [SAMPLE_ENTRY] },
      characterName: 'Test Char',
    });
    const ext = result.entries[0].extensions as Record<string, unknown>;
    expect(ext.case_sensitive).toBe(false);
    expect(ext.name).toBe('Silver Flagon');
    expect(ext.id).toBe(101);
    expect(ext.comment).toBe('A key location');
    expect(ext.selective).toBe(false);
    expect(ext.secondary_keys).toEqual(['Silver Flagon']);
    expect(ext.position).toBe('before_char');
    expect(ext.source).toBe('lyra_card');
  });

  test('disabled entries are skipped and counted', () => {
    const result = normalizeCharacterBook({
      book: {
        name: 'Test',
        description: '',
        extensions: {},
        entries: [SAMPLE_ENTRY, DISABLED_ENTRY],
      },
      characterName: 'Test Char',
    });
    expect(result.entries).toHaveLength(1);
    expect(result.summary.skipped).toBe(1);
    expect(result.summary.skippedReasons[0]).toContain('disabled');
  });

  test('constant entries are mapped with constant=true', () => {
    const result = normalizeCharacterBook({
      book: { name: 'Test', description: '', extensions: {}, entries: [CONSTANT_ENTRY] },
      characterName: 'Test Char',
    });
    expect(result.entries[0].constant).toBe(true);
    expect(result.entries[0].keywords).toEqual([]);
  });

  test('no field vanishes — every key in source is either mapped or in extensions', () => {
    const result = normalizeCharacterBook({
      book: { name: 'Test', description: '', extensions: {}, entries: [SAMPLE_ENTRY] },
      characterName: 'Test Char',
    });
    const ext = result.entries[0].extensions as Record<string, unknown>;
    // 'extensions' is merged into the target extensions bag (not lost)
    // 'enabled' is consumed by the skip/import decision
    const consumedKeys = new Set([
      'keys', 'content', 'constant', 'insertion_order', 'priority', 'enabled', 'extensions',
    ]);
    for (const key of Object.keys(SAMPLE_ENTRY)) {
      if (!consumedKeys.has(key)) {
        expect(Object.keys(ext)).toContain(key);
      }
    }
  });

  test('empty keys with constant:true is valid (always-injected entry)', () => {
    const result = normalizeCharacterBook({
      book: { name: 'Test', description: '', extensions: {}, entries: [CONSTANT_ENTRY] },
      characterName: 'Test Char',
    });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].constant).toBe(true);
    expect(result.entries[0].keywords).toEqual([]);
  });
});

// ── AC-4: Import summary ───────────────────────────────────────────────────

describe('normalizeCharacterBook — AC-4: import summary', () => {
  test('over-bound book imports first N entries with a summary message', () => {
    const manyEntries = Array.from({ length: 250 }, (_, i) => ({
      keys: [`key${i}`],
      content: `Entry ${i} content.`,
      extensions: {},
      enabled: true,
      insertion_order: i,
      constant: false,
    }));
    const result = normalizeCharacterBook({
      book: { name: 'Big Book', description: '', extensions: {}, entries: manyEntries },
      characterName: 'Test',
    });
    expect(result.entries).toHaveLength(200);
    expect(result.summary.total).toBe(250);
    expect(result.summary.imported).toBe(200);
    expect(result.summary.skipped).toBe(50);
    expect(result.summary.skippedReasons[0]).toContain('exceeds the maximum');
  });

  test('content exceeding max length is skipped', () => {
    const longEntry = {
      ...SAMPLE_ENTRY,
      content: 'x'.repeat(10_001),
      name: 'Long Entry',
    };
    const result = normalizeCharacterBook({
      book: { name: 'Test', description: '', extensions: {}, entries: [longEntry, SAMPLE_ENTRY] },
      characterName: 'Test Char',
    });
    expect(result.entries).toHaveLength(1);
    expect(result.summary.skipped).toBe(1);
    expect(result.summary.skippedReasons[0]).toContain('exceeds the maximum');
  });

  test('non-string content is skipped', () => {
    const badEntry = {
      ...SAMPLE_ENTRY,
      content: 12345 as unknown as string,
      name: 'Bad Entry',
    };
    const result = normalizeCharacterBook({
      book: { name: 'Test', description: '', extensions: {}, entries: [badEntry, SAMPLE_ENTRY] },
      characterName: 'Test Char',
    });
    expect(result.entries).toHaveLength(1);
    expect(result.summary.skipped).toBe(1);
    expect(result.summary.skippedReasons[0]).toContain('non-string');
  });

  test('book name falls back to character name when absent', () => {
    const result = normalizeCharacterBook({
      book: { name: undefined, description: '', extensions: {}, entries: [SAMPLE_ENTRY] },
      characterName: 'Lyra Sunweaver',
    });
    expect(result.name).toBe("Lyra Sunweaver's Lorebook");
  });

  test('book description falls back to generated text when absent', () => {
    const result = normalizeCharacterBook({
      book: { name: 'Test', description: undefined, extensions: {}, entries: [SAMPLE_ENTRY] },
      characterName: 'Lyra',
    });
    expect(result.description).toContain('Lyra');
  });
});
