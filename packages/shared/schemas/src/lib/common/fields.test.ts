import { describe, expect, test } from 'bun:test';
import { Value } from 'typebox/value';
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
    const result = Value.Parse(TimestampSchema, validTimestamp);
    expect(result.seconds).toBe(1700000000);
    expect(result.nanoseconds).toBe(0);
  });

  test('should accept any value (Type.Unsafe schema)', () => {
    const invalidTimestamp = {
      seconds: 'not a number',
    };
    // Type.Unsafe accepts any value without validation
    expect(() => Value.Assert(TimestampSchema, invalidTimestamp)).not.toThrow();
  });
});

describe('FieldValueSchema', () => {
  test('should parse non-null value as field value', () => {
    const result = Value.Parse(FieldValueSchema, 'some value');
    expect(result).toBe('some value');
  });

  test('should accept null (Type.Unsafe schema)', () => {
    // Type.Unsafe accepts any value including null without validation
    expect(() => Value.Assert(FieldValueSchema, null)).not.toThrow();
  });
});

describe('GeoPointSchema', () => {
  test('should parse valid geo point', () => {
    const validGeoPoint = {
      latitude: 40.7128,
      longitude: -74.006,
    };
    const result = Value.Parse(GeoPointSchema, validGeoPoint);
    expect(result.latitude).toBe(40.7128);
    expect(result.longitude).toBe(-74.006);
  });

  test('should accept null (Type.Unsafe schema)', () => {
    // Type.Unsafe accepts any value including null without validation
    expect(() => Value.Assert(GeoPointSchema, null)).not.toThrow();
  });
});

describe('UniversalValueSchema', () => {
  test('should parse string', () => {
    expect(Value.Parse(UniversalValueSchema, 'hello')).toBe('hello');
  });

  test('should parse number', () => {
    expect(Value.Parse(UniversalValueSchema, 42)).toBe(42);
  });

  test('should reject array', () => {
    expect(() => Value.Assert(UniversalValueSchema, ['a', 'b'])).toThrow();
  });

  test('should reject object', () => {
    expect(() => Value.Assert(UniversalValueSchema, { key: 'value' })).toThrow();
  });
});
