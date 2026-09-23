// scripts/src/lib/ops/emberwatch_atlas_coverage.ts
//
// Map GID → atlas frame coverage (C-548).
//
// The gap this closes: the release candidate seals the LOCAL terrain atlas
// (`terrainAtlasGroup` in `emberwatch_candidate.ts` reads the manifest's
// `atlas.textureUrl` from `static/game-data/`), and `buildAndSealCandidate`
// regenerates that atlas before sealing. Nothing, however, asserted that every
// GID a map layer actually paints resolves to a frame the sealed atlas carries.
// A stale atlas build (or a map committed against a newer frame table) would
// therefore seal and ship a crossing drawn from a GID the atlas does not have,
// and the engine would quietly substitute `fallbackTile`.
//
// The rule is exactly the plan's §9 "material fallback" rule: a required frame
// reference must be resolvable, and a plausible grass fallback is not success.
//
// This module is pure and read-only: it takes the manifest, the map layer data
// and the atlas frame names and returns findings. The atlas descriptor is read
// by the caller so the same check runs against a built descriptor OR an
// in-memory one (tests).

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type AtlasCoverageFinding = {
  /** Stable id, e.g. `village/ground/gid134`. */
  id: string;
  /** Map the offending GID was painted on. */
  mapId: string;
  /** Layer name the GID appears in. */
  layer: string;
  /** The map-local GID (raw Tiled GID minus the tileset's `firstgid`). */
  gid: number;
  /** The frame name the manifest binds to the GID, when one is declared. */
  frame?: string;
  /** Why it failed: no manifest tile/frame, a missing atlas frame, or missing maps. */
  reason: 'undeclared-gid' | 'frame-not-in-atlas' | 'maps-not-built';
  /** First cell (row-major index) where the offending GID appears. */
  cell: number;
  detail: string;
};

/** A single tile layer's data plus its logical name. */
export type CoverageLayer = { name: string; data: readonly number[] };

/** The manifest facts the check needs. */
export type AtlasCoverageManifest = {
  /** GID (as a string key) → frame name. */
  tiles: Record<string, { frame?: string }>;
  /** Tileset `firstgid` used by the map's tilesets, normally 1. */
  firstgid?: number;
};

/**
 * Frame names present in a built grid-atlas descriptor (`atlas.json`).
 *
 * The descriptor is a spritesheet: `frames` is a map of `filename` → rect.
 * A missing or unreadable descriptor yields an empty set, which makes every
 * frame a failure — the correct direction (fail closed).
 */
export const atlasFrameNames = (descriptor: {
  frames?: Record<string, unknown> | Array<{ filename?: string }>;
}): Set<string> => {
  const frames = descriptor.frames;
  if (!frames) {
    return new Set();
  }
  if (Array.isArray(frames)) {
    return new Set(
      frames
        .map((entry) => entry.filename)
        .filter((name): name is string => typeof name === 'string'),
    );
  }
  return new Set(Object.keys(frames));
};

/** The `collision` layer stores a boolean solidity flag, never tile GIDs. */
const NON_GID_LAYERS = new Set(['collision']);

/**
 * The failure a single painted GID represents, or `undefined` when it resolves.
 *
 * Split out of `checkGidAtlasCoverage` so the scan loop stays a flat
 * dedupe-and-collect rather than a branch ladder (cognitive-complexity guard).
 */
const cellFinding = (options: {
  mapId: string;
  layerName: string;
  gid: number;
  cell: number;
  manifest: AtlasCoverageManifest;
  atlasFrames: ReadonlySet<string>;
}): AtlasCoverageFinding | undefined => {
  const { mapId, layerName, gid, cell, manifest, atlasFrames } = options;
  const def = manifest.tiles[String(gid)];
  if (def?.frame === undefined) {
    return {
      id: `${mapId}/${layerName}/gid${gid}`,
      mapId,
      layer: layerName,
      gid,
      reason: 'undeclared-gid',
      cell,
      detail:
        `map "${mapId}" layer "${layerName}" paints GID ${gid} at cell ${cell}, ` +
        'which the manifest declares no frame for — the renderer falls back',
    };
  }
  const frame = def.frame;
  if (atlasFrames.has(frame)) {
    return undefined;
  }
  return {
    id: `${mapId}/${layerName}/gid${gid}`,
    mapId,
    layer: layerName,
    gid,
    frame,
    reason: 'frame-not-in-atlas',
    cell,
    detail:
      `map "${mapId}" layer "${layerName}" paints GID ${gid} (frame "${frame}") at cell ` +
      `${cell}, but the terrain atlas does not carry that frame — the crossing would ` +
      'ship drawn from the fallback tile',
  };
};

/**
 * The failures one layer contributes, deduped across the whole scan via
 * `reported`. Split out of `checkGidAtlasCoverage` so neither function nests a
 * branch ladder (cognitive-complexity guard).
 */
