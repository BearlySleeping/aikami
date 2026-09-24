// packages/shared/constants/src/lib/media_preparation.ts
//
// C-520: stable identifiers for the versioned image-workflow and media
// preparation layer.
//
// These are *identifiers*, not configuration: a validation code that changes
// text between releases breaks a reviewer's audit trail, and a profile id that
// moves silently invalidates the SHA-256 a pack reference was pinned against.
// Adding an entry is safe; renaming one is a contract change.

// ---------------------------------------------------------------------------
// Processor identity
// ---------------------------------------------------------------------------

/**
 * Identity of the deterministic preparation kernel. Recorded in every
 * `MediaValidationReport` so a prepared hash is always attributable to a
 * processor revision — a later kernel change is a new version, never a silent
 * reinterpretation of an existing hash.
 */
export const DETERMINISTIC_PREPARATION_PROCESSOR = {
  id: 'aikami-deterministic-preparation',
  version: '1.0.0',
  deterministic: true,
} as const;

/** Reported for any run a stochastic model contributed to. */
export const STOCHASTIC_PROCESSOR_MARKER = 'stochastic' as const;

// ---------------------------------------------------------------------------
// Preparation roles
// ---------------------------------------------------------------------------

/** Roles a preparation profile can produce. */
export const PREPARATION_ROLES = [
  'prop-sprite',
  'portrait',
  'sprite-sheet',
  'terrain-atlas-page',
] as const;

export type PreparationRole = (typeof PREPARATION_ROLES)[number];

// ---------------------------------------------------------------------------
// Shipped profile ids
// ---------------------------------------------------------------------------

/**
 * The shipped workflow profiles. The legacy SD-XL profile stays available and
 * selectable; the FLUX.2-klein 4B profile is opt-in (it requires a pinned
 * multi-gigabyte install); the Mystic07 spritesheet profile is deliberately
 * un-dispatchable research evidence.
 */
export const WORKFLOW_PROFILE_IDS = {
  sdxlLegacy: 'sdxl-legacy',
  flux2Klein4b: 'flux2-klein-4b-comfyui',
  mystic07Spritesheet9b: 'mystic07-spritesheet-9b',
} as const;

export type WorkflowProfileId = (typeof WORKFLOW_PROFILE_IDS)[keyof typeof WORKFLOW_PROFILE_IDS];

/** Default profile when a request names none — preserves the pre-C-520 path. */
export const DEFAULT_WORKFLOW_PROFILE_ID: WorkflowProfileId = WORKFLOW_PROFILE_IDS.sdxlLegacy;

/** The shipped preparation profiles. */
export const PREPARATION_PROFILE_IDS = {
  propNativeAlpha: 'prop-native-alpha',
  propFullAlphaGround: 'prop-full-alpha-ground',
  /**
   * The luminance-matte path for engines that emit RGB only (the local
   * sd.cpp/Anima pipeline): the prop is rendered on a uniform near-black
   * ground and alpha is derived from luminance. Restores the pre-5.0.0
   * extraction path for prop jobs that need it.
   */
  propLuminanceAlphaGround: 'prop-luminance-alpha-ground',
  portraitOriginal: 'portrait-original',
  lpcSheetNative: 'lpc-sheet-native',
} as const;

export type PreparationProfileId =
  (typeof PREPARATION_PROFILE_IDS)[keyof typeof PREPARATION_PROFILE_IDS];

// ---------------------------------------------------------------------------
// Validation codes
// ---------------------------------------------------------------------------

/**
 * Machine-checkable QA codes. A rejection reason is always one of these, so a
 * caller can branch on it and a reviewer can diff it release to release.
 */
export const MEDIA_VALIDATION_CODES = {
  /** Alpha channel is absent or fully opaque where transparency is required. */
  alphaRequired: 'alpha-required',
  /** An opaque axis-aligned rectangle spans the canvas: an unextracted ground. */
  groundRectangleDetected: 'ground-rectangle-detected',
  /** A ground plane was present but never detached into an isolated prop. */
  groundPlaneNotDetached: 'ground-plane-not-detached',
  /** Partial-alpha pixels line the silhouette: a fringe/checkerboard extraction. */
  alphaFringeRatioExceeded: 'alpha-fringe-ratio-exceeded',
  /** Opaque content touches the canvas edge: the sprite is clipped. */
  clippedContent: 'clipped-content',
  /** No opaque pixel on the ground-contact row. */
  groundContactMissing: 'ground-contact-missing',
  /** The longest opaque run is shorter than the native-scale readability floor. */
  nativeScaleUnreadable: 'native-scale-unreadable',
  /** Nearest-neighbour resampling produced new colours — a blend happened. */
  resampleBlended: 'resample-blended',
  /** Width and height were stretched independently. */
  aspectRatioStretched: 'aspect-ratio-stretched',
  /** Two preparation runs of the same input produced different bytes. */
  nonDeterministicOutput: 'non-deterministic-output',
  /** The prepared artifact declares a format its bytes do not carry. */
  formatMismatch: 'format-mismatch',
} as const;

