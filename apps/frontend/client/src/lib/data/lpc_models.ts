// apps/frontend/client/src/lib/data/lpc_models.ts
// biome-ignore-all lint/style/useNamingConvention: States needs to be in UpperCase until refactor

/**
 * Local mirrors of engine enums from @aikami/frontend/engine.
 *
 * These const objects replicate the numeric values of `LpcAnimationState`
 * and `LpcDirection` defined in:
 *   packages/frontend/engine/src/rendering/animation_controller.ts
 *
 * We define them locally to avoid statically importing the full engine
 * bundle (which triggers INEFFECTIVE_DYNAMIC_IMPORT warnings in Vite/Rollup).
 * The engine is lazily loaded only when the game canvas is actually needed.
 */

/** Mirrors `LpcAnimationState` enum values from the engine animation controller. */
export const LpcAnimationState = {
  /** Rows 0–3: casting magic spells. */
  Spellcast: 0,
  /** Rows 4–7: thrusting weapons forward. */
  Thrust: 4,
  /** Rows 8–11: walking / running movement. */
  Walk: 8,
  /** Rows 12–15: slashing with weapons. */
  Slash: 12,
  /** Rows 16–19: shooting bows / ranged weapons. */
  Shoot: 16,
  /** Row 20 only: death / collapse animation. */
  Die: 20,
} as const;

export type LpcAnimationState = number;

/** Mirrors `LpcDirection` enum values from the engine animation controller. */
export const LpcDirection = {
  /** Facing upward (north). Row offset 0 within state block. */
  Up: 0,
  /** Facing left (west). Row offset 1 within state block. */
  Left: 1,
  /** Facing downward (south). Row offset 2 within state block. */
  Down: 2,
  /** Facing right (east). Row offset 3 within state block. */
  Right: 3,
} as const;

export type LpcDirection = number;

/**
 * Returns the absolute spritesheet row for the given state and direction.
 * Mirrors `getLpcStateRow` from the engine animation controller.
 */
export const getLpcStateRow = (state: LpcAnimationState, direction: LpcDirection): number => {
  if (state === LpcAnimationState.Die) {
    return state;
  }
  return state + direction;
};
