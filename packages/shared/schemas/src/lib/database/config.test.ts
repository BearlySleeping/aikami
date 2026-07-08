import { describe, expect, test } from 'bun:test';
import { Value } from 'typebox/value';
import {
  ConfigCreateSchema,
  ConfigSchema,
  ConfigUpdateSchema,
  GameDifficultySchema,
  ThemeSchema,
} from './config.ts';

describe('ThemeSchema', () => {
  test('should accept valid themes', () => {
    expect(Value.Parse(ThemeSchema, 'dark')).toBe('dark');
    expect(Value.Parse(ThemeSchema, 'light')).toBe('light');
    expect(Value.Parse(ThemeSchema, 'system')).toBe('system');
  });

  test('should default to system', () => {
    const result = Value.Default(ThemeSchema, undefined);
    expect(result).toBe('system');
  });

  test('should reject invalid theme', () => {
    expect(() => Value.Parse(ThemeSchema, 'purple')).toThrow();
  });
});

describe('GameDifficultySchema', () => {
  test('should accept valid difficulties', () => {
    expect(Value.Parse(GameDifficultySchema, 'easy')).toBe('easy');
    expect(Value.Parse(GameDifficultySchema, 'normal')).toBe('normal');
    expect(Value.Parse(GameDifficultySchema, 'hard')).toBe('hard');
  });

  test('should default to normal', () => {
    const result = Value.Default(GameDifficultySchema, undefined);
    expect(result).toBe('normal');
  });
});

describe('ConfigSchema', () => {
  const validConfig = {
    id: 'user-123',
    uid: 'user-123',
    theme: 'dark',
    locale: 'en',
    notificationsEnabled: true,
    soundEnabled: true,
    gameDifficulty: 'normal',
    autoSave: true,
    showTutorial: false,
  };

  test('should parse valid config data', () => {
    const result = Value.Parse(ConfigSchema, validConfig);
    expect(result.id).toBe('user-123');
    expect(result.uid).toBe('user-123');
    expect(result.theme).toBe('dark');
    expect(result.locale).toBe('en');
  });

  test('should apply defaults for optional fields', () => {
    const minimalConfig = {
      id: 'user-456',
      uid: 'user-456',
    };
    const result = Value.Default(ConfigSchema, minimalConfig);
    expect(result.theme).toBe('system');
    expect(result.locale).toBe('en');
    expect(result.notificationsEnabled).toBe(true);
    expect(result.soundEnabled).toBe(true);
    expect(result.gameDifficulty).toBe('normal');
    expect(result.autoSave).toBe(true);
    expect(result.showTutorial).toBe(true);
  });

  test('should reject invalid locale', () => {
    const invalidConfig = {
      ...validConfig,
      locale: 123,
    };
    expect(() => Value.Parse(ConfigSchema, invalidConfig)).toThrow();
  });

  test('should reject invalid gameDifficulty', () => {
    const invalidConfig = {
      ...validConfig,
      gameDifficulty: 'impossible',
    };
    expect(() => Value.Parse(ConfigSchema, invalidConfig)).toThrow();
  });
});

describe('ConfigCreateSchema', () => {
  test('should parse valid create data', () => {
    const createData = {
      uid: 'user-789',
      theme: 'light',
      locale: 'da',
    };
    const result = Value.Parse(ConfigCreateSchema, createData);
    expect(result.uid).toBe('user-789');
    expect(result.theme).toBe('light');
    expect(result.locale).toBe('da');
  });

  test('should reject missing uid', () => {
    const invalidData = {
      theme: 'dark',
    };
    expect(() => Value.Parse(ConfigCreateSchema, invalidData)).toThrow();
  });
});

const mockServerTimestamp = { _methodName: 'serverTimestamp' };

describe('ConfigUpdateSchema', () => {
  test('should parse valid update data', () => {
    const updateData = {
      uid: 'user-123',
      updatedAt: mockServerTimestamp,
      theme: 'dark',
      notificationsEnabled: false,
    };
    const result = Value.Parse(ConfigUpdateSchema, updateData);
    expect(result.theme).toBe('dark');
    expect(result.notificationsEnabled).toBe(false);
  });

  test('should allow partial updates', () => {
    const updateData = {
      uid: 'user-123',
      updatedAt: mockServerTimestamp,
      locale: 'es',
    };
    const result = Value.Parse(ConfigUpdateSchema, updateData);
    expect(result.locale).toBe('es');
  });
});
