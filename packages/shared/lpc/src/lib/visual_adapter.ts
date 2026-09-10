// packages/shared/lpc/src/lib/visual_adapter.ts
//
// LPC → shared VisualDefinition adapter.
//
// C-496: providers compile into the shared visual definition ONCE at
// import/normalization; the renderer consumes validated data, never provider
// prompts or generator-specific conventions. This adapter emits explicit
// metadata (frames, clips, timing, origins, fallbacks) for an LPC sheet
// rather than letting the renderer guess geometry from image dimensions.
//
// Dimension heuristics remain ONLY in resolveLpcSheetGeometry (a labeled
// legacy adapter); this module treats its result as the reviewed layout and
// never re-detects format. Upstream-derived compatibility mappings must be
// committed as reviewed data (never read from the gitignored `examples/**`).
//
// Contract: C-496

import {
  FRAMES_PER_STATE,
  getLpcStateRow,
  LPC_STATE_NAMES,
  LpcAnimationState,
  LpcDirection,
} from './animation.ts';
import type { LpcSheetGeometry } from './sheet_geometry.ts';

// ---------------------------------------------------------------------------
// Direction names
// ---------------------------------------------------------------------------

/**
 * Direction names keyed by {@link LpcDirection} row offset.
 */
const DIRECTION_NAMES: Record<LpcDirection, string> = {
  [LpcDirection.Up]: 'up',
  [LpcDirection.Left]: 'left',
  [LpcDirection.Down]: 'down',
  [LpcDirection.Right]: 'right',
} as const;

/** The directions that have a per-row block in a full LPC sheet. */
const BLOCKED_DIRECTIONS: readonly LpcDirection[] = [
  LpcDirection.Up,
  LpcDirection.Left,
  LpcDirection.Down,
  LpcDirection.Right,
];

/**
 * Actor-level fallback for a state name.
 *
 * A missing action follows this explicit actor-level fallback, never an
 * independent random per-layer substitution. `idle` falls back to `walk`
 * (LPC idle is the first walk frame); `die` falls back to a neutral idle.
 */
const STATE_FALLBACKS: Record<string, string> = {
  spellcast: 'idle',
  thrust: 'idle',
  slash: 'idle',
  shoot: 'idle',
  die: 'idle.down',
  idle: 'walk',
} as const;

/** Default hold duration per frame in ms (playback timing). */
const DEFAULT_FRAME_DURATION_MS = 120;

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

/**
 * Options for {@link compileLpcSpriteToVisualDefinition}.
 */
export type CompileLpcSpriteOptions = {
  /** Stable asset id, e.g. `hero` or `weapon/sword/longsword`. */
  assetId: string;
  /** Reviewed LPC sheet geometry (from resolveLpcSheetGeometry). */
  geometry: LpcSheetGeometry;
  /** Content-hash revision of the definition. */
  revision: string;
  /** Original source (e.g. `Universal-LPC-Spritesheet`). */
  source: string;
  /** License/attribution strings held verbatim. */
  licenses: readonly string[];
  /** Optional generator provenance label. */
  generator?: string;
  /** Per-frame hold duration in ms. */
  frameDurationMs?: number;
  /** The single image width in pixels. */
  imageWidth: number;
  /** The single image height in pixels. */
  imageHeight: number;
  /** Immutable artifact reference for the sheet image. */
  artifactRef: string;
};

/**
 * Compiles an LPC spritesheet into a shared {@link VisualDefinition}.
 *
 * Produces a `complete_sprite` definition with one image, per-state frames,
 * and clips named `<state>.<direction>` (e.g. `walk.east`, `die`). Frames
 * carry explicit origins (the sheet's anchor offset) and trim metadata so
 * game and preview render identically without re-deriving layout.
 *
 * @param options - Compilation options.
 * @returns A valid `complete_sprite` visual definition.
 */
