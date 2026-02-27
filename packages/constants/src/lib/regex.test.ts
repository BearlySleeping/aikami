import { describe, expect, test } from 'bun:test';
import { validISORegex } from './regex.ts';

describe('validISORegex', () => {
  test('should be a valid RegExp object', () => {
    expect(validISORegex).toBeInstanceOf(RegExp);
  });

  test('should match valid ISO 639-1 codes', () => {
    expect(validISORegex.test('en')).toBe(true);
    expect(validISORegex.test('es')).toBe(true);
    expect(validISORegex.test('fr')).toBe(true);
    expect(validISORegex.test('de')).toBe(true);
    expect(validISORegex.test('ja')).toBe(true);
    expect(validISORegex.test('zh')).toBe(true);
  });

  test('should match uppercase codes', () => {
    expect(validISORegex.test('EN')).toBe(true);
    expect(validISORegex.test('ES')).toBe(true);
  });

  test('should not match invalid codes', () => {
    expect(validISORegex.test('xxx')).toBe(false);
    expect(validISORegex.test('zzz')).toBe(false);
    expect(validISORegex.test('123')).toBe(false);
  });

  test('should match common ISO 639-1 codes', () => {
    const commonCodes = ['en', 'es', 'fr', 'de', 'ja', 'zh', 'it', 'pt', 'ru', 'ar'];
    commonCodes.forEach((code) => {
      expect(validISORegex.test(code)).toBe(true);
    });
  });
});
