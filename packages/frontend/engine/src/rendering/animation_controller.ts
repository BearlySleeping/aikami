// packages/frontend/engine/src/rendering/animation_controller.ts

// ---------------------------------------------------------------------------
// LPC Animation Controller — velocity-to-frame index computation
//
// Pure functions that map bitECS velocity vectors to LPC spritesheet frame
// indices. Zero side effects. No GPU or TextureManager coupling — the caller
// feeds the returned index to TextureManager.getFrameAt().
// ---------------------------------------------------------------------------

/** Standard LPC spritesheet column count (13 animation frames per row). */
const LPC_COLUMNS = 13;

// ---------------------------------------------------------------------------
// LpcAnimationState — maps animation actions to starting spritesheet rows
// ---------------------------------------------------------------------------

/**
 * LPC animation state identifiers.
 *
 * Each state occupies a contiguous block of 4 rows (one per direction)
 * in the spritesheet, except `DIE` which is a single row. The numeric
 * value is the zero-based starting row of the block.
 *
 * Standard LPC layout (13 cols × 21 rows, 64×64 frames):
 *   SPELLCAST: rows  0–3
 *   THRUST:    rows  4–7
 *   WALK:      rows  8–11
 *   SLASH:     rows 12–15
 *   SHOOT:     rows 16–19
 *   DIE:       row  20
 */
export enum LpcAnimationState {
  /** Rows 0–3: casting magic spells. */
  Spellcast = 0,
  /** Rows 4–7: thrusting weapons forward. */
  Thrust = 4,
  /** Rows 8–11: walking / running movement. */
  Walk = 8,
  /** Rows 12–15: slashing with weapons. */
  Slash = 12,
  /** Rows 16–19: shooting bows / ranged weapons. */
  Shoot = 16,
  /** Row 20 only: death / collapse animation. */
  Die = 20,
}

// ---------------------------------------------------------------------------
// LpcDirection — maps movement direction to row offset within a state block
// ---------------------------------------------------------------------------

/**
 * LPC direction identifiers.
 *
 * The numeric value is the row offset within an animation state block.
 * Added to the state's starting row to compute the absolute spritesheet row.
 *
 *   UP:    0
 *   LEFT:  1
 *   DOWN:  2
 *   RIGHT: 3
 */
export enum LpcDirection {
  /** Facing upward (north). Row offset 0 within state block. */
  Up = 0,
  /** Facing left (west). Row offset 1 within state block. */
  Left = 1,
  /** Facing downward (south). Row offset 2 within state block. */
  Down = 2,
  /** Facing right (east). Row offset 3 within state block. */
  Right = 3,
}

// ---------------------------------------------------------------------------
// Per-state frame counts — determines modulus wrapping boundary
// ---------------------------------------------------------------------------

/**
 * Number of animation frames per state (columns per row in the spritesheet).
 *
 * Standard LPC frame counts:
 *   SPELLCAST: 7 frames  (cols 0–6)
 *   THRUST:    8 frames  (cols 0–7)
 *   WALK:      9 frames  (cols 0–8)
 *   SLASH:     6 frames  (cols 0–5)
 *   SHOOT:    13 frames  (cols 0–12, full row)
 *   DIE:       6 frames  (cols 0–5)
 */
const FRAMES_PER_STATE = {
  [LpcAnimationState.Spellcast]: 7,
  [LpcAnimationState.Thrust]: 8,
  [LpcAnimationState.Walk]: 9,
  [LpcAnimationState.Slash]: 6,
  [LpcAnimationState.Shoot]: 13,
  [LpcAnimationState.Die]: 6,
} as const;

// ---------------------------------------------------------------------------
// velocityToDirection — derive sprite orientation from movement vector
// ---------------------------------------------------------------------------

/**
 * Derives an {@link LpcDirection} from a 2D velocity vector.
 *
 * Uses the dominant axis to select direction:
 * - When `|vx| > |vy|`: LEFT or RIGHT based on `vx` sign.
 * - When `|vy| >= |vx|`: UP or DOWN based on `vy` sign.
 *
 * At zero velocity, returns `DOWN` as the default idle-facing direction.
 *
 * @param vx - Horizontal velocity component (pixels/sec).
 * @param vy - Vertical velocity component (pixels/sec).
 * @returns The corresponding {@link LpcDirection}.
 */
export const velocityToDirection = (vx: number, vy: number): LpcDirection => {
  if (vx === 0 && vy === 0) {
    return LpcDirection.Down;
  }

  if (Math.abs(vx) > Math.abs(vy)) {
    return vx > 0 ? LpcDirection.Right : LpcDirection.Left;
  }

  return vy > 0 ? LpcDirection.Down : LpcDirection.Up;
};

// ---------------------------------------------------------------------------
// getLpcFrameIndex — pure frame index computer with modulus wrapping
// ---------------------------------------------------------------------------

/**
 * Computes a zero-based spritesheet frame index for the given animation
 * state, direction, and tick count.
 *
 * The returned index is row-major (`row * LPC_COLUMNS + column`) and can
 * be passed directly to `TextureManager.getFrameAt()`.
 *
 * Modulus wrapping ensures the index stays within the state's frame
 * boundaries regardless of tick magnitude — safe against overflow leaks
 * even when tick counts span millions of frames.
 *
 * **Direction is ignored for `DIE`** (single-row state).
 *
 * @param state - The animation state.
 * @param direction - The facing direction.
 * @param tickCount - Monotonic tick counter for this entity.
 * @returns The spritesheet frame index.
 */
export const getLpcFrameIndex = (
  state: LpcAnimationState,
  direction: LpcDirection,
  tickCount: number,
): number => {
  const frameCount = FRAMES_PER_STATE[state];

  let row: number;
  if (state === LpcAnimationState.Die) {
    row = state; // Single row — direction irrelevant
  } else {
    row = state + direction;
  }

  // Safe modulus: handles negative and overflow tick values
  const frame = ((tickCount % frameCount) + frameCount) % frameCount;

  return row * LPC_COLUMNS + frame;
};

// ---------------------------------------------------------------------------
// getLpcStateRow — helper to extract the absolute row from state + direction
// ---------------------------------------------------------------------------

/**
 * Returns the absolute spritesheet row for the given state and direction.
 *
 * Useful for debugging and test assertions that reason about row addresses
 * rather than frame indices.
 *
 * @param state - The animation state.
 * @param direction - The facing direction (ignored for DIE).
 * @returns The absolute spritesheet row (0-based).
 */
export const getLpcStateRow = (state: LpcAnimationState, direction: LpcDirection): number => {
  if (state === LpcAnimationState.Die) {
    return state;
  }
  return state + direction;
};
