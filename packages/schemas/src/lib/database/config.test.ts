import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import {
  ConfigCreateSchema,
  ConfigSchema,
  ConfigUpdateSchema,
  GameDifficultySchema,
  ThemeSchema,
} from './config.ts';

describe('ThemeSchema', () => {
  test('should accept valid themes', () => {
    expect(ThemeSchema.parse('dark')).toBe('dark');
    expect(ThemeSchema.parse('light')).toBe('light');
    expect(ThemeSchema.parse('system')).toBe('system');
  });

  test('should default to system', () => {
    const result = ThemeSchema.parse(undefined);
    expect(result).toBe('system');
  });

  test('should reject invalid theme', () => {
    expect(() => ThemeSchema.parse('purple')).toThrow(z.ZodError);
  });
});

describe('GameDifficultySchema', () => {
  test('should accept valid difficulties', () => {
    expect(GameDifficultySchema.parse('easy')).toBe('easy');
    expect(GameDifficultySchema.parse('normal')).toBe('normal');
    expect(GameDifficultySchema.parse('hard')).toBe('hard');
  });

  test('should default to normal', () => {
    const result = GameDifficultySchema.parse(undefined);
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
    const result = ConfigSchema.parse(validConfig);
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
    const result = ConfigSchema.parse(minimalConfig);
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
    expect(() => ConfigSchema.parse(invalidConfig)).toThrow(z.ZodError);
  });

  test('should reject invalid gameDifficulty', () => {
    const invalidConfig = {
      ...validConfig,
      gameDifficulty: 'impossible',
    };
    expect(() => ConfigSchema.parse(invalidConfig)).toThrow(z.ZodError);
  });
});

describe('ConfigCreateSchema', () => {
  test('should parse valid create data', () => {
    const createData = {
      uid: 'user-789',
      theme: 'light',
      locale: 'da',
    };
    const result = ConfigCreateSchema.parse(createData);
    expect(result.uid).toBe('user-789');
    expect(result.theme).toBe('light');
    expect(result.locale).toBe('da');
  });

  test('should reject missing uid', () => {
    const invalidData = {
      theme: 'dark',
    };
    expect(() => ConfigCreateSchema.parse(invalidData)).toThrow(z.ZodError);
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
    const result = ConfigUpdateSchema.parse(updateData);
    expect(result.theme).toBe('dark');
    expect(result.notificationsEnabled).toBe(false);
  });

  test('should allow partial updates', () => {
    const updateData = {
      uid: 'user-123',
      updatedAt: mockServerTimestamp,
      locale: 'es',
    };
    const result = ConfigUpdateSchema.parse(updateData);
    expect(result.locale).toBe('es');
  });
});
