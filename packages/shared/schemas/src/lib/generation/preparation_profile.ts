// packages/shared/schemas/src/lib/generation/preparation_profile.ts
//
// Versioned, deterministic media-preparation profiles (C-520).
//
// The recipe registry refuses any non-empty `output.postprocess`, because
// "transparent-friendly" and "loopable" are prompt words — not guarantees.
// This module is the missing deterministic half: a preparation profile names
// the exact ordered transformation set, pins the resample method and the
// encode format, and fixes the QA limits a prepared artifact is judged
// against.
//
// Determinism is the point: the same raw bytes plus the same profile version
// must produce the same prepared bytes, so the prepared SHA-256 is a stable
// identity that a pack reference can rely on.
//
// Contract: C-520 Versioned image workflows and asset preparation

import { type Static, Type } from 'typebox';

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

/**
 * Resampling methods. The method is pinned per approved profile — pixel-art
 * needs nearest-neighbour, an oversized painted source needs a reviewed
 * downsample. "Whatever the browser/image library defaults to" is not a
 * method.
 */
export const ResampleMethodSchema = Type.Union([
  Type.Literal('nearest-neighbor', { description: 'True pixel clusters — never blends' }),
  Type.Literal('box-average', {
    description: 'Deterministic area-average downsample for oversized painted sources',
  }),
]);

export type ResampleMethod = Static<typeof ResampleMethodSchema>;

/** Alpha source. A stochastic segmentation model is recorded as its own step. */
export const AlphaExtractModeSchema = Type.Union([
  Type.Literal('threshold', { description: 'Deterministic luminance/colour cut' }),
  Type.Literal('luminance', { description: 'Deterministic luminance ramp' }),
]);

export type AlphaExtractMode = Static<typeof AlphaExtractModeSchema>;

/** How a coloured backdrop fringe is suppressed. Colour keying alone is banned. */
export const AlphaDespillSchema = Type.Union([
  Type.Literal('none'),
  Type.Literal('green'),
  Type.Literal('magenta'),
]);

export type AlphaDespill = Static<typeof AlphaDespillSchema>;

/** Decode + EXIF-orient, producing a straight RGBA surface. */
export const DecodeOrientOperationSchema = Type.Object({
  op: Type.Literal('decode-orient'),
  autoOrient: Type.Boolean(),
});

/** Deliberate resample with a locked method and locked aspect ratio. */
export const ResampleOperationSchema = Type.Object({
  op: Type.Literal('resample'),
  method: ResampleMethodSchema,
  targetWidth: Type.Integer({ minimum: 1 }),
  targetHeight: Type.Integer({ minimum: 1 }),
  /**
   * When true the aspect ratio is preserved and the output is the largest box
   * that fits inside `targetWidth × targetHeight`; width and height are never
   * stretched independently.
   */
  lockAspectRatio: Type.Boolean(),
});

/** Alpha extraction. `detachGroundPlane` separates a full-alpha ground. */
export const AlphaExtractOperationSchema = Type.Object({
  op: Type.Literal('alpha-extract'),
  mode: AlphaExtractModeSchema,
  /** 0–255 cut/ramp floor for the deterministic modes. */
  threshold: Type.Integer({ minimum: 0, maximum: 255 }),
  despill: AlphaDespillSchema,
  /**
   * True when the source is a full-alpha ground render that must be separated
   * into an isolated transparent prop. Never remove an opaque backdrop by
   * colour key alone.
   */
  detachGroundPlane: Type.Boolean(),
});

/** Deterministic fringe/matte cleanup after extraction. */
export const AlphaCleanupOperationSchema = Type.Object({
  op: Type.Literal('alpha-cleanup'),
  /** Boundary pixels below this alpha are pulled fully transparent. */
  fringeThreshold: Type.Integer({ minimum: 0, maximum: 255 }),
  /** Pixels above this alpha are pulled fully opaque (matte hardening). */
  matteThreshold: Type.Integer({ minimum: 0, maximum: 255 }),
  /**
   * Reject a surviving axis-aligned opaque block that spans the canvas — the
   * signature of an unextracted ground plane.
   */
  removeGroundRectangle: Type.Boolean(),
});

