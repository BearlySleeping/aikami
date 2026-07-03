import { describe, expect, test } from 'bun:test';
import { getSupportedLocale, isSupportedLocale, supportedLocales } from './common.ts';

describe('supportedLocales', () => {
  test('should be a tuple of supported locales', () => {
    expect(supportedLocales).toEqual(['en']);
  });

  test('should contain en locale', () => {
    expect(supportedLocales).toContain('en');
  });

  test('should be readonly tuple', () => {
    const locales: readonly ['en'] = supportedLocales;
    expect(locales).toEqual(['en']);
  });

  test('should have correct length', () => {
    expect(supportedLocales.length).toBe(1);
  });
});

describe('isSupportedLocale', () => {
  test('should return true for supported locales', () => {
    expect(isSupportedLocale('en')).toBe(true);
  });

  test('should return false for unsupported locales', () => {
    expect(isSupportedLocale('fr')).toBe(false);
    expect(isSupportedLocale('es')).toBe(false);
  });

  test('should handle null and undefined', () => {
    expect(isSupportedLocale(null)).toBe(false);
    expect(isSupportedLocale(undefined)).toBe(false);
  });

  test('should handle non-string values', () => {
    expect(isSupportedLocale(123)).toBe(false);
    expect(isSupportedLocale({})).toBe(false);
    expect(isSupportedLocale([])).toBe(false);
  });

  test('should handle extremely large strings', () => {
    const largeString = 'a'.repeat(1000000);
    expect(isSupportedLocale(largeString)).toBe(false);
  });

  test('should handle unexpected characters', () => {
    expect(isSupportedLocale('en-US')).toBe(false);
    expect(isSupportedLocale(' EN ')).toBe(false);
    expect(isSupportedLocale('en\n')).toBe(false);
    expect(isSupportedLocale('eñ')).toBe(false);
  });
});

describe('getSupportedLocale', () => {
  test('should return the locale if it is supported', () => {
    expect(getSupportedLocale('en')).toBe('en');
  });

  test('should return the fallback if the locale is not supported', () => {
    expect(getSupportedLocale('fr')).toBe('en');
    expect(getSupportedLocale('es', 'en')).toBe('en');
  });

  test('should handle null and undefined by returning fallback', () => {
    expect(getSupportedLocale(null)).toBe('en');
    expect(getSupportedLocale(undefined)).toBe('en');
  });

  test('should handle extremely large strings by returning fallback', () => {
    const largeString = 'a'.repeat(1000000);
    expect(getSupportedLocale(largeString)).toBe('en');
  });

  test('should handle unexpected characters by returning fallback', () => {
    expect(getSupportedLocale('en-US')).toBe('en');
    expect(getSupportedLocale(' EN ')).toBe('en');
  });
});
