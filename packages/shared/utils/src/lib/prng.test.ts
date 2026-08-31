// packages/shared/utils/src/lib/prng.test.ts
//
// Contract: C-381 AC-9 — seeded PRNG reproducibility

import { describe, expect, test } from 'bun:test';
import { createSeededRandom, createSeededRng } from './prng.ts';

describe('createSeededRandom — AC-9', () => {
  test('produces deterministic output from the same seed', () => {
    const a = createSeededRandom(42);
    const b = createSeededRandom(42);
    for (let i = 0; i < 100; i++) {
      expect(a()).toBe(b());
    }
  });

  test('produces different output from different seeds', () => {
    const a = createSeededRandom(42);
    const b = createSeededRandom(99);
    const resultsA = Array.from({ length: 10 }, () => a());
    const resultsB = Array.from({ length: 10 }, () => b());
    expect(resultsA).not.toEqual(resultsB);
  });

  test('output is in [0, 1)', () => {
    const rng = createSeededRandom(123);
    for (let i = 0; i < 1000; i++) {
      const val = rng();
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThan(1);
    }
  });

  test('reproduces the same sequence across instances', () => {
    const seed = 777;
    const seq1 = Array.from({ length: 20 }, () => createSeededRandom(seed)());
    const seq2 = Array.from({ length: 20 }, () => createSeededRandom(seed)());
    expect(seq1).toEqual(seq2);
  });
});

describe('createSeededRng — AC-9', () => {
  test('int returns values in [min, max]', () => {
    const rng = createSeededRng(42);
    for (let i = 0; i < 100; i++) {
      const val = rng.int(1, 6);
      expect(val).toBeGreaterThanOrEqual(1);
      expect(val).toBeLessThanOrEqual(6);
    }
  });

  test('pick returns an element from the array', () => {
    const rng = createSeededRng(42);
    const arr = ['a', 'b', 'c', 'd'];
    for (let i = 0; i < 100; i++) {
      const picked = rng.pick(arr);
      expect(arr).toContain(picked);
    }
  });

  test('shuffle is deterministic from the same seed', () => {
    const arr1 = [1, 2, 3, 4, 5, 6, 7, 8];
    const arr2 = [1, 2, 3, 4, 5, 6, 7, 8];
    createSeededRng(42).shuffle(arr1);
    createSeededRng(42).shuffle(arr2);
    expect(arr1).toEqual(arr2);
  });

  test('next, int, pick, shuffle all derive from the same sequence', () => {
    const rng1 = createSeededRng(100);
    const rng2 = createSeededRng(100);
    // Both should produce the same sequence of values
    expect(rng1.next()).toBe(rng2.next());
    expect(rng1.int(1, 10)).toBe(rng2.int(1, 10));
    expect(rng1.pick(['x', 'y', 'z'])).toBe(rng2.pick(['x', 'y', 'z']));
  });
});