/** Crop to content while preserving a ground-contact origin. */
export const TrimOperationSchema = Type.Object({
  op: Type.Literal('trim'),
  /**
   * When true the anchor is the bottom-most opaque row and horizontal centre of
   * the content, so a state swap keeps the feet on the same pixel.
   */
  preserveGroundContact: Type.Boolean(),
  /** Transparent margin kept around the trimmed content. */
  paddingPx: Type.Integer({ minimum: 0 }),
});

/** Frame packing with padding and edge extrusion. */
export const PackOperationSchema = Type.Object({
  op: Type.Literal('pack'),
  paddingPx: Type.Integer({ minimum: 0 }),
  /** Edge pixels duplicated outward, preventing bleed between frames. */
  extrudePx: Type.Integer({ minimum: 0 }),
  /** Hard texture-size budget per page, per axis. */
  maxPageSize: Type.Integer({ minimum: 1 }),
});

/** Final encode. Lossless only — never rename PNG bytes to `.webp`. */
export const EncodeOperationSchema = Type.Object({
  op: Type.Literal('encode'),
  format: Type.Union([Type.Literal('png'), Type.Literal('webp-lossless')]),
});

/** One ordered preparation step. */
export const PreparationOperationSchema = Type.Union([
  DecodeOrientOperationSchema,
  ResampleOperationSchema,
  AlphaExtractOperationSchema,
  AlphaCleanupOperationSchema,
  TrimOperationSchema,
  PackOperationSchema,
  EncodeOperationSchema,
]);

export type PreparationOperation = Static<typeof PreparationOperationSchema>;
export type DecodeOrientOperation = Static<typeof DecodeOrientOperationSchema>;
export type ResampleOperation = Static<typeof ResampleOperationSchema>;
export type AlphaExtractOperation = Static<typeof AlphaExtractOperationSchema>;
export type AlphaCleanupOperation = Static<typeof AlphaCleanupOperationSchema>;
export type TrimOperation = Static<typeof TrimOperationSchema>;
export type PackOperation = Static<typeof PackOperationSchema>;
export type EncodeOperation = Static<typeof EncodeOperationSchema>;

// ---------------------------------------------------------------------------
// QA limits
// ---------------------------------------------------------------------------

/** Machine-checkable review limits a prepared artifact is judged against. */
export const PreparationQaLimitsSchema = Type.Object({
  /** The artifact must have at least one opaque pixel on its ground-contact row. */
  requireGroundContact: Type.Boolean,
  /**
   * Maximum share (0–1) of boundary-adjacent pixels allowed to carry partial
   * alpha. A checkerboard/colour-key extraction leaves a high ratio.
   */
  maxAlphaFringeRatio: Type.Number({ minimum: 0, maximum: 1 }),
  /** No opaque content may touch the canvas edge (clipped content). */
  forbidClippedContent: Type.Boolean,
  /**
   * Minimum opaque run length, in pixels, for the artifact to be judged
   * readable at native 1×. Guards against a downscale that erases features.
   */
  minNativeScaleFeaturePx: Type.Integer({ minimum: 1 }),
  /**
   * QA codes that always escalate to human review, even when every machine
   * check passes — geometry alone does not prove temporal or visual coherence.
   */
  manualReviewCodes: Type.Array(Type.String({ minLength: 1 })),
});

export type PreparationQaLimits = Static<typeof PreparationQaLimitsSchema>;

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

/** A pinned, versioned preparation profile. */
export const PreparationProfileSchema = Type.Object({
  id: Type.String({ pattern: '^[a-z0-9][a-z0-9-]*$' }),
  version: Type.String({ pattern: '^[0-9]+\\.[0-9]+\\.[0-9]+$' }),
  /**
   * `pixel-art` profiles must resample with nearest-neighbour; a `native`
   * profile is an already authoring-scale source. The registry enforces this.
   */
  pixelGrid: Type.Union([Type.Literal('pixel-art'), Type.Literal('native')]),
  /** Ordered operations. Order is part of the profile identity. */
  operations: Type.Array(PreparationOperationSchema, { minItems: 1 }),
  qa: PreparationQaLimitsSchema,
  /** Which artifact role this profile produces. */
  role: Type.Union([
    Type.Literal('prop-sprite'),
    Type.Literal('portrait'),
    Type.Literal('sprite-sheet'),
    Type.Literal('terrain-atlas-page'),
  ]),
  notes: Type.Optional(Type.String({ minLength: 1 })),
});

export type PreparationProfile = Static<typeof PreparationProfileSchema>;

export const PreparationProfileListSchema = Type.Array(PreparationProfileSchema);
