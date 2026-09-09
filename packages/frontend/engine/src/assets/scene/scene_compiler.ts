// packages/frontend/engine/src/assets/scene/scene_compiler.ts
//
// C-505 — Compile a validated canonical scene into engine-friendly runtime
// data.
//
// The compiler is the single owner of source → compiled render/gameplay
// translation. It reuses the existing autotiler (`autotileLayers`) for terrain
// underlay/transition emission and the C-378 `frames` layer convention so the
// existing renderers consume normalized scenes without a second render path
// (architecture directive 1). Compilation is load-time or edit-driven; idle
// frames never rebuild grids (AC-6).

import { SCENE_FRAME_EMPTY_INDEX } from '@aikami/constants';
import type { ContentPackTerrain } from '@aikami/schemas';
import type { SceneDocument, ScenePlacement } from '@aikami/types';
import { autotileLayers } from '../autotile.ts';
import type { TilemapData, TilemapLayer } from '../map_loader.ts';

/** A compiled render layer carrying frame names per cell (0 = empty). */
export type CompiledSceneLayer = {
  /** Stable, order-bearing layer identity. */
  id: string;
  /** Human-readable layer name for diagnostics. */
  name: string;
  /** Render band — never sniffed from the name (C-378). */
  band: 'ground' | 'decor' | 'overhead';
  /** Render order within its band. */
  order: number;
  /** Frame name per cell, row-major; '' = empty. */
  frames: Array<string | ''>;
};

/** Logical contribution counts per pass (AC-2 / AC-6 emission assertions). */
export type SceneEmissionReport = {
  /** Number of non-empty ground cells emitted. */
  ground: number;
  /** Number of non-empty decal cells emitted. */
  decal: number;
  /** Number of non-empty overhead cells emitted. */
  overhead: number;
  /** Number of placements. */
  placements: number;
  /** Number of compiled render layers. */
  layers: number;
};

/** The compiled runtime scene. */
export type CompiledScene = {
  /** Stable scene id from the document. */
  sceneId: string;
  width: number;
  height: number;
  tileSize: number;
  /** Render layers ordered bottom-to-top for chunk emission. */
  layers: CompiledSceneLayer[];
  /** Terrain channel (row-major) — authoritative for terrain cost/sight. */
  terrain: string[] | undefined;
  /** Authoritative collision grid (row-major, true = solid). */
  collision: boolean[];
  /** Elevation channel (preserved; traversal unimplemented). */
  elevation: number[] | undefined;
  /** Placements with stable ids, transforms and roles. */
  placements: ScenePlacement[];
  /** Emission report for deterministic assertions (AC-2 / AC-6). */
  emission: SceneEmissionReport;
};

/** Context needed to compile a scene. */
export type SceneCompileContext = {
  /**
   * Pack terrain definitions (index-aligned with the scene's terrain ids).
   * Required for terrain-mode surfaces (the autotiler needs frame bases,
   * wang mode and precedence). Omitted → terrain mode cannot compile.
   */
  terrains?: readonly ContentPackTerrain[];
};

/**
 * Compiles a validated scene document into runtime data.
 *
 * @param doc - A scene document that has already passed strict validation.
 * @param context - Compile context (pack terrains for terrain surfaces).
 * @returns The compiled scene, or throws when terrain mode lacks terrains.
 */
