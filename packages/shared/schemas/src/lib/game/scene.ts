// packages/shared/schemas/src/lib/game/scene.ts
//
// C-505 — Canonical native scene document schema.
//
// A strict, versioned, discriminated schema for the *implemented* scene format.
// It is deliberately narrow: exactly one document kind (`aikami.scene`), one
// authoritative ground source (terrain XOR baked), uniquely identified layers
// and placements, and bounded sizes. Future authoring document kinds
// (`aikami.region`/`aikami.biome`/`aikami.house`) are documented but REJECTED
// until a separately approved compiler exists (AC-7).
//
// Cross-field invariants (grid lengths == width×height, palette indices in
// range, cell-count limits, multiplication overflow) are enforced by the
// engine's strict validator (`scene_validator.ts`) because TypeBox alone
// cannot express them. This schema owns the wire/document *shape*.

import {
  SCENE_DOCUMENT_KIND,
  SCENE_ELEVATION_MAX,
  SCENE_ELEVATION_MIN,
  SCENE_FRAME_EMPTY_INDEX,
  SCENE_LAYER_ROLES,
  SCENE_MAX_CELLS,
  SCENE_MAX_PALETTE_FRAMES,
  SCENE_MAX_PLACEMENTS,
  SCENE_MAX_TRANSITIONS,
  SCENE_MAX_VISUAL_LAYERS,
  SCENE_SCHEMA_VERSION,
  SCENE_TERRAIN_MATCHING_MODES,
  type SceneLayerRole,
  type SceneTerrainMatchingMode,
} from '@aikami/constants';
import { type Static, Type } from 'typebox';

const NON_EMPTY_ID = { minLength: 1 } as const;
const TERRAIN_MATCHING_MODE_SCHEMA = Type.Enum(SCENE_TERRAIN_MATCHING_MODES);
const LAYER_ROLE_SCHEMA = Type.Enum(SCENE_LAYER_ROLES);

/** Positive integer cell dimension. */
const CellDimension = Type.Integer({ minimum: 1 });