export const compileLpcSpriteToVisualDefinition = (
  options: CompileLpcSpriteOptions,
): CompleteSpriteDefinitionShape => {
  const {
    assetId,
    geometry,
    revision,
    source,
    licenses,
    generator,
    frameDurationMs = DEFAULT_FRAME_DURATION_MS,
    imageWidth,
    imageHeight,
    artifactRef,
  } = options;

  const pitch = geometry.pitch;

  // One frame per (state, direction, column). The LPC sheet stacks states
  // vertically (4 rows per state block; die is a single row).
  const frames: VisualFrameShape[] = [];
  const clips: VisualClipShape[] = [];

  const statesWithDirections: readonly LpcAnimationState[] = [
    LpcAnimationState.Spellcast,
    LpcAnimationState.Thrust,
    LpcAnimationState.Walk,
    LpcAnimationState.Slash,
    LpcAnimationState.Shoot,
    LpcAnimationState.Die,
  ];

  // Emit explicit idle.<dir> clips (single frame = walk frame 0) so every
  // actor-level fallback resolves to a real clip. LPC has no idle row; the
  // idle pose is the first frame of the walk row for that direction.
  for (const direction of BLOCKED_DIRECTIONS) {
    const directionName = DIRECTION_NAMES[direction];
    const row = getLpcStateRow(LpcAnimationState.Walk, direction);
    const frameId = `idle.${directionName}.0`;
    frames.push(makeFrame(frameId, 0, row, pitch, geometry));
    clips.push({
      name: `idle.${directionName}`,
      frames: [{ frameId, durationMs: frameDurationMs }],
      loop: true,
      fallback: `walk.${directionName}`,
    });
  }

  for (const state of statesWithDirections) {
    const stateName = LPC_STATE_NAMES[state];
    const frameCount = FRAMES_PER_STATE[state];

    if (state === LpcAnimationState.Die) {
      // Single row — one clip with no direction suffix.
      const row = getLpcStateRow(state, LpcDirection.Down);
      const clipFrames: VisualClipFrameShape[] = [];
      for (let col = 0; col < frameCount; col++) {
        const frameId = `die.${col}`;
        frames.push(makeFrame(frameId, col, row, pitch, geometry));
        clipFrames.push({ frameId, durationMs: frameDurationMs });
      }
      clips.push({
        name: 'die',
        frames: clipFrames,
        loop: false,
        fallback: STATE_FALLBACKS[stateName],
      });
      continue;
    }

    for (const direction of BLOCKED_DIRECTIONS) {
      const directionName = DIRECTION_NAMES[direction];
      const row = getLpcStateRow(state, direction);
      const clipFrames: VisualClipFrameShape[] = [];
      for (let col = 0; col < frameCount; col++) {
        const frameId = `${stateName}.${directionName}.${col}`;
        frames.push(makeFrame(frameId, col, row, pitch, geometry));
        clipFrames.push({ frameId, durationMs: frameDurationMs });
      }
      const isWalk = stateName === 'walk';
      clips.push({
        name: `${stateName}.${directionName}`,
        frames: clipFrames,
        loop: isWalk,
        // Direction-preserving actor-level fallback: `slash.down` falls
        // back to `idle.down`, never to an arbitrary direction.
        fallback: isWalk ? undefined : `${STATE_FALLBACKS[stateName]}.${directionName}`,
      });
    }
  }

  return {
    kind: 'complete_sprite',
    identity: {
      schemaVersion: 'visual.definition.1',
      id: assetId,
      revision,
    },
    images: [
      {
        id: 'sheet',
        artifactRef,
        width: imageWidth,
        height: imageHeight,
        colorEncoding: 'rgba',
        alpha: true,
      },
    ],
    frames,
    clips,
    presentation: {
      pixelDensity: geometry.scale,
      sampling: 'nearest',
      colorOperation: 'none',
    },
    provenance: {
      source,
      licenses: [...licenses],
      ...(generator ? { generator } : {}),
    },
    defaultClip: 'walk.down',
  };
};

/**
 * Builds a single frame rectangle for a cell at (col, row) in a pitch grid.
 */
const makeFrame = (
  frameId: string,
  col: number,
  row: number,
  pitch: number,
  geometry: LpcSheetGeometry,
): VisualFrameShape => ({
  id: frameId,
  imageId: 'sheet',
  x: col * pitch,
  y: row * pitch,
  width: pitch,
  height: pitch,
  logicalWidth: 64,
  logicalHeight: 64,
  trimX: 0,
  trimY: 0,
  originX: geometry.anchorOffset.x,
  originY: geometry.anchorOffset.y,
});

// ---------------------------------------------------------------------------
// Local shape types (kept local so the adapter does not re-export schema
// internals; the returned value conforms to VisualDefinitionSchema).
// ---------------------------------------------------------------------------

type CompleteSpriteDefinitionShape = {
  kind: 'complete_sprite';
  identity: {
    schemaVersion: 'visual.definition.1';
    id: string;
    revision: string;
  };
  images: readonly VisualImageShape[];
  frames: readonly VisualFrameShape[];
  clips: readonly VisualClipShape[];
  presentation: {
    pixelDensity: number;
    sampling: 'nearest' | 'linear';
    colorOperation: 'none' | 'multiply_tint';
  };
  provenance: {
    source: string;
    licenses: readonly string[];
    generator?: string;
  };
  defaultClip: string;
};

type VisualImageShape = {
  id: string;
  artifactRef: string;
  width: number;
  height: number;
  colorEncoding: 'rgba' | 'palette_indexed';
  alpha: boolean;
};

type VisualFrameShape = {
  id: string;
  imageId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  logicalWidth: number;
  logicalHeight: number;
  trimX: number;
  trimY: number;
  originX: number;
  originY: number;
};

type VisualClipFrameShape = {
  frameId: string;
  durationMs: number;
};

type VisualClipShape = {
  name: string;
  frames: readonly VisualClipFrameShape[];
  loop: boolean;
  fallback?: string;
};
