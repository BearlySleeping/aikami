import { describe, expect, test } from 'bun:test';
import { ENV_GUARD, guardCommand, normalizeTimeout } from '../bash_timeout_normalizer.ts';
import { runSync } from './process_runner.ts';

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
  test('prepends the non-interactive env guard without synthesizing CI', () => {
    const guarded = guardCommand('git status');
    expect(guarded).toBe(`${ENV_GUARD}git status`);
    expect(ENV_GUARD).not.toMatch(/\bCI=/);
  });

  test('does not double-prepend the guard', () => {
    expect(guardCommand(`${ENV_GUARD}git status`)).toBe(`${ENV_GUARD}git status`);
  });

  test.serial('preserves ambient CI when executing the guarded command', () => {
    const previousCi = process.env.CI;
    process.env.CI = 'ambient-local';
    try {
      const result = runSync('sh', ['-c', guardCommand('printf "%s" "$CI"')]);
      expect(result.stdout).toBe('ambient-local');
    } finally {
      if (previousCi === undefined) {
        delete process.env.CI;
      } else {
        process.env.CI = previousCi;
      }
    }
  });

  test('lets the caller override CI and the non-interactive defaults', () => {
    const command = guardCommand(
      'export CI=caller-local FORCE_COLOR=0 GIT_TERMINAL_PROMPT=1; printf "%s:%s:%s" "$CI" "$FORCE_COLOR" "$GIT_TERMINAL_PROMPT"',
    );
    const result = runSync('sh', ['-c', command]);
    expect(result.stdout).toBe('caller-local:0:1');
  });
});
