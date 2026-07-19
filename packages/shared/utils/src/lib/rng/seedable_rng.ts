// packages/shared/utils/src/lib/rng/seedable_rng.ts
//
// Deterministic 32-bit PRNG using the mulberry32 algorithm.
// Extracted from packages/frontend/engine/src/systems/turn_manager_system.ts
// into a shared package for use by the engine, dice service, rules kernel,
// and any future mechanical resolution code.
//
// Contract: C-336 Extract a Deterministic Rules Kernel and Typed Game Command

/**
 * A seedable 32-bit PRNG returning values in [0, 1). Uses mulberry32.
 *
 * Deterministic — given the same seed, produces the same sequence.
 * Supports mid-sequence serialization via {@link serializeRng} /
 * {@link deserializeRng} for save/restore across sessions.
 */
export type SeedableRng = {
  /** Advance the PRNG and return a float in [0, 1). */
  next(): number;
  /** Return an integer in [1, sides] inclusive. */
  dice(sides: number): number;
  /** The original seed value. */
  readonly seed: number;
  /** The current internal mulberry32 state (for serialization). */
  getState(): number;
};

/**
 * Serialized RNG state for mid-sequence save/restore.
 *
 * Captures both the initial seed and the current internal mulberry32
 * state so the sequence can be resumed at the exact same position.
 */
export type SerializedRng = {
  seed: number;
  state: number;
};

/**
 * Creates a seedable PRNG using the mulberry32 algorithm.
 *
 * Given the same seed, the sequence of values returned by `next()` and
 * `dice()` is byte-identical — enabling deterministic combat replay
 * across all runtimes (browser, Node, Bun).
 *
 * @param seed - A 32-bit integer seed.
 * @param initialState - Optional internal state override for resume-from-serialized.
 * @returns A {@link SeedableRng} instance.
 */
export const createSeedableRng = (seed: number, initialState?: number): SeedableRng => {
  let state = initialState !== undefined ? initialState | 0 : seed | 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const dice = (sides: number): number => {
    if (sides < 1) {
      return 0;
    }
    return Math.floor(next() * sides) + 1;
  };

  const getState = (): number => {
    return state;
  };

  return { next, dice, seed, getState };
};

/**
 * Captures the RNG state for mid-sequence serialization.
 *
 * Use this to save the RNG position after a partial command log replay
 * so the sequence can be resumed later (e.g., across save/load cycles).
 *
 * @param rng - The active {@link SeedableRng} instance.
 * @returns A {@link SerializedRng} with seed + current internal state.
 */
export const serializeRng = (rng: SeedableRng): SerializedRng => {
  return {
    seed: rng.seed,
    state: rng.getState(),
  };
};

/**
 * Restores a {@link SeedableRng} from a serialized snapshot.
 *
 * Resumes the PRNG sequence at the exact same position it was
 * when {@link serializeRng} was called.
 *
 * @param data - A {@link SerializedRng} from {@link serializeRng}.
 * @returns A new {@link SeedableRng} instance at the serialized position.
 */
export const deserializeRng = (data: SerializedRng): SeedableRng => {
  return createSeedableRng(data.seed, data.state);
};
