// packages/frontend/engine/src/rendering/animation_controller.ts
//
// AnimationController — main-thread per-entity animation state machine
//
// Tracks positional deltas across frames to derive facing direction and
// walk/idle transitions without access to the bitECS Velocity component
// (which lives in the worker). Computes spritesheet frame indices via
// the pure functions from @aikami/lpc so downstream render code can slice
// textures.

import {
  ElapsedTimeActor,
  getLpcFrameIndex,
  getLpcStateRow,
  LpcAnimationState,
  LpcDirection,
  velocityToDirection,
} from '@aikami/lpc';

// Re-export moved symbols for backward compatibility with engine-internal imports.
export { getLpcFrameIndex, getLpcStateRow, LpcAnimationState, LpcDirection, velocityToDirection };

// ---------------------------------------------------------------------------
// AnimationController — main-thread per-entity animation state machine
//
// Tracks positional deltas across frames to derive facing direction and
// walk/idle transitions without access to the bitECS Velocity component
// (which lives in the worker). Computes spritesheet frame indices via
// the pure functions above so downstream render code can slice textures.
// ---------------------------------------------------------------------------

/**
 * Wall-clock duration of one walk frame in ms (C-496).
 *
 * Replaces the old `ANIMATION_TICK_DIVISOR = 8` frame-count divisor: at the
 * previous ~60fps ticker the walk cycle advanced one frame every 8 ticks ≈
 * 136ms of continuous movement. The clock now advances by real elapsed
 * time, so a 60Hz and a 30Hz host move the same sprite at the same speed
 * without a second, refresh-count clock.
 */
const FRAME_DURATION_MS = 136;

/**
 * Default delta (ms) applied per `update` call when the caller does not
 * supply real elapsed time (e.g. unit tests). Roughly one 60fps tick (17ms).
 */
const DEFAULT_DELTA_MS = 17;

/**
 * Consecutive zero-delta idle time tolerated before the entity is considered
 * idle (C-378, C-496). Roughly ~102ms (≈6 frames at 60fps), absorbing the
 * worker render-buffer drift while keeping the idle→frame-0 lock responsive.
 */
const IDLE_GRACE_MS = 102;

/**
 * Per-entity animation state machine for the main thread.
 *
 * Tracks facing direction, walk/idle state, and a monotonic elapsed-time
 * clock ({@link ElapsedTimeActor}). On each frame the caller feeds the
 * entity's current world-space position and the real elapsed wall-clock
 * delta; the controller derives facing direction from the movement vector
 * and advances the clock only while the entity is moving.
 *
 * The returned frame index is a zero-based spritesheet index (row-major)
 * suitable for passing to {@link TextureManager.getFrameAt}. Idle entities
 * lock to frame 0 of the Walk row for their last known direction.
 *
 * Usage:
 * ```typescript
 * const anim = new AnimationController();
 * // Each ticker frame (ticker.deltaMS ≈ 16.7ms at 60Hz):
 * const frameIndex = anim.update({ x: entityX, y: entityY, deltaMs: ticker.deltaMS });
 * ```
 */
export class AnimationController {
  /** Current facing direction based on last non-zero movement delta. */
  private _direction: LpcDirection = LpcDirection.Down;

  /** Monotonic elapsed-time clock, reset to 0 on idle transition. */
  private readonly _clock = new ElapsedTimeActor();

  /** Last known world-space X position. */
  private _lastX = 0;

  /** Last known world-space Y position. */
  private _lastY = 0;

  /** Whether the first position has been recorded. */
  private _hasLastPosition = false;

  /** Whether the entity is currently in idle state (zero velocity). */
  private _idle = true;

  /** Consecutive zero-delta idle time in ms — resets on any movement frame. */
  private _consecutiveIdleMs = 0;

  /**
   * Updates the animation state machine with the entity's current world-space
   * position and the real elapsed wall-clock delta since the last frame.
   *
   * On the first call, records the position and returns frame 0 for the
   * default direction (Down). On subsequent calls, computes the delta from
   * the last position to determine movement and facing direction.
   *
   * Zero-delta frames are treated as "no new data" (stale render-view read)
   * rather than instant idle: the walk cycle keeps advancing as long as the
   * entity was moving within the last {@link IDLE_GRACE_MS}. Only a sustained
   * zero-delta run (≥ IDLE_GRACE_MS) locks the sprite to the idle frame.
   *
   * @param options - Update options.
   * @param options.x - Current world-space X position.
   * @param options.y - Current world-space Y position.
   * @param options.deltaMs - Real elapsed wall-clock time since the last
   *   update in ms (from the ticker). Falls back to {@link DEFAULT_DELTA_MS}.
   * @returns The zero-based spritesheet frame index for this frame.
   */
  update(options: { x: number; y: number; deltaMs?: number }): number {
    const { x, y } = options;
    const deltaMs = options.deltaMs ?? DEFAULT_DELTA_MS;

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
      this._consecutiveIdleMs = 0;
      this._direction = velocityToDirection(dx, dy);
      this._idle = false;
      // Advance the single elapsed-time clock; playback speed is determined
      // by wall-clock time, never by how many refresh ticks fired (C-496).
      this._clock.advance(deltaMs);
    } else {
      this._consecutiveIdleMs += deltaMs;
      if (this._consecutiveIdleMs >= IDLE_GRACE_MS && !this._idle) {
        // Sustained zero-delta — genuinely stopped. Lock to frame 0.
        this._idle = true;
        this._clock.reset();
      }
    }
    // While moving (or within the grace window), the elapsed clock keeps
    // accumulating so the walk cycle advances across stale reads.

    const effectiveTicks = this.effectiveTickCount;
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

  /** The computed frame index for the current state/direction/elapsed time. */
  get frameIndex(): number {
    const effectiveTicks = this.effectiveTickCount;
    return getLpcFrameIndex(LpcAnimationState.Walk, this._direction, effectiveTicks);
  }

  /**
   * The effective frame step after elapsed-time scaling.
   *
   * Suitable for modulus-wrapping against a custom frame count when the
   * spritesheet layout differs from the standard 13-column LPC grid.
   */
  get effectiveTickCount(): number {
    return Math.floor(this._clock.elapsedMs / FRAME_DURATION_MS);
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

  /** Resets all internal state (position tracking, elapsed clock, direction). */
  reset(): void {
    this._direction = LpcDirection.Down;
    this._clock.reset();
    this._lastX = 0;
    this._lastY = 0;
    this._hasLastPosition = false;
    this._idle = true;
    this._consecutiveIdleMs = 0;
  }
}
