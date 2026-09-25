// scripts/src/lib/ops/emberwatch_prop_visual_audit.ts
//
// C-529 section E: audit every accepted Emberwatch prop at its intended WORLD
// scale — not at its raw generation resolution.
//
// The first human gate judged props by how they looked in-game; this tool makes
// that judgement mechanical and repeatable BEFORE a candidate is sealed. For
// every prop frame it records:
//
//   • source pixel dimensions            (the accepted art on disk)
//   • trimmed alpha bounds               (where the opaque object actually is)
//   • logical world render size          (manifest `renderSize`)
//   • anchor                             (manifest `anchor`)
//   • collision footprint                (manifest `collision`)
//   • shadow setting                     (manifest `shadow`)
//   • maps where used                    (from the map spawn objects)
//
// …and composites a contact sheet where each prop is drawn at its intended
// world size next to a 32px terrain tile and a 48×64 LPC-sized character block,
// so a scale/style error is visible at a glance.
//
// Outputs (gitignored evidence):
//   .local/releases/evidence/emberwatch-visual-audit/report.json
//   .local/releases/evidence/emberwatch-visual-audit/contact_sheet.png
//
// Run: bun scripts/src/lib/ops/emberwatch_prop_visual_audit.ts

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computePropRenderSize } from '@aikami/utils';
import sharp from 'sharp';
import { logger } from '$logger';

const here = dirname(fileURLToPath(import.meta.url));
const repository = join(here, '../../../..');
const packRoot = join(repository, 'content/packs/emberwatch');
const sourceDir = join(packRoot, 'props');
const outDir = join(repository, '.local/releases/evidence/emberwatch-visual-audit');

/** UI zoom in the contact sheet: 1 world pixel renders as this many px. */
const ZOOM = 4;
/** Reference terrain tile (the grid atlas frame size). */
const TILE_SIZE = 32;
/** Reference LPC character footprint (standing body). */
const CHARACTER_WIDTH = 48;
const CHARACTER_HEIGHT = 64;

type PropDef = {
  name: string;
  frame: string;
  renderSize?: { width?: number; height?: number };
  anchor?: { x: number; y: number };
  collision?: { type: string; width?: number; height?: number; radius?: number };
  shadow?: { kind: string; width?: number; height?: number };
  styleClass?: string;
};

type ManifestShape = { props?: Record<string, PropDef> };

type Row = {
  frame: string;
  propIds: string[];
  maps: string[];
  sourceWidth: number;
  sourceHeight: number;
  alphaBounds: { left: number; top: number; width: number; height: number } | null;
  worldWidth: number;
  worldHeight: number;
  worldSizeAuthored: boolean;
  anchor: { x: number; y: number };
  collision: PropDef['collision'] | null;
  shadow: PropDef['shadow'] | null;
  styleClass: string;
};

type SpawnObject = {
  type?: string;
  properties?: Array<{ name: string; value: unknown }>;
};

type FramePlacement = { propIds: Set<string>; maps: Set<string> };

const placementRef = (object: SpawnObject): { frame: string; propId: string } | undefined => {
  if (object.type !== 'prop') {
    return undefined;
  }
  const props = new Map((object.properties ?? []).map((p) => [p.name, p.value]));
  const frame = props.get('frame');
  const propId = props.get('propId');
  if (typeof frame !== 'string' || typeof propId !== 'string') {
    return undefined;
  }
  return { frame, propId };
};

const recordPlacements = (
  byFrame: Map<string, FramePlacement>,
  layers: Array<{ objects?: SpawnObject[] }>,
  mapId: string,
): void => {
  for (const layer of layers) {
    for (const object of layer.objects ?? []) {
      const ref = placementRef(object);
      if (!ref) {
        continue;
      }
      const entry = byFrame.get(ref.frame) ?? { propIds: new Set(), maps: new Set() };
      entry.propIds.add(ref.propId);
      entry.maps.add(mapId);
      byFrame.set(ref.frame, entry);
    }
  }
};

const mapsForFrame = (): Map<string, FramePlacement> => {
  const byFrame = new Map<string, FramePlacement>();
  const mapsDir = join(packRoot, 'maps');
  for (const file of readdirSync(mapsDir).sort()) {
    if (!file.endsWith('.json')) {
      continue;
    }
    const map = JSON.parse(readFileSync(join(mapsDir, file), 'utf8')) as {
      layers?: Array<{ objects?: SpawnObject[] }>;
    };
    recordPlacements(byFrame, map.layers ?? [], file.slice(0, -5));
  }
  return byFrame;
};

