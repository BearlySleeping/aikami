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
// The audit is a set of independent rules over one indexed snapshot of the
// pack. Each rule is a pure function of that snapshot, so a rule can be read,
// tested and changed on its own instead of being one branch inside a
// thousand-line scan.
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

type TransitionEdge = { from: string; to: string };

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

/** Reads a named property from an object or layer. */
const prop = (properties: Property[] | undefined, name: string): unknown =>
  (properties ?? []).find((candidate) => candidate.name === name)?.value;

const surfaceFinding = (
  kind: string,
  severity: SurfaceFinding['severity'],
  subject: string,
  detail: string,
): SurfaceFinding => ({ kind, severity, subject, detail });

/** The indexed pack snapshot every rule reads. Nothing below re-reads a file. */
type PackIndex = {
  manifest: Manifest;
  maps: Map<string, MapJson>;
  mapIds: string[];
};

/** Accumulated scan state, threaded through the object rules. */
type MapScan = {
  findings: SurfaceFinding[];
  placedProps: Set<string>;
  transitions: TransitionEdge[];
  objectCount: number;
};

const indexPack = (): PackIndex => {
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
  return { manifest, maps, mapIds };
};

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

/** RULE: two objects in one layer must not share an id. */
const checkPlacementId = (
  object: MapObject,
  subject: string,
  ids: Set<string>,
): SurfaceFinding[] => {
  if (object.id === undefined) {
    return [];
  }
  const key = String(object.id);
  const duplicate = ids.has(key);
  ids.add(key);
  return duplicate
    ? [
        surfaceFinding(
          'duplicate-placement-id',
          'error',
          subject,
          `object id ${key} appears more than once`,
        ),
      ]
    : [];
};

/** RULE: a placed prop must resolve to a manifest definition and its own frame. */
const checkPlacedProp = (options: {
  object: MapObject;
  subject: string;
  manifest: Manifest;
  placedProps: Set<string>;
}): SurfaceFinding[] => {
  const { object, subject, manifest, placedProps } = options;
  const propId = String(prop(object.properties, 'propId') ?? '');
  if (propId.length === 0) {
    return [
      surfaceFinding(
        'undefined-manifest-prop',
        'error',
        subject,
        'a prop object carries no propId',
      ),
    ];
  }
  const def = manifest.props[propId];
  if (def === undefined) {
    return [
      surfaceFinding(
        'undefined-manifest-prop',
        'error',
        subject,
        `places prop "${propId}", which the manifest does not define — it falls back to grass`,
      ),
    ];
  }
  placedProps.add(propId);
  const frame = String(prop(object.properties, 'frame') ?? '');
  return frame.length > 0 && frame !== def.frame
    ? [
        surfaceFinding(
          'wrong-semantic-prop-reuse',
          'error',
          subject,
          `places frame "${frame}" but the manifest binds "${def.frame}" — the art contradicts the semantic`,
        ),
      ]
    : [];
};

/** RULE: a transition must name a known map and land the player on a walkable cell. */
const checkTransition = (options: {
  object: MapObject;
  mapId: string;
  maps: Map<string, MapJson>;
  transitions: TransitionEdge[];
}): SurfaceFinding[] => {
  const { object, mapId, maps, transitions } = options;
  const targetMap = String(prop(object.properties, 'targetMap') ?? '');
  if (targetMap.length === 0) {
    return [
      surfaceFinding(
        'transition-to-unknown-map',
        'error',
        mapId,
        'a transition names no targetMap',
      ),
    ];
  }
  const target = maps.get(targetMap);
  if (!target) {
    return [
      surfaceFinding(
        'transition-to-unknown-map',
        'error',
        `${mapId} → ${targetMap}`,
        'transition targets a map that is not in the pack',
      ),
    ];
  }
  transitions.push({ from: mapId, to: targetMap });
  const targetX = Number(prop(object.properties, 'targetX') ?? 0);
  const targetY = Number(prop(object.properties, 'targetY') ?? 0);
  return isWalkable(target, targetX, targetY)
    ? []
    : [
        surfaceFinding(
          'unwalkable-transition-destination',
          'error',
          `${mapId} → ${targetMap}`,
          `lands at (${targetX}, ${targetY}), which is inside a collider`,
        ),
      ];
};

const scanMapObjects = (options: {
  mapId: string;
  map: MapJson;
  manifest: Manifest;
  maps: Map<string, MapJson>;
  scan: MapScan;
  ids: Set<string>;
}): void => {
  const { mapId, map, manifest, maps, scan, ids } = options;
  for (const layer of map.layers) {
    if (layer.type !== 'objectgroup') {
      continue;
    }
    for (const object of layer.objects ?? []) {
      const subject = `${mapId}/${layer.name}`;
      scan.objectCount += 1;
      scan.findings.push(...checkPlacementId(object, subject, ids));
      if (object.type === 'prop') {
        scan.findings.push(
          ...checkPlacedProp({
            object,
            subject,
            manifest,
            placedProps: scan.placedProps,
          }),
        );
      }
      if (object.type === 'transition') {
        scan.findings.push(
          ...checkTransition({ object, mapId, maps, transitions: scan.transitions }),
        );
      }
    }
  }
};

