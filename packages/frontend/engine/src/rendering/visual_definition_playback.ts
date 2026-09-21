// packages/frontend/engine/src/rendering/visual_definition_playback.ts
//
// Visual-definition playback resolver — the engine's consumer of the shared
// C-496 VisualDefinition and the elapsed-time actor clock.
//
// The renderer never reads provider prompts or generator conventions: given a
// validated VisualDefinition it resolves which frame is visible at an elapsed
// time, following the clip's actor-level fallback chain when a requested clip
// is missing. It is pure (no Pixi), so it is unit-testable and shared by both
// the game and the preview hosts. Hosts swap the resolved frame view; steady
// playback allocates no render objects here.
//
// Contract: C-496 (AC-3, AC-5, AC-6)

import { resolveClipFrameAtTime, totalClipDuration } from '@aikami/lpc';
import type { VisualClip, VisualDefinition, VisualFrame, VisualImage } from '@aikami/schemas';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A resolved playback frame: which clip played (after actor-level fallback),
 * the current frame, its origin, and the source image.
 */
export type ResolvedPlaybackFrame = {
  /** The clip that actually played (post-fallback). */
  clipName: string;
  /** The resolved frame id. */
  frameId: string;
  /** The resolved frame geometry. */
  frame: VisualFrame;
  /** The source image for this frame. */
  image: VisualImage;
};

/**
 * Options for {@link resolveDefinitionFrameAtTime}.
 */
export type ResolveDefinitionFrameOptions = {
  /** A validated visual definition. */
  definition: VisualDefinition;
  /** Requested clip name, e.g. `walk.down` or `slash.east`. */
  clipName: string;
  /** Monotonic elapsed wall-clock time in ms for playback. */
  elapsedMs: number;
  /**
   * Optional injectable clip lookup for testing fallback behavior without a
   * full definition; defaults to looking clips up in `definition.clips`.
   */
  lookupClip?: (name: string) => VisualClip | undefined;
};

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

/**
 * Resolves the frame visible at an elapsed time for a definition, following
 * actor-level clip fallbacks when the requested clip is missing.
 *
 * Fallback follows the clip's declared `fallback` chain (e.g. `slash.down` →
 * `idle.down`), never an independent random per-layer substitution. The walk
 * is cycle-safe and bounded, so a malformed but validated acyclic chain
 * cannot hang.
 *
 * @param options - Resolve options.
 * @returns The resolved playback frame, or `undefined` when no clip resolves.
 */
export const resolveDefinitionFrameAtTime = (
  options: ResolveDefinitionFrameOptions,
): ResolvedPlaybackFrame | undefined => {
  const { definition, clipName, elapsedMs } = options;
  const lookupClip =
    options.lookupClip ??
    ((name: string): VisualClip | undefined =>
      definition.clips.find((entry) => entry.name === name));

  // Resolve the effective clip through the actor-level fallback chain:
  // a missing clip follows its declared fallback (e.g. `slash.down` →
  // `idle.down`), never an independent random per-layer substitution. The
  // walk is visited-set-bounded and cycle-safe.
  const visited = new Set<string>();
  let current = clipName;
  let clip = lookupClip(current);
  while (clip === undefined) {
    if (current === undefined || visited.has(current)) {
      break;
    }
    visited.add(current);
    const declaring = definition.clips.find((c) => c.name === current);
    const fallback = declaring?.fallback;
    if (fallback === undefined) {
      break;
    }
    current = fallback;
    clip = lookupClip(current);
  }

  if (clip === undefined || clip.frames.length === 0) {
    return undefined;
  }

  const frameId = resolveClipFrameAtTime(clip, elapsedMs);
  if (frameId === undefined) {
    return undefined;
  }

  const frame = definition.frames.find((f) => f.id === frameId);
  if (!frame) {
    return undefined;
  }

  const image = definition.images.find((img) => img.id === frame.imageId);
  if (!image) {
    return undefined;
  }

  return { clipName: clip.name, frameId, frame, image };
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Total duration in ms of a clip's active frame set (re-export for hosts).
 */
export { totalClipDuration };

/**
 * Resolves the frame for a *specific* clip occurrence (no fallback), used by
 * hosts that already selected a clip. Delegates to the shared clock resolver.
 */
export const resolveClipFrameId = (clip: VisualClip, elapsedMs: number): string | undefined =>
  resolveClipFrameAtTime(clip, elapsedMs);