/** Trimmed alpha bounds, or null when the source has no meaningful alpha. */
const trimmedAlphaBounds = async (
  file: string,
): Promise<{ left: number; top: number; width: number; height: number } | null> => {
  try {
    const info = await sharp(file).trim({ threshold: 1 }).toBuffer({ resolveWithObject: true });
    return {
      left: info.info.trimOffsetLeft ?? 0,
      top: info.info.trimOffsetTop ?? 0,
      width: info.info.width,
      height: info.info.height,
    };
  } catch {
    return null;
  }
};

const buildRow = async (
  frame: string,
  byFrame: Map<string, FramePlacement>,
  defByFrame: Map<string, PropDef>,
): Promise<Row> => {
  const file = join(sourceDir, frame);
  const meta = await sharp(file).metadata();
  const sourceWidth = meta.width ?? 0;
  const sourceHeight = meta.height ?? 0;
  const placement = byFrame.get(frame);
  const propDef = defByFrame.get(frame);
  const worldSize = computePropRenderSize({
    textureWidth: sourceWidth,
    textureHeight: sourceHeight,
    ...(propDef?.renderSize?.width === undefined ? {} : { renderWidth: propDef.renderSize.width }),
    ...(propDef?.renderSize?.height === undefined
      ? {}
      : { renderHeight: propDef.renderSize.height }),
  });

  // World size comes from the manifest renderSize when authored; otherwise it
  // is the source size (legacy behaviour).
  return {
    frame,
    propIds: placement ? [...placement.propIds].sort() : [],
    maps: placement ? [...placement.maps].sort() : [],
    sourceWidth,
    sourceHeight,
    alphaBounds: await trimmedAlphaBounds(file),
    worldWidth: worldSize.width,
    worldHeight: worldSize.height,
    worldSizeAuthored: propDef?.renderSize !== undefined,
    anchor: propDef?.anchor ?? { x: 0.5, y: 1 },
    collision: propDef?.collision ?? null,
    shadow: propDef?.shadow ?? null,
    styleClass: propDef?.styleClass ?? 'unclassified',
  };
};

const buildRows = async (): Promise<Row[]> => {
  const manifest = JSON.parse(
    readFileSync(join(packRoot, 'manifest.json'), 'utf8'),
  ) as ManifestShape;
  const byFrame = mapsForFrame();
  // Frame → definition, independent of placement (an encounter-only prop such
  // as `inn_oil_pool` still declares its world size and shadow).
  const defByFrame = new Map<string, PropDef>();
  for (const def of Object.values(manifest.props ?? {})) {
    if (!defByFrame.has(def.frame)) {
      defByFrame.set(def.frame, def);
    }
  }
  const files = readdirSync(sourceDir)
    .filter((name) => name.endsWith('.png') || name.endsWith('.webp'))
    .sort();

  const rows: Row[] = [];
  for (const frame of files) {
    rows.push(await buildRow(frame, byFrame, defByFrame));
  }
  return rows;
};

const svgLabel = (text: string, width: number): Buffer =>
  Buffer.from(
    `<svg width="${width}" height="18" xmlns="http://www.w3.org/2000/svg"><text x="1" y="13" font-family="monospace" font-size="11" fill="#e8e8e8">${text}</text></svg>`,
  );