export type MediaValidationCode =
  (typeof MEDIA_VALIDATION_CODES)[keyof typeof MEDIA_VALIDATION_CODES];

/** Codes that always require a human to look, even at `info`/`warning` level. */
export const MANUAL_REVIEW_CODES: readonly MediaValidationCode[] = [
  MEDIA_VALIDATION_CODES.groundPlaneNotDetached,
  MEDIA_VALIDATION_CODES.alphaFringeRatioExceeded,
  MEDIA_VALIDATION_CODES.resampleBlended,
];

// ---------------------------------------------------------------------------
// Workflow validation codes
// ---------------------------------------------------------------------------

/** Reasons a compiled workflow is refused before any HTTP submission. */
export const WORKFLOW_VALIDATION_CODES = {
  /** The template names a node class the installed ComfyUI does not expose. */
  unknownNodeClass: 'unknown-node-class',
  /** A required node input is absent from the compiled graph. */
  missingRequiredInput: 'missing-required-input',
  /** A required, pinned weight artifact is not installed. */
  missingDependency: 'missing-dependency',
  /** A pinned dependency's installed bytes do not match its recorded hash. */
  dependencyChecksumMismatch: 'dependency-checksum-mismatch',
  /** A required semantic input was not supplied. */
  missingSemanticInput: 'missing-semantic-input',
  /** A LoRA was requested outside the profile's allowlist. */
  unsupportedLora: 'unsupported-lora',
  /** A LoRA's model family does not match the profile's base family. */
  loraFamilyMismatch: 'lora-family-mismatch',
  /** The request asked for a capability the profile does not prove. */
  unsupportedCapability: 'unsupported-capability',
  /** The selected profile is not dispatchable at all. */
  profileNotDispatchable: 'profile-not-dispatchable',
  /** A semantic input's payload exceeded the profile's declared bound. */
  payloadTooLarge: 'payload-too-large',
  /** The stored template no longer matches the profile's pinned hash. */
  templateHashMismatch: 'template-hash-mismatch',
} as const;

export type WorkflowValidationCode =
  (typeof WORKFLOW_VALIDATION_CODES)[keyof typeof WORKFLOW_VALIDATION_CODES];

// ---------------------------------------------------------------------------
// Sprite-sheet (LPC) QA codes
// ---------------------------------------------------------------------------

/**
 * Codes for judging a generated sheet as *animation*. Read against the real
 * LPC constants in `@aikami/lpc`, never against a hand-rolled copy of the
 * layout.
 */
export const SPRITE_SHEET_CODES = {
  /** The sheet's pixel grid is not an exact multiple of the LPC cell pitch. */
  invalidCellGrid: 'invalid-cell-grid',
  /** A state block is missing one or more of its four facing rows. */
  missingDirection: 'missing-direction',
  /** A row does not carry the state's required frame count. */
  wrongFrameCount: 'wrong-frame-count',
  /** Two frames in one row are byte-identical: a duplicated frame. */
  duplicateFrame: 'duplicate-frame',
  /** An entirely empty frame sits inside a state row. */
  emptyFrame: 'empty-frame',
  /** The opaque footprint moves between frames: drifting feet. */
  driftingFeet: 'drifting-feet',
  /** The body's opaque bounding box changes size across a state's frames. */
  inconsistentBodySize: 'inconsistent-body-size',
  /** A frame touches a cell edge: cut-off equipment or a clipped sprite. */
  clippedFrame: 'clipped-frame',
  /** Facing order is not up/left/down/right as the runtime expects. */
  wrongFacingOrder: 'wrong-facing-order',
  /** A single still cannot establish temporal coherence — always review. */
  animationReviewRequired: 'animation-review-required',
} as const;

export type SpriteSheetCode = (typeof SPRITE_SHEET_CODES)[keyof typeof SPRITE_SHEET_CODES];

// ---------------------------------------------------------------------------
// Atlas capacity
// ---------------------------------------------------------------------------

/** Codes for pack/atlas compilation. */
export const ATLAS_VALIDATION_CODES = {
  /** A frame is larger than the page budget on at least one axis. */
  frameExceedsPage: 'frame-exceeds-page',
  /** The packed pages exceed the declared capacity. */
  capacityOverflow: 'capacity-overflow',
  /** Two frames in one namespace share a name. */
  duplicateFrameName: 'duplicate-frame-name',
  /** A referenced frame name is absent from every page. */
  missingFrame: 'missing-frame',
  /** A frame's packed bounds fall outside its page. */
  frameOutOfPageBounds: 'frame-out-of-page-bounds',
  /** The page padding/extrusion does not match the profile. */
  invalidPadding: 'invalid-padding',
} as const;

export type AtlasValidationCode =
  (typeof ATLAS_VALIDATION_CODES)[keyof typeof ATLAS_VALIDATION_CODES];

/** The explicit terrain-cell capacity of the shipped Emberwatch grid atlas. */
export const EMBERWATCH_TERRAIN_ATLAS_CAPACITY = {
  columns: 16,
  rows: 11,
  /** 176 cells; one frame remains free after the C-553 palette append. */
  cells: 176,
} as const;
