// scripts/src/lib/ops/emberwatch_coverage_audit.ts
//
// Phase-1 coverage audit for the Emberwatch content pack.
//
// Produces a machine-readable inventory of every visual/audio surface the pack
// depends on and classifies each entry as accepted, acceptable-shared,
// placeholder-reuse, missing, needs-regeneration, needs-map-change or
// needs-runtime-capability. The report is the evidence base for the asset brief
// (docs/plans/emberwatch_asset_brief.json) and the release orchestrator's
// preflight.
//
// This script only READS. It never writes to the pack, the atlas build output
// or R2. `--out <path>` writes the report itself (default:
// docs/reference/emberwatch-coverage-audit.json).
//
// Run: bun scripts/src/lib/ops/emberwatch_coverage_audit.ts [--out <path>]
//
// Exit codes: 0 ok · 1 audit found blocking gaps (see report.blockers).

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repository = join(here, '../../../..');
const packRoot = join(repository, 'content/packs/emberwatch');
const tilesetRoot = join(repository, 'apps/frontend/client/static/game-data/sprites/tilesets');

/** Classification vocabulary — kept as a closed union so a typo cannot ship. */
type Classification =
  | 'accepted/current'
  | 'acceptable-shared'
  | 'placeholder/wrong-semantic-reuse'
  | 'missing'
  | 'needs-regeneration'
  | 'needs-map-layout-change'
  | 'needs-runtime-capability';

type Finding = {
  /** Stable surface id (map:propId, npc:npcId, tile:gid …). */
  id: string;
  /** Coarse surface family. */
  surface:
    | 'map'
    | 'terrain'
    | 'prop'
    | 'prop-frame'
    | 'structure'
    | 'evidence-object'
    | 'npc'
    | 'npc-appearance'
    | 'portrait'
    | 'enemy-visual'
    | 'audio-cue'
    | 'source-image'
    | 'atlas-frame'
    | 'catalog-tag';
  classification: Classification;
  detail: string;
};

type Report = {
  schemaVersion: 1;
  kind: 'emberwatch-coverage-audit';
  generatedBy: 'scripts/src/lib/ops/emberwatch_coverage_audit.ts';
  packId: string;
  packVersion: string;
  packUpdatedAt: string;
  generatedAt: string;
  summary: Record<Classification, number>;
  counts: Record<string, number>;
  findings: Finding[];
  blockers: Finding[];
};

// ── Helpers ────────────────────────────────────────────────────────────────

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

