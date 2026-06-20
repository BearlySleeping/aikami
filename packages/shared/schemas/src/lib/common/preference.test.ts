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

  test('should reject unsupported locale key', () => {
    const invalidData = { fr: 'French' };
    expect(() => Value.Parse(LocaleDataSchema, invalidData)).toThrow();
  });
});
