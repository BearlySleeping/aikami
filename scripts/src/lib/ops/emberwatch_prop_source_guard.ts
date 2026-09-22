// scripts/src/lib/ops/emberwatch_prop_source_guard.ts
//
// C-529: every placed Emberwatch prop must resolve to an intended art source.
//
// The first human visual gate caught the village still rendering the OLD
// green-backed well: `manifest.props.village_well.frame` was `well.png`, a
// procedurally-painted GRID-atlas furniture frame, while every other landmark
// had moved to accepted standalone art under `content/packs/emberwatch/props/`.
// The same class of bug — a prop silently resolving through the grid atlas (or
// worse, falling through to `fallbackTile`) — is what this guard makes
// unrepresentable.
//
// Classification per placed prop frame:
//   • `accepted`      — a standalone source exists in content/packs/emberwatch/props
//   • `legacy-grid`   — no standalone source yet; explicitly allowlisted below
//   • `unresolved`    — neither → would fall back to the pack fallback tile (BLOCKER)
//
// Pure + offline: it reads the manifest and maps and the props source list, not
// the generated atlas build output.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Frames still painted by the legacy grid atlas because no accepted standalone
 * source exists for them yet. Each entry is a known, deliberate debt — NOT an
 * excuse to add more.
 *
 * Empty as of the 5.0.0 polish pass: the six former legacy-grid furniture
 * frames (`crate`, `table`, `bed`, `counter`, `bookshelf`, `anvil`) now have
 * accepted standalone art under `content/packs/emberwatch/props/`. Any prop
 * that still resolves through the grid atlas is now a hard `unresolved`
 * violation instead of an allowlisted debt.
 */
export const LEGACY_GRID_PROP_FRAMES: ReadonlySet<string> = new Set([]);

export type PropSourceClassification = 'accepted' | 'legacy-grid' | 'unresolved';

export type PropSourceRow = {
  propId: string;
  frame: string;
  maps: string[];
  classification: PropSourceClassification;
};

export type PropSourceAudit = {
  rows: PropSourceRow[];
  /** Frames that resolve to neither accepted art nor the legacy allowlist. */
  violations: PropSourceRow[];
  /** Standalone source filenames present in the pack. */
  acceptedSources: string[];
};

/** Standalone accepted prop source filenames (no build output required). */
export const readAcceptedPropSources = (repository: string): string[] => {
  const dir = join(repository, 'content/packs/emberwatch/props');
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir)
    .filter((name) => name.endsWith('.png') || name.endsWith('.webp'))
    .sort();
};

type SpawnObject = {
  type?: string;
  properties?: Array<{ name: string; value: unknown }>;
};

type MapLayer = { objects?: SpawnObject[] };

type Placement = { frame: string; maps: Set<string> };

const mapsDirOf = (repository: string): string => join(repository, 'content/packs/emberwatch/maps');

const readMapLayers = (file: string): MapLayer[] => {
  const map = JSON.parse(readFileSync(file, 'utf8')) as { layers?: MapLayer[] };
  return map.layers ?? [];
};

/** `(propId, frame)` for a prop spawn object, or undefined for anything else. */
const propRefOf = (object: SpawnObject): { propId: string; frame: string } | undefined => {
  if (object.type !== 'prop') {
    return undefined;
  }
  const props = new Map((object.properties ?? []).map((p) => [p.name, p.value]));
  const propId = props.get('propId');
  const frame = props.get('frame');
  if (typeof propId !== 'string' || typeof frame !== 'string') {
    return undefined;
  }
  return { propId, frame };
};

const recordLayer = (placements: Map<string, Placement>, layer: MapLayer, mapId: string): void => {
  for (const object of layer.objects ?? []) {
    const ref = propRefOf(object);
    if (!ref) {
      continue;
    }
    const existing = placements.get(ref.propId);
    if (existing) {
      if (existing.frame !== ref.frame) {
        throw new Error(
          `emberwatch_prop_source_guard: prop "${ref.propId}" uses conflicting frames "${existing.frame}" and "${ref.frame}" (map "${mapId}")`,
        );
      }
      existing.maps.add(mapId);
    } else {
      placements.set(ref.propId, { frame: ref.frame, maps: new Set([mapId]) });
    }
  }
};

/** Every prop placement across the pack's maps: propId → frame → map ids. */
const readPropPlacements = (repository: string): Map<string, Placement> => {
  const placements = new Map<string, Placement>();
  for (const file of readdirSync(mapsDirOf(repository)).sort()) {
    if (!file.endsWith('.json')) {
      continue;
    }
    const mapId = file.slice(0, -5);
    for (const layer of readMapLayers(join(mapsDirOf(repository), file))) {
      recordLayer(placements, layer, mapId);
    }
  }
  return placements;
};

const classify = (frame: string, accepted: ReadonlySet<string>): PropSourceClassification => {
  if (accepted.has(frame)) {
    return 'accepted';
  }
  return LEGACY_GRID_PROP_FRAMES.has(frame) ? 'legacy-grid' : 'unresolved';
};

/**
 * Audits every placed prop frame against the accepted standalone sources and
 * the legacy allowlist. Deterministic ordering by propId.
 */
export const auditEmberwatchPropSources = (repository: string): PropSourceAudit => {
  const acceptedSources = readAcceptedPropSources(repository);
  const accepted = new Set(acceptedSources);
  const rows: PropSourceRow[] = [];
  for (const [propId, { frame, maps }] of readPropPlacements(repository)) {
    rows.push({ propId, frame, maps: [...maps].sort(), classification: classify(frame, accepted) });
  }
  rows.sort((a, b) => a.propId.localeCompare(b.propId));
  return {
    rows,
    violations: rows.filter((row) => row.classification === 'unresolved'),
    acceptedSources,
  };
};
