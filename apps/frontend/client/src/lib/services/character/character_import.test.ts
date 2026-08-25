// apps/frontend/client/src/lib/services/character/character_import.test.ts
//
// Unit tests for the SillyTavern character-card import pipeline (C-419).

// biome-ignore-all lint/style/useNamingConvention: SillyTavern card format uses snake_case fields
//
// Covers:
// - AC-1: V2 card parses (PNG `chara` chunk + JSON) into a Character
// - AC-2: V3 card parses (`ccv3` chunk + JSON) without loss of V3 fields
// - AC-2: stats-free cards compile with inferred ability scores
// - Malformed/adversarial card content fails cleanly (no crash)
//
// Uses createPlaceholderPngCard to build minimal PNGs with embedded tEXt
// chunks — no real image fixtures needed.

import { describe, expect, test } from 'bun:test';
import { inferAbilityScores } from './ability_score_inference.ts';
import { compileCardToNpc, compileCardToPersona } from './card_compiler.ts';
import { normalizeCharacterBook } from './character_book_mapper.ts';
import { importFromJson, importFromPng } from './character_importer.ts';
import { isV2Card, isV3Card } from './character_validator.ts';
import { createPlaceholderPngCard } from './png_writer.ts';

// ── Fixtures ─────────────────────────────────────────────────────────────

/** Minimal valid SillyTavern V2 card JSON. */
const V2_CARD = {
  spec: 'chara_card_v2',
  spec_version: '2.0',
  data: {
    name: 'Lyra Sunweaver',
    description: 'A wandering elven bard with a silver tongue.',
    personality: 'Witty, curious, fiercely loyal to her companions.',
    scenario: 'The party meets Lyra at a crossroads inn.',
    first_mes: 'Well met, travelers! Care to hear a tune?',
    mes_example: '<START>\n{{user}}: Hello\n{{char}}: A smile!',
    creator_notes: 'Test fixture card.',
    system_prompt: 'You are Lyra, an elven bard.',
    post_history_instructions: '',
    alternate_greetings: ['Greetings!'],
    tags: ['bard', 'elf', 'female'],
    creator: 'aikami-tests',
    character_version: '1.0',
    extensions: {},
  },
} as const;

/** Minimal valid SillyTavern V3 card JSON with a spec-conforming `assets` array. */
const V3_CARD = {
  spec: 'chara_card_v3',
  spec_version: '3.0',
  data: {
    ...V2_CARD.data,
    assets: [
      { type: 'card', uri: 'https://example.com/cards/lyra.png', name: 'Lyra Card' },
      { type: 'thumbnail', uri: 'https://example.com/cards/lyra-thumb.png', name: 'Lyra Thumb' },
    ],
  },
} as const;

/** V2 card with NO stat-relevant fields (exercises ability-score inference). */
// The stats-free scenario is covered by the inferAbilityScores tests below;
// the fixture is intentionally minimal and unused as a standalone constant.

const pngFileFromCard = (card: unknown, keyword: 'chara' | 'ccv3'): File => {
  const base64 = btoa(JSON.stringify(card));
  const blob = createPlaceholderPngCard({ keyword, text: base64 });
  return new File([blob], 'card.png', { type: 'image/png' });
};

// ── C-439: Character book fixtures ────────────────────────────────────────

