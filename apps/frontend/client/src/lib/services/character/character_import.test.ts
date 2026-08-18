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