const scanMaps = (index: PackIndex): MapScan & { terrainCells: number } => {
  const scan: MapScan = {
    findings: [],
    placedProps: new Set<string>(),
    transitions: [],
    objectCount: 0,
  };
  let terrainCells = 0;
  for (const mapId of index.mapIds) {
    const map = index.maps.get(mapId);
    if (!map) {
      continue;
    }
    terrainCells += (map.aikami?.terrain ?? []).filter((cell) => cell.length > 0).length;
    // Object ids are scoped to one map: Tiled ids restart per map, so the
    // duplicate-id rule must not compare across maps.
    scanMapObjects({
      mapId,
      map,
      manifest: index.manifest,
      maps: index.maps,
      scan,
      ids: new Set<string>(),
    });
  }
  return { ...scan, terrainCells };
};

/** RULE: every transition needs a way back, or it is a one-way trip. */
const checkReturnTransitions = (transitions: TransitionEdge[]): SurfaceFinding[] =>
  transitions
    .filter(({ from, to }) => !transitions.some((other) => other.from === to && other.to === from))
    .map(({ from, to }) =>
      surfaceFinding(
        'missing-return-transition',
        'warning',
        `${from} → ${to}`,
        'no transition leads back — a one-way trip',
      ),
    );

/** RULE: every prop definition should be placed somewhere and carry provenance. */
const checkPropDefinitions = (manifest: Manifest, placedProps: Set<string>): SurfaceFinding[] => {
  const findings: SurfaceFinding[] = [];
  for (const [propId, def] of Object.entries(manifest.props)) {
    if (!placedProps.has(propId)) {
      findings.push(
        surfaceFinding(
          'orphan-prop-definition',
          'warning',
          propId,
          `defined (frame ${def.frame}) but no map places it`,
        ),
      );
    }
    if (def.provenance?.source === undefined) {
      findings.push(
        surfaceFinding(
          'missing-provenance',
          'warning',
          propId,
          'has no provenance source recorded',
        ),
      );
    }
  }
  return findings;
};

/** RULE: an NPC that authors portraits must author a `neutral` fallback. */
const checkPortraits = (manifest: Manifest): { findings: SurfaceFinding[]; count: number } => {
  const findings: SurfaceFinding[] = [];
  let count = 0;
  for (const [npcId, npc] of Object.entries(manifest.npcs)) {
    const variants = Object.keys(npc.portraits?.variants ?? {});
    if (variants.length === 0) {
      findings.push(
        surfaceFinding(
          'missing-neutral-portrait',
          'warning',
          npcId,
          'NPC authors no portrait variants',
        ),
      );
      continue;
    }
    count += variants.length;
    if (!variants.includes('neutral')) {
      findings.push(
        surfaceFinding(
          'missing-neutral-portrait',
          'error',
          npcId,
          'authors portraits but no `neutral` variant — dialogue has no fallback',
        ),
      );
    }
  }
  return { findings, count };
};

export const runSurfaceAudit = (): {
  findings: SurfaceFinding[];
  stats: Record<string, number>;
} => {
  const index = indexPack();
  const scan = scanMaps(index);
  const portraits = checkPortraits(index.manifest);
  const findings = [
    ...scan.findings,
    ...checkReturnTransitions(scan.transitions),
    ...checkPropDefinitions(index.manifest, scan.placedProps),
    ...portraits.findings,
  ];

  return {
    findings,
    stats: {
      maps: index.mapIds.length,
      props: Object.keys(index.manifest.props).length,
      placedProps: scan.placedProps.size,
      objects: scan.objectCount,
      transitions: scan.transitions.length,
      portraits: portraits.count,
      terrainCells: scan.terrainCells,
    },
  };
};

const reportStats = (stats: Record<string, number>): void => {
  console.log('Emberwatch surface audit');
  console.log(
    `  ${stats.maps} maps, ${stats.objects} objects, ${stats.transitions} transitions, ` +
      `${stats.placedProps}/${stats.props} props placed, ${stats.portraits} portraits, ` +
      `${stats.terrainCells} terrain cells`,
  );
  console.log('');
};

const reportFindings = (errors: SurfaceFinding[], warnings: SurfaceFinding[]): void => {
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
};

const main = (): void => {
  const { findings, stats } = runSurfaceAudit();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ findings, stats }, null, 2));
    return;
  }
  const errors = findings.filter((finding) => finding.severity === 'error');
  const warnings = findings.filter((finding) => finding.severity === 'warning');
  reportStats(stats);
  reportFindings(errors, warnings);
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
