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
 * Horizontal axis takes priority over vertical — when both axes are
 * active, the entity faces LEFT or RIGHT based on `vx` sign. This gives
 * the classic RPG feel where holding left+up shows the left walk
 * animation, not a flickering alternation between left and up.
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

  // Horizontal axis has priority — when both axes are active,
  // face LEFT or RIGHT based on vx sign. This prevents flickering
  // between horizontal and vertical directions when diagonal
  // velocity components have near-equal magnitude.
  if (vx !== 0) {
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

// ---------------------------------------------------------------------------
// AnimationController — main-thread per-entity animation state machine
//
// Tracks positional deltas across frames to derive facing direction and
// walk/idle transitions without access to the bitECS Velocity component
// (which lives in the worker). Computes spritesheet frame indices via
// the pure functions above so downstream render code can slice textures.
// ---------------------------------------------------------------------------

/**
 * Default tick divisor for walk animation playback speed.
 *
 * Matches {@link ANIMATION_TICK_DIVISOR} in render_system.ts so
 * worker-computed and main-thread-computed frame indices stay in sync.
 */
const ANIMATION_TICK_DIVISOR = 8;

/**
 * Per-entity animation state machine for the main thread.
 *
 * Tracks facing direction, walk/idle state, and a monotonic tick counter.
 * On each frame, the caller feeds the entity's current world-space position
 * via {@link update}. The controller computes the delta from the last known
 * position, derives the facing direction via {@link velocityToDirection},
 * and transitions between Walk (non-zero delta) and Idle (zero delta) states.
 *
 * The returned frame index is a zero-based spritesheet index (row-major)
 * suitable for passing to {@link TextureManager.getFrameAt}.
 *
 * Idle entities lock to frame 0 of the Walk row for their last known
 * direction. Moving entities cycle through the full walk frame range at
 * a playback speed controlled by {@link ANIMATION_TICK_DIVISOR}.
 *
 * Usage:
 * ```typescript
 * const anim = new AnimationController();
 * // Each frame:
 * const frameIndex = anim.update({ x: entityX, y: entityY });
 * const frameTexture = textureManager.getFrameAt({
 *   texture: sheet,
 *   layout: { frameWidth: 64, frameHeight: 64, columns: 13 },
 *   frameIndex,
 * });
 * ```
 */
export class AnimationController {
  /** Current facing direction based on last non-zero movement delta. */
  private _direction: LpcDirection = LpcDirection.Down;

  /** Monotonic tick counter, reset to 0 on idle transition. */
  private _tickCount = 0;

  /** Last known world-space X position. */
  private _lastX = 0;

  /** Last known world-space Y position. */
  private _lastY = 0;

  /** Whether the first position has been recorded. */
  private _hasLastPosition = false;

  /** Whether the entity is currently in idle state (zero velocity). */
  private _idle = true;

  /**
   * Updates the animation state machine with the entity's current
   * world-space position.
   *
   * On the first call, records the position and returns frame 0 for the
   * default direction (Down). On subsequent calls, computes the delta
   * from the last position to determine movement and facing direction.
   *
   * @param options - Update options.
   * @param options.x - Current world-space X position.
   * @param options.y - Current world-space Y position.
   * @returns The zero-based spritesheet frame index for this frame.
   */
  update(options: { x: number; y: number }): number {
    const { x, y } = options;

    if (!this._hasLastPosition) {
      this._lastX = x;
      this._lastY = y;
      this._hasLastPosition = true;
      return getLpcFrameIndex(LpcAnimationState.Walk, this._direction, 0);
    }

    const dx = x - this._lastX;
    const dy = y - this._lastY;
    this._lastX = x;
    this._lastY = y;

    const isMoving = dx !== 0 || dy !== 0;

    if (isMoving) {
      this._direction = velocityToDirection(dx, dy);
      this._idle = false;
      this._tickCount += 1;
    } else if (!this._idle) {
      // Just transitioned to idle — lock to frame 0
      this._idle = true;
      this._tickCount = 0;
    }
    // Already idle: tickCount stays at 0, no change needed

    const effectiveTicks = Math.floor(this._tickCount / ANIMATION_TICK_DIVISOR);
    return getLpcFrameIndex(LpcAnimationState.Walk, this._direction, effectiveTicks);
  }

  /** The current facing direction (last non-zero movement direction). */
  get direction(): LpcDirection {
    return this._direction;
  }

  /** Whether the entity is currently in idle state. */
  get isIdle(): boolean {
    return this._idle;
  }

  /** The computed frame index for the current state/direction/tick. */
  get frameIndex(): number {
    const effectiveTicks = Math.floor(this._tickCount / ANIMATION_TICK_DIVISOR);
    return getLpcFrameIndex(LpcAnimationState.Walk, this._direction, effectiveTicks);
  }

  /**
   * The effective tick count after divisor scaling.
   *
   * Suitable for modulus-wrapping against a custom frame count when
   * the spritesheet layout differs from the standard 13-column LPC grid.
   */
  get effectiveTickCount(): number {
    return Math.floor(this._tickCount / ANIMATION_TICK_DIVISOR);
  }

  /**
   * Computes the zero-based column index within a spritesheet animation
   * row for the given number of columns.
   *
   * Used when the spritesheet has a non-standard column count
   * (e.g., standalone walk sheet with 9 columns instead of 13).
   *
   * @param columns - Number of animation frame columns in the sheet.
   * @returns Zero-based column index, modulus-wrapped into `[0, columns)`.
   */
  getFrameColumn(columns: number): number {
    const effective = this.effectiveTickCount;
    return effective % columns;
  }

  /** Resets all internal state (position tracking, ticks, direction). */
  reset(): void {
    this._direction = LpcDirection.Down;
    this._tickCount = 0;
    this._lastX = 0;
    this._lastY = 0;
    this._hasLastPosition = false;
    this._idle = true;
  }
}
