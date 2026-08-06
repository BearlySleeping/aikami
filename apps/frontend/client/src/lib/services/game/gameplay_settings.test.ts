// apps/frontend/client/src/lib/services/game/gameplay_settings.test.ts
//
// Unit tests for getGameplayDifficulty — the shared difficulty reader used
// by the GM/NPC dialogue context projection.

import { afterEach, describe, expect, test } from 'bun:test';
import {
  DEFAULT_DIFFICULTY,
  type GameplayDifficulty,
  getGameplayDifficulty,
} from './gameplay_settings';

const STORAGE_KEY = 'aikami_gameplay_settings';

describe('getGameplayDifficulty', () => {
  afterEach(() => {
    localStorage.clear();
  });

  test('returns the default difficulty when nothing is stored', () => {
    expect(getGameplayDifficulty()).toBe(DEFAULT_DIFFICULTY);
    expect(DEFAULT_DIFFICULTY).toBe('medium');
  });

  test('reads the persisted difficulty level', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ difficulty: 'easy' }));
    expect(getGameplayDifficulty()).toBe('easy');

    localStorage.setItem(STORAGE_KEY, JSON.stringify({ difficulty: 'hard' }));
    expect(getGameplayDifficulty()).toBe('hard');
  });

  test('falls back to default for an invalid difficulty value', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ difficulty: 'nightmare' }));
    expect(getGameplayDifficulty()).toBe(DEFAULT_DIFFICULTY);
  });

  test('falls back to default for malformed JSON', () => {
    localStorage.setItem(STORAGE_KEY, '{not json');
    expect(getGameplayDifficulty()).toBe(DEFAULT_DIFFICULTY);
  });

  test('falls back to default for non-object payloads', () => {
    localStorage.setItem(STORAGE_KEY, '"easy"');
    expect(getGameplayDifficulty()).toBe(DEFAULT_DIFFICULTY);
  });

  test('exhausts all valid difficulty ids', () => {
    const valid: readonly GameplayDifficulty[] = ['easy', 'medium', 'hard'];
    for (const id of valid) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ difficulty: id }));
      expect(getGameplayDifficulty()).toBe(id);
    }
  });
});
