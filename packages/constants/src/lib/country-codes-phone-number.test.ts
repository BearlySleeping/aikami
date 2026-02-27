import { describe, expect, test } from 'bun:test';
import { normalizedCountries } from './country-codes-phone-number.ts';

describe('normalizedCountries', () => {
  test('should be an array', () => {
    expect(Array.isArray(normalizedCountries)).toBe(true);
  });

  test('should contain US entry', () => {
    const us = normalizedCountries.find((country) => country.iso2 === 'US');
    expect(us).toBeDefined();
    expect(us?.dialCode).toBe('1');
    expect(us?.name).toContain('United States');
  });

  test('should contain GB entry', () => {
    const gb = normalizedCountries.find((country) => country.iso2 === 'GB');
    expect(gb).toBeDefined();
    expect(gb?.dialCode).toBe('44');
  });

  test('each country should have required properties', () => {
    normalizedCountries.forEach((country) => {
      expect(country).toHaveProperty('areaCodes');
      expect(country).toHaveProperty('dialCode');
      expect(country).toHaveProperty('id');
      expect(country).toHaveProperty('iso2');
      expect(country).toHaveProperty('label');
      expect(country).toHaveProperty('name');
      expect(country).toHaveProperty('priority');
    });
  });

  test('iso2 should be uppercase two-letter codes', () => {
    normalizedCountries.forEach((country) => {
      expect(typeof country.iso2).toBe('string');
      expect(country.iso2.length).toBe(2);
      expect(country.iso2).toBe(country.iso2.toUpperCase());
    });
  });

  test('dialCode should be non-empty string', () => {
    normalizedCountries.forEach((country) => {
      expect(typeof country.dialCode).toBe('string');
      expect(country.dialCode.length).toBeGreaterThan(0);
    });
  });

  test('should have substantial number of countries', () => {
    expect(normalizedCountries.length).toBeGreaterThan(200);
  });
});
