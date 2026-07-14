// apps/frontend/client/src/lib/services/expression/expression_catalog.test.ts
//
// Unit tests for expression catalog validation — ensures all 19 entries
// have required fields, no duplicate IDs, and keywords compile to valid RegExp.
//
// Contract: C-239 Expression Emotion System

import { describe, expect, test } from 'bun:test';
import {
  EXPRESSION_CATALOG,
  getExpressionEntry,
  getKeywordRegex,
} from '$lib/data/expression_catalog';

describe('ExpressionCatalog — structural validation', () => {
  test('catalog contains exactly 19 entries', () => {
    expect(EXPRESSION_CATALOG.length).toBe(19);
  });

  test('every entry has required id, label, keywords, and lpcOverlays', () => {
    for (const entry of EXPRESSION_CATALOG) {
      expect(entry.id).toBeString();
      expect(entry.label).toBeString();
      expect(Array.isArray(entry.keywords)).toBe(true);
      expect(entry.keywords.length).toBeGreaterThan(0);
      expect(typeof entry.lpcOverlays).toBe('object');
      expect(entry.lpcOverlays).not.toBeNull();
    }
  });

  test('no duplicate expression IDs', () => {
    const ids = EXPRESSION_CATALOG.map((entry) => entry.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  test('every expression ID has a corresponding entry via getExpressionEntry', () => {
    for (const entry of EXPRESSION_CATALOG) {
      expect(getExpressionEntry(entry.id)).toBeDefined();
    }
  });

  test('neutral has no LPC overlays', () => {
    const neutral = getExpressionEntry('neutral');
    expect(neutral.lpcOverlays.eyes).toBeUndefined();
    expect(neutral.lpcOverlays.eyebrows).toBeUndefined();
    expect(neutral.lpcOverlays.mouth).toBeUndefined();
  });

  test('angry has eyes, eyebrows, and mouth overlays', () => {
    const angry = getExpressionEntry('angry');
    expect(angry.lpcOverlays.eyes).toBeString();
    expect(angry.lpcOverlays.eyebrows).toBeString();
    expect(angry.lpcOverlays.mouth).toBeString();
  });

  test('keywords compile to valid RegExp', () => {
    for (const entry of EXPRESSION_CATALOG) {
      const regex = getKeywordRegex(entry.id);
      expect(regex).toBeInstanceOf(RegExp);
      // Should not throw when used
      expect(() => regex.test('test')).not.toThrow();
    }
  });

  test('keyword regex matches expected words', () => {
    const happyRegex = getKeywordRegex('happy');
    expect(happyRegex.test('She smiles warmly')).toBe(true);
    expect(happyRegex.test('He is joyful today')).toBe(true);
    expect(happyRegex.test('Nothing matches here')).toBe(false);
  });

  test('keyword regex is case-insensitive', () => {
    const angryRegex = getKeywordRegex('angry');
    expect(angryRegex.test('He is ANGRY')).toBe(true);
    expect(angryRegex.test('she was FURIOUS')).toBe(true);
  });

  test('keyword regex matches whole words only', () => {
    const sadRegex = getKeywordRegex('sad');
    expect(sadRegex.test('She is sad')).toBe(true);
    // "saddle" should not match "sad"
    expect(sadRegex.test('The saddle is worn')).toBe(false);
  });

  test('getKeywordRegex returns empty matching regex for unknown ID', () => {
    const regex = getKeywordRegex('nonexistent' as unknown as 'neutral');
    expect(regex).toBeInstanceOf(RegExp);
    expect(regex.test('anything')).toBe(false);
  });

  test('keyword regex cache returns same instance for same ID', () => {
    const a = getKeywordRegex('happy');
    const b = getKeywordRegex('happy');
    expect(a).toBe(b);
  });
});