export const compileScene = (doc: SceneDocument, context?: SceneCompileContext): CompiledScene => {
  const { width, height, tileSize } = doc.extent;
  const cellCount = width * height;
  const sceneId = doc.id;

  const layers: CompiledSceneLayer[] = [];
  let ground = 0;
  let decal = 0;
  let overhead = 0;

  // ── Ground pass (single authoritative source) ─────────────────────────
  if (doc.surface.mode === 'terrain') {
    const terrains = context?.terrains;
    if (!terrains || terrains.length === 0) {
      throw new Error(
        `scene:compile terrain surface "${sceneId}" requires pack terrain definitions`,
      );
    }
    // Reuse the existing layered corner-16 autotiler — the terrain compiler
    // is the sole emitter of underlay/transition passes (directive 3).
    const emissions = autotileLayers({
      width,
      height,
      terrain: doc.surface.cells,
      terrains,
    });
    const sorted = [...emissions].sort((a, b) => a.precedence - b.precedence);
    for (const emission of sorted) {
      const frames = emission.frames.map((frame) => (frame === 0 ? '' : frame));
      layers.push({
        id: `${sceneId}:ground:${emission.name}`,
        name: emission.name,
        band: 'ground',
        order: emission.precedence,
        frames,
      });
      for (const frame of frames) {
        if (frame) {
          ground++;
        }
      }
    }
    if (ground === 0) {
      throw new Error(`scene:compile terrain surface "${sceneId}" emitted no ground frames`);
    }
  } else {
    // Baked ground: one ground layer from the palette grid.
    const frames: Array<string | ''> = new Array(cellCount);
    for (let i = 0; i < cellCount; i++) {
      const idx = doc.surface.grid[i];
      frames[i] = idx === SCENE_FRAME_EMPTY_INDEX ? '' : (doc.surface.palette[idx] ?? '');
      if (frames[i]) {
        ground++;
      }
    }
    layers.push({
      id: `${sceneId}:ground:baked`,
      name: `${sceneId}_ground`,
      band: 'ground',
      order: 0,
      frames,
    });
  }

  // ── Decal / overhead passes (intentional layers, never ground copies) ──
  const roleCounters: Record<'decor' | 'overhead', number> = { decor: 0, overhead: 0 };
  for (const layer of doc.layers) {
    const frames: Array<string | ''> = new Array(cellCount);
    let nonEmpty = 0;
    for (let i = 0; i < cellCount; i++) {
      const idx = layer.grid[i];
      frames[i] = idx === SCENE_FRAME_EMPTY_INDEX ? '' : (layer.palette[idx] ?? '');
      if (frames[i]) {
        nonEmpty++;
      }
    }
    const band = layer.role === 'overhead' ? 'overhead' : 'decor';
    const order = roleCounters[band]++;
    layers.push({
      id: `${sceneId}:${band}:${layer.id}`,
      name: layer.id,
      band,
      order,
      frames,
    });
    if (band === 'overhead') {
      overhead += nonEmpty;
    } else {
      decal += nonEmpty;
    }
  }

  // ── Collision (terrain authority + explicit blocking overrides) ───────
  const collision = _buildCollision(doc, context?.terrains);

  const compiled: CompiledScene = {
    sceneId,
    width,
    height,
    tileSize,
    layers,
    terrain: doc.surface.mode === 'terrain' ? doc.surface.cells : undefined,
    collision,
    elevation: doc.elevation,
    placements: doc.placements,
    emission: {
      ground,
      decal,
      overhead,
      placements: doc.placements.length,
      layers: layers.length,
    },
  };

  return compiled;
};

/**
 * Builds the authoritative collision grid.
 *
 * Terrain mode: solidity derives from the pack terrain `isWalkable` (never
 * from tile alpha/image) with the explicit `collision` layer additive.
 * Baked mode: no inherent solidity (baked pixels are visual only); only
 * explicit blocking overrides block. Navigation overrides apply on top of
 * either (can block or explicitly unblock a cell).
 */
const _buildCollision = (
  doc: SceneDocument,
  terrains: readonly ContentPackTerrain[] | undefined,
): boolean[] => {
  const cellCount = doc.extent.width * doc.extent.height;
  const collision = new Array<boolean>(cellCount).fill(false);

  if (doc.surface.mode === 'terrain' && terrains && terrains.length > 0) {
    const walkable = new Map<string, boolean>();
    for (const t of terrains) {
      walkable.set(t.name, t.isWalkable);
    }
    const defaultId = doc.surface.defaultTerrain;
    for (let i = 0; i < cellCount; i++) {
      const id = doc.surface.cells[i] ?? '';
      const resolved = id === '' ? defaultId : id;
      const w = walkable.get(resolved);
      // Strict validation already guaranteed every id is declared, so an
      // unknown id here can only mean a default mismatch — fail closed.
      collision[i] = w === undefined ? true : !w;
    }
  }

  // Explicit blocking overrides (can add or remove solidity).
  for (const override of doc.navigation.blockingOverrides ?? []) {
    collision[override.index] = override.blocked;
  }

  return collision;
};

