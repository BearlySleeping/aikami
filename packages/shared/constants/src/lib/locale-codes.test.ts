import { describe, expect, test } from 'bun:test';
import { allLocales } from './locale-codes.ts';

describe('allLocales', () => {
  test('should be an array', () => {
    expect(Array.isArray(allLocales)).toBe(true);
  });

  test('should contain English locale', () => {
    const english = allLocales.find((locale) => locale['1'] === 'en');
    expect(english).toBeDefined();
    expect(english?.name).toBe('English');
    expect(english?.['2']).toBe('eng');
  });

  test('should contain Japanese locale', () => {
    const japanese = allLocales.find((locale) => locale['1'] === 'ja');
    expect(japanese).toBeDefined();
    expect(japanese?.name).toBe('Japanese');
  });

  test('each locale should have required properties', () => {
    for (const locale of allLocales) {
      expect(locale).toHaveProperty('1');
      expect(locale).toHaveProperty('2');
      expect(locale).toHaveProperty('3');
      expect(locale).toHaveProperty('local');
      expect(locale).toHaveProperty('name');
    }
  });

  test('each locale should have valid ISO 639-1 code', () => {
    for (const locale of allLocales) {
      expect(typeof locale['1']).toBe('string');
      expect(locale['1'].length).toBe(2);
    }
  });

  test('should have substantial number of locales', () => {
    expect(allLocales.length).toBeGreaterThan(100);
  });
});
