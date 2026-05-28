import { describe, expect, test } from 'bun:test';
import { CountryToCode, countryCodes } from './location.ts';

describe('CountryToCode', () => {
  test('should be a readonly object', () => {
    expect(typeof CountryToCode).toBe('object');
  });

  test('should contain US entry', () => {
    expect(CountryToCode).toHaveProperty('US');
    expect(CountryToCode.US).toBe('United States');
  });

  test('should contain GB entry', () => {
    expect(CountryToCode).toHaveProperty('GB');
    expect(CountryToCode.GB).toBe('United Kingdom');
  });

  test('should contain DE entry', () => {
    expect(CountryToCode).toHaveProperty('DE');
    expect(CountryToCode.DE).toBe('Germany');
  });

  test('should contain JP entry', () => {
    expect(CountryToCode).toHaveProperty('JP');
    expect(CountryToCode.JP).toBe('Japan');
  });

  test('all country names should be non-empty strings', () => {
    for (const name of Object.values(CountryToCode)) {
      expect(typeof name).toBe('string');
      expect(name.length).toBeGreaterThan(0);
    }
  });
});

describe('countryCodes', () => {
  test('should be an array', () => {
    expect(Array.isArray(countryCodes)).toBe(true);
  });

  test('should contain US', () => {
    expect(countryCodes).toContain('US');
  });

  test('should contain GB', () => {
    expect(countryCodes).toContain('GB');
  });

  test('should have same keys as CountryToCode', () => {
    expect(countryCodes.length).toBe(Object.keys(CountryToCode).length);
  });

  test('all codes should be strings of length 2 or 3', () => {
    for (const code of countryCodes) {
      expect(typeof code).toBe('string');
      expect(code.length).toBeGreaterThanOrEqual(2);
    }
  });
});
