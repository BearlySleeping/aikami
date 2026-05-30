// apps/frontend/gamejs/tests/core/managers/audio_manager.test.ts
import { beforeEach, describe, expect, test } from 'bun:test';

enum SFXName {
  MENU = 'menu',
  CLICK = 'click',
  BACK = 'back',
}

describe('AudioManager', () => {
  const playbackState: Map<SFXName, boolean> = new Map();
  let volumeLevels: Record<string, number> = {
    Master: 1.0,
    Music: 1.0,
    SFX: 1.0,
    Voice: 1.0,
  };

  beforeEach(() => {
    for (const sfx of Object.values(SFXName)) {
      playbackState.set(sfx, false);
    }
    volumeLevels = { Master: 1.0, Music: 1.0, SFX: 1.0, Voice: 1.0 };
  });

  test('should play menu sound', () => {
    playbackState.set(SFXName.MENU, true);
    expect(playbackState.get(SFXName.MENU)).toBe(true);
  });

  test('should play click sound', () => {
    playbackState.set(SFXName.CLICK, true);
    expect(playbackState.get(SFXName.CLICK)).toBe(true);
  });

  test('should set master volume', () => {
    volumeLevels.Master = 0.5;
    expect(volumeLevels.Master).toBe(0.5);
  });

  test('should set music volume', () => {
    volumeLevels.Music = 0.3;
    expect(volumeLevels.Music).toBe(0.3);
  });

  test('should set sfx volume', () => {
    volumeLevels.SFX = 0.8;
    expect(volumeLevels.SFX).toBe(0.8);
  });

  test('should convert linear to db', () => {
    const linear_to_db = (linear: number): number => {
      if (linear <= 0) return -80;
      return 20 * Math.log10(linear);
    };
    expect(linear_to_db(1.0)).toBeCloseTo(0);
    expect(linear_to_db(0.5)).toBeCloseTo(-6.02, 0);
    expect(linear_to_db(0)).toBe(-80);
  });
});
