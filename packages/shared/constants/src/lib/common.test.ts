import { describe, expect, test } from 'bun:test';
import { supportedLocales } from './common.ts';

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
