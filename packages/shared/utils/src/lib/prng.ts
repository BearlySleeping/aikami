// packages/shared/utils/src/lib/prng.ts
//
// Seeded pseudo-random number generator (Mulberry32) for reproducible
// world generation. Contract: C-381 AC-9.
//
// All generation paths must use this instead of Math.random() so that
// a world can be reproduced from its seed.

/**
 * Creates a seeded PRNG using the Mulberry32 algorithm.
 * Returns a function that produces deterministic floats in [0, 1).
 *
 * @param seed - Integer seed. Campaigns store this as `Campaign.seed`.
 * @returns A function that returns the next deterministic value.
 */
export const createSeededRandom = (seed: number): (() => number) => {
  let state = seed | 0;
  return (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/**
 * Creates a seeded PRNG and binds convenience methods.
 *
 * @param seed - Integer seed.
 * @returns An object with `next()` (float in [0,1)), `int(min, max)` (inclusive),
 *          `pick(array)` (random element), and `shuffle(array)` (Fisher-Yates in-place).
 */
export const createSeededRng = (seed: number) => {
  const next = createSeededRandom(seed);
  return {
    next,
    /** Returns a random integer in [min, max] (inclusive). */
    int: (min: number, max: number): number => {
      return Math.floor(next() * (max - min + 1)) + min;
    },
    /** Picks a random element from an array. */
    pick: <T>(arr: readonly T[]): T => {
      return arr[Math.floor(next() * arr.length)] as T;
    },
    /** Fisher-Yates shuffle in-place. Returns the same array reference. */
    shuffle: <T>(arr: T[]): T[] => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [arr[i], arr[j]] = [arr[j] as T, arr[i] as T];
      }
      return arr;
    },
  };
};

export type SeededRng = ReturnType<typeof createSeededRng>;