/**
 * Compiles a canonical scene back into the {@link TilemapData} shape the
 * existing render/collision/terrain pipeline consumes.
 *
 * This is the single production bridge that lets `/game` keep its proven
 * downstream consumers (chunk renderer, `buildCollisionGrid`,
 * `buildTerrainGridForMap`, spawn/transition extraction) while the canonical
 * scene remains the ONE authoritative source — the loader boundary, not an
 * additional render path (architecture directive 1, AC-1).
 *
 * Layers are emitted in the C-378 `frames` convention (frame name per cell,
 * 0 = empty), resolved by name through the atlas — never GIDs. Spawns,
 * transitions and props are recovered from the scene's placements with their
 * stable ids and transforms so persisted world state stays attached (AC-3).
 */
export const compileSceneToTilemap = (
  compiled: CompiledScene,
  doc: SceneDocument,
  source?: TilemapData,
): TilemapData => {
  const { width, height } = compiled;
  const tileSize = compiled.tileSize;

  // Render layers always come from the canonical compiler. The source map
  // contributes tileset metadata only; passing its raw layers through would
  // discard canonical role/order and frame transformations.
  const renderLayers: TilemapLayer[] = compiled.layers.map((layer) => ({
    name: layer.name,
    width,
    height,
    data: new Array<number>(width * height).fill(0),
    // `0` in frames is already reserved for empty; convert '' → 0.
    frames: layer.frames.map((frame) => (frame ? frame : 0)),
    visible: true,
    band: layer.band,
  }));

  // Spawn/prop/transition objects. On the production /game path a source
  // legacy map is present: its object layers preserve every custom property
  // while `id` is normalized to the canonical string identity. The proven
  // spawner/transition consumers still see spawnId/npcId/frame/dialogueKey.
  // The canonical scene stays the semantic identity authority while source
  // objects remain the derived spawn artifact. Native scenes (no source)
  // rebuild objects directly from canonical placements and transitions.
  const objectLayers: TilemapData['objectLayers'] = source?.objectLayers?.length
    ? source.objectLayers.map((layer) => ({
        ...layer,
        objects: layer.objects.map((object) => {
          if (object.id === undefined) {
            return object;
          }
          const legacyId = String(object.id);
          return {
            ...object,
            id:
              object.type === 'transition'
                ? legacyId
                : (doc.provenance?.identityMap?.[legacyId] ?? legacyId),
          };
        }),
      }))
    : (() => {
        // Recover spawn/prop objects from placements (stable ids + transforms).
        const objects: Record<string, unknown>[] = [];
        for (const placement of compiled.placements) {
          objects.push({
            id: placement.id,
            name: placement.id,
            type: placement.component,
            x: placement.x,
            y: placement.y,
            properties: [{ name: 'frame', type: 'string', value: placement.frame }],
          });
        }
        // Recover transitions with their trigger rects + targets.
        for (const transition of doc.transitions ?? []) {
          objects.push({
            id: transition.id,
            name: transition.id,
            type: 'transition',
            x: transition.x,
            y: transition.y,
            width: transition.width,
            height: transition.height,
            properties: [
              { name: 'targetMap', type: 'string', value: transition.targetMap },
              { name: 'targetX', type: 'number', value: transition.targetX },
              { name: 'targetY', type: 'number', value: transition.targetY },
              ...(transition.targetSpawnId
                ? [{ name: 'targetSpawnId', type: 'string', value: transition.targetSpawnId }]
                : []),
            ],
          });
        }
        return objects.length > 0 ? [{ name: 'entities', objects }] : undefined;
      })();

  return {
    width,
    height,
    tilewidth: tileSize,
    tileheight: tileSize,
    tilesets: source?.tilesets ?? [],
    layers: renderLayers,
    objectLayers,
    terrain: compiled.terrain,
    elevation: compiled.elevation,
  };
};
