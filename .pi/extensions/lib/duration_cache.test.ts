import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  commandKey,
  DEFAULT_CACHE_PATH,
  firstSleepMs,
  getDurationPrior,
  median,
  nextIntervalMs,
  recordDuration,
} from './duration_cache.ts';

let cwd = '';
const opts = () => ({ cwd });
const cacheFile = () => join(cwd, DEFAULT_CACHE_PATH);

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'durcache-'));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe('commandKey', () => {
  test('is stable for the same command', () => {
    expect(commandKey('moon run app:build')).toBe(commandKey('moon run app:build'));
  });

  test('ignores whitespace formatting differences', () => {
    expect(commandKey('moon  run   app:build ')).toBe(commandKey('moon run app:build'));
  });

  test('distinguishes different targets', () => {
    expect(commandKey('moon run app:build')).not.toBe(commandKey('moon run api:build'));
  });
});

describe('median', () => {
  test('returns undefined for no samples', () => {
    expect(median([])).toBeUndefined();
  });

  test('picks the middle of an odd-length list', () => {
    expect(median([5, 1, 3])).toBe(3);
  });

  test('averages the middle pair of an even-length list', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
});

describe('recordDuration / getDurationPrior', () => {
  test('returns undefined before any samples', () => {
    expect(getDurationPrior('cargo build', opts())).toBeUndefined();
  });

  test('round-trips a single sample', () => {
    recordDuration('cargo build', 1000, opts());
    expect(getDurationPrior('cargo build', opts())).toEqual({
      expectedMs: 1000,
      sampleCount: 1,
    });
  });

  test('uses the median, so one outlier does not dominate', () => {
    for (const ms of [1000, 1100, 1050, 60_000]) {
      recordDuration('cargo build', ms, opts());
    }
    const prior = getDurationPrior('cargo build', opts());
    expect(prior?.sampleCount).toBe(4);
    expect(prior?.expectedMs).toBe(1075);
  });

  test('keeps at most 10 samples, retaining the newest', () => {
    for (let i = 1; i <= 15; i++) {
      recordDuration('x', i * 100, opts());
    }
    const prior = getDurationPrior('x', opts());
    expect(prior?.sampleCount).toBe(10);
    // Newest 10 are 600..1500 -> median 1050.
    expect(prior?.expectedMs).toBe(1050);
  });

  test('tracks commands independently', () => {
    recordDuration('a', 500, opts());
    recordDuration('b', 9000, opts());
    expect(getDurationPrior('a', opts())?.expectedMs).toBe(500);
    expect(getDurationPrior('b', opts())?.expectedMs).toBe(9000);
  });

  test('ignores non-positive and non-finite durations', () => {
    recordDuration('a', 0, opts());
    recordDuration('a', -5, opts());
    recordDuration('a', Number.NaN, opts());
    expect(getDurationPrior('a', opts())).toBeUndefined();
  });

  test('recovers from a corrupt cache file instead of throwing', () => {
    mkdirSync(join(cwd, '.pi/cache'), { recursive: true });
    writeFileSync(cacheFile(), 'not json{{');
    expect(getDurationPrior('a', opts())).toBeUndefined();
    recordDuration('a', 700, opts());
    expect(getDurationPrior('a', opts())?.expectedMs).toBe(700);
  });

  test('ignores a cache file from a future schema version', () => {
    mkdirSync(join(cwd, '.pi/cache'), { recursive: true });
    writeFileSync(cacheFile(), JSON.stringify({ version: 99, entries: { x: {} } }));
    expect(getDurationPrior('a', opts())).toBeUndefined();
  });

  test('persists a readable label for hand-debugging', () => {
    recordDuration('moon run app:build', 1234, opts());
    const raw = JSON.parse(readFileSync(cacheFile(), 'utf8'));
    const entry = raw.entries[commandKey('moon run app:build')];
    expect(entry.label).toBe('moon run app:build');
  });
});

describe('firstSleepMs', () => {
  test('falls back to the interval with no prior', () => {
    expect(firstSleepMs(5000, undefined, 600_000)).toBe(5000);
  });

  test('does not speculate on a single sample', () => {
    expect(firstSleepMs(5000, { expectedMs: 240_000, sampleCount: 1 }, 600_000)).toBe(5000);
  });

  test('sleeps 80% of the expected duration once the prior is trusted', () => {
    // A 60s build waits 48s instead of taking 12 samples.
    expect(firstSleepMs(5000, { expectedMs: 60_000, sampleCount: 3 }, 600_000)).toBe(48_000);
  });

  test('never sleeps less than the caller interval', () => {
    expect(firstSleepMs(5000, { expectedMs: 1000, sampleCount: 5 }, 600_000)).toBe(5000);
  });

  test('caps the speculative sleep at two minutes', () => {
    expect(firstSleepMs(5000, { expectedMs: 3_600_000, sampleCount: 5 }, 7_200_000)).toBe(120_000);
  });

  test('never sleeps past the deadline', () => {
    expect(firstSleepMs(5000, { expectedMs: 240_000, sampleCount: 3 }, 10_000)).toBe(10_000);
  });
});

describe('nextIntervalMs', () => {
  test('backs off by 1.5x', () => {
    expect(nextIntervalMs(4000, 600_000)).toBe(6000);
  });

  test('caps at 30 seconds', () => {
    expect(nextIntervalMs(60_000, 600_000)).toBe(30_000);
  });

  test('never drops below one second', () => {
    expect(nextIntervalMs(100, 600_000)).toBe(1000);
  });

  test('does not overshoot the remaining budget', () => {
    expect(nextIntervalMs(20_000, 5000)).toBe(5000);
  });
});
