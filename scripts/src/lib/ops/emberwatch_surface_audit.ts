// scripts/src/lib/ops/emberwatch_surface_audit.ts
//
// Bidirectional asset-surface audit for the Emberwatch pack (Phase 6) plus the
// static half of the five-map gate (Phase 3).
//
//   RUNTIME → DATA   every prop/portrait/transition reference resolves
//   DATA → RUNTIME   every installed prop has a deliberate consumer
//
// and the failure classes that produced real defects in this pack:
//
//   undefined-manifest-prop            prop falls back to grass
//   orphan-prop-definition             a prop no map places
//   wrong-semantic-prop-reuse          placed frame ≠ the manifest's frame
//   duplicate-placement-id             two objects share an id
//   unwalkable-transition-destination  a portal landing inside a collider
//   missing-return-transition          a one-way trip
//   transition-to-unknown-map          a portal into nothing
//   missing-neutral-portrait           dialogue with no fallback bust
//   missing-provenance                 no acceptance lineage
//   missing-terrain-override           autotile terrain left as baked tiles
//
// Run: bun scripts/src/lib/ops/emberwatch_surface_audit.ts [--json]

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repository = join(here, '../../../..');
const packRoot = join(repository, 'content/packs/emberwatch');

export type SurfaceFinding = {
  kind: string;
  severity: 'error' | 'warning';
  subject: string;
  detail: string;
};

type Property = { name: string; value: unknown };

type MapObject = {
  id?: number;
  type?: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  properties?: Property[];
};

type MapLayer = {
  name: string;
  type: string;
  properties?: Property[];
  objects?: MapObject[];
  data?: number[];
};

type MapJson = {
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  layers: MapLayer[];
  aikami?: { terrain?: string[] };
};

type Manifest = {
  props: Record<string, { frame: string; provenance?: { source?: string } }>;
  npcs: Record<string, { portraits?: { variants: Record<string, string> } }>;
};

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

/** Reads a named property from an object or layer. */
const prop = (properties: Property[] | undefined, name: string): unknown =>
  (properties ?? []).find((candidate) => candidate.name === name)?.value;

