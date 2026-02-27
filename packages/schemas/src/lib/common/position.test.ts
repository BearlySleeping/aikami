import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { AddressFieldSchema, CountryCodeSchema, PositionFieldSchema } from './position.ts';

describe('CountryCodeSchema', () => {
  test('should parse US country code', () => {
    expect(CountryCodeSchema.parse('US')).toBe('US');
  });

  test('should parse GB country code', () => {
    expect(CountryCodeSchema.parse('GB')).toBe('GB');
  });

  test('should reject invalid country code', () => {
    expect(() => CountryCodeSchema.parse('XX')).toThrow(z.ZodError);
  });
});

describe('PositionFieldSchema', () => {
  test('should parse valid position data', () => {
    const validData = {
      geohash: 'abc123',
      geopoint: { latitude: 40.7128, longitude: -74.006 },
    };
    const result = PositionFieldSchema.parse(validData);
    expect(result.geohash).toBe('abc123');
    expect(result.geopoint.latitude).toBe(40.7128);
  });

  test('should reject missing geohash', () => {
    const invalidData = {
      geopoint: { latitude: 40.7128, longitude: -74.006 },
    };
    expect(() => PositionFieldSchema.parse(invalidData)).toThrow(z.ZodError);
  });
});

describe('AddressFieldSchema', () => {
  test('should parse valid address data', () => {
    const validData = {
      city: 'New York',
      country: 'United States',
      countryCode: 'US',
      postcode: '10001',
      region: 'New York',
      regionCode: 'NY',
    };
    const result = AddressFieldSchema.parse(validData);
    expect(result.city).toBe('New York');
    expect(result.countryCode).toBe('US');
  });

  test('should parse with optional fields undefined', () => {
    const validData = { city: 'New York' };
    const result = AddressFieldSchema.parse(validData);
    expect(result.city).toBe('New York');
    expect(result.country).toBeUndefined();
    expect(result.countryCode).toBeUndefined();
  });

  test('should accept union for countryCode', () => {
    const validData = { countryCode: 'US' };
    const result = AddressFieldSchema.parse(validData);
    expect(result.countryCode).toBe('US');

    const validData2 = { countryCode: 'Unknown' };
    const result2 = AddressFieldSchema.parse(validData2);
    expect(result2.countryCode).toBe('Unknown');
  });
});