/** Scene extent: positive integer width/height in cells + tile size (px). */
export const SceneExtentSchema = Type.Object(
  {
    width: CellDimension,
    height: CellDimension,
    tileSize: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);

/** Baked ground: a frame palette plus a row-major grid of palette indices. */
export const SceneBakedSurfaceSchema = Type.Object(
  {
    mode: Type.Literal('baked'),
    /** Ordered frame names. Index 0 is reserved for empty cells. */
    palette: Type.Array(Type.String(NON_EMPTY_ID), {
      minItems: 1,
      maxItems: SCENE_MAX_PALETTE_FRAMES,
    }),
    /** Row-major palette indices; 0 = empty. length must equal width×height. */
    grid: Type.Array(Type.Integer({ minimum: 0, maximum: SCENE_MAX_PALETTE_FRAMES - 1 }), {
      minItems: 1,
    }),
  },
  { additionalProperties: false },
);

/** Semantic terrain ground: one terrain id per cell + declared default. */
export const SceneTerrainSurfaceSchema = Type.Object(
  {
    mode: Type.Literal('terrain'),
    /** Default terrain id for empty/unassigned cells. */
    defaultTerrain: Type.String(NON_EMPTY_ID),
    /** Row-major terrain ids; length must equal width×height. */
    cells: Type.Array(Type.String(), { minItems: 1 }),
    /**
     * Terrain matching mode for underlay/transition emission. Omission means
     * `fill`. Unknown modes are rejected by strict validation (AC-4).
     */
    matchingMode: Type.Optional(TERRAIN_MATCHING_MODE_SCHEMA),
  },
  { additionalProperties: false },
);

/** Discriminated surface: exactly one authoritative ground source. */
export const SceneSurfaceSchema = Type.Union([SceneTerrainSurfaceSchema, SceneBakedSurfaceSchema]);

/** A uniquely identified decal/overhead visual grid with an explicit role. */
export const SceneVisualLayerSchema = Type.Object(
  {
    /** Stable layer id — must be unique across the scene (AC-2). */
    id: Type.String(NON_EMPTY_ID),
    /** Explicit role; the engine never sniffs it from the id/name. */
    role: LAYER_ROLE_SCHEMA,
    /** Render order within the role (stable, order-bearing). */
    order: Type.Integer({ minimum: 0 }),
    /** Ordered frame palette; index 0 reserved for empty. */
    palette: Type.Array(Type.String(NON_EMPTY_ID), {
      minItems: 1,
      maxItems: SCENE_MAX_PALETTE_FRAMES,
    }),
    /** Row-major palette indices; length must equal width×height. */
    grid: Type.Array(Type.Integer({ minimum: 0, maximum: SCENE_MAX_PALETTE_FRAMES - 1 }), {
      minItems: 1,
    }),
  },
  { additionalProperties: false },
);

/** Explicit transform/origin of a placement. */
export const SceneTransformSchema = Type.Object(
  {
    flipH: Type.Optional(Type.Boolean()),
    flipV: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const SceneOriginSchema = Type.Object(
  {
    x: Type.Number(),
    y: Type.Number(),
  },
  { additionalProperties: false },
);

/** A placement: a logical component/frame reference at a position. */
export const ScenePlacementSchema = Type.Object(
  {
    /** Stable placement id — must be unique across the scene (AC-2/AC-3). */
    id: Type.String(NON_EMPTY_ID),
    /** Logical component (prefab/prop) identity from the pack lock. */
    component: Type.String(NON_EMPTY_ID),
    /** Logical frame name resolved through the installed pack lock. */
    frame: Type.String(NON_EMPTY_ID),
    /** Pixel position (+x right, +y down). */
    x: Type.Number(),
    y: Type.Number(),
    transform: Type.Optional(SceneTransformSchema),
    origin: Type.Optional(SceneOriginSchema),
    /** Render role for band/depth; ground placements render below entities. */
    role: Type.Optional(LAYER_ROLE_SCHEMA),
    /**
     * Explicit solidity override. Never derived from alpha or image colour.
     * A tree canopy is not its collision footprint.
     */
    solid: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

/** Navigation: explicit blocking overrides over authoritative terrain rules. */
export const SceneNavigationOverrideSchema = Type.Object(
  {
    /** Row-major cell index. */
    index: Type.Integer({ minimum: 0 }),
    blocked: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const SceneNavigationSchema = Type.Object(
  {
    /**
     * Explicit blocking overrides. The terrain rules remain authoritative; an
     * override can only tighten (block) or explicitly unblock a cell. There is
     * NEVER a second unrelated preview-only collision grid.
     */
    blockingOverrides: Type.Optional(
      Type.Array(SceneNavigationOverrideSchema, { maxItems: SCENE_MAX_CELLS }),
    ),
  },
  { additionalProperties: false },
);

/** Elevation channel (bounded int; omission means zero). */
export const SceneElevationSchema = Type.Array(
  Type.Integer({ minimum: SCENE_ELEVATION_MIN, maximum: SCENE_ELEVATION_MAX }),
);

/** Source provenance: format/revision + identity mapping for migration. */
export const SceneProvenanceSchema = Type.Object(
  {
    source: Type.String(NON_EMPTY_ID),
    revision: Type.String(),
    /**
     * Explicit persisted mapping from legacy identities to canonical
     * placement ids. Required for imported objects without a stable id;
     * never derived from array order or mutable position (AC-3).
     */
    identityMap: Type.Optional(Type.Record(Type.String(), Type.String(NON_EMPTY_ID))),
  },
  { additionalProperties: false },
);

/** A map-to-map transition zone (AC-1 preserves Tiled transitions). */
export const SceneTransitionSchema = Type.Object(
  {
    /** Stable transition id. */
    id: Type.String(NON_EMPTY_ID),
    /** Pixel rectangle (top-left). */
    x: Type.Number(),
    y: Type.Number(),
    width: Type.Integer({ minimum: 0 }),
    height: Type.Integer({ minimum: 0 }),
    /** Target map id. */
    targetMap: Type.String(NON_EMPTY_ID),
    targetX: Type.Number(),
    targetY: Type.Number(),
    /** Optional target spawn id on the destination map. */
    targetSpawnId: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

/**
 * The canonical native scene document.
 *
 * Discriminated on `kind` so a future authoring kind (e.g. `aikami.region`)
 * structurally fails to match and can be reported as unsupported rather than
 * silently reinterpreted as a map (AC-7).
 */
export const SceneDocumentSchema = Type.Object(
  {
    kind: Type.Literal(SCENE_DOCUMENT_KIND),
    schemaVersion: Type.Literal(SCENE_SCHEMA_VERSION),
    /** Stable scene id. */
    id: Type.String(NON_EMPTY_ID),
    /** Installed asset-lock reference resolving immutable visual references. */
    assetLock: Type.String(NON_EMPTY_ID),
    extent: SceneExtentSchema,
    surface: SceneSurfaceSchema,
    layers: Type.Array(SceneVisualLayerSchema, {
      maxItems: SCENE_MAX_VISUAL_LAYERS,
    }),
    placements: Type.Array(ScenePlacementSchema, {
      maxItems: SCENE_MAX_PLACEMENTS,
    }),
    navigation: SceneNavigationSchema,
    transitions: Type.Optional(
      Type.Array(SceneTransitionSchema, { maxItems: SCENE_MAX_TRANSITIONS }),
    ),
    elevation: Type.Optional(SceneElevationSchema),
    provenance: Type.Optional(SceneProvenanceSchema),
  },
  { additionalProperties: false },
);

/** Canonical native scene document accepted by current loaders. */
export type SceneDocument = Static<typeof SceneDocumentSchema>;
/** Positive scene dimensions and square tile size in pixels. */
export type SceneExtent = Static<typeof SceneExtentSchema>;
/** Semantic terrain channel used to compile canonical ground layers. */
export type SceneTerrainSurface = Static<typeof SceneTerrainSurfaceSchema>;
/** Authored frame-palette grid used as a baked ground surface. */
export type SceneBakedSurface = Static<typeof SceneBakedSurfaceSchema>;
/** Ordered canonical visual grid with an explicit render role. */
export type SceneVisualLayer = Static<typeof SceneVisualLayerSchema>;
/** Stable scene object identity, visual reference, and transform. */
export type ScenePlacement = Static<typeof ScenePlacementSchema>;
/** Navigation overrides layered over authoritative terrain rules. */
export type SceneNavigation = Static<typeof SceneNavigationSchema>;
/** Explicit blocked state for one row-major scene cell. */
export type SceneNavigationOverride = Static<typeof SceneNavigationOverrideSchema>;
/** Stable map-to-map transition zone and destination. */
export type SceneTransition = Static<typeof SceneTransitionSchema>;

export type { SceneLayerRole, SceneTerrainMatchingMode };

/** Sentinel: the reserved empty frame-palette index for visual cells. */
export const SCENE_EMPTY_FRAME_INDEX = SCENE_FRAME_EMPTY_INDEX;