/** One contact-sheet row: prop @ world size ×ZOOM, a 32px tile, a 48×64 char. */
const renderRow = async (row: Row): Promise<{ input: Buffer; top: number; left: number }> => {
  const gap = 8;
  const labelHeight = 20;
  const propW = Math.max(1, Math.round(row.worldWidth)) * ZOOM;
  const propH = Math.max(1, Math.round(row.worldHeight)) * ZOOM;
  const surfacesW = propW * 3 + gap * 2;
  const tileW = TILE_SIZE * ZOOM;
  const charW = CHARACTER_WIDTH * ZOOM;
  const charH = CHARACTER_HEIGHT * ZOOM;
  const contentH = Math.max(propH, charH);
  const rowW = surfacesW + gap + tileW + gap + charW;
  const rowH = contentH + labelHeight;

  const propImage = await sharp(join(sourceDir, row.frame))
    .resize(propW, propH, { fit: 'fill', kernel: 'nearest' })
    .png()
    .toBuffer();

  // A neutral checkerboard so transparent art is visible.
  const checker = Buffer.from(
    `<svg width="${rowW}" height="${rowH}" xmlns="http://www.w3.org/2000/svg"><rect width="${rowW}" height="${rowH}" fill="#20242a"/><rect width="${propW}" height="${rowH}" fill="#20242a"/><rect x="${propW + gap}" width="${propW}" height="${rowH}" fill="#f8fafc"/><rect x="${(propW + gap) * 2}" width="${propW}" height="${rowH}" fill="#111827"/></svg>`,
  );
  const tile = Buffer.from(
    `<svg width="${tileW}" height="${tileW}" xmlns="http://www.w3.org/2000/svg"><rect width="${tileW}" height="${tileW}" fill="#4a8f3c" stroke="#2c5a24" stroke-width="2"/></svg>`,
  );
  const character = Buffer.from(
    `<svg width="${charW}" height="${charH}" xmlns="http://www.w3.org/2000/svg"><rect x="${charW / 4}" y="0" width="${charW / 2}" height="${charH}" fill="#c8a24a" opacity="0.85"/></svg>`,
  );

  const composited = await sharp(checker)
    .composite([
      { input: tile, top: contentH - tileW, left: surfacesW + gap },
      { input: character, top: contentH - charH, left: surfacesW + gap + tileW + gap },
      { input: propImage, top: contentH - propH, left: 0 },
      { input: propImage, top: contentH - propH, left: propW + gap },
      { input: propImage, top: contentH - propH, left: (propW + gap) * 2 },
      {
        input: svgLabel(
          `${row.frame}  [${row.styleClass}]  src ${row.sourceWidth}×${row.sourceHeight}  world ${Math.round(row.worldWidth)}×${Math.round(row.worldHeight)}`,
          rowW,
        ),
        top: 2,
        left: 2,
      },
    ])
    .png()
    .toBuffer();
  return { input: composited, top: 0, left: 0 };
};

const main = async (): Promise<void> => {
  if (!existsSync(sourceDir)) {
    throw new Error(`emberwatch_prop_visual_audit: no props directory at ${sourceDir}`);
  }
  mkdirSync(outDir, { recursive: true });

  const rows = await buildRows();
  writeFileSync(join(outDir, 'report.json'), `${JSON.stringify({ zoom: ZOOM, rows }, null, 2)}\n`);

  // Stack the rows into one contact sheet.
  const rowBuffers: Buffer[] = [];
  for (const row of rows) {
    rowBuffers.push((await renderRow(row)).input);
  }
  const rowMetas = await Promise.all(rowBuffers.map((buf) => sharp(buf).metadata()));
  const sheetWidth = Math.max(...rowMetas.map((m) => m.width ?? 0));
  let sheetHeight = 0;
  for (const meta of rowMetas) {
    sheetHeight += (meta.height ?? 0) + 4;
  }
  let top = 0;
  const composites = rowBuffers.map((input, index) => {
    const entry = { input, top, left: 0 };
    top += (rowMetas[index]?.height ?? 0) + 4;
    return entry;
  });
  await sharp({
    create: {
      width: sheetWidth,
      height: sheetHeight,
      channels: 4,
      background: { r: 16, g: 18, b: 22, alpha: 1 },
    },
  })
    .composite(composites)
    .png()
    .toFile(join(outDir, 'contact_sheet.png'));

  logger.info('emberwatch_prop_visual_audit:done', {
    outDir,
    rows: rows.length,
    worldSizeAuthored: rows.filter((row) => row.worldSizeAuthored).length,
    legacyNative: rows.filter((row) => !row.worldSizeAuthored).length,
  });
  for (const row of rows) {
    logger.info('emberwatch_prop_visual_audit:row', {
      frame: row.frame,
      source: `${row.sourceWidth}×${row.sourceHeight}`,
      world: `${Math.round(row.worldWidth)}×${Math.round(row.worldHeight)}`,
      shadow: row.shadow?.kind ?? 'none',
      maps: row.maps.join(',') || '(unplaced)',
    });
  }
};

await main();