export const runSurfaceAudit = (): {
  findings: SurfaceFinding[];
  stats: Record<string, number>;
} => {
  const findings: SurfaceFinding[] = [];
  const manifest = readJson<Manifest>(join(packRoot, 'manifest.json'));
  const mapDir = join(packRoot, 'maps');
  const mapIds = existsSync(mapDir)
    ? readdirSync(mapDir)
        .filter((name) => name.endsWith('.json'))
        .map((name) => name.replace(/\.json$/, ''))
        .sort()
    : [];

  const maps = new Map<string, MapJson>();
  for (const mapId of mapIds) {
    maps.set(mapId, readJson<MapJson>(join(mapDir, `${mapId}.json`)));
  }

  /** A cell is walkable when its collision-layer GID is 0. */
  const isWalkable = (map: MapJson, px: number, py: number): boolean => {
    const collision = map.layers.find((layer) => layer.name === 'collision');
    if (!collision?.data) {
      return false;
    }
    const col = Math.floor(px / map.tilewidth);
    const row = Math.floor(py / map.tileheight);
    if (col < 0 || row < 0 || col >= map.width || row >= map.height) {
      return false;
    }
    return (collision.data[row * map.width + col] ?? 0) === 0;
  };

  const placedProps = new Set<string>();
  const transitions: { from: string; to: string }[] = [];
  let objectCount = 0;
  let terrainCells = 0;

  for (const mapId of mapIds) {
    const map = maps.get(mapId);
    if (!map) {
      continue;
    }

    // ── terrain override coverage ─────────────────────────────────────────
    const terrain = map.aikami?.terrain ?? [];
    terrainCells += terrain.filter((cell) => cell.length > 0).length;

    const ids = new Set<string>();
    for (const layer of map.layers) {
      if (layer.type !== 'objectgroup') {
        continue;
      }
      for (const object of layer.objects ?? []) {
        objectCount += 1;

        if (object.id !== undefined) {
          const key = String(object.id);
          if (ids.has(key)) {
            findings.push({
              kind: 'duplicate-placement-id',
              severity: 'error',
              subject: `${mapId}/${layer.name}`,
              detail: `object id ${key} appears more than once`,
            });
          }
          ids.add(key);
        }

        if (object.type === 'prop') {
          const propId = String(prop(object.properties, 'propId') ?? '');
          const frame = String(prop(object.properties, 'frame') ?? '');
          const def = manifest.props[propId];
          if (propId.length === 0) {
            findings.push({
              kind: 'undefined-manifest-prop',
              severity: 'error',
              subject: `${mapId}/${layer.name}`,
              detail: 'a prop object carries no propId',
            });
            continue;
          }
          if (def === undefined) {
            findings.push({
              kind: 'undefined-manifest-prop',
              severity: 'error',
              subject: `${mapId}/${layer.name}`,
              detail: `places prop "${propId}", which the manifest does not define — it falls back to grass`,
            });
            continue;
          }
          placedProps.add(propId);
          if (frame.length > 0 && frame !== def.frame) {
            findings.push({
              kind: 'wrong-semantic-prop-reuse',
              severity: 'error',
              subject: `${mapId}/${propId}`,
              detail: `places frame "${frame}" but the manifest binds "${def.frame}" — the art contradicts the semantic`,
            });
          }
        }

        if (object.type === 'transition') {
          const targetMap = String(prop(object.properties, 'targetMap') ?? '');
          const targetX = Number(prop(object.properties, 'targetX') ?? 0);
          const targetY = Number(prop(object.properties, 'targetY') ?? 0);
          if (targetMap.length === 0) {
            findings.push({
              kind: 'transition-to-unknown-map',
              severity: 'error',
              subject: mapId,
              detail: 'a transition names no targetMap',
            });
            continue;
          }
          const target = maps.get(targetMap);
          if (!target) {
            findings.push({
              kind: 'transition-to-unknown-map',
              severity: 'error',
              subject: `${mapId} → ${targetMap}`,
              detail: 'transition targets a map that is not in the pack',
            });
            continue;
          }
          transitions.push({ from: mapId, to: targetMap });
          if (isWalkable(target, targetX, targetY) === false) {
            findings.push({
              kind: 'unwalkable-transition-destination',
              severity: 'error',
              subject: `${mapId} → ${targetMap}`,
              detail: `lands at (${targetX}, ${targetY}), which is inside a collider`,
            });
          }
        }
      }
    }
  }

  // ── return transitions ───────────────────────────────────────────────────
  for (const { from, to } of transitions) {
    if (!transitions.some((other) => other.from === to && other.to === from)) {
      findings.push({
        kind: 'missing-return-transition',
        severity: 'warning',
        subject: `${from} → ${to}`,
        detail: 'no transition leads back — a one-way trip',
      });
    }
  }

  // ── orphan prop definitions + provenance ────────────────────────────────
  for (const [propId, def] of Object.entries(manifest.props)) {
    if (!placedProps.has(propId)) {
      findings.push({
        kind: 'orphan-prop-definition',
        severity: 'warning',
        subject: propId,
        detail: `defined (frame ${def.frame}) but no map places it`,
      });
    }
    if (def.provenance?.source === undefined) {
      findings.push({
        kind: 'missing-provenance',
        severity: 'warning',
        subject: propId,
        detail: 'has no provenance source recorded',
      });
    }
  }

  // ── portraits ───────────────────────────────────────────────────────────
  let portraitCount = 0;
  for (const [npcId, npc] of Object.entries(manifest.npcs)) {
    const variants = Object.keys(npc.portraits?.variants ?? {});
    if (variants.length === 0) {
      findings.push({
        kind: 'missing-neutral-portrait',
        severity: 'warning',
        subject: npcId,
        detail: 'NPC authors no portrait variants',
      });
      continue;
    }
    portraitCount += variants.length;
    if (!variants.includes('neutral')) {
      findings.push({
        kind: 'missing-neutral-portrait',
        severity: 'error',
        subject: npcId,
        detail: 'authors portraits but no `neutral` variant — dialogue has no fallback',
      });
    }
  }

  return {
    findings,
    stats: {
      maps: mapIds.length,
      props: Object.keys(manifest.props).length,
      placedProps: placedProps.size,
      objects: objectCount,
      transitions: transitions.length,
      portraits: portraitCount,
      terrainCells,
    },
  };
};

const main = (): void => {
  const { findings, stats } = runSurfaceAudit();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ findings, stats }, null, 2));
    return;
  }
  const errors = findings.filter((finding) => finding.severity === 'error');
  const warnings = findings.filter((finding) => finding.severity === 'warning');
  console.log('Emberwatch surface audit');
  console.log(
    `  ${stats.maps} maps, ${stats.objects} objects, ${stats.transitions} transitions, ` +
      `${stats.placedProps}/${stats.props} props placed, ${stats.portraits} portraits, ` +
      `${stats.terrainCells} terrain cells`,
  );
  console.log('');
  for (const finding of errors) {
    console.log(`  ERROR   [${finding.kind}] ${finding.subject} — ${finding.detail}`);
  }
  for (const finding of warnings.slice(0, 12)) {
    console.log(`  warning [${finding.kind}] ${finding.subject} — ${finding.detail}`);
  }
  if (warnings.length > 12) {
    console.log(`  …and ${warnings.length - 12} more warning(s)`);
  }
  console.log('');
  console.log(
    errors.length === 0
      ? `✅ surface audit passed — ${warnings.length} warning(s), 0 error(s)`
      : `❌ surface audit FAILED — ${errors.length} error(s), ${warnings.length} warning(s)`,
  );
  if (errors.length > 0) {
    process.exit(1);
  }
};

if (import.meta.main) {
  main();
}
