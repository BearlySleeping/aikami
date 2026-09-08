import { describe, expect, test } from 'bun:test';
import { ENV_GUARD, guardCommand, normalizeTimeout } from '../bash_timeout_normalizer.ts';

describe('normalizeTimeout', () => {
  test('keeps seconds-range timeouts untouched', () => {
    expect(normalizeTimeout(30)).toBe(30);
    expect(normalizeTimeout(600)).toBe(600);
  });

  test('caps over-long seconds-range timeouts', () => {
    expect(normalizeTimeout(700)).toBe(600);
  });

  test('converts millisecond values down to seconds', () => {
    expect(normalizeTimeout(120000)).toBe(120);
  });

  test('caps converted millisecond values', () => {
    expect(normalizeTimeout(3600000)).toBe(600);
  });

  test('defaults when timeout is missing', () => {
    expect(normalizeTimeout(undefined)).toBe(60);
    expect(normalizeTimeout(null)).toBe(60);
  });
});

describe('guardCommand', () => {
  test('prepends the env guard', () => {
    expect(guardCommand('git status')).toBe(ENV_GUARD + 'git status');
  });

  test('does not double-prepend the guard', () => {
    expect(guardCommand(ENV_GUARD + 'git status')).toBe(ENV_GUARD + 'git status');
  });
});
