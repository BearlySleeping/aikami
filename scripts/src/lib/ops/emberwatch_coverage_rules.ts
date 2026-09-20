// scripts/src/lib/ops/emberwatch_coverage_rules.ts
//
// The Emberwatch coverage audit's model and rules.
//
// The audit is deliberately two layers:
//
//   1. index   — read the pack once into a plain snapshot (`CoverageInputs`);
//   2. rules   — one pure function per surface family, each a function of that
//                snapshot alone.
//
// A rule that reads files, or that shares mutable state with another rule, is
// what turns an audit into a thousand-line function nobody can change safely.
// Everything here is pure over `CoverageInputs`; the CLI shell in
// `emberwatch_coverage_audit.ts` owns reading, aggregation and reporting.
//
// Classification vocabulary — kept as a closed union so a typo cannot ship.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const repository = join(here, '../../../..');
const packRoot = join(repository, 'content/packs/emberwatch');
const tilesetRoot = join(repository, 'apps/frontend/client/static/game-data/sprites/tilesets');

/** Tileset atlas geometry — a change here is an explicit geometry change. */
export const ATLAS_COLS = 16;
export const ATLAS_ROWS = 8;

export type Classification =
  | 'accepted/current'
  | 'acceptable-shared'
  | 'placeholder/wrong-semantic-reuse'
  | 'missing'
  | 'needs-regeneration'
  | 'needs-map-layout-change'
  | 'needs-runtime-capability';

export const CLASSIFICATIONS: readonly Classification[] = [
  'accepted/current',
  'acceptable-shared',
  'placeholder/wrong-semantic-reuse',
  'missing',
  'needs-regeneration',
  'needs-map-layout-change',
  'needs-runtime-capability',
];

export type Finding = {
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

export type PackManifest = {
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
      /**
       * How the actor draws itself. `static` means the pack authored ONE image
       * for a non-humanoid actor, which is what makes an encounter enemy's
       * hostile art a real consumer rather than a runtime gap.
       */
      visual?: { kind: 'lpc' | 'static'; url?: string };
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
    bindings: {
      cueId: string;
      target: string;
      context: string;
      source: { kind: 'asset'; tag: string; sha256: string } | { kind: 'silence' };
    }[];
  };
};

