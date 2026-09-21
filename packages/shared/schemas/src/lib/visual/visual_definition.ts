// packages/shared/schemas/src/lib/visual/visual_definition.ts
//
// Versioned visual definition — the single source of truth that determines
// an asset's frames, timing, origin and supported color behavior.
//
// C-496 introduces this as the common wire format that the game renderer and
// the Hub/client previews both consume. Providers (LPC, generic atlases,
// static props) compile into this validated definition once at
// import/normalization; the renderer never reads provider prompts or
// generator-specific conventions.
//
// The type is strict (`additionalProperties: false`) so a definition cannot
// smuggle undocumented fields onto the wire, and every reference (image,
// frame, clip fallback) is structurally resolvable or the definition is
// rejected before publication/allocation.
//
// Contract: C-496

import { type Static, Type } from 'typebox';
import { Value } from 'typebox/value';

// ---------------------------------------------------------------------------
// Version
// ---------------------------------------------------------------------------

/**
 * The current schema version for a visual definition.
 *
 * Bumped only on a breaking wire-format change. A higher `schemaVersion`
 * than the consumer understands is rejected (capability gating), never
 * silently misrendered.
 */
export const VISUAL_DEFINITION_SCHEMA_VERSION = 'visual.definition.1' as const;

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/**
 * Discriminated `kind` of a visual definition.
 *
 * - `complete_sprite` — a self-contained animated sprite (e.g. a generic
 *   atlas character or static prop).
 * - `component` — a modular part that must be combined with a rig/body
 *   (e.g. an LPC hat or shield layer); carries rig/body/pose compatibility
 *   and stable pass ordering.
 * - `tileset` — a tile/prop atlas consumed via the existing tileset fields.
 *
 * The discriminated union keeps domain payloads distinct: tile matching and
 * equipment occupancy are not properties of every image.
 */
export const VisualKindSchema = Type.Union(
  [Type.Literal('complete_sprite'), Type.Literal('component'), Type.Literal('tileset')],
  { description: 'Discriminated kind of a visual definition.' },
);

export type VisualKind = Static<typeof VisualKindSchema>;

/**
 * Stable identity for a visual definition.
 *
 * `revision` is a content hash of the definition bytes (outside the hashed
 * bytes themselves) so an unchanged id can point at a changed revision.
 */
