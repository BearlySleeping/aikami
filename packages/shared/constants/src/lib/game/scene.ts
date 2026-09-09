// packages/shared/constants/src/lib/game/scene.ts
//
// C-505 — Canonical scene data & authoring boundary.
//
// Constants governing the versioned native scene document format. These are
// shared by the strict TypeBox schema, the engine scene model/validator and
// the import/export tooling so every consumer agrees on one interpretation.

/**
 * Current version of the canonical scene document schema. Bump only with a
 * documented compatibility/profile decision — a schema-version change must
 * never silently recompute a saved world's layout (C-505 AC-3).
 */
export const SCENE_SCHEMA_VERSION = 1;

/**
 * The single supported native scene document kind.
 *
 * A scene loader accepts exactly this kind for the implemented format. Future
 * authoring document kinds (region/biome/house blueprints) are explicitly
 * rejected until a separately approved compiler exists (C-505 AC-7).
 */
export const SCENE_DOCUMENT_KIND = 'aikami.scene' as const;

/**
 * Document kinds that describe *future* authoring operations, not executable
 * maps. The loader must report these as an unsupported authoring format rather
 * than guessing a forest, a blank map or a legacy fallback (AC-7). These are
 * deliberately NOT accepted by any current entry point.
 */
export const SCENE_FUTURE_DOCUMENT_KINDS = [
  'aikami.region',
  'aikami.biome',
  'aikami.house',
] as const;

/**
 * Terrain matching modes the engine understands. The terrain compiler is the
 * sole emitter of underlay/transition passes; unknown matching modes are
 * errors, never approximate `corner16` aliases (AC-4).
 */
export const SCENE_TERRAIN_MATCHING_MODES = ['fill', 'corner16'] as const;

export type SceneTerrainMatchingMode = (typeof SCENE_TERRAIN_MATCHING_MODES)[number];

/**
 * Render layer roles. Ground renders below every entity, decor below entities
 * but above ground, overhead above every entity. The engine never infers the
 * role from the layer name (C-378 convention preserved).
 */
export const SCENE_LAYER_ROLES = ['ground', 'decor', 'overhead'] as const;

export type SceneLayerRole = (typeof SCENE_LAYER_ROLES)[number];

// ── Import / allocation safety limits (C-505 State & Data Models) ──────────
//
// Initial import safety limits. Dimensions, multiplication overflow, counts
// and compressed-expansion are all checked BEFORE allocation. Raising a limit
// requires a documented compatibility/profile decision, not silently bypassing
// validation.

/** Maximum total cells across a scene: 1,048,576 (1024×1024). */
export const SCENE_MAX_CELLS = 1_048_576;

/** Maximum authored visual layers: 32. */
export const SCENE_MAX_VISUAL_LAYERS = 32;

/** Maximum placements: 65,536. */
export const SCENE_MAX_PLACEMENTS = 65_536;

/** Maximum decoded map buffer size: 64 MiB. */
export const SCENE_MAX_DECODED_BYTES = 64 * 1024 * 1024;

/** Elevation channel bounds (int8 range preserved, traversal unimplemented). */
export const SCENE_ELEVATION_MIN = -128;
export const SCENE_ELEVATION_MAX = 127;

/** Frame palette reserved index for empty visual cells. */
export const SCENE_FRAME_EMPTY_INDEX = 0;

/** Maximum palette frame entries in a baked surface or visual layer grid. */
export const SCENE_MAX_PALETTE_FRAMES = 4096;
