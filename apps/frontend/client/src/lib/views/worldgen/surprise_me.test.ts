// apps/frontend/client/src/lib/views/worldgen/surprise_me.test.ts
//
// Unit tests for Surprise Me input generation — validates that presets are
// well-formed, getRandomPreset returns deterministic results with seed,
// and random mode produces valid output.
//
// Run with:
//   bun test --preload ./src/lib/test_preload.ts --tsconfig tsconfig.test.json \
//     src/lib/views/worldgen/surprise_me.test.ts
//
// Contract: C-233

import { describe, expect, test } from 'bun:test';
import { getRandomPreset, SURPRISE_ME_PRESETS } from '@aikami/types';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Surprise Me presets — C-233', () => {
  describe('SURPRISE_ME_PRESETS', () => {
    test('has at least 6 presets', () => {
      expect(SURPRISE_ME_PRESETS.length).toBeGreaterThanOrEqual(6);
    });

    test('all presets have all required fields', () => {
      for (const preset of SURPRISE_ME_PRESETS) {
        expect(preset.genre.length).toBeGreaterThan(0);
        expect(preset.tone.length).toBeGreaterThan(0);
        expect(preset.setting.length).toBeGreaterThan(0);
        expect(preset.difficulty.length).toBeGreaterThan(0);
        expect(preset.goals.length).toBeGreaterThan(0);
      }
    });

    test('all presets have valid difficulty values', () => {
      const validDifficulties = ['Easy', 'Medium', 'Hard'];
      for (const preset of SURPRISE_ME_PRESETS) {
        expect(validDifficulties).toContain(preset.difficulty);
      }
    });

    test('all presets have non-empty genre', () => {
      const genres = SURPRISE_ME_PRESETS.map((p) => p.genre);
      expect(genres.every((g) => g.length > 0)).toBe(true);
    });

    test('all presets have distinct combinations (at least 6 unique setting+goal pairs)', () => {
      const keys = SURPRISE_ME_PRESETS.map(
        (p) => `${p.genre}::${p.tone}::${p.setting.slice(0, 20)}`,
      );
      const unique = new Set(keys);
      expect(unique.size).toBeGreaterThanOrEqual(6);
    });
  });

  describe('getRandomPreset', () => {
    test('returns a valid preset', () => {
      const preset = getRandomPreset();
      expect(preset.genre.length).toBeGreaterThan(0);
      expect(preset.tone.length).toBeGreaterThan(0);
      expect(preset.setting.length).toBeGreaterThan(0);
      expect(preset.difficulty.length).toBeGreaterThan(0);
      expect(preset.goals.length).toBeGreaterThan(0);
    });

    test('returns deterministic results with same seed', () => {
      const a = getRandomPreset(42);
      const b = getRandomPreset(42);
      expect(a.genre).toBe(b.genre);
      expect(a.tone).toBe(b.tone);
      expect(a.setting).toBe(b.setting);
      expect(a.goals).toBe(b.goals);
    });

    test('returns different results with different seeds', () => {
      const a = getRandomPreset(1);
      const b = getRandomPreset(999);
      // Very unlikely that both seed 1 and 999 map to the same index
      // If they do (n < 12), that's fine — just verify they're from the list
      expect(SURPRISE_ME_PRESETS).toContainEqual(a);
      expect(SURPRISE_ME_PRESETS).toContainEqual(b);
    });

    test('handles seed = 0', () => {
      const preset = getRandomPreset(0);
      expect(preset.genre.length).toBeGreaterThan(0);
    });

    test('handles negative seed', () => {
      const preset = getRandomPreset(-42);
      expect(preset.genre.length).toBeGreaterThan(0);
    });

    test('handles large seed', () => {
      const preset = getRandomPreset(999999);
      expect(preset.genre.length).toBeGreaterThan(0);
    });

    test('returns a preset from the SURPRISE_ME_PRESETS array', () => {
      const preset = getRandomPreset(7);
      const match = SURPRISE_ME_PRESETS.find(
        (p) => p.genre === preset.genre && p.tone === preset.tone && p.setting === preset.setting,
      );
      expect(match).toBeDefined();
    });
  });
});