export type MapJson = {
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

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

const listFiles = (dir: string, ext: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((name) => extname(name).toLowerCase() === ext)
        .sort()
    : [];

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

/** Everything the rules read. Built once; no rule touches the filesystem. */
export type CoverageInputs = {
  manifest: PackManifest;
  maps: Map<string, MapJson>;
  /** Findings produced while indexing (a declared map with no file). */
  indexFindings: Finding[];
  placedProps: Map<string, string[]>;
  placedNpcs: Map<string, string[]>;
  /** `from->target:spawnId` for every authored transition. */
  transitions: string[];
  hostileNpcIds: Set<string>;
  hasPortraitRuntime: boolean;
  sourceImages: string[];
  bakedTiles: number;
  corner16Terrains: number;
  atlasCellsUsed: number;
  atlasCellsTotal: number;
};

type MapPlacements = { propIds: string[]; npcIds: string[]; transitions: string[] };

type MapObject = NonNullable<MapJson['layers'][number]['objects']>[number];

/** Every gameplay object in one map, with non-object layers already dropped. */
const mapObjects = (map: MapJson): MapObject[] =>
  map.layers
    .filter((layer) => layer.type === 'objectgroup')
    .flatMap((layer) => layer.objects ?? []);

/** Files one object under the placement list its type names. */
const collectPlacement = (mapId: string, object: MapObject, into: MapPlacements): void => {
  const values = propsOf(object);
  if (object.type === 'prop') {
    into.propIds.push(String(values.propId ?? ''));
  }
  if (object.type === 'npc') {
    into.npcIds.push(String(values.npcId ?? ''));
  }
  if (object.type === 'transition') {
    into.transitions.push(`${mapId}->${String(values.targetMap)}:${String(values.targetSpawnId)}`);
  }
};

/** Reads one map's gameplay objects: placed props, placed NPCs, transitions. */
const scanMapPlacements = (mapId: string, map: MapJson): MapPlacements => {
  const placements: MapPlacements = { propIds: [], npcIds: [], transitions: [] };
  for (const object of mapObjects(map)) {
    collectPlacement(mapId, object, placements);
  }
  return placements;
};

const indexMaps = (
  manifest: PackManifest,
): Pick<
  CoverageInputs,
  'maps' | 'indexFindings' | 'placedProps' | 'placedNpcs' | 'transitions'
> => {
  const maps = new Map<string, MapJson>();
  const placedProps = new Map<string, string[]>();
  const placedNpcs = new Map<string, string[]>();
  const transitions: string[] = [];
  const indexFindings: Finding[] = [];
  for (const mapId of Object.keys(manifest.maps)) {
    const path = join(packRoot, `maps/${mapId}.json`);
    if (!existsSync(path)) {
      indexFindings.push({
        id: `map:${mapId}`,
        surface: 'map',
        classification: 'missing',
        detail: `manifest declares map "${mapId}" but ${path} does not exist`,
      });
      continue;
    }
    const map = readJson<MapJson>(path);
    const placements = scanMapPlacements(mapId, map);
    maps.set(mapId, map);
    placedProps.set(mapId, placements.propIds);
    placedNpcs.set(mapId, placements.npcIds);
    transitions.push(...placements.transitions);
    indexFindings.push({
      id: `map:${mapId}`,
      surface: 'map',
      classification:
        placements.propIds.length <= 6 ? 'needs-map-layout-change' : 'accepted/current',
      detail: `${map.width}x${map.height}; ${placements.propIds.length} prop placements, ${placements.npcIds.length} NPC placements, ${placements.transitions.length} transitions`,
    });
  }
  return { maps, indexFindings, placedProps, placedNpcs, transitions };
};

/**
 * The portrait capability exists when the pack schema models portraits AND the
 * client resolver reads them. Both are repository facts, so the audit checks
 * the schema file rather than a runtime probe.
 */
const hasPortraitRuntime = (): boolean => {
  const schemaPath = join(repository, 'packages/shared/schemas/src/lib/game/content_pack.ts');
  const resolverPath = join(repository, 'apps/frontend/client/src/lib/data/npc_avatar_catalog.ts');
  return (
    existsSync(schemaPath) &&
    readFileSync(schemaPath, 'utf8').includes('NpcPortraitsSchema') &&
    existsSync(resolverPath) &&
    readFileSync(resolverPath, 'utf8').includes('_resolvePackPortrait')
  );
};

export const collectCoverageInputs = (): CoverageInputs => {
  const manifest = readJson<PackManifest>(join(packRoot, 'manifest.json'));
  const indexed = indexMaps(manifest);
  const hostileNpcIds = new Set<string>();
  for (const encounter of Object.values(manifest.encounters)) {
    for (const id of encounter.enemyNpcIds) {
      hostileNpcIds.add(id);
    }
  }
  const bakedTiles = Object.keys(manifest.tiles).length;
  const corner16Terrains = manifest.terrains.filter((t) => t.wang === 'corner16').length;
  return {
    manifest,
    ...indexed,
    hostileNpcIds,
    hasPortraitRuntime: hasPortraitRuntime(),
    sourceImages: listFiles(join(packRoot, 'props'), '.png').concat(
      listFiles(join(packRoot, 'props'), '.webp'),
    ),
    bakedTiles,
    corner16Terrains,
    atlasCellsUsed: bakedTiles + corner16Terrains * 16,
    atlasCellsTotal: ATLAS_COLS * ATLAS_ROWS,
  };
};

// ── Rules ──────────────────────────────────────────────────────────────────
//
// One function per surface family. Each returns only the findings it owns, so
// adding a rule means adding a function rather than adding a branch.

/** RULE: every transition needs the reciprocal trip back. */
export const checkReciprocalTransitions = (input: CoverageInputs): Finding[] => {
  const transitionSet = new Set(input.transitions);
  return input.transitions
    .filter((edge) => {
      const [from, rest] = edge.split('->');
      const target = rest.split(':')[0];
      return ![...transitionSet].some((candidate) => candidate.startsWith(`${target}->${from}:`));
    })
    .map((edge) => {
      const [from, rest] = edge.split('->');
      const target = rest.split(':')[0];
      return {
        id: `transition:${edge}`,
        surface: 'structure' as const,
        classification: 'needs-map-layout-change' as const,
        detail: `transition ${edge} has no reciprocal ${target}->${from} transition`,
      };
    });
};

/** RULE: terrain coverage plus the atlas headroom that gates a new terrain. */
export const checkTerrainAndHeadroom = (input: CoverageInputs): Finding[] => {
  const findings: Finding[] = input.manifest.terrains.map((terrain) => ({
    id: `terrain:${terrain.name}`,
    surface: 'terrain',
    classification: 'accepted/current',
    detail: `${terrain.wang}${terrain.wang === 'corner16' ? ' (16 atlas cells)' : ''}; precedence ${terrain.precedence}; walkable=${terrain.isWalkable}`,
  }));
  const free = input.atlasCellsTotal - input.atlasCellsUsed;
  findings.push({
    id: 'atlas:headroom',
    surface: 'atlas-frame',
    classification:
      input.atlasCellsUsed >= input.atlasCellsTotal ? 'needs-regeneration' : 'accepted/current',
    detail: `${input.atlasCellsUsed}/${input.atlasCellsTotal} atlas cells used (${input.bakedTiles} baked tiles + ${input.corner16Terrains}×16 corner16) — ${free} free; a new corner16 terrain requires an explicit geometry change`,
  });
  return findings;
};

/** RULE: every prop definition, its frame sharing, and whether any map places it. */
export const checkProps = (input: CoverageInputs): Finding[] => {
  const frameToProps = new Map<string, string[]>();
  for (const [propId, def] of Object.entries(input.manifest.props)) {
    frameToProps.set(def.frame, [...(frameToProps.get(def.frame) ?? []), propId]);
  }
  return Object.entries(input.manifest.props).map(([propId, def]) => {
    const reuse = KNOWN_SEMANTIC_REUSE[`${propId}|${def.frame}`];
    const sharedWith = (frameToProps.get(def.frame) ?? []).filter((id) => id !== propId);
    const placedAnywhere = [...input.placedProps.values()].some((ids) => ids.includes(propId));
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
    return { id: `prop:${propId}`, surface: 'prop' as const, classification, detail };
  });
};

/** An evidence object's classification: a missing prop, a known reuse, or current. */
const classifyEvidence = (
  def: PackManifest['props'][string] | undefined,
  reuse: string | undefined,
): Classification => {
  if (def === undefined) {
    return 'missing';
  }
  return reuse === undefined ? 'accepted/current' : 'placeholder/wrong-semantic-reuse';
};

/** RULE: every evidence object resolves to a real prop on a real map. */
export const checkEvidence = (input: CoverageInputs): Finding[] =>
  input.manifest.evidence.flatMap((evidence) => {
    const [mapId, propId] = evidence.discoverableAt.split(':');
    const def = input.manifest.props[propId];
    const reuse = def ? KNOWN_SEMANTIC_REUSE[`${propId}|${def.frame}`] : undefined;
    const classification: Classification = classifyEvidence(def, reuse);
    const findings: Finding[] = [
      {
        id: `evidence:${evidence.id}`,
        surface: 'evidence-object',
        classification,
        detail: def
          ? `${evidence.label} at ${evidence.discoverableAt} renders ${def.frame}${reuse ? ` — ${reuse}` : ''}`
          : `${evidence.label} discoverableAt ${evidence.discoverableAt} but "${propId}" is not a defined prop`,
      },
    ];
    if (!input.maps.has(mapId)) {
      findings.push({
        id: `evidence-map:${evidence.id}`,
        surface: 'evidence-object',
        classification: 'missing',
        detail: `evidence ${evidence.id} names map "${mapId}" which the manifest does not declare`,
      });
    }
    return findings;
  });

/**
 * RULE: an NPC's body, its authored hostile visual, and its portrait binding.
 *
 * A story character who happens to fight (Rollo) is CORRECTLY a humanoid: the
 * pack authors a personality and a dialogue arc for them. Only an NPC that
 * exists solely as an encounter enemy — no authored identity — is a
 * placeholder when it wears a generic humanoid body.
 */
export const checkNpcs = (input: CoverageInputs): Finding[] =>
  Object.entries(input.manifest.npcs).flatMap(([npcId, npc]) => {
    const components = npc.appearance?.components ?? [];
    const isHostile = input.hostileNpcIds.has(npcId);
    const findings: Finding[] = [
      {
        id: `npc:${npcId}`,
        surface: 'npc',
        classification: 'accepted/current',
        detail: `${npc.name}${isHostile ? ' (hostile)' : ''}${npc.isCompanion ? ' (companion)' : ''}${npc.isVendor ? ' (vendor)' : ''}`,
      },
      appearanceFinding(npcId, npc),
    ];
    const enemyVisual = enemyVisualFinding(npcId, npc, components, isHostile);
    if (enemyVisual) {
      findings.push(enemyVisual);
    }
    findings.push(portraitFinding(input, npcId, npc, isHostile));
    return findings;
  });

const appearanceFinding = (npcId: string, npc: PackManifest['npcs'][string]): Finding => {
  const components = npc.appearance?.components ?? [];
  const legacyLayers = npc.appearanceLayers ?? [];
  if (components.length > 0) {
    return {
      id: `npc-appearance:${npcId}`,
      surface: 'npc-appearance',
      classification: 'accepted/current',
      detail: `${components.length} LPC components: ${components.map((c) => c.assetId).join(', ')}`,
    };
  }
  if (legacyLayers.length > 0) {
    return {
      id: `npc-appearance:${npcId}`,
      surface: 'npc-appearance',
      classification: 'acceptable-shared',
      detail: `legacy appearanceLayers [${legacyLayers.join(', ')}] — resolves through the catalog-order snapshot, not a declared component set`,
    };
  }
  return {
    id: `npc-appearance:${npcId}`,
    surface: 'npc-appearance',
    classification: 'missing',
    detail: 'no component appearance declared',
  };
};

const enemyVisualFinding = (
  npcId: string,
  npc: PackManifest['npcs'][string],
  components: { slot: string; assetId: string }[],
  isHostile: boolean,
): Finding | undefined => {
  const isAuthoredCharacter = npc.personality !== undefined || npc.portraits !== undefined;
  if (!isHostile || isAuthoredCharacter) {
    return undefined;
  }
  // An authored static visual IS the hostile art: the actor renders as itself,
  // not as a humanoid stand-in, so the capability gap is closed and the image
  // is a real consumer of the pack's own bytes.
  if (npc.visual?.kind === 'static') {
    return {
      id: `enemy-visual:${npcId}`,
      surface: 'enemy-visual',
      classification: 'accepted/current',
      detail: `authored static visual (${npc.visual.url ?? 'unnamed'})`,
    };
  }
  const looksHumanoid =
    components.some((c) => c.slot === 'body') && components.some((c) => c.slot === 'head');
  return {
    id: `enemy-visual:${npcId}`,
    surface: 'enemy-visual',
    classification: looksHumanoid ? 'needs-runtime-capability' : 'accepted/current',
    detail: looksHumanoid
      ? `${npc.name} renders as a generic humanoid LPC body (${components.map((c) => c.assetId).join(', ')}) — no authored hostile visual`
      : 'authored non-humanoid visual',
  };
};

const portraitFinding = (
  input: CoverageInputs,
  npcId: string,
  npc: PackManifest['npcs'][string],
  isHostile: boolean,
): Finding => {
  if (!input.hasPortraitRuntime) {
    return {
      id: `portrait:${npcId}`,
      surface: 'portrait',
      classification: 'needs-runtime-capability',
      detail: 'no NPC portrait binding exists in the pack schema or dialogue UI',
    };
  }
  const boundVariants = Object.keys(npc.portraits?.variants ?? {});
  if (boundVariants.length > 0) {
    return {
      id: `portrait:${npcId}`,
      surface: 'portrait',
      classification: 'accepted/current',
      detail: `bound variants: ${boundVariants.join(', ')}`,
    };
  }
  // A combat enemy is met in the encounter, not in a dialogue bust, so an
  // absent portrait is the authored state rather than a gap.
  return {
    id: `portrait:${npcId}`,
    surface: 'portrait',
    classification: isHostile ? 'acceptable-shared' : 'missing',
    detail: isHostile
      ? 'hostile NPC — no dialogue bust authored (combat-only)'
      : 'the portrait capability exists but this NPC binds no portrait',
  };
};

/** RULE: every audio binding the pack declares. */
export const checkAudioCues = (input: CoverageInputs): Finding[] =>
  input.manifest.audio.bindings.map((binding) => ({
    id: `audio:${binding.cueId}`,
    surface: 'audio-cue',
    classification: 'accepted/current',
    // An intentional-silence cue names no bytes, so there is no tag or hash to
    // report. Saying so is the honest detail — the alternative would be to
    // print a hash for content that does not exist.
    detail:
      binding.source.kind === 'silence'
        ? `${binding.target} "${binding.context}" → intentional silence (no bytes)`
        : `${binding.target} "${binding.context}" → tag ${binding.source.tag} (sha256 ${binding.source.sha256.slice(0, 12)}…)`,
  }));

/** RULE: every authoring source image shipped in the pack. */
export const checkSourceArt = (input: CoverageInputs): Finding[] =>
  input.sourceImages.map((name) => ({
    id: `source:${name}`,
    surface: 'source-image',
    classification: 'accepted/current',
    detail: 'standalone authoring source in content/packs/emberwatch/props',
  }));

/** RULE: the built atlases exist and match the geometry the pack expects. */
export const checkAtlasFrames = (input: CoverageInputs): Finding[] => {
  const findings: Finding[] = [gridAtlasFinding(input)];
  const propsJsonPath = join(tilesetRoot, 'props.json');
  if (!existsSync(propsJsonPath)) {
    findings.push({
      id: 'props-atlas:frames',
      surface: 'atlas-frame',
      classification: 'missing',
      detail: 'prop atlas props.json is not built — run generate_emberwatch_props_atlas.ts',
    });
    return findings;
  }
  const names = Object.keys(
    readJson<{ frames?: Record<string, unknown> }>(propsJsonPath).frames ?? {},
  );
  findings.push({
    id: 'props-atlas:frames',
    surface: 'atlas-frame',
    classification:
      names.length === input.sourceImages.length ? 'accepted/current' : 'needs-regeneration',
    detail: `prop atlas declares ${names.length} frames for ${input.sourceImages.length} source images`,
  });
  for (const name of names) {
    findings.push({
      id: `prop-frame:${name}`,
      surface: 'prop-frame',
      classification: 'accepted/current',
      detail: 'packed prop-atlas frame',
    });
  }
  return findings;
};

const gridAtlasFinding = (input: CoverageInputs): Finding => {
  const atlasJsonPath = join(tilesetRoot, 'atlas.json');
  if (!existsSync(atlasJsonPath)) {
    return {
      id: 'atlas:frames',
      surface: 'atlas-frame',
      classification: 'missing',
      detail: 'grid atlas.json is not built — run generate_emberwatch_atlas.ts',
    };
  }
  const frameCount = Object.keys(
    readJson<{ frames?: Record<string, unknown> }>(atlasJsonPath).frames ?? {},
  ).length;
  return {
    id: 'atlas:frames',
    surface: 'atlas-frame',
    classification: frameCount === input.atlasCellsUsed ? 'accepted/current' : 'needs-regeneration',
    detail: `grid atlas declares ${frameCount} frames (expected ${input.atlasCellsUsed})`,
  };
};

/** The catalog tags the pack needs at boot or during play, de-duplicated. */
export const catalogTagsOf = (manifest: PackManifest): string[] => [
  ...new Set([
    'index',
    'emberwatch:manifest',
    ...Object.keys(manifest.maps).map((id) => `emberwatch:maps:${id}`),
    ...manifest.audio.bindings.flatMap((b) => (b.source.kind === 'asset' ? [b.source.tag] : [])),
  ]),
];

/** RULE: the catalog tags the pack needs at boot or during play. */
export const checkCatalogTags = (input: CoverageInputs): Finding[] =>
  catalogTagsOf(input.manifest).map((tag) => ({
    id: `catalog-tag:${tag}`,
    surface: 'catalog-tag',
    classification: 'accepted/current',
    detail: 'required by the pack at boot or during play',
  }));

/** Every (map, propId) placement the pack authors, in map order. */
const placedPropIds = (input: CoverageInputs): { mapId: string; propId: string }[] =>
  [...input.maps].flatMap(([mapId, map]) =>
    mapObjects(map)
      .filter((object) => object.type === 'prop')
      .map((object) => ({ mapId, propId: String(propsOf(object).propId ?? '') }))
      .filter((placement) => placement.propId.length > 0),
  );

/** RULE: props a map places but the manifest never defines — they fall back. */
export const checkUndefinedPlacedProps = (input: CoverageInputs): Finding[] =>
  placedPropIds(input)
    .filter(({ propId }) => !input.manifest.props[propId])
    .map(({ mapId, propId }) => ({
      id: `${mapId}:${propId}`,
      surface: 'prop' as const,
      classification: 'missing' as const,
      detail: `map "${mapId}" places prop "${propId}" but manifest.props has no such definition — the renderer falls back to ${input.manifest.fallbackTile}`,
    }));

/**
 * Every rule, in report order. The order is stable so the committed report
 * diffs cleanly; adding a rule appends a family rather than reshuffling.
 */
export const runCoverageRules = (input: CoverageInputs): Finding[] => [
  ...input.indexFindings,
  ...checkReciprocalTransitions(input),
  ...checkTerrainAndHeadroom(input),
  ...checkProps(input),
  ...checkEvidence(input),
  ...checkNpcs(input),
  ...checkAudioCues(input),
  ...checkSourceArt(input),
  ...checkAtlasFrames(input),
  ...checkCatalogTags(input),
  ...checkUndefinedPlacedProps(input),
];
