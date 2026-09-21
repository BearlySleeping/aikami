// packages/shared/lpc/src/lib/elapsed_time.ts
//
// Elapsed-time clip playback — the shared actor clock primitive.
//
// C-496: animation playback uses elapsed time, not display refresh count, so
// a variable frame-rate host (60Hz rAF vs 30Hz) advances the same clip at the
// same wall-clock speed. This module is pure: it resolves which frame of a
// clip should be visible at a given elapsed time and never allocates render
// objects, textures or sprites. Hosts feed it a monotonic elapsed time and
// swap the resolved frame view; steady playback therefore allocates nothing.
//
// Contract: C-496

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A clip occurrence used by the elapsed-time resolver.
 */
export type ElapsedClipFrame = {
  /** Frame id within the definition. */
  frameId: string;
  /** Positive hold duration in ms. */
  durationMs: number;
};

/**
 * A clip that can be played by elapsed time.
 */
export type ElapsedClip = {
  /** Ordered frame occurrences. */
  frames: readonly ElapsedClipFrame[];
  /** Whether the clip loops. */
  loop: boolean;
};

// ---------------------------------------------------------------------------
// Duration
// ---------------------------------------------------------------------------

/**
 * Total duration of a clip in ms (sum of its frame durations).
 *
 * Returns 0 when the clip has no frames.
 */
export const totalClipDuration = (clip: ElapsedClip): number =>
  clip.frames.reduce((sum, frame) => sum + frame.durationMs, 0);

// ---------------------------------------------------------------------------
// resolveClipFrameAtTime
// ---------------------------------------------------------------------------

/**
 * Resolves the frame id visible at an elapsed time for a clip.
 *
 * Uses elapsed wall-clock time, not a frame/refresh count. When the clip
 * loops, time wraps by the total duration; when it does not loop, playback
 * clamps to the final frame once the total duration is exceeded.
 *
 * @param clip - The clip to play.
 * @param elapsedMs - Monotonic elapsed time in ms for this clip.
 * @returns The resolved frame id, or `undefined` when the clip is empty.
 */
export const resolveClipFrameAtTime = (
  clip: ElapsedClip,
  elapsedMs: number,
): string | undefined => {
  if (clip.frames.length === 0) {
    return undefined;
  }

  const total = totalClipDuration(clip);
  if (total <= 0) {
    return clip.frames[0].frameId;
  }

  let t = elapsedMs;
  if (clip.loop) {
    t = ((t % total) + total) % total;
  } else if (elapsedMs >= total) {
    return clip.frames[clip.frames.length - 1].frameId;
  }

  let cursor = 0;
  for (const frame of clip.frames) {
    cursor += frame.durationMs;
    if (t < cursor) {
      return frame.frameId;
    }
  }
  return clip.frames[clip.frames.length - 1].frameId;
};

// ---------------------------------------------------------------------------
// ElapsedTimeActor
// ---------------------------------------------------------------------------

/**
 * A per-actor elapsed-time clock that advances a single clip.
 *
 * One actor clock drives all compatible layers (AC-5): instead of each layer
 * sampling its own refresh-count ticker, they all read the same elapsed time
 * from this clock, so layered passes stay in frame-lock. Callers advance the
 * clock by real elapsed milliseconds between frames and resolve the visible
 * frame for every layer from the same value.
 */
export class ElapsedTimeActor {
  private _elapsedMs = 0;

  /**
   * Advances the clock by a positive delta in ms and returns the new value.
   *
   * @param deltaMs - Elapsed wall-clock time since the last call (ms).
   * @returns The updated monotonic elapsed time.
   */
  advance(deltaMs: number): number {
    this._elapsedMs += deltaMs > 0 ? deltaMs : 0;
    return this._elapsedMs;
  }

  /** The current monotonic elapsed time in ms. */
  get elapsedMs(): number {
    return this._elapsedMs;
  }

  /** Resets the clock to zero. */
  reset(): void {
    this._elapsedMs = 0;
  }
}
