// scripts/src/lib/ops/emberwatch_visual_report.ts
//
// Agent-readable visual audit report for the Emberwatch maps.
//
// Produces the machine-readable companion to the human contact sheet: for every
// placed prop it records the frame, world coordinates, source dimensions,
// logical world size, anchor, collision footprint, shadow and an art-source
// classification; for every map it records dimensions, object counts,
// walkability, unreachable areas, landmark placements and legacy-visual
// dependencies.
//
// It is deterministic and network-free (no sharp, no screenshots), so it can
// run on every authoring edit. The contact sheet remains in
// `emberwatch_prop_visual_audit.ts`; this report only names where screenshots
// would be captured.
//
// Run: bun scripts/src/lib/ops/emberwatch_visual_report.ts [--json] [--out <path>]

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { computePropRenderSize } from '@aikami/utils';
import { cellOfPoint } from './emberwatch_map_navigation.ts';
import {
  buildContexts,
  type Manifest,
  type MapSummary,
  type PlacedObject,
  packRoot,
  readJson,
  repository,
  str,
} from './emberwatch_map_validation_context.ts';
import { summarizeMap } from './emberwatch_map_validation_rules.ts';
import {
  auditEmberwatchPropSources,
  LEGACY_GRID_PROP_FRAMES,
} from './emberwatch_prop_source_guard.ts';

export type PropArtClassification =
  | 'accepted-standalone'
  | 'accepted-generated'
  | 'legacy-grid'
  | 'unresolved';

export type PropVisualRow = {
  map: string;
  propId: string;
  frame: string;
  cell: { c: number; r: number };
  world: { x: number; y: number };
  sourcePixels: { width: number; height: number } | null;
  worldSize: { width: number; height: number };
  worldSizeAuthored: boolean;
  anchor: { x: number; y: number } | null;
  collision: { type: string; width?: number; height?: number } | null;
  shadow: { kind: string; width?: number; height?: number } | null;
  classification: PropArtClassification;
};

export type VisualReport = {
  schemaVersion: 1;
  kind: 'emberwatch-visual-report';
  generatedAt: string;
  generatedBy: 'scripts/src/lib/ops/emberwatch_visual_report.ts';
  props: PropVisualRow[];
  maps: Array<MapSummary & { landmarkPlacements: string[] }>;
  legacyVisualDependencies: string[];
  screenshotHooks: {
    note: string;
    urlPattern: string;
    flags: string[];
    contactSheet: string;
  };
};

type ManifestWithProvenance = Manifest & {
  props?: Record<
    string,
    {
      frame?: string;
      anchor?: { x: number; y: number };
      renderSize?: { width?: number; height?: number };
      collision?: { type: string; width?: number; height?: number };
      shadow?: { kind: string; width?: number; height?: number };
      provenance?: { source?: string };
    }
  >;
};

const DEFAULT_OUT = join(repository, 'docs/reference/emberwatch-visual-report.json');
const LANDMARK_MIN_WIDTH = 96;

const generatedAt = (): string =>
  process.env.SOURCE_DATE_EPOCH
    ? new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000).toISOString()
    : new Date().toISOString();

/** Reads PNG width/height from the IHDR chunk without decoding the image. */
const readPngSize = (path: string): { width: number; height: number } | null => {
  try {
    const bytes = readFileSync(path);
    if (bytes.length < 24 || bytes.readUInt32BE(0) !== 0x89504e47) {
      return null;
    }
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  } catch {
    return null;
  }
};

const classify = (options: {
  frame: string;
  accepted: ReadonlySet<string>;
  provenance: string | undefined;
}): PropArtClassification => {
  if (options.accepted.has(options.frame)) {
    return options.provenance?.startsWith('generated:')
      ? 'accepted-generated'
      : 'accepted-standalone';
  }
  return LEGACY_GRID_PROP_FRAMES.has(options.frame) ? 'legacy-grid' : 'unresolved';
};

const propsDir = join(packRoot, 'props');

const acceptedFrames = (): Set<string> =>
  new Set(
    existsSync(propsDir)
      ? readdirSync(propsDir).filter((name) => name.endsWith('.png') || name.endsWith('.webp'))
      : [],
  );