const layerFindings = (options: {
  mapId: string;
  layer: CoverageLayer;
  firstgid: number;
  manifest: AtlasCoverageManifest;
  atlasFrames: ReadonlySet<string>;
  reported: Set<string>;
}): AtlasCoverageFinding[] => {
  const { mapId, layer, firstgid, manifest, atlasFrames, reported } = options;
  const out: AtlasCoverageFinding[] = [];
  for (const [cell, rawGid] of layer.data.entries()) {
    // Mirror the engine: `localTileId = rawGid - firstgid + 1`
    // (ManifestAtlasResolver.getTileTextureFromGid). Manifest tile keys are
    // 1-based local ids, so GID 0 is empty and a raw GID below `firstgid` is
    // invalid.
    const cleanGid = (rawGid & 0x0fffffff) >>> 0;
    const gid = cleanGid - firstgid + 1;
    if (cleanGid === 0 || gid < 1) {
      continue;
    }
    const key = `${layer.name}:${gid}`;
    if (reported.has(key)) {
      continue;
    }
    reported.add(key);
    const finding = cellFinding({
      mapId,
      layerName: layer.name,
      gid,
      cell,
      manifest,
      atlasFrames,
    });
    if (finding !== undefined) {
      out.push(finding);
    }
  }
  return out;
};

/**
 * Every distinct map GID that does not resolve to a frame the atlas carries.
 *
 * A GID of 0 is empty and skipped. A GID the manifest does not declare is a
 * failure in its own right (the engine falls back), and a declared GID whose
 * frame the atlas lacks is the bridge-broken case this contract exists for.
 * Each distinct offending GID is reported once per (map, layer), naming its
 * first cell so an author can find it.
 */
export const checkGidAtlasCoverage = (options: {
  mapId: string;
  layers: readonly CoverageLayer[];
  manifest: AtlasCoverageManifest;
  atlasFrames: ReadonlySet<string>;
}): AtlasCoverageFinding[] => {
  const { mapId, layers, manifest, atlasFrames } = options;
  const firstgid = manifest.firstgid ?? 1;
  const reported = new Set<string>();
  const findings: AtlasCoverageFinding[] = [];
  for (const layer of layers) {
    if (NON_GID_LAYERS.has(layer.name)) {
      continue;
    }
    findings.push(...layerFindings({ mapId, layer, firstgid, manifest, atlasFrames, reported }));
  }
  return findings;
};

/** The tileset `firstgid` a map declares for its primary atlas. */
const firstgidOf = (tilesets: readonly { firstgid?: number }[] | undefined): number => {
  if (tilesets && tilesets.length > 1) {
    throw new Error(
      'Atlas coverage requires a single tileset per map; multiple tilesets cannot be scanned',
    );
  }
  const first = tilesets?.[0]?.firstgid;
  return typeof first === 'number' ? first : 1;
};

/**
 * Reads the built grid-atlas descriptor for a game-data root and returns its
 * frame names. Returns `undefined` when the descriptor is absent, which the
 * caller reports as a distinct "atlas not built" failure rather than as N
 * missing frames.
 */
export const readAtlasFrameNames = (gameDataRoot: string): Set<string> | undefined => {
  const path = join(gameDataRoot, 'sprites/tilesets/atlas.json');
  if (!existsSync(path)) {
    return undefined;
  }
  return atlasFrameNames(
    JSON.parse(readFileSync(path, 'utf8')) as {
      frames?: Record<string, unknown> | Array<{ filename?: string }>;
    },
  );
};

/** A single tile layer read off a map file. */
type MapLayerFile = { name?: string; type?: string; data?: number[] };
type MapFile = { layers?: MapLayerFile[]; tilesets?: Array<{ firstgid?: number }> };

/**
 * Scans every map under a pack directory and reports GIDs that do not resolve
 * to a frame in the built atlas at `gameDataRoot`.
 *
 * `atlasBuilt` is false when coverage cannot run because the atlas descriptor
 * or required map directory is missing; `findings` distinguishes missing maps.
 */
export const scanPackGidAtlasCoverage = (options: {
  packRoot: string;
  gameDataRoot: string;
  manifest: AtlasCoverageManifest;
}): { atlasBuilt: boolean; findings: AtlasCoverageFinding[] } => {
  const atlasFrames = readAtlasFrameNames(options.gameDataRoot);
  if (atlasFrames === undefined) {
    return { atlasBuilt: false, findings: [] };
  }
  const mapsDir = join(options.packRoot, 'maps');
  const findings: AtlasCoverageFinding[] = [];
  if (!existsSync(mapsDir)) {
    return {
      atlasBuilt: false,
      findings: [
        {
          id: 'maps-not-built',
          mapId: '*',
          layer: 'maps',
          gid: 0,
          cell: 0,
          reason: 'maps-not-built',
          detail: `Required map directory is missing: ${mapsDir}`,
        },
      ],
    };
  }
  for (const file of readdirSync(mapsDir)
    .filter((name) => name.endsWith('.json'))
    .sort()) {
    const mapId = file.slice(0, -'.json'.length);
    const map = JSON.parse(readFileSync(join(mapsDir, file), 'utf8')) as MapFile;
    const layers: CoverageLayer[] = (map.layers ?? [])
      .filter((layer) => layer.type === 'tilelayer' && Array.isArray(layer.data))
      .map((layer) => ({ name: layer.name ?? '', data: layer.data ?? [] }));
    findings.push(
      ...checkGidAtlasCoverage({
        mapId,
        layers,
        manifest: { ...options.manifest, firstgid: firstgidOf(map.tilesets) },
        atlasFrames,
      }),
    );
  }
  return { atlasBuilt: true, findings };
};
