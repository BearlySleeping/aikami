// apps/frontend/client/src/lib/data/initial_suggestion_presets.test.ts
import { describe, expect, test } from 'bun:test';
import {
  getClassInitialSuggestions,
  MAX_INITIAL_SUGGESTIONS,
  mergeInitialSuggestions,
  PLAYER_CLASS_INITIAL_CHIPS,
} from './initial_suggestion_presets.ts';

describe('PLAYER_CLASS_INITIAL_CHIPS', () => {
  test('covers every class preset id', () => {
    const classIds = ['fighter', 'wizard', 'rogue', 'bard', 'cleric', 'ranger', 'paladin', 'druid'];
    for (const id of classIds) {
      expect(PLAYER_CLASS_INITIAL_CHIPS[id], `class ${id}`).toBeDefined();
      expect(PLAYER_CLASS_INITIAL_CHIPS[id]?.length).toBeGreaterThan(0);
    }
  });

  test('every chip satisfies the suggestion chip contract', () => {
    for (const [classId, chips] of Object.entries(PLAYER_CLASS_INITIAL_CHIPS)) {
      for (const chip of chips) {
        expect(chip.id.length, `chip id for ${classId}`).toBeGreaterThanOrEqual(1);
        expect(chip.label.length).toBeGreaterThanOrEqual(1);
        expect(
          chip.prefillText.length,
          `prefillText for ${classId}.${chip.id}`,
        ).toBeGreaterThanOrEqual(10);
        expect(['dialogue', 'skill_check', 'combat', 'trade', 'quest']).toContain(chip.intentType);
      }
    }
  });

  test('class chip ids are globally unique', () => {
    const ids = new Set<string>();
    for (const chips of Object.values(PLAYER_CLASS_INITIAL_CHIPS)) {
      for (const chip of chips) {
        expect(ids.has(chip.id), `duplicate chip id ${chip.id}`).toBe(false);
        ids.add(chip.id);
      }
    }
  });
});

describe('getClassInitialSuggestions', () => {
  test('returns the class preset for a known class', () => {
    expect(getClassInitialSuggestions('bard')).toBe(PLAYER_CLASS_INITIAL_CHIPS.bard);
  });

  test('returns fallback chips for an unknown or missing class', () => {
    expect(getClassInitialSuggestions('monk').length).toBeGreaterThan(0);
    expect(getClassInitialSuggestions(undefined).length).toBeGreaterThan(0);
    expect(getClassInitialSuggestions('monk')[0].id).toBe('class_default_help');
  });
});

describe('mergeInitialSuggestions', () => {
  test('merges NPC chips first, then class chips', () => {
    const npcChips = [
      {
        id: 'npc_ask',
        label: 'Ask a question',
        intentType: 'dialogue' as const,
        prefillText: 'I have a question for you if you have a moment.',
      },
    ];
    const merged = mergeInitialSuggestions(npcChips, 'bard');
    expect(merged[0].id).toBe('npc_ask');
    expect(merged.some((c) => c.id.startsWith('class_'))).toBe(true);
  });

  test('dedupes by id with NPC chips winning', () => {
    const npcChips = [
      {
        id: 'class_bard_perform',
        label: 'NPC version',
        intentType: 'dialogue' as const,
        prefillText: 'The NPC authored version of this chip takes priority.',
      },
    ];
    const merged = mergeInitialSuggestions(npcChips, 'bard');
    const perform = merged.find((c) => c.id === 'class_bard_perform');
    expect(perform?.label).toBe('NPC version');
  });

  test('caps merged chips at MAX_INITIAL_SUGGESTIONS', () => {
    const npcChips = Array.from({ length: 6 }, (_, i) => ({
      id: `npc_${i}`,
      label: `Chip ${i}`,
      intentType: 'dialogue' as const,
      prefillText: `This is a long enough prefill sentence for chip number ${i}.`,
    }));
    const merged = mergeInitialSuggestions(npcChips, 'bard');
    expect(merged.length).toBeLessThanOrEqual(MAX_INITIAL_SUGGESTIONS);
  });

  test('returns class chips when no NPC chips are provided', () => {
    const merged = mergeInitialSuggestions(undefined, 'fighter');
    expect(merged.length).toBeGreaterThan(0);
    expect(merged.every((c) => c.id.startsWith('class_'))).toBe(true);
  });

  test('returns empty when no NPC chips and no class preset matches nothing', () => {
    // mergeInitialSuggestions always falls back to FALLBACK_CLASS_CHIPS, so
    // the result is never empty for a greeting — guard against regressions.
    const merged = mergeInitialSuggestions([], undefined);
    expect(merged.length).toBeGreaterThan(0);
  });
});