const buildPropRow = (options: {
  map: string;
  object: PlacedObject;
  manifest: ManifestWithProvenance;
  accepted: ReadonlySet<string>;
}): PropVisualRow => {
  const { map, object, manifest, accepted } = options;
  const propId = str(object.props.propId);
  const def = manifest.props?.[propId];
  const frame = str(def?.frame);
  const sourcePixels = frame.endsWith('.png') ? readPngSize(join(propsDir, frame)) : null;
  const renderSize = def?.renderSize;
  const worldSize = computePropRenderSize({
    textureWidth: sourcePixels?.width ?? 0,
    textureHeight: sourcePixels?.height ?? 0,
    ...(renderSize?.width === undefined ? {} : { renderWidth: renderSize.width }),
    ...(renderSize?.height === undefined ? {} : { renderHeight: renderSize.height }),
  });
  return {
    map,
    propId,
    frame,
    cell: cellOfPoint(object.x, object.y),
    world: { x: object.x, y: object.y },
    sourcePixels,
    worldSize: { width: worldSize.width, height: worldSize.height },
    worldSizeAuthored: renderSize !== undefined,
    anchor: def?.anchor ?? null,
    collision: def?.collision ?? null,
    shadow: def?.shadow ?? null,
    classification: classify({ frame, accepted, provenance: def?.provenance?.source }),
  };
};

const buildRows = (manifest: ManifestWithProvenance): PropVisualRow[] => {
  const accepted = acceptedFrames();
  const rows: PropVisualRow[] = [];
  for (const context of buildContexts(manifest).values()) {
    for (const object of context.props) {
      rows.push(buildPropRow({ map: context.id, object, manifest, accepted }));
    }
  }
  rows.sort((a, b) => a.map.localeCompare(b.map) || a.propId.localeCompare(b.propId));
  return rows;
};

/** Builds the deterministic visual report. Pure + read-only. */
export const buildVisualReport = (): VisualReport => {
  const manifest = readJson<ManifestWithProvenance>(join(packRoot, 'manifest.json'));
  const contexts = buildContexts(manifest);

  const maps = [...contexts.values()].map((context) => {
    const summary = summarizeMap(context, manifest);
    const landmarkPlacements = [
      ...new Set(
        context.props
          .filter((prop) => {
            const def = manifest.props?.[str(prop.props.propId)];
            const width = def?.renderSize?.width ?? 0;
            return width >= LANDMARK_MIN_WIDTH;
          })
          .map((prop) => str(prop.props.propId)),
      ),
    ].sort();
    return { ...summary, landmarkPlacements };
  });

  const legacyVisualDependencies = [
    ...new Set(
      auditEmberwatchPropSources(repository)
        .rows.filter((row) => row.classification === 'legacy-grid')
        .map((row) => row.frame),
    ),
  ].sort();

  return {
    schemaVersion: 1,
    kind: 'emberwatch-visual-report',
    generatedAt: generatedAt(),
    generatedBy: 'scripts/src/lib/ops/emberwatch_visual_report.ts',
    props: buildRows(manifest),
    maps,
    legacyVisualDependencies,
    screenshotHooks: {
      note: 'Screenshots are illustrative, never a correctness gate. Capture via the visual suite or `?screenshot=true`.',
      urlPattern: '/?map=<mapId>&screenshot=true&e2e=true',
      flags: ['screenshot=true', 'e2e=true', 'authoring=true'],
      contactSheet: '.local/releases/evidence/emberwatch-visual-audit/contact_sheet.png',
    },
  };
};

const main = (): void => {
  const report = buildVisualReport();
  const outFlag = process.argv.indexOf('--out');
  const outPath = outFlag >= 0 ? (process.argv[outFlag + 1] ?? DEFAULT_OUT) : DEFAULT_OUT;
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(
      `Emberwatch visual report — ${report.props.length} placed props, ${report.maps.length} maps`,
    );
    for (const map of report.maps) {
      console.log(
        `  ${map.id.padEnd(14)} walkable ${map.walkablePercent}%  unreachable ${map.unreachableCells} cells  ` +
          `landmarks ${map.landmarkPlacements.length}  legacy frames ${map.legacyFrames.length}`,
      );
    }
    console.log(
      `  legacy visual dependencies: ${report.legacyVisualDependencies.join(', ') || 'none'}`,
    );
  }
  if (existsSync(dirname(outPath))) {
    writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  const unresolved = report.props.filter((row) => row.classification === 'unresolved');
  process.exit(unresolved.length > 0 ? 1 : 0);
};

if (import.meta.main) {
  main();
}