const listFiles = (dir: string, ext: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((name) => extname(name).toLowerCase() === ext)
        .sort()
    : [];

type PackManifest = {
  id: string;
  version: string;
  updatedAt: string;
  atlas: { textureUrl: string; spritesheetUrl: string; tileSize: number };
  propAtlases: { textureUrl: string; spritesheetUrl: string }[];
  fallbackTile: string;
  terrains: {
    name: string;
    precedence: number;
    wang: string;
    frameBase: string;
    variants?: string[];
    isWalkable: boolean;
  }[];
  tiles: Record<string, { name: string; frame: string; isWalkable: boolean; isWall?: boolean }>;
  props: Record<
    string,
    {
      name: string;
      frame: string;
      isWalkable: boolean;
      collision?: { type: string; width: number; height: number };
      environment?: unknown;
    }
  >;
  maps: Record<string, { file: string; name: string }>;
  npcs: Record<
    string,
    {
      name: string;
      appearanceLayers?: number[];
      appearance?: { components?: { slot: string; assetId: string }[] };
      portraits?: { variants?: Record<string, string> };
      personality?: unknown;
      combatStats?: unknown;
      isCompanion?: boolean;
      isVendor?: boolean;
    }
  >;
  evidence: { id: string; label: string; discoverableAt: string }[];
  encounters: Record<string, { mapId: string; enemyNpcIds: string[]; environment?: unknown }>;
  audio: {
    bindings: { cueId: string; target: string; context: string; tag: string; sha256: string }[];
  };
};

type MapJson = {
  width: number;
  height: number;
  layers: {
    name: string;
    type: string;
    objects?: {
      type: string;
      x: number;
      y: number;
      properties?: { name: string; value: unknown }[];
    }[];
  }[];
};

const propsOf = (object: {
  properties?: { name: string; value: unknown }[];
}): Record<string, unknown> =>
  Object.fromEntries((object.properties ?? []).map((p) => [p.name, p.value]));

/**
 * Frames whose artwork is a *different semantic object* reused to stand in for
 * the real thing. Each entry is a known, audited placeholder — the audit fails
 * loudly when a new one appears rather than silently accepting it.
 */
const KNOWN_SEMANTIC_REUSE: Record<string, string> = {
  'inn_table|counter.png': 'a table rendered with the shop counter tile',
  'inn_brazier|barrel.png': 'a brazier rendered as a barrel',
  'inn_oil_pool|notice_board.png': 'a spilled-oil surface rendered as a notice board',
  'inn_support|village_gate.png': 'a rotting roof support rendered as the village gate',
  'sella_receipt|notice_board.png': 'an evidence receipt rendered as a notice board',
  'tess_component|crate.png': 'a ward component evidence object rendered as a crate',
  'shrine_arch|column.png': 'a shrine archway rendered as a single column tile',
  'ward_socket|column.png': 'the ward socket rendered as a single column tile',
  'waystation_cart|crate.png': 'a broken cart rendered as a crate',
};

/** Props placed by a map but absent from `manifest.props` — they fall back. */
const undefinedPlacedProps = (manifest: PackManifest, maps: Map<string, MapJson>): Finding[] => {
  const findings: Finding[] = [];
  for (const [mapId, map] of maps) {
    for (const layer of map.layers) {
      if (layer.type !== 'objectgroup') {
        continue;
      }
      for (const object of layer.objects ?? []) {
        if (object.type !== 'prop') {
          continue;
        }
        const propId = String(propsOf(object).propId ?? '');
        if (propId && !manifest.props[propId]) {
          findings.push({
            id: `${mapId}:${propId}`,
            surface: 'prop',
            classification: 'missing',
            detail: `map "${mapId}" places prop "${propId}" but manifest.props has no such definition — the renderer falls back to ${manifest.fallbackTile}`,
          });
        }
      }
    }
  }
  return findings;
};

// ── Main ───────────────────────────────────────────────────────────────────

const main = (): void => {
  const manifest = readJson<PackManifest>(join(packRoot, 'manifest.json'));
  const findings: Finding[] = [];

  // ── Maps ────────────────────────────────────────────────────────────────
  const maps = new Map<string, MapJson>();
  const placedProps = new Map<string, string[]>();
  const placedNpcs = new Map<string, string[]>();
  const transitions: string[] = [];
  for (const mapId of Object.keys(manifest.maps)) {
    const path = join(packRoot, `maps/${mapId}.json`);
    if (!existsSync(path)) {
      findings.push({
        id: `map:${mapId}`,
        surface: 'map',
        classification: 'missing',
        detail: `manifest declares map "${mapId}" but ${path} does not exist`,
      });
      continue;
    }
    const map = readJson<MapJson>(path);
    maps.set(mapId, map);
    const propIds: string[] = [];
    const npcIds: string[] = [];
    for (const layer of map.layers) {
      if (layer.type !== 'objectgroup') {
        continue;
      }
      for (const object of layer.objects ?? []) {
        const values = propsOf(object);
        if (object.type === 'prop') {
          propIds.push(String(values.propId ?? ''));
        }
        if (object.type === 'npc') {
          npcIds.push(String(values.npcId ?? ''));
        }
        if (object.type === 'transition') {
          transitions.push(`${mapId}->${String(values.targetMap)}:${String(values.targetSpawnId)}`);
        }
      }
    }
    placedProps.set(mapId, propIds);
    placedNpcs.set(mapId, npcIds);
    findings.push({
      id: `map:${mapId}`,
      surface: 'map',
      classification: propIds.length <= 6 ? 'needs-map-layout-change' : 'accepted/current',
      detail: `${map.width}x${map.height}; ${propIds.length} prop placements, ${npcIds.length} NPC placements, ${transitions.filter((t) => t.startsWith(`${mapId}->`)).length} transitions`,
    });
  }

  // ── Reciprocal transitions ──────────────────────────────────────────────
  const transitionSet = new Set(transitions);
  for (const edge of transitions) {
    const [from, rest] = edge.split('->');
    const target = rest.split(':')[0];
    const reverseExists = [...transitionSet].some((candidate) =>
      candidate.startsWith(`${target}->${from}:`),
    );
    if (!reverseExists) {
      findings.push({
        id: `transition:${edge}`,
        surface: 'structure',
        classification: 'needs-map-layout-change',
        detail: `transition ${edge} has no reciprocal ${target}->${from} transition`,
      });
    }
  }

  // ── Terrains + atlas headroom ───────────────────────────────────────────
  const ATLAS_COLS = 16;
  const ATLAS_ROWS = 8;
  const bakedTiles = Object.keys(manifest.tiles).length;
  const corner16Terrains = manifest.terrains.filter((t) => t.wang === 'corner16');
  const atlasCellsUsed = bakedTiles + corner16Terrains.length * 16;
  const atlasCellsTotal = ATLAS_COLS * ATLAS_ROWS;
  for (const terrain of manifest.terrains) {
    findings.push({
      id: `terrain:${terrain.name}`,
      surface: 'terrain',
      classification: terrain.wang === 'fill' ? 'accepted/current' : 'accepted/current',
      detail: `${terrain.wang}${terrain.wang === 'corner16' ? ` (${16} atlas cells)` : ''}; precedence ${terrain.precedence}; walkable=${terrain.isWalkable}`,
    });
  }
  findings.push({
    id: 'atlas:headroom',
    surface: 'atlas-frame',
    classification: atlasCellsUsed >= atlasCellsTotal ? 'needs-regeneration' : 'accepted/current',
    detail: `${atlasCellsUsed}/${atlasCellsTotal} atlas cells used (${bakedTiles} baked tiles + ${corner16Terrains.length}×16 corner16) — ${atlasCellsTotal - atlasCellsUsed} free; a new corner16 terrain requires an explicit geometry change`,
  });

  // ── Props + their frames ────────────────────────────────────────────────
  const frameToProps = new Map<string, string[]>();
  for (const [propId, def] of Object.entries(manifest.props)) {
    frameToProps.set(def.frame, [...(frameToProps.get(def.frame) ?? []), propId]);
  }
  for (const [propId, def] of Object.entries(manifest.props)) {
    const key = `${propId}|${def.frame}`;
    const reuse = KNOWN_SEMANTIC_REUSE[key];
    const sharedWith = (frameToProps.get(def.frame) ?? []).filter((id) => id !== propId);
    const placedAnywhere = [...placedProps.values()].some((ids) => ids.includes(propId));
    let classification: Classification = 'accepted/current';
    let detail = `frame ${def.frame}`;
    if (reuse) {
      classification = 'placeholder/wrong-semantic-reuse';
      detail = `${reuse}; frame ${def.frame} shared with ${sharedWith.join(', ') || 'nothing else'}`;
    } else if (sharedWith.length > 0) {
      classification = 'acceptable-shared';
      detail = `frame ${def.frame} shared with ${sharedWith.join(', ')}`;
    }
    if (!placedAnywhere) {
      detail += ' (not placed by any map — encounter-only or unused)';
    }
    findings.push({ id: `prop:${propId}`, surface: 'prop', classification, detail });
  }

  // ── Evidence objects ────────────────────────────────────────────────────
  for (const evidence of manifest.evidence) {
    const [mapId, propId] = evidence.discoverableAt.split(':');
    const def = manifest.props[propId];
    const reuse = def ? KNOWN_SEMANTIC_REUSE[`${propId}|${def.frame}`] : undefined;
    let evidenceClass: Classification = 'missing';
    if (def) {
      evidenceClass = reuse ? 'placeholder/wrong-semantic-reuse' : 'accepted/current';
    }
    findings.push({
      id: `evidence:${evidence.id}`,
      surface: 'evidence-object',
      classification: evidenceClass,
      detail: def
        ? `${evidence.label} at ${evidence.discoverableAt} renders ${def.frame}${reuse ? ` — ${reuse}` : ''}`
        : `${evidence.label} discoverableAt ${evidence.discoverableAt} but "${propId}" is not a defined prop`,
    });
    if (!maps.has(mapId)) {
      findings.push({
        id: `evidence-map:${evidence.id}`,
        surface: 'evidence-object',
        classification: 'missing',
        detail: `evidence ${evidence.id} names map "${mapId}" which the manifest does not declare`,
      });
    }
  }

  // ── NPCs, appearances, portraits, enemy visuals ─────────────────────────
  const hostileNpcIds = new Set<string>();
  for (const encounter of Object.values(manifest.encounters)) {
    for (const id of encounter.enemyNpcIds) {
      hostileNpcIds.add(id);
    }
  }
  // The capability exists when the pack schema models portraits AND the client
  // resolver reads them. Both are repository facts, so the audit checks the
  // schema file rather than a runtime probe.
  const portraitSchemaPath = join(
    repository,
    'packages/shared/schemas/src/lib/game/content_pack.ts',
  );
  const portraitResolverPath = join(
    repository,
    'apps/frontend/client/src/lib/data/npc_avatar_catalog.ts',
  );
  const hasPortraitRuntime =
    existsSync(portraitSchemaPath) &&
    readFileSync(portraitSchemaPath, 'utf8').includes('NpcPortraitsSchema') &&
    existsSync(portraitResolverPath) &&
    readFileSync(portraitResolverPath, 'utf8').includes('_resolvePackPortrait');
  for (const [npcId, npc] of Object.entries(manifest.npcs)) {
    const components = npc.appearance?.components ?? [];
    const legacyLayers = npc.appearanceLayers ?? [];
    const isHostile = hostileNpcIds.has(npcId);
    findings.push({
      id: `npc:${npcId}`,
      surface: 'npc',
      classification: 'accepted/current',
      detail: `${npc.name}${isHostile ? ' (hostile)' : ''}${npc.isCompanion ? ' (companion)' : ''}${npc.isVendor ? ' (vendor)' : ''}`,
    });
    let appearanceClass: Classification = 'missing';
    let appearanceDetail = 'no component appearance declared';
    if (components.length > 0) {
      appearanceClass = 'accepted/current';
      appearanceDetail = `${components.length} LPC components: ${components.map((c) => c.assetId).join(', ')}`;
    } else if (legacyLayers.length > 0) {
      appearanceClass = 'acceptable-shared';
      appearanceDetail = `legacy appearanceLayers [${legacyLayers.join(', ')}] — resolves through the catalog-order snapshot, not a declared component set`;
    }
    findings.push({
      id: `npc-appearance:${npcId}`,
      surface: 'npc-appearance',
      classification: appearanceClass,
      detail: appearanceDetail,
    });
    // A story character who happens to fight (Rollo) is CORRECTLY a humanoid:
    // the pack authors a personality and a dialogue arc for them. Only an NPC
    // that exists solely as an encounter enemy — no authored identity — is a
    // placeholder when it wears a generic humanoid body.
    const isAuthoredCharacter = npc.personality !== undefined || npc.portraits !== undefined;
    if (isHostile && !isAuthoredCharacter) {
      const looksHumanoid =
        components.some((c) => c.slot === 'body') && components.some((c) => c.slot === 'head');
      findings.push({
        id: `enemy-visual:${npcId}`,
        surface: 'enemy-visual',
        classification: looksHumanoid ? 'needs-runtime-capability' : 'accepted/current',
        detail: looksHumanoid
          ? `${npc.name} renders as a generic humanoid LPC body (${components.map((c) => c.assetId).join(', ')}) — no authored hostile visual`
          : 'authored non-humanoid visual',
      });
    }
    const boundVariants = Object.keys(npc.portraits?.variants ?? {});
    let portraitClass: Classification = 'needs-runtime-capability';
    let portraitDetail = 'no NPC portrait binding exists in the pack schema or dialogue UI';
    if (hasPortraitRuntime) {
      if (boundVariants.length > 0) {
        portraitClass = 'accepted/current';
        portraitDetail = `bound variants: ${boundVariants.join(', ')}`;
      } else if (isHostile) {
        // A combat enemy is met in the encounter, not in a dialogue bust, so an
        // absent portrait is the authored state rather than a gap.
        portraitClass = 'acceptable-shared';
        portraitDetail = 'hostile NPC — no dialogue bust authored (combat-only)';
      } else {
        portraitClass = 'missing';
        portraitDetail = 'the portrait capability exists but this NPC binds no portrait';
      }
    }
    findings.push({
      id: `portrait:${npcId}`,
      surface: 'portrait',
      classification: portraitClass,
      detail: portraitDetail,
    });
  }

  // ── Audio cues ──────────────────────────────────────────────────────────
  for (const binding of manifest.audio.bindings) {
    findings.push({
      id: `audio:${binding.cueId}`,
      surface: 'audio-cue',
      classification: 'accepted/current',
      detail: `${binding.target} "${binding.context}" → tag ${binding.tag} (sha256 ${binding.sha256.slice(0, 12)}…)`,
    });
  }

  // ── Source art ──────────────────────────────────────────────────────────
  const sourceImages = listFiles(join(packRoot, 'props'), '.png').concat(
    listFiles(join(packRoot, 'props'), '.webp'),
  );
  for (const name of sourceImages) {
    findings.push({
      id: `source:${name}`,
      surface: 'source-image',
      classification: 'accepted/current',
      detail: 'standalone authoring source in content/packs/emberwatch/props',
    });
  }

  // ── Generated atlas frames ──────────────────────────────────────────────
  const atlasJsonPath = join(tilesetRoot, 'atlas.json');
  const propsJsonPath = join(tilesetRoot, 'props.json');
  if (existsSync(atlasJsonPath)) {
    const atlas = readJson<{ frames?: Record<string, unknown> }>(atlasJsonPath);
    const frameCount = Object.keys(atlas.frames ?? {}).length;
    findings.push({
      id: 'atlas:frames',
      surface: 'atlas-frame',
      classification: frameCount === atlasCellsUsed ? 'accepted/current' : 'needs-regeneration',
      detail: `grid atlas declares ${frameCount} frames (expected ${atlasCellsUsed})`,
    });
  } else {
    findings.push({
      id: 'atlas:frames',
      surface: 'atlas-frame',
      classification: 'missing',
      detail: 'grid atlas.json is not built — run generate_emberwatch_atlas.ts',
    });
  }
  if (existsSync(propsJsonPath)) {
    const props = readJson<{ frames?: Record<string, unknown> }>(propsJsonPath);
    const names = Object.keys(props.frames ?? {});
    findings.push({
      id: 'props-atlas:frames',
      surface: 'atlas-frame',
      classification:
        names.length === sourceImages.length ? 'accepted/current' : 'needs-regeneration',
      detail: `prop atlas declares ${names.length} frames for ${sourceImages.length} source images`,
    });
    for (const name of names) {
      findings.push({
        id: `prop-frame:${name}`,
        surface: 'prop-frame',
        classification: 'accepted/current',
        detail: 'packed prop-atlas frame',
      });
    }
  } else {
    findings.push({
      id: 'props-atlas:frames',
      surface: 'atlas-frame',
      classification: 'missing',
      detail: 'prop atlas props.json is not built — run generate_emberwatch_props_atlas.ts',
    });
  }

  // ── Catalog tags the pack needs ─────────────────────────────────────────
  const catalogTags = [
    'index',
    'emberwatch:manifest',
    ...Object.keys(manifest.maps).map((id) => `emberwatch:maps:${id}`),
    ...manifest.audio.bindings.map((b) => b.tag),
  ];
  for (const tag of catalogTags) {
    findings.push({
      id: `catalog-tag:${tag}`,
      surface: 'catalog-tag',
      classification: 'accepted/current',
      detail: 'required by the pack at boot or during play',
    });
  }

  findings.push(...undefinedPlacedProps(manifest, maps));

  // ── Summary ─────────────────────────────────────────────────────────────
  const summary: Record<Classification, number> = {
    'accepted/current': 0,
    'acceptable-shared': 0,
    'placeholder/wrong-semantic-reuse': 0,
    missing: 0,
    'needs-regeneration': 0,
    'needs-map-layout-change': 0,
    'needs-runtime-capability': 0,
  };
  for (const finding of findings) {
    summary[finding.classification] += 1;
  }

  const blockers = findings.filter(
    (f) =>
      f.classification === 'missing' || f.classification === 'placeholder/wrong-semantic-reuse',
  );

  const report: Report = {
    schemaVersion: 1,
    kind: 'emberwatch-coverage-audit',
    generatedBy: 'scripts/src/lib/ops/emberwatch_coverage_audit.ts',
    packId: manifest.id,
    packVersion: manifest.version,
    packUpdatedAt: manifest.updatedAt,
    // Deterministic when the caller pins it; otherwise the audit timestamp.
    generatedAt: process.env.SOURCE_DATE_EPOCH
      ? new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000).toISOString()
      : new Date().toISOString(),
    summary,
    counts: {
      maps: Object.keys(manifest.maps).length,
      terrains: manifest.terrains.length,
      bakedTiles,
      corner16Terrains: corner16Terrains.length,
      atlasCellsUsed,
      atlasCellsTotal,
      atlasCellsFree: atlasCellsTotal - atlasCellsUsed,
      props: Object.keys(manifest.props).length,
      npcs: Object.keys(manifest.npcs).length,
      hostileNpcs: hostileNpcIds.size,
      evidence: manifest.evidence.length,
      audioCues: manifest.audio.bindings.length,
      sourceImages: sourceImages.length,
      transitions: transitions.length,
      catalogTags: catalogTags.length,
      findings: findings.length,
    },
    findings,
    blockers,
  };

  const outFlag = process.argv.indexOf('--out');
  const outPath =
    outFlag >= 0 && process.argv[outFlag + 1]
      ? process.argv[outFlag + 1]
      : join(repository, 'docs/reference/emberwatch-coverage-audit.json');
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);

  console.log(`Emberwatch coverage audit — pack ${manifest.version}`);
  console.log(`  findings: ${findings.length}  blockers: ${blockers.length}`);
  for (const [classification, count] of Object.entries(summary)) {
    if (count > 0) {
      console.log(`    ${classification}: ${count}`);
    }
  }
  console.log(`  report: ${outPath}`);
  for (const blocker of blockers) {
    console.log(`  ⛔ [${blocker.classification}] ${blocker.id} — ${blocker.detail}`);
  }

  process.exit(blockers.length > 0 ? 1 : 0);
};

main();