export const VisualIdentitySchema = Type.Object(
  {
    schemaVersion: Type.Literal(VISUAL_DEFINITION_SCHEMA_VERSION),
    /** Stable, human-readable asset id (e.g. `weapon/sword/longsword`). */
    id: Type.String({ minLength: 1 }),
    /** Content hash of the definition, pinned by pack/release locks. */
    revision: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export type VisualIdentity = Static<typeof VisualIdentitySchema>;

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

/**
 * Supported color encodings.
 *
 * V1 supports original RGBA plus an explicit multiplicative tint
 * (`colorOperation: 'multiply_tint'`). Indexed/masked palette rendering is
 * deferred: a definition carrying `palette_indexed` is rejected for playback
 * with a diagnostic rather than pretending tint is palette replacement.
 */
export const VisualColorEncodingSchema = Type.Union(
  [Type.Literal('rgba'), Type.Literal('palette_indexed')],
  { description: 'Pixel color encoding of an image.' },
);

export type VisualColorEncoding = Static<typeof VisualColorEncodingSchema>;

/** Upper bound on image dimensions (finite/bounded, anti-DoS). */
export const VISUAL_MAX_DIMENSION = 16384;

/** Upper bound on the number of frames in one definition (bounded). */
export const VISUAL_MAX_FRAMES = 4096;

/**
 * One immutable source image referenced by frames.
 *
 * `artifactRef` is an immutable, content-addressed reference to the decoded
 * bytes; never a mutable browse path or an arbitrary URL.
 */
export const VisualImageSchema = Type.Object(
  {
    /** Stable image id, referenced by frames via `imageId`. */
    id: Type.String({ minLength: 1 }),
    /** Immutable artifact reference (content-addressed). */
    artifactRef: Type.String({ minLength: 1 }),
    /** Image width in pixels (bounded). */
    width: Type.Integer({ minimum: 1, maximum: VISUAL_MAX_DIMENSION }),
    /** Image height in pixels (bounded). */
    height: Type.Integer({ minimum: 1, maximum: VISUAL_MAX_DIMENSION }),
    /** Pixel color encoding. */
    colorEncoding: VisualColorEncodingSchema,
    /** Whether the image carries real alpha. */
    alpha: Type.Boolean(),
  },
  { additionalProperties: false },
);

export type VisualImage = Static<typeof VisualImageSchema>;

// ---------------------------------------------------------------------------
// Frames
// ---------------------------------------------------------------------------

/**
 * A single frame rectangle inside an image.
 *
 * Frame rectangles are half-open and expressed in image pixels.
 * `logicalWidth/logicalHeight` are the untrimmed logical size; `trimX/trimY`
 * and `originX/originY` are in the untrimmed logical coordinate system.
 * Origins/trim offsets use the untrimmed logical space, so repacking an
 * atlas cannot change logical frame identity or reskin a save.
 */
export const VisualFrameSchema = Type.Object(
  {
    /** Unique frame id, referenced by clips. */
    id: Type.String({ minLength: 1 }),
    /** Image this frame slices from. */
    imageId: Type.String({ minLength: 1 }),
    /** Left edge in image pixels (inclusive, half-open). */
    x: Type.Integer({ minimum: 0 }),
    /** Top edge in image pixels (inclusive, half-open). */
    y: Type.Integer({ minimum: 0 }),
    /** Frame width in image pixels (>=1). */
    width: Type.Integer({ minimum: 1, maximum: VISUAL_MAX_DIMENSION }),
    /** Frame height in image pixels (>=1). */
    height: Type.Integer({ minimum: 1, maximum: VISUAL_MAX_DIMENSION }),
    /** Untrimmed logical width. */
    logicalWidth: Type.Integer({ minimum: 1, maximum: VISUAL_MAX_DIMENSION }),
    /** Untrimmed logical height. */
    logicalHeight: Type.Integer({ minimum: 1, maximum: VISUAL_MAX_DIMENSION }),
    /** Horizontal trim offset in the untrimmed logical space. */
    trimX: Type.Integer(),
    /** Vertical trim offset in the untrimmed logical space. */
    trimY: Type.Integer(),
    /** Pixel-space origin X (anchor), in the untrimmed logical space. */
    originX: Type.Integer(),
    /** Pixel-space origin Y (anchor), in the untrimmed logical space. */
    originY: Type.Integer(),
  },
  { additionalProperties: false },
);

export type VisualFrame = Static<typeof VisualFrameSchema>;

// ---------------------------------------------------------------------------
// Clips
// ---------------------------------------------------------------------------

/**
 * A clip occurrence — one frame plus its positive hold duration in ms.
 */
export const VisualClipFrameSchema = Type.Object(
  {
    /** Frame id within this definition. */
    frameId: Type.String({ minLength: 1 }),
    /** Positive duration this frame is held, in ms. */
    durationMs: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);

export type VisualClipFrame = Static<typeof VisualClipFrameSchema>;

/**
 * A named animation clip, e.g. `walk.east`.
 *
 * `fallback` names another clip in the same definition to use when this
 * clip is missing from a host's capabilities. Fallbacks must be acyclic.
 */
export const VisualClipSchema = Type.Object(
  {
    /** Unique clip name such as `walk.east` or `idle`. */
    name: Type.String({ minLength: 1 }),
    /** Ordered frame occurrences. */
    frames: Type.Array(VisualClipFrameSchema, {
      minItems: 1,
      maxItems: VISUAL_MAX_FRAMES,
    }),
    /** Whether the clip loops. */
    loop: Type.Boolean(),
    /** Optional fallback clip name; must be acyclic and resolvable. */
    fallback: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);

export type VisualClip = Static<typeof VisualClipSchema>;

// ---------------------------------------------------------------------------
// Components (modular parts)
// ---------------------------------------------------------------------------

/**
 * One stable render pass of a component.
 *
 * A single selectable component may emit several stable passes (e.g. a
 * rear `behind` pass and a front pass). `depth` and `order` provide
 * deterministic ordering/visibility independent of async load order or
 * catalog-array position.
 */
export const VisualComponentPassSchema = Type.Object(
  {
    /** Stable pass id (e.g. `behind`, `front`). */
    passId: Type.String({ minLength: 1 }),
    /** Clip this pass plays. */
    clipName: Type.String({ minLength: 1 }),
    /** Relative depth for composition (larger = closer to camera). */
    depth: Type.Integer(),
    /** Whether this pass is visible by default. */
    visible: Type.Boolean(),
  },
  { additionalProperties: false },
);

export type VisualComponentPass = Static<typeof VisualComponentPassSchema>;

/**
 * A modular component with declared rig/body/pose compatibility.
 *
 * Invalid combinations (a component whose rig/body/pose profile does not
 * match the host) are rejected with actionable diagnostics, never silently
 * substituted per-layer.
 */
export const VisualComponentSchema = Type.Object(
  {
    /** Stable component id (e.g. `hat/magic/celestial_adult`). */
    id: Type.String({ minLength: 1 }),
    /** Compatible rig profile id. */
    rigProfile: Type.String({ minLength: 1 }),
    /** Compatible body profile id. */
    bodyProfile: Type.String({ minLength: 1 }),
    /** Compatible pose profile id (shared clock/timing profile). */
    poseProfile: Type.String({ minLength: 1 }),
    /** Stable render passes in deterministic order. */
    passes: Type.Array(VisualComponentPassSchema, { minItems: 1 }),
    /** Deterministic composition order (ties resolved by this value). */
    order: Type.Integer(),
  },
  { additionalProperties: false },
);

export type VisualComponent = Static<typeof VisualComponentSchema>;

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

/**
 * Presentation policy for the definition.
 *
 * `colorOperation` is the only explicitly supported color operation in V1:
 * `multiply_tint` (RGBA with multiplicative tint) or `none`. Material/color
 * tags are discovery metadata, never implicit dye instructions.
 */
export const VisualPresentationSchema = Type.Object(
  {
    /** Pixel density relative to a 1× logical unit (1 = 64px cell). */
    pixelDensity: Type.Number({ minimum: 0 }),
    /** Texture sampling policy. */
    sampling: Type.Union([Type.Literal('nearest'), Type.Literal('linear')]),
    /** Explicitly supported color operation. */
    colorOperation: Type.Union([Type.Literal('none'), Type.Literal('multiply_tint')]),
  },
  { additionalProperties: false },
);

export type VisualPresentation = Static<typeof VisualPresentationSchema>;

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

/**
 * Source/license provenance. Never executable nodes or scripts.
 */
export const VisualProvenanceSchema = Type.Object(
  {
    /** Original source description (e.g. `Universal-LPC-Spritesheet`). */
    source: Type.String({ minLength: 1 }),
    /** License/attribution strings held verbatim. */
    licenses: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
    /** Optional generator provenance (e.g. `lpc-adapter@v1`). */
    generator: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);

export type VisualProvenance = Static<typeof VisualProvenanceSchema>;

// ---------------------------------------------------------------------------
// Definition root (discriminated by kind)
// ---------------------------------------------------------------------------

/**
 * Properties common to every visual definition kind.
 *
 * Spread into each kind's strict object (rather than composed via
 * `Type.Intersect`) because intersecting two `additionalProperties: false`
 * objects is unsatisfiable — each strict member rejects the other's fields.
 */
const BASE_DEFINITION_PROPS = {
  identity: VisualIdentitySchema,
  images: Type.Array(VisualImageSchema, { minItems: 1 }),
  frames: Type.Array(VisualFrameSchema, { minItems: 1 }),
  clips: Type.Array(VisualClipSchema, { minItems: 1 }),
  presentation: VisualPresentationSchema,
  provenance: VisualProvenanceSchema,
} as const;

/**
 * A complete (self-contained) sprite definition.
 */
export const CompleteSpriteDefinitionSchema = Type.Object(
  {
    kind: Type.Literal('complete_sprite'),
    ...BASE_DEFINITION_PROPS,
    /** Optional default clip name used when none is requested. */
    defaultClip: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);

export type CompleteSpriteDefinition = Static<typeof CompleteSpriteDefinitionSchema>;

/**
 * A modular component definition (rig/body/pose compatible part).
 */
export const ComponentDefinitionSchema = Type.Object(
  {
    kind: Type.Literal('component'),
    ...BASE_DEFINITION_PROPS,
    component: VisualComponentSchema,
  },
  { additionalProperties: false },
);

export type ComponentDefinition = Static<typeof ComponentDefinitionSchema>;

/**
 * A tileset/prop atlas definition.
 */
export const TilesetDefinitionSchema = Type.Object(
  {
    kind: Type.Literal('tileset'),
    ...BASE_DEFINITION_PROPS,
    /** One clip per tile/prop id for deterministic frame lookup. */
    tileClips: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  },
  { additionalProperties: false },
);

export type TilesetDefinition = Static<typeof TilesetDefinitionSchema>;

/**
 * The full visual definition wire schema — discriminated by `kind`.
 */
export const VisualDefinitionSchema = Type.Union([
  CompleteSpriteDefinitionSchema,
  ComponentDefinitionSchema,
  TilesetDefinitionSchema,
]);

export type VisualDefinition = Static<typeof VisualDefinitionSchema>;

// ---------------------------------------------------------------------------
// Validation diagnostics
// ---------------------------------------------------------------------------

/**
 * A structured diagnostic describing why a definition was rejected.
 *
 * Diagnostics identify the asset, clip, profile or failed reference so
 * authors can act on them; fallback use is visible to authors.
 */
export type VisualDiagnostic = {
  /** Human-readable error message. */
  message: string;
  /** The definition id the diagnostic belongs to. */
  assetId: string;
  /** Optional clip name involved. */
  clip?: string;
  /** Optional component/pass id involved. */
  component?: string;
  /** Optional image id involved. */
  imageId?: string;
  /** Optional frame id involved. */
  frameId?: string;
  /** Optional failed reference. */
  reference?: string;
};

/**
 * Collects clip fallback chains into a map for cycle detection.
 *
 * Returns a map of clip name → its declared fallback name (undefined if
 * none). Clips referenced by a fallback but absent from the map resolve to
 * `undefined`, which callers treat as a missing-reference diagnostic.
 */
export const collectClipFallbacks = (
  clips: readonly VisualClip[],
): Map<string, string | undefined> => {
  const fallbacks = new Map<string, string | undefined>();
  for (const clip of clips) {
    fallbacks.set(clip.name, clip.fallback);
  }
  return fallbacks;
};

/**
 * Detects acyclic clip fallbacks.
 *
 * Returns the first clip name that participates in a fallback cycle, or
 * `undefined` when the fallback graph is acyclic. A self-referencing
 * fallback is treated as a cycle (it can never resolve to another clip).
 */
export const findCyclicClipFallback = (clips: readonly VisualClip[]): string | undefined => {
  const fallbacks = collectClipFallbacks(clips);

  const visit = (start: string): string | undefined => {
    const seen = new Set<string>();
    let current: string | undefined = start;
    while (current !== undefined && !seen.has(current)) {
      seen.add(current);
      current = fallbacks.get(current);
    }
    // `current` is undefined only when the chain ended at a clip with no
    // fallback (acyclic). Otherwise we re-encountered a visited clip.
    return current === undefined ? undefined : current;
  };

  for (const clip of clips) {
    const cycle = visit(clip.name);
    if (cycle !== undefined) {
      return cycle;
    }
  }
  return undefined;
};

// ---------------------------------------------------------------------------
// validateVisualDefinition — structural validation + diagnostics
// ---------------------------------------------------------------------------

/**
 * Validates a visual definition beyond the TypeBox shape check.
 *
 * Performs reference integrity, bounds, duplicate and cycle checks that the
 * wire schema cannot express, and returns a list of diagnostics. An empty
 * array means the definition is structurally valid and safe to publish or
 * allocate. Unsupported rendering modes (indexed palette playback) are
 * rejected here rather than misrendered.
 *
 * Callers gate publication/allocation on a zero-length diagnostic result.
 *
 * @param value - The definition to validate.
 * @returns A list of {@link VisualDiagnostic}; empty when valid.
 */
export const validateVisualDefinition = (value: unknown): VisualDiagnostic[] => {
  const diagnostics: VisualDiagnostic[] = [];

  // 1. Shape contract.
  if (!Value.Check(VisualDefinitionSchema, value)) {
    return [
      {
        message: 'Definition does not conform to VisualDefinitionSchema',
        assetId: 'unknown',
      },
    ];
  }

  const def = value as VisualDefinition;
  const assetId = def.identity.id;

  // 2. Unsupported rendering modes are rejected, not approximated.
  const unsupportedImage = def.images.find((image) => image.colorEncoding === 'palette_indexed');
  if (unsupportedImage) {
    diagnostics.push({
      message:
        'palette_indexed playback is not supported in this contract; use rgba or explicit multiplicative tint',
      assetId,
      imageId: unsupportedImage.id,
    });
  }

  // 3. Duplicate ids.
  const imageIds = new Set<string>();
  for (const image of def.images) {
    if (imageIds.has(image.id)) {
      diagnostics.push({ message: `Duplicate image id '${image.id}'`, assetId, imageId: image.id });
    }
    imageIds.add(image.id);
  }

  const frameIds = new Set<string>();
  for (const frame of def.frames) {
    if (frameIds.has(frame.id)) {
      diagnostics.push({ message: `Duplicate frame id '${frame.id}'`, assetId, frameId: frame.id });
    }
    frameIds.add(frame.id);
  }

  const clipNames = new Set<string>();
  for (const clip of def.clips) {
    if (clipNames.has(clip.name)) {
      diagnostics.push({ message: `Duplicate clip name '${clip.name}'`, assetId, clip: clip.name });
    }
    clipNames.add(clip.name);
  }

  // 4. Frames resolve their image and stay in bounds.
  const imageById = new Map(def.images.map((image) => [image.id, image]));
  for (const frame of def.frames) {
    const image = imageById.get(frame.imageId);
    if (!image) {
      diagnostics.push({
        message: `Frame '${frame.id}' references missing image '${frame.imageId}'`,
        assetId,
        frameId: frame.id,
        reference: frame.imageId,
      });
      continue;
    }
    if (frame.x + frame.width > image.width || frame.y + frame.height > image.height) {
      diagnostics.push({
        message: `Frame '${frame.id}' extends outside image '${image.id}' bounds`,
        assetId,
        frameId: frame.id,
        imageId: image.id,
      });
    }
  }

  // 5. Clips resolve their frames.
  const frameById = new Map(def.frames.map((frame) => [frame.id, frame]));
  for (const clip of def.clips) {
    for (const occurrence of clip.frames) {
      if (!frameById.has(occurrence.frameId)) {
        diagnostics.push({
          message: `Clip '${clip.name}' references missing frame '${occurrence.frameId}'`,
          assetId,
          clip: clip.name,
          reference: occurrence.frameId,
        });
      }
    }
    if (clip.fallback !== undefined && !clipNames.has(clip.fallback)) {
      diagnostics.push({
        message: `Clip '${clip.name}' references missing fallback '${clip.fallback}'`,
        assetId,
        clip: clip.name,
        reference: clip.fallback,
      });
    }
  }

  if (
    def.kind === 'complete_sprite' &&
    def.defaultClip !== undefined &&
    !clipNames.has(def.defaultClip)
  ) {
    diagnostics.push({
      message: `Default clip references missing clip '${def.defaultClip}'`,
      assetId,
      reference: def.defaultClip,
    });
  }

  if (def.kind === 'tileset' && def.tileClips !== undefined) {
    for (const tileClip of def.tileClips) {
      if (!clipNames.has(tileClip)) {
        diagnostics.push({
          message: `Tile clip references missing clip '${tileClip}'`,
          assetId,
          reference: tileClip,
        });
      }
    }
  }

  // 6. Acyclic fallbacks.
  const cycle = findCyclicClipFallback(def.clips);
  if (cycle !== undefined) {
    diagnostics.push({
      message: `Clip fallback cycle detected involving '${cycle}'`,
      assetId,
      clip: cycle,
    });
  }

  // 7. Component passes resolve their clips.
  if (def.kind === 'component') {
    for (const pass of def.component.passes) {
      if (!clipNames.has(pass.clipName)) {
        diagnostics.push({
          message: `Pass '${pass.passId}' references missing clip '${pass.clipName}'`,
          assetId,
          component: def.component.id,
          reference: pass.clipName,
        });
      }
    }
  }

  return diagnostics;
};

/**
 * True when a definition validates with zero diagnostics.
 *
 * Convenience wrapper used to gate publication/allocation.
 */
export const isVisualDefinitionValid = (value: unknown): boolean =>
  validateVisualDefinition(value).length === 0;
