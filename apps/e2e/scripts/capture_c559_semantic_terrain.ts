// apps/e2e/scripts/capture_c559_semantic_terrain.ts
//
// Reproducible C-559 semantic-terrain evidence. Captures the production /game
// route through the shared Emberwatch POM, requires WebGL and resolved entity
// textures, pins map/atlas hashes, and writes a labeled ImageMagick sheet.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium, type Page } from 'playwright';
import {
  type EmberwatchHouseCell,
  type EmberwatchHouseMapId,
  EmberwatchHousePage,
} from '../src/pom/emberwatch_house_page.ts';
import { ENTITY_TEXTURE_GUARD_POLICY } from '../src/visual/core/entity_texture_guard.ts';

type Lane = 'before' | 'after';
type Viewport = { width: number; height: number };
type CaptureCase = {
  id: string;
  label: string;
  mapId: EmberwatchHouseMapId;
  target: EmberwatchHouseCell;
  viewport?: Viewport;
};
type CaptureRecord = {
  lane: Lane;
  id: string;
  label: string;
  file: string;
  mapId: string;
  requestedCell: string;
  actualPlayerCell: string;
  actualCameraCell: string;
  cameraWorld: { x: number; y: number };
  cameraSource: 'worldTransform' | 'engine' | 'playerFallback';
  renderer: string;
  viewport: Viewport;
  entityTextureFingerprint: string;
  sha256: string;
};

const ROOT = resolve(import.meta.dirname, '../../..');
const EVIDENCE_DIR = resolve(process.env.C559_EVIDENCE_DIR ?? '/tmp/opencode/c559-evidence');
const CLIENT_URL = process.env.C559_CLIENT_URL ?? 'http://127.0.0.1:5399';
const LANE = (process.env.C559_LANE ?? 'after') as Lane;
const LANE_ROOT = resolve(process.env.C559_LANE_ROOT ?? ROOT);
const DEFAULT_VIEWPORT: Viewport = { width: 1920, height: 1080 };
const PAIR_SUMMARIES: Readonly<Record<string, string>> = {
  'ward-square':
    'Asymmetric dirt spans/spurs plus path/stone semantic transitions; indoor floor split unchanged.',
  'crossing-landing':
    'Existing dirt terrain with an asymmetric bridge-aligned organic approach; water remains origin/main.',
  'inn-floor':
    'Interior terrain channel omitted; C-552 indoor wood/threshold materials remain baked.',
  'merchant-floor':
    'Interior terrain channel omitted; C-552 indoor flagstone and navy base remain baked.',
  'old-road': 'Outdoor path/earth/gravel semantic transitions; water and bridge visuals remain origin/main.',
  'ruined-shrine':
    'Outdoor sand/stone/dirt semantic transitions; no grass or placeholder floor leakage.',
};

const CASES: readonly CaptureCase[] = [
  {
    id: 'ward-square',
    label: 'Ward square dirt and stone boundaries',
    mapId: 'village',
    target: { c: 30, r: 24 },
  },
  {
    id: 'crossing-landing',
    label: 'Crossing landing organic edge',
    mapId: 'village',
    target: { c: 38, r: 9 },
    viewport: { width: 1280, height: 720 },
  },
  {
    id: 'inn-floor',
    label: 'Inn threshold and floor boundary',
    mapId: 'inn',
    target: { c: 14, r: 10 },
  },
  {
    id: 'merchant-floor',
    label: 'Merchant floor and landing boundary',
    mapId: 'merchant_shop',
    target: { c: 12, r: 9 },
  },
  {
    id: 'old-road',
    label: 'Old-road culvert and path boundary',
    mapId: 'old_road',
    target: { c: 21, r: 18 },
  },
  {
    id: 'ruined-shrine',
    label: 'Ruined-shrine apron and sand boundary',
    mapId: 'ruined_shrine',
    target: { c: 20, r: 22 },
  },
];

const hashBytes = (bytes: Uint8Array | string): string =>
  createHash('sha256').update(bytes).digest('hex');
const hashFile = (path: string): string => hashBytes(readFileSync(path));
const formatCell = (cell: EmberwatchHouseCell): string => `${cell.c},${cell.r}`;

const artifactHashes = (): Record<string, string> => {
  const paths = [
    'content/packs/emberwatch/manifest.json',
    'content/packs/emberwatch/maps/village.json',
    'content/packs/emberwatch/maps/inn.json',
    'content/packs/emberwatch/maps/merchant_shop.json',
    'content/packs/emberwatch/maps/old_road.json',
    'content/packs/emberwatch/maps/ruined_shrine.json',
    'apps/frontend/client/static/game-data/sprites/tilesets/atlas.webp',
    'apps/frontend/client/static/game-data/sprites/tilesets/atlas.json',
  ];
  return Object.fromEntries(paths.map((path) => [path, hashFile(resolve(LANE_ROOT, path))]));
};

