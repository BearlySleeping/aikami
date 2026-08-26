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
  LpcAnimationState,
  LpcDirection,
  velocityToDirection,
  getLpcFrameIndex,
  getLpcStateRow,
} from '@aikami/lpc';

// Re-export moved symbols for backward compatibility with engine-internal imports.
export {
  getLpcFrameIndex,
  getLpcStateRow,
  LpcAnimationState,
  LpcDirection,
  velocityToDirection,
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
 * Consecutive zero-delta frames tolerated before the entity is considered
 * idle (C-378).
 *
 * The main-thread ticker (~16.7ms rAF) reads positions from the worker's
 * render-view buffer, which updates on a setTimeout(16) loop that drifts
 * to 20-30ms under load. A single stale read therefore produces a
 * zero-delta frame while the entity is still moving. Without a grace
 * period the controller resets its tick counter on every such frame and
 * the walk cycle never advances past frame 0 — the sprite slides with no
 * walking animation. A ~100ms grace (≈6 frames) absorbs the jitter while
 * keeping the idle→frame-0 lock responsive when the player really stops.
 */
const IDLE_GRACE_FRAMES = 6;

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

  /** Consecutive zero-delta frames — resets on any movement frame. */
  private _consecutiveIdleFrames = 0;

  /**
   * Updates the animation state machine with the entity's current
   * world-space position.
   *
   * On the first call, records the position and returns frame 0 for the
   * default direction (Down). On subsequent calls, computes the delta
   * from the last position to determine movement and facing direction.
   *
   * Zero-delta frames are treated as "no new data" (stale render-view
   * read) rather than instant idle: the walk cycle keeps advancing as
   * long as the entity was moving within the last
   * {@link IDLE_GRACE_FRAMES} frames. Only a sustained zero-delta run
   * (≥ IDLE_GRACE_FRAMES) locks the sprite to the idle frame (C-378).
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
      this._consecutiveIdleFrames = 0;
      this._direction = velocityToDirection(dx, dy);
      this._idle = false;
      this._tickCount += 1;
    } else {
      this._consecutiveIdleFrames += 1;
      if (this._consecutiveIdleFrames >= IDLE_GRACE_FRAMES && !this._idle) {
        // Sustained zero-delta — genuinely stopped. Lock to frame 0.
        this._idle = true;
        this._tickCount = 0;
      }
    }
    // While moving (or within the grace window), tickCount keeps
    // accumulating so the walk cycle advances across stale reads.

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
    this._consecutiveIdleFrames = 0;
  }
}