/** A minimal lorebook entry for testing. */
const SAMPLE_BOOK_ENTRY = {
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

/** A disabled entry (enabled: false) that should be skipped. */
const DISABLED_BOOK_ENTRY = {
  keys: ['disabled'],
  content: 'This should not appear.',
  extensions: {},
  enabled: false,
  insertion_order: 2,
  constant: false,
};

/** A constant entry (no keywords, always included). */
const CONSTANT_BOOK_ENTRY = {
  keys: [],
  content: 'Always present lore about the world.',
  extensions: {},
  enabled: true,
  insertion_order: 3,
  constant: true,
};

/** V2 card with a character_book. */
const V2_CARD_WITH_BOOK = {
  ...V2_CARD,
  data: {
    ...V2_CARD.data,
    character_book: {
      name: "Lyra's World",
      description: "Locations and lore from Lyra's travels.",
      scan_depth: 50,
      token_budget: 500,
      recursive_scanning: true,
      extensions: { exported_from: 'SillyTavern' },
      entries: [SAMPLE_BOOK_ENTRY, DISABLED_BOOK_ENTRY, CONSTANT_BOOK_ENTRY],
    },
  },
} as const;

/** V3 card with a character_book (same book shape as V2). */
const V3_CARD_WITH_BOOK = {
  ...V3_CARD,
  data: {
    ...V3_CARD.data,
    character_book: V2_CARD_WITH_BOOK.data.character_book,
  },
} as const;

// ── Validator ────────────────────────────────────────────────────────────

describe('character_validator', () => {
  test('isV2Card accepts a valid V2 card', () => {
    expect(isV2Card(V2_CARD)).toBe(true);
  });

  test('isV2Card rejects a V3 card', () => {
    expect(isV2Card(V3_CARD)).toBe(false);
  });

  test('isV3Card accepts a valid V3 card', () => {
    expect(isV3Card(V3_CARD)).toBe(true);
  });

  test('isV3Card rejects a V2 card', () => {
    expect(isV3Card(V2_CARD)).toBe(false);
  });

  test('isV3Card rejects non-object / null / malformed input', () => {
    expect(isV3Card(null)).toBe(false);
    expect(isV3Card(undefined)).toBe(false);
    expect(isV3Card('string')).toBe(false);
    expect(isV3Card({ spec: 'chara_card_v3' })).toBe(false);
  });

  test('isV3Card rejects a card whose extensions is null', () => {
    const card = {
      spec: 'chara_card_v3',
      spec_version: '3.0',
      data: { ...V3_CARD.data, extensions: null },
    };
    expect(isV3Card(card)).toBe(false);
  });

  test('isV3Card rejects a card whose extensions is an array', () => {
    const card = {
      spec: 'chara_card_v3',
      spec_version: '3.0',
      data: { ...V3_CARD.data, extensions: [] },
    };
    expect(isV3Card(card)).toBe(false);
  });
});

// ── AC-1: V2 PNG import ─────────────────────────────────────────────────

describe('importFromPng — V2 cards (AC-1)', () => {
  test('parses a V2 card from a PNG chara chunk', async () => {
    const result = await importFromPng({ file: pngFileFromCard(V2_CARD, 'chara') });
    expect(result.character.name).toBe('Lyra Sunweaver');
    expect(result.character.description).toBe('A wandering elven bard with a silver tongue.');
    expect(result.character.personality).toBe('Witty, curious, fiercely loyal to her companions.');
    expect(result.character.scenario).toBe('The party meets Lyra at a crossroads inn.');
    expect(result.character.first_mes).toBe('Well met, travelers! Care to hear a tune?');
    expect(result.avatarFile).toBeDefined();
  });

  test('rejects a non-PNG file cleanly', async () => {
    const file = new File(['not a png'], 'card.txt', { type: 'text/plain' });
    await expect(importFromPng({ file })).rejects.toThrow('File is not a valid PNG.');
  });

  test('rejects a PNG with no recognisable card chunk cleanly', async () => {
    const blob = createPlaceholderPngCard({ keyword: 'unknown', text: 'nope' });
    const file = new File([blob], 'card.png', { type: 'image/png' });
    await expect(importFromPng({ file })).rejects.toThrow('No valid character data found in PNG.');
  });

  test('rejects a PNG with malformed base64 JSON cleanly', async () => {
    const blob = createPlaceholderPngCard({ keyword: 'chara', text: '###not-json###' });
    const file = new File([blob], 'card.png', { type: 'image/png' });
    await expect(importFromPng({ file })).rejects.toThrow();
  });
});

// ── AC-1: V2 JSON import ────────────────────────────────────────────────

describe('importFromJson — V2 cards (AC-1)', () => {
  test('parses a V2 card from JSON', async () => {
    const file = new File([JSON.stringify(V2_CARD)], 'card.json', { type: 'application/json' });
    const result = await importFromJson({ file });
    expect(result.character.name).toBe('Lyra Sunweaver');
    expect(result.character.system_prompt).toBe('You are Lyra, an elven bard.');
  });

  test('rejects invalid JSON cleanly', async () => {
    const file = new File(['{ not json'], 'card.json', { type: 'application/json' });
    await expect(importFromJson({ file })).rejects.toThrow('Invalid JSON format.');
  });

  test('rejects JSON matching no known spec cleanly', async () => {
    const file = new File([JSON.stringify({ hello: 'world' })], 'card.json', {
      type: 'application/json',
    });
    await expect(importFromJson({ file })).rejects.toThrow(
      'JSON does not match known character specifications.',
    );
  });
});

// ── AC-2: V3 import ─────────────────────────────────────────────────────

describe('importFromPng — V3 cards (AC-2)', () => {
  test('parses a V3 card from a PNG ccv3 chunk', async () => {
    const result = await importFromPng({ file: pngFileFromCard(V3_CARD, 'ccv3') });
    expect(result.character.name).toBe('Lyra Sunweaver');
    expect(result.character.description).toBe('A wandering elven bard with a silver tongue.');
    // V3 `data.assets` is normalized into extensions.assets on the PNG path
    // too, preserving the exact asset array for downstream compilation.
    expect(result.character.extensions.assets).toEqual(V3_CARD.data.assets);
  });
});

describe('importFromJson — V3 cards (AC-2)', () => {
  test('parses a V3 card from JSON without losing V3 fields', async () => {
    const file = new File([JSON.stringify(V3_CARD)], 'card.json', { type: 'application/json' });
    const result = await importFromJson({ file });
    expect(result.character.name).toBe('Lyra Sunweaver');
    // The V3 `assets` array is preserved exactly under extensions.assets.
    expect(result.character.extensions.assets).toEqual(V3_CARD.data.assets);
  });
});

// ── AC-2: ability-score inference ───────────────────────────────────────

describe('inferAbilityScores — stats-free cards (AC-2)', () => {
  test('returns the deterministic default array when the card declares no stats', () => {
    const scores = inferAbilityScores({ character: { ...V2_CARD.data, extensions: {} } });
    expect(scores.strength).toBeGreaterThanOrEqual(8);
    expect(scores.dexterity).toBeGreaterThanOrEqual(8);
    expect(scores.constitution).toBeGreaterThanOrEqual(8);
    expect(scores.intelligence).toBeGreaterThanOrEqual(8);
    expect(scores.wisdom).toBeGreaterThanOrEqual(8);
    expect(scores.charisma).toBeGreaterThanOrEqual(8);
  });

  test('prefers declared scores from card extensions when present', () => {
    const character = {
      ...V2_CARD.data,
      extensions: {
        abilityScores: { strength: 18, dexterity: 14, charisma: 20 },
      },
    };
    const scores = inferAbilityScores({ character });
    expect(scores.strength).toBe(18);
    expect(scores.dexterity).toBe(14);
    expect(scores.charisma).toBe(20);
  });
});

// ── AC-1: compile to PersonaSheetSchema ─────────────────────────────────

describe('compileCardToPersona — AC-1', () => {
  test('maps V2 card fields into PersonaSheetSchema fields', () => {
    const compiled = compileCardToPersona({ character: { ...V2_CARD.data } });
    // name → name
    expect(compiled.name).toBe('Lyra Sunweaver');
    // description → background
    expect(compiled.background).toBe('A wandering elven bard with a silver tongue.');
    // personality → personalityTraits
    expect(compiled.personalityTraits).toBe('Witty, curious, fiercely loyal to her companions.');
    // scenario → notes (PersonaSheetSchema has no scenario key)
    expect(compiled.notes).toBe('The party meets Lyra at a crossroads inn.');
    // ability scores populated (inferred since the card declares none)
    expect(compiled.abilityScores).toBeDefined();
    expect(compiled.abilityScores?.strength).toBeGreaterThanOrEqual(8);
  });

  test('preserves declared ability scores through compilation when extensions also carry V3 assets', () => {
    // A V3 card compiles with its declared scores even when the extensions
    // bag additionally holds the normalized `assets` array (C-419 CR fix).
    const character = {
      ...V2_CARD.data,
      extensions: {
        abilityScores: { strength: 16, dexterity: 14, charisma: 13 },
        assets: V3_CARD.data.assets,
      },
    };
    const compiled = compileCardToPersona({ character });
    expect(compiled.abilityScores?.strength).toBe(16);
    expect(compiled.abilityScores?.dexterity).toBe(14);
    expect(compiled.abilityScores?.charisma).toBe(13);
    expect(compiled.name).toBe('Lyra Sunweaver');
  });
});

// ── NPC compilation ─────────────────────────────────────────────────────

describe('compileCardToNpc', () => {
  test('maps V2 card fields into NpcSheetSchema fields', () => {
    const compiled = compileCardToNpc({ character: { ...V2_CARD.data } });
    expect(compiled.name).toBe('Lyra Sunweaver');
    expect(compiled.personality).toBe('Witty, curious, fiercely loyal to her companions.');
    expect(compiled.scenario).toBe('The party meets Lyra at a crossroads inn.');
    expect(compiled.firstMessage).toBe('Well met, travelers! Care to hear a tune?');
    expect(compiled.systemPrompt).toBe('You are Lyra, an elven bard.');
    expect(compiled.abilityScores).toBeDefined();
  });
});

// ── C-439 AC-1: character_book parsing ────────────────────────────────────

describe('character_book import — AC-1: parsing', () => {
  test('V2 PNG card with book parses and returns normalized lorebook', async () => {
    const result = await importFromPng({ file: pngFileFromCard(V2_CARD_WITH_BOOK, 'chara') });
    expect(result.lorebook).toBeDefined();
    const lorebook = result.lorebook;
    if (!lorebook) {
      throw new Error('Expected lorebook to be defined');
    }
    expect(lorebook.name).toBe("Lyra's World");
    expect(lorebook.entries).toHaveLength(2); // 1 disabled skipped
    expect(lorebook.summary.total).toBe(3);
    expect(lorebook.summary.imported).toBe(2);
    expect(lorebook.summary.skipped).toBe(1);
  });

  test('V3 PNG card with book parses and returns normalized lorebook', async () => {
    const result = await importFromPng({ file: pngFileFromCard(V3_CARD_WITH_BOOK, 'ccv3') });
    expect(result.lorebook).toBeDefined();
    const lorebook = result.lorebook;
    if (!lorebook) {
      throw new Error('Expected lorebook to be defined');
    }
    expect(lorebook.entries).toHaveLength(2);
    expect(lorebook.summary.total).toBe(3);
  });

  test('JSON card with book parses and returns normalized lorebook', async () => {
    const file = new File([JSON.stringify(V2_CARD_WITH_BOOK)], 'card.json', {
      type: 'application/json',
    });
    const result = await importFromJson({ file });
    expect(result.lorebook).toBeDefined();
    const lorebook = result.lorebook;
    if (!lorebook) {
      throw new Error('Expected lorebook to be defined');
    }
    expect(lorebook.entries).toHaveLength(2);
    expect(lorebook.summary.total).toBe(3);
  });

  test('V2, V3, and JSON paths produce identical normalized book structure', async () => {
    const pngV2 = await importFromPng({ file: pngFileFromCard(V2_CARD_WITH_BOOK, 'chara') });
    const pngV3 = await importFromPng({ file: pngFileFromCard(V3_CARD_WITH_BOOK, 'ccv3') });
    const file = new File([JSON.stringify(V2_CARD_WITH_BOOK)], 'card.json', {
      type: 'application/json',
    });
    const json = await importFromJson({ file });

    const lorebookV2 = pngV2.lorebook;
    const lorebookV3 = pngV3.lorebook;
    const lorebookJson = json.lorebook;

    if (!lorebookV2 || !lorebookV3 || !lorebookJson) {
      throw new Error('Expected all lorebooks to be defined');
    }

    // All three should have the same entry count and summary
    expect(lorebookV2.summary).toEqual(lorebookV3.summary);
    expect(lorebookV2.summary).toEqual(lorebookJson.summary);

    // Entry content should match across all paths
    expect(lorebookV2.entries[0].content).toBe(lorebookV3.entries[0].content);
    expect(lorebookV2.entries[0].content).toBe(lorebookJson.entries[0].content);
  });

  test('card with no character_book imports exactly as before (no lorebook)', async () => {
    const result = await importFromPng({ file: pngFileFromCard(V2_CARD, 'chara') });
    expect(result.lorebook).toBeUndefined();
    expect(result.character.name).toBe('Lyra Sunweaver'); // character still imports
  });

  test('card with no character_book via JSON imports exactly as before', async () => {
    const file = new File([JSON.stringify(V2_CARD)], 'card.json', { type: 'application/json' });
    const result = await importFromJson({ file });
    expect(result.lorebook).toBeUndefined();
    expect(result.character.name).toBe('Lyra Sunweaver');
  });
});

// ── C-439 AC-2: entry mapping ─────────────────────────────────────────────

describe('character_book mapping — AC-2: entry mapping', () => {
  test('keys map to keywords, content maps directly', () => {
    const normalized = normalizeCharacterBook({
      book: {
        name: 'Test',
        description: '',
        extensions: {},
        entries: [SAMPLE_BOOK_ENTRY],
      },
      characterName: 'Test Char',
    });
    expect(normalized.entries[0].keywords).toEqual(['tavern', 'inn', 'drink']);
    expect(normalized.entries[0].content).toBe(
      'The Silver Flagon is a cozy inn known for its spiced mead.',
    );
  });

  test('insertion_order wins over priority when both present', () => {
    const normalized = normalizeCharacterBook({
      book: {
        name: 'Test',
        description: '',
        extensions: {},
        entries: [SAMPLE_BOOK_ENTRY], // insertion_order=1, priority=5
      },
      characterName: 'Test Char',
    });
    // insertion_order (1) wins over priority (5)
    expect(normalized.entries[0].priority).toBe(1);
  });

  test('unmapped fields are preserved in extensions', () => {
    const normalized = normalizeCharacterBook({
      book: {
        name: 'Test',
        description: '',
        extensions: {},
        entries: [SAMPLE_BOOK_ENTRY],
      },
      characterName: 'Test Char',
    });
    const ext = normalized.entries[0].extensions as Record<string, unknown>;
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
    const normalized = normalizeCharacterBook({
      book: {
        name: 'Test',
        description: '',
        extensions: {},
        entries: [SAMPLE_BOOK_ENTRY, DISABLED_BOOK_ENTRY],
      },
      characterName: 'Test Char',
    });
    expect(normalized.entries).toHaveLength(1);
    expect(normalized.summary.skipped).toBe(1);
    expect(normalized.summary.skippedReasons[0]).toContain('disabled');
  });

  test('constant entries are mapped with constant=true', () => {
    const normalized = normalizeCharacterBook({
      book: {
        name: 'Test',
        description: '',
        extensions: {},
        entries: [CONSTANT_BOOK_ENTRY],
      },
      characterName: 'Test Char',
    });
    expect(normalized.entries[0].constant).toBe(true);
    expect(normalized.entries[0].keywords).toEqual([]);
  });

  test('no field vanishes — every key in source is either mapped or in extensions', () => {
    const normalized = normalizeCharacterBook({
      book: {
        name: 'Test',
        description: '',
        extensions: {},
        entries: [SAMPLE_BOOK_ENTRY],
      },
      characterName: 'Test Char',
    });
    const ext = normalized.entries[0].extensions as Record<string, unknown>;
    const mappedKeys = new Set([
      'keys',
      'content',
      'constant',
      'insertion_order',
      'priority',
      'enabled',
      'extensions',
    ]);
    for (const key of Object.keys(SAMPLE_BOOK_ENTRY)) {
      if (!mappedKeys.has(key)) {
        // Every unmapped key must be in extensions
        expect(Object.keys(ext)).toContain(key);
      }
    }
  });
});

// ── C-439 AC-4: import summary ────────────────────────────────────────────

describe('character_book import — AC-4: import summary', () => {
  test('malformed book degrades to character-only import with no crash', async () => {
    const malformedCard = {
      ...V2_CARD,
      data: {
        ...V2_CARD.data,
        character_book: 'not-an-object',
      },
    };
    const file = new File([JSON.stringify(malformedCard)], 'card.json', {
      type: 'application/json',
    });
    const result = await importFromJson({ file });
    // Character still imports
    expect(result.character.name).toBe('Lyra Sunweaver');
    // Book is silently skipped (malformed)
    expect(result.lorebook).toBeUndefined();
  });

  test('over-bound book imports first N entries with a summary message', () => {
    const manyEntries = Array.from({ length: 250 }, (_, i) => ({
      keys: [`key${i}`],
      content: `Entry ${i} content.`,
      extensions: {},
      enabled: true,
      insertion_order: i,
      constant: false,
    }));
    const normalized = normalizeCharacterBook({
      book: {
        name: 'Big Book',
        description: '',
        extensions: {},
        entries: manyEntries,
      },
      characterName: 'Test',
    });
    expect(normalized.entries).toHaveLength(200); // MAX_ENTRY_COUNT
    expect(normalized.summary.total).toBe(250);
    expect(normalized.summary.imported).toBe(200);
    expect(normalized.summary.skipped).toBe(50);
    expect(normalized.summary.skippedReasons[0]).toContain('exceeds the maximum');
  });

  test('malformed ccv3 chunk falls back to valid chara chunk with book', async () => {
    // Create a PNG with both ccv3 (malformed) and chara (valid with book) chunks
    const { buildTextChunk } = await import('./png_writer.ts');

    // Start with a minimal PNG
    const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const ihdrData = new Uint8Array([0, 0, 0, 1, 0, 0, 0, 1, 8, 0, 0, 0, 0]);
    const idatData = new Uint8Array([
      0x78, 0x01, 0x01, 0x02, 0x00, 0xfd, 0xff, 0x00, 0xff, 0x00, 0x40, 0x00, 0x40,
    ]);
    const iendData = new Uint8Array(0);

    const buildPngChunk = (type: string, data: Uint8Array): Uint8Array => {
      const encoder = new TextEncoder();
      const typeBytes = encoder.encode(type);
      const lengthBytes = new Uint8Array(4);
      new DataView(lengthBytes.buffer).setUint32(0, data.length);

      // Simple CRC stub (not validated for this test)
      const crcBytes = new Uint8Array([0, 0, 0, 0]);

      const result = new Uint8Array(4 + typeBytes.length + data.length + 4);
      result.set(lengthBytes, 0);
      result.set(typeBytes, 4);
      result.set(data, 8);
      result.set(crcBytes, 8 + data.length);
      return result;
    };

    // Malformed ccv3 chunk (invalid base64)
    const ccv3Chunk = buildTextChunk({ keyword: 'ccv3', text: '###not-valid-base64###' });

    // Valid chara chunk with a book
    const charaChunk = buildTextChunk({
      keyword: 'chara',
      text: btoa(JSON.stringify(V2_CARD_WITH_BOOK)),
    });

    const chunks = [
      signature,
      buildPngChunk('IHDR', ihdrData),
      ccv3Chunk,
      charaChunk,
      buildPngChunk('IDAT', idatData),
      buildPngChunk('IEND', iendData),
    ];

    const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
    const pngData = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      pngData.set(chunk, offset);
      offset += chunk.length;
    }

    const file = new File([pngData], 'card.png', { type: 'image/png' });
    const result = await importFromPng({ file });

    // Character should be imported from chara chunk
    expect(result.character.name).toBe('Lyra Sunweaver');

    // Lorebook should also come from the chara chunk (not the malformed ccv3)
    expect(result.lorebook).toBeDefined();
    const lorebook = result.lorebook;
    if (!lorebook) {
      throw new Error('Expected lorebook to be defined');
    }
    expect(lorebook.name).toBe("Lyra's World");
    expect(lorebook.entries).toHaveLength(2);
  });
});
