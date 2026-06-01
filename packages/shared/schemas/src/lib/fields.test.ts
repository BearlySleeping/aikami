import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import {
  FieldValueSchema,
  GeoPointSchema,
  TimestampSchema,
  UniversalValueSchema,
} from './fields.ts';

describe('TimestampSchema', () => {
  test('should parse valid timestamp object', () => {
    const validTimestamp = {
      seconds: 1700000000,
      nanoseconds: 0,
      toDate: () => new Date(),
      toMillis: () => 1700000000000,
    };
    const result = TimestampSchema.parse(validTimestamp);
    expect(result.seconds).toBe(1700000000);
    expect(result.nanoseconds).toBe(0);
  });

  test('should reject invalid timestamp', () => {
    const invalidTimestamp = {
      seconds: 'not a number',
    };
    expect(() => TimestampSchema.parse(invalidTimestamp)).toThrow(z.ZodError);
  });
});

describe('FieldValueSchema', () => {
  test('should parse non-null value as field value', () => {
    const result = FieldValueSchema.parse('some value');
    expect(result).toBe('some value');
  });

  test('should reject null', () => {
    expect(() => FieldValueSchema.parse(null)).toThrow(z.ZodError);
  });
});

describe('GeoPointSchema', () => {
  test('should parse valid geo point', () => {
    const validGeoPoint = {
      latitude: 40.7128,
      longitude: -74.006,
    };
    const result = GeoPointSchema.parse(validGeoPoint);
    expect(result.latitude).toBe(40.7128);
    expect(result.longitude).toBe(-74.006);
  });

  test('should reject null', () => {
    expect(() => GeoPointSchema.parse(null)).toThrow(z.ZodError);
  });
});

describe('UniversalValueSchema', () => {
  test('should parse string', () => {
    expect(UniversalValueSchema.parse('hello')).toBe('hello');
  });

  test('should parse number', () => {
    expect(UniversalValueSchema.parse(42)).toBe(42);
  });

  test('should reject array', () => {
    expect(() => UniversalValueSchema.parse(['a', 'b'])).toThrow(z.ZodError);
  });

  test('should reject object', () => {
    expect(() => UniversalValueSchema.parse({ key: 'value' })).toThrow(z.ZodError);
  });
});
