import { describe, expect, test } from 'bun:test';
import { Value } from 'typebox/value';
import { LocaleDataSchema, SupportedLocaleSchema } from './preference.ts';

describe('SupportedLocaleSchema', () => {
  test('should parse en locale', () => {
    expect(Value.Parse(SupportedLocaleSchema, 'en')).toBe('en');
  });

  test('should reject unsupported locale', () => {
    expect(() => Value.Parse(SupportedLocaleSchema, 'fr')).toThrow();
    expect(() => Value.Parse(SupportedLocaleSchema, 'es')).toThrow();
  });
});

describe('LocaleDataSchema', () => {
  test('should parse valid locale data', () => {
    const validData = { en: 'English' };
    const result = Value.Parse(LocaleDataSchema, validData);
    expect(result.en).toBe('English');
  });

  test('should parse with optional value undefined', () => {
    const validData = { en: undefined };
    const result = Value.Parse(LocaleDataSchema, validData);
    expect(result.en).toBeUndefined();
  });

  test('should allow unsupported locale keys (open record in TypeBox v1)', () => {
    const invalidData = { fr: 'French' };
    // TypeBox v1 records are open by default — extra keys pass through
    const result = Value.Parse(LocaleDataSchema, invalidData);
    expect(result.fr).toBe('French');
  });
});
