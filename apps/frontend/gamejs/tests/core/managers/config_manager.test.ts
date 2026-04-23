// apps/frontend/gamejs/tests/core/managers/config_manager.test.ts
import { beforeEach, describe, expect, test } from 'bun:test';

enum ConfigKey {
  VIDEO_FULLSCREEN = 'video_fullscreen',
  VIDEO_BORDERLESS = 'video_borderless',
  VIDEO_VSYNC = 'video_vsync',
  AUDIO_MASTER_VOLUME = 'audio_master_volume',
  AUDIO_MUSIC_VOLUME = 'audio_music_volume',
  AUDIO_SFX_VOLUME = 'audio_sfx_volume',
  AUDIO_VOICE_VOLUME = 'audio_voice_volume',
  API_OPENAI_KEY = 'api_openai_key',
}

const DEFAULT_VALUES: Record<ConfigKey, unknown> = {
  [ConfigKey.VIDEO_FULLSCREEN]: false,
  [ConfigKey.VIDEO_BORDERLESS]: false,
  [ConfigKey.VIDEO_VSYNC]: 0,
  [ConfigKey.AUDIO_MASTER_VOLUME]: 1.0,
  [ConfigKey.AUDIO_MUSIC_VOLUME]: 1.0,
  [ConfigKey.AUDIO_SFX_VOLUME]: 1.0,
  [ConfigKey.AUDIO_VOICE_VOLUME]: 1.0,
  [ConfigKey.API_OPENAI_KEY]: '',
};

describe('ConfigManager', () => {
  let mockConfig: Map<ConfigKey, unknown>;

  beforeEach(() => {
    mockConfig = new Map();
    for (const key of Object.values(ConfigKey)) {
      mockConfig.set(key, DEFAULT_VALUES[key]);
    }
  });

  test('should have default values for all keys', () => {
    for (const key of Object.values(ConfigKey)) {
      const value = mockConfig.get(key as ConfigKey);
      expect(value).toBe(DEFAULT_VALUES[key as ConfigKey]);
    }
  });

  test('should get value with default fallback', () => {
    const value = mockConfig.get(ConfigKey.VIDEO_FULLSCREEN);
    expect(value).toBe(false);
  });

  test('should set and get modified value', () => {
    mockConfig.set(ConfigKey.VIDEO_FULLSCREEN, true);
    expect(mockConfig.get(ConfigKey.VIDEO_FULLSCREEN)).toBe(true);
  });

  test('should reset to defaults', () => {
    mockConfig.set(ConfigKey.VIDEO_FULLSCREEN, true);
    mockConfig.set(ConfigKey.AUDIO_MASTER_VOLUME, 0.5);
    mockConfig.clear();
    for (const key of Object.values(ConfigKey)) {
      mockConfig.set(key, DEFAULT_VALUES[key as ConfigKey]);
    }
    expect(mockConfig.get(ConfigKey.VIDEO_FULLSCREEN)).toBe(false);
    expect(mockConfig.get(ConfigKey.AUDIO_MASTER_VOLUME)).toBe(1.0);
  });

  test('should handle string values', () => {
    mockConfig.set(ConfigKey.API_OPENAI_KEY, 'sk-test-key');
    expect(mockConfig.get(ConfigKey.API_OPENAI_KEY)).toBe('sk-test-key');
  });

  test('should handle numeric values', () => {
    mockConfig.set(ConfigKey.VIDEO_VSYNC, 2);
    expect(mockConfig.get(ConfigKey.VIDEO_VSYNC)).toBe(2);
  });
});