const captureCases = async (page: Page): Promise<CaptureRecord[]> => {
  const records: CaptureRecord[] = [];
  for (const definition of CASES) {
    const viewport = definition.viewport ?? DEFAULT_VIEWPORT;
    await page.setViewportSize(viewport);
    const game = new EmberwatchHousePage(page, CLIENT_URL);
    await game.goto({ gameHour: 12 });
    await game.loadMapAt(definition.mapId, definition.target);
    const textures = await game.requireResolvedEntityTextures();
    const file = `${LANE}-${definition.id}.png`;
    const path = join(EVIDENCE_DIR, LANE, file);
    const snapshot = await game.capture(path);
    if (snapshot.renderer !== 'webgl') {
      throw new Error(`C559 ${LANE}/${definition.id} renderer is ${snapshot.renderer}`);
    }
    if (snapshot.player.c !== definition.target.c || snapshot.player.r !== definition.target.r) {
      throw new Error(
        `C559 ${LANE}/${definition.id} expected player ${formatCell(definition.target)}, got ${formatCell(snapshot.player)}`,
      );
    }
    records.push({
      lane: LANE,
      id: definition.id,
      label: definition.label,
      file,
      mapId: snapshot.mapId,
      requestedCell: formatCell(definition.target),
      actualPlayerCell: formatCell(snapshot.player),
      actualCameraCell: formatCell(snapshot.camera),
      cameraWorld: { x: snapshot.camera.x, y: snapshot.camera.y },
      cameraSource: snapshot.cameraSource,
      renderer: snapshot.renderer,
      viewport,
      entityTextureFingerprint: hashBytes(Buffer.from(JSON.stringify(textures))),
      sha256: hashFile(path),
    });
  }
  return records;
};

const writeAfterEvidence = async (records: readonly CaptureRecord[]): Promise<void> => {
  const before = JSON.parse(
    readFileSync(join(EVIDENCE_DIR, 'before', 'capture_manifest.json'), 'utf8'),
  ) as { captures: CaptureRecord[] };
  const byLane = [...before.captures, ...records];
  for (const definition of CASES) {
    const beforeRecord = before.captures.find((record) => record.id === definition.id);
    const afterRecord = records.find((record) => record.id === definition.id);
    if (!beforeRecord || !afterRecord) {
      throw new Error(`C-559 missing before/after record for ${definition.id}`);
    }
    execFileSync(
      'magick',
      [
        join(EVIDENCE_DIR, 'before', beforeRecord.file),
        join(EVIDENCE_DIR, 'after', afterRecord.file),
        '+append',
        join(EVIDENCE_DIR, `pair-${definition.id}.png`),
      ],
      { stdio: 'inherit' },
    );
  }
  const index = [
    '# C-559 semantic terrain edge evidence',
    '',
    `Renderer: \`WebGL\`. Entity-texture guard: \`${ENTITY_TEXTURE_GUARD_POLICY}\`.`,
    'Pairs use the same production `/game` route, requested player cell, viewport, and noon hour.',
    'Collision proof: `collision-proof.json`. Global metric: `metric-baseline.json` / `metric-after.json`. Named placed composites: `metric-placed-composites.json`.',
    '',
    '| Lane | Case | Map | Player | Camera | Viewport | SHA-256 |',
    '|---|---|---|---|---|---|---|',
    ...byLane.map(
      (record) =>
        `| ${record.lane} | ${record.label} (\`${record.file}\`) | ${record.mapId} | ${record.actualPlayerCell} | ${record.actualCameraCell} | ${record.viewport.width}×${record.viewport.height} | \`${record.sha256}\` |`,
    ),
    '',
    '## Pair review',
    '',
    '| Pair image | What changed |',
    '|---|---|',
    ...CASES.map(
      (definition) =>
        `| \`pair-${definition.id}.png\` | ${PAIR_SUMMARIES[definition.id] ?? 'Terrain boundary update.'} |`,
    ),
    '',
    'Technical evidence only. Terrain and sprite presence still require human review.',
    '',
  ].join('\n');
  await writeFile(join(EVIDENCE_DIR, 'index.md'), index);
  const images = byLane.map((record) => join(EVIDENCE_DIR, record.lane, record.file));
  execFileSync(
    'magick',
    [
      'montage',
      '-label',
      '%t',
      '-tile',
      '3x4',
      '-geometry',
      '640x360+12+24',
      ...images,
      join(EVIDENCE_DIR, 'sheet.png'),
    ],
    { stdio: 'inherit' },
  );
};

const main = async (): Promise<void> => {
  if (LANE !== 'before' && LANE !== 'after') {
    throw new Error(`C559_LANE must be before or after, got ${LANE}`);
  }
  await mkdir(join(EVIDENCE_DIR, LANE), { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    executablePath: realpathSync(process.env.C559_CHROMIUM_PATH ?? chromium.executablePath()),
    args: [
      '--use-gl=angle',
      '--use-angle=gl',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--disable-lcd-text',
      '--font-render-hinting=none',
      '--disable-font-subpixel-positioning',
      '--force-color-profile=srgb',
    ],
  });
  const context = await browser.newContext({ viewport: DEFAULT_VIEWPORT, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  let records: CaptureRecord[] = [];
  try {
    records = await captureCases(page);
  } finally {
    await context.close();
    await browser.close();
  }
  if (pageErrors.length > 0) {
    throw new Error(`C559 page errors: ${pageErrors.join(' | ')}`);
  }
  const graphics = { renderer: 'webgl', entityTextureGuard: ENTITY_TEXTURE_GUARD_POLICY };
  const manifest = {
    schemaVersion: 1,
    lane: LANE,
    command: `C559_LANE=${LANE} C559_LANE_ROOT=${LANE_ROOT} C559_CLIENT_URL=${CLIENT_URL} bun run --cwd apps/e2e scripts/capture_c559_semantic_terrain.ts`,
    artifactRoot: LANE_ROOT,
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: LANE_ROOT, encoding: 'utf8' }).trim(),
    graphics,
    artifacts: artifactHashes(),
    captures: records,
    pageErrors,
  };
  await writeFile(
    join(EVIDENCE_DIR, LANE, 'capture_manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  if (LANE === 'after') {
    await writeAfterEvidence(records);
  }
  console.log(`C-559 ${LANE} evidence captured: ${records.length} PNGs -> ${EVIDENCE_DIR}`);
};

await main();
