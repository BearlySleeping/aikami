import { describe, expect, test } from 'bun:test';
import { Value } from 'typebox/value';
import { AppearanceSchema } from './appearance.ts';

describe('AppearanceSchema', () => {
  test('should parse valid appearance data', () => {
    const appearance = {
      avatarUrl: 'https://example.com/avatar.png',
      portraitUrl: 'https://example.com/portrait.png',
      physicalDescription: 'Tall and muscular',
      age: '30',
      height: '6\'0"',
      weight: '200 lbs',
      eyeColor: 'Blue',
      hairColor: 'Black',
      skinColor: 'Fair',
      distinguishingMarks: 'Scar on left cheek',
    };
    const result = Value.Parse(AppearanceSchema, appearance);
    expect(result.avatarUrl).toBe('https://example.com/avatar.png');
    expect(result.physicalDescription).toBe('Tall and muscular');
    expect(result.age).toBe('30');
  });

  test('should parse empty object as valid', () => {
    const result = Value.Parse(AppearanceSchema, {});
    expect(result.avatarUrl).toBeUndefined();
    expect(result.physicalDescription).toBeUndefined();
  });

  test('should parse partial appearance', () => {
    const appearance = {
      eyeColor: 'Green',
      hairColor: 'Red',
    };
    const result = Value.Parse(AppearanceSchema, appearance);
    expect(result.eyeColor).toBe('Green');
    expect(result.hairColor).toBe('Red');
    expect(result.avatarUrl).toBeUndefined();
  });

  test('should reject invalid avatarUrl', () => {
    const appearance = {
      avatarUrl: 'not-a-url',
    };
    expect(() => Value.Parse(AppearanceSchema, appearance)).toThrow();
  });

  test('should reject invalid portraitUrl', () => {
    const appearance = {
      portraitUrl: 'invalid',
    };
    expect(() => Value.Parse(AppearanceSchema, appearance)).toThrow();
  });

  test('should accept valid optional fields', () => {
    const appearance = {
      physicalDescription: 'Short and stocky',
      age: '25',
      height: '5\'6"',
      weight: '150 lbs',
      distinguishingMarks: 'Tattoo of a dragon on forearm',
    };
    const result = Value.Parse(AppearanceSchema, appearance);
    expect(result.physicalDescription).toBe('Short and stocky');
    expect(result.distinguishingMarks).toBe('Tattoo of a dragon on forearm');
  });
});
