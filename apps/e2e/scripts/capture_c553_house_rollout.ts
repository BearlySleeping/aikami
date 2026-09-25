// apps/e2e/scripts/capture_c553_house_rollout.ts
//
// Reproducible C-553 before/after house-rollout evidence. Captures separate
// C-550 and C-553 production clients through the shared POM, verifies WebGL and
// visible entity textures before every PNG, pins artifacts, and builds a sheet.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium, type Page } from 'playwright';
import sharp from 'sharp';
import {
  type EmberwatchHouseCell,
  type EmberwatchHouseClip,
  type EmberwatchHouseMapId,
  EmberwatchHousePage,
} from '../src/pom/emberwatch_house_page.ts';
import { ENTITY_TEXTURE_GUARD_POLICY } from '../src/visual/core/entity_texture_guard.ts';

type Viewport = { width: number; height: number };
type Lane = 'before' | 'after';
type ArtifactHashes = {
  manifest: string;
  villageMap: string;
  innMap: string;
  atlasWebp: string;
  atlasJson: string;
};
type ExpectedLane = ArtifactHashes & { entityTextureGuard: string };
type ExpectedArtifacts = Record<Lane, ExpectedLane>;
type GitIdentity = {
  root: string;
  commit: string;
  branch: string;
  statusFingerprint: string;
};
type CaptureRecord = {
  lane: Lane;
  id: string;
  label: string;
  file: string;
  clientUrl: string;
  artifactRoot: string;
  mapId: string;
  requestedCell: string;
  expectedPlayerCell: string;
  actualPlayerCell: string;
  actualCameraCell: string;
  cameraWorld: { x: number; y: number };
  worldTransform: { x: number; y: number; scaleX: number; scaleY: number };
  cameraSource: 'worldTransform' | 'engine' | 'playerFallback';
  renderer: string;
  viewport: Viewport;
  gameHour: number;
  clip?: EmberwatchHouseClip;
  entityTextureFingerprint: string;
  sha256: string;
};
type CaptureDefinition = {
  id: string;
  label: string;
  mapId: EmberwatchHouseMapId;
  target: EmberwatchHouseCell;
  expectedPlayer: EmberwatchHouseCell;
  viewport?: Viewport;
  gameHour?: number;
  clip?: EmberwatchHouseClip;
  actions?: ReadonlyArray<{
    key: 'KeyW' | 'KeyA' | 'KeyS' | 'KeyD';
    holdMs: number;
  }>;
};

type BuildingPair = {
  id: string;
  label: string;
  before: CaptureDefinition;
  after: CaptureDefinition;
};
type GraphicsLimits = Awaited<ReturnType<EmberwatchHousePage['graphicsLimits']>>;
type CanvasAllocation = Awaited<ReturnType<EmberwatchHousePage['canvasAllocation']>>;
type WorldSnapshot = Awaited<ReturnType<EmberwatchHousePage['snapshot']>>;
type CaptureRuntime = {
  page: Page;
  urls: Record<Lane, string>;
  roots: Record<Lane, string>;
  records: CaptureRecord[];
  pageErrors: string[];
  graphics: GraphicsLimits | undefined;
  overviewAllocation: CanvasAllocation | undefined;
};

const ROOT = resolve(import.meta.dirname, '../../..');
const EVIDENCE_DIR = resolve(process.env.C553_EVIDENCE_DIR ?? '/tmp/opencode/c553-evidence');
const BEFORE_ROOT = resolve(process.env.C553_BEFORE_ROOT ?? '/tmp/opencode/c552-baseline');
const AFTER_ROOT = resolve(process.env.C553_AFTER_ROOT ?? ROOT);
const BEFORE_CLIENT_URL = process.env.C553_BEFORE_CLIENT_URL;
const AFTER_CLIENT_URL = process.env.C553_AFTER_CLIENT_URL;
const EXPECTED_PATH = resolve(
  ROOT,
  'apps/e2e/src/visual/c553_house_rollout_expected_artifacts.json',
);
const FULL_MAP_VIEWPORT: Viewport = { width: 8192, height: 6144 };
const DEFAULT_VIEWPORT: Viewport = { width: 1920, height: 1080 };
const CELL_SCREEN_SIZE = 128;

const hashBytes = (bytes: Uint8Array | string): string =>
  createHash('sha256').update(bytes).digest('hex');
const hashFile = (path: string): string => hashBytes(readFileSync(path));
const formatCell = (cell: EmberwatchHouseCell): string => `${cell.c},${cell.r}`;

const clipForCells = (c0: number, r0: number, c1: number, r1: number): EmberwatchHouseClip => ({
  x: c0 * CELL_SCREEN_SIZE,
  y: r0 * CELL_SCREEN_SIZE,
  width: (c1 - c0 + 1) * CELL_SCREEN_SIZE,
  height: (r1 - r0 + 1) * CELL_SCREEN_SIZE,
});

const pairClip = (c0: number, r0: number, c1: number, r1: number): EmberwatchHouseClip =>
  clipForCells(c0, r0, c1, r1);

const buildingPairs: readonly BuildingPair[] = [
  {
    id: 'inn',
    label: 'Inn',
    before: {
      id: 'inn',
      label: 'C-550 inn south door',
      mapId: 'village',
      target: { c: 51, r: 22 },
      expectedPlayer: { c: 51, r: 22 },
      viewport: FULL_MAP_VIEWPORT,
      clip: pairClip(46, 11, 56, 24),
    },
    after: {
      id: 'inn',
      label: 'C-553 inn aligned open door',
      mapId: 'village',
      target: { c: 51, r: 22 },
      expectedPlayer: { c: 51, r: 22 },
      viewport: FULL_MAP_VIEWPORT,
      clip: pairClip(46, 11, 56, 24),
    },
  },
  {
    id: 'merchant-shop',
    label: 'Merchant shop',
    before: {
      id: 'merchant-shop',
      label: 'C-550 merchant south door',
      mapId: 'village',
      target: { c: 51, r: 35 },
      expectedPlayer: { c: 51, r: 35 },
      viewport: FULL_MAP_VIEWPORT,
      clip: pairClip(46, 25, 56, 37),
    },
    after: {
      id: 'merchant-shop',
      label: 'C-553 merchant aligned open door',
      mapId: 'village',
      target: { c: 51, r: 36 },
      expectedPlayer: { c: 51, r: 36 },
      viewport: FULL_MAP_VIEWPORT,
      clip: pairClip(46, 25, 56, 37),
    },
  },
  {
    id: 'smithy',
    label: 'Smithy',
    before: {
      id: 'smithy',
      label: 'C-550 smithy north landing',
      mapId: 'village',
      target: { c: 8, r: 29 },
      expectedPlayer: { c: 8, r: 29 },
      viewport: FULL_MAP_VIEWPORT,
      clip: pairClip(3, 28, 13, 39),
    },
    after: {
      id: 'smithy',
      label: 'C-553 smithy south door',
      mapId: 'village',
      target: { c: 8, r: 38 },
      expectedPlayer: { c: 8, r: 38 },
      viewport: FULL_MAP_VIEWPORT,
      clip: pairClip(3, 28, 13, 39),
    },
  },
  {
    id: 'north-west-cottage',
    label: 'North-west cottage',
    before: {
      id: 'north-west-cottage',
      label: 'C-550 north-west cottage',
      mapId: 'village',
      target: { c: 9, r: 22 },
      expectedPlayer: { c: 9, r: 22 },
      viewport: FULL_MAP_VIEWPORT,
      clip: pairClip(4, 14, 13, 24),
    },
    after: {
      id: 'north-west-cottage',
      label: 'C-553 north-west cottage',
      mapId: 'village',
      target: { c: 9, r: 22 },
      expectedPlayer: { c: 9, r: 22 },
      viewport: FULL_MAP_VIEWPORT,
      clip: pairClip(4, 14, 13, 24),
    },
  },
  {
    id: 'north-cottage',
    label: 'North cottage',
    before: {
      id: 'north-cottage',
      label: 'C-550 north cottage',
      mapId: 'village',
      target: { c: 21, r: 20 },
      expectedPlayer: { c: 21, r: 20 },
      viewport: FULL_MAP_VIEWPORT,
      clip: pairClip(17, 12, 25, 22),
    },
    after: {
      id: 'north-cottage',
      label: 'C-553 north cottage',
      mapId: 'village',
      target: { c: 21, r: 20 },
      expectedPlayer: { c: 21, r: 20 },
      viewport: FULL_MAP_VIEWPORT,
      clip: pairClip(17, 12, 25, 22),
    },
  },
  {
    id: 'south-west-shed',
    label: 'South-west shed',
    before: {
      id: 'south-west-shed',
      label: 'C-550 shed north landing',
      mapId: 'village',
      target: { c: 27, r: 35 },
      expectedPlayer: { c: 27, r: 35 },
      viewport: FULL_MAP_VIEWPORT,
      clip: pairClip(23, 34, 31, 44),
    },
    after: {
      id: 'south-west-shed',
      label: 'C-553 shed south door',
      mapId: 'village',
      target: { c: 27, r: 43 },
      expectedPlayer: { c: 27, r: 43 },
      viewport: FULL_MAP_VIEWPORT,
      clip: pairClip(23, 34, 31, 44),
    },
  },
  {
    id: 'north-east-hut',
    label: 'North-east hut',
    before: {
      id: 'north-east-hut',
      label: 'C-550 hut short door',
      mapId: 'village',
      target: { c: 54, r: 11 },
      expectedPlayer: { c: 54, r: 11 },
      viewport: FULL_MAP_VIEWPORT,
      clip: pairClip(50, 4, 57, 12),
    },
    after: {
      id: 'north-east-hut',
      label: 'C-553 hut actor-scale door',
      mapId: 'village',
      target: { c: 54, r: 11 },
      expectedPlayer: { c: 54, r: 11 },
      viewport: FULL_MAP_VIEWPORT,
      clip: pairClip(50, 4, 57, 12),
    },
  },
];

const afterCases: readonly CaptureDefinition[] = [
  {
    id: 'village-overview',
    label: 'C-553 full-village overview at maximum useful lane width',
    mapId: 'village',
    target: { c: 31, r: 23 },
    expectedPlayer: { c: 31, r: 23 },
    viewport: FULL_MAP_VIEWPORT,
  },
  {
    id: 'square-dawn',
    label: 'C-553 village square at dawn',
    mapId: 'village',
    target: { c: 28, r: 23 },
    expectedPlayer: { c: 28, r: 23 },
    gameHour: 6,
  },
  {
    id: 'square-night',
    label: 'C-553 village square at night',
    mapId: 'village',
    target: { c: 28, r: 23 },
    expectedPlayer: { c: 28, r: 23 },
    gameHour: 0,
  },
  {
    id: 'inn-walk-behind',
    label: 'C-553 player partly occluded beneath inn roof',
    mapId: 'village',
    target: { c: 51, r: 11 },
    expectedPlayer: { c: 51, r: 13 },
    actions: [{ key: 'KeyS', holdMs: 350 }],
  },
];

const gitText = (root: string, args: readonly string[]): string =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

const gitIdentity = (root: string): GitIdentity => {
  const status = execFileSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], {
    cwd: root,
  });
  const statusEntries = status
    .toString('utf8')
    .split('\0')
    .filter((entry) => entry.length >= 4)
    .toSorted((left, right) => left.slice(3).localeCompare(right.slice(3)));
  const identityParts = [
    gitText(root, ['rev-parse', 'HEAD']),
    gitText(root, ['rev-parse', '--abbrev-ref', 'HEAD']),
    status.toString('utf8'),
  ];
  for (const entry of statusEntries) {
    const path = entry.slice(3);
    identityParts.push(path);
    if (entry.startsWith('??')) {
      identityParts.push(readFileSync(resolve(root, path)).toString('base64'));
    } else {
      identityParts.push(
        execFileSync('git', ['diff', '--binary', 'HEAD', '--', path], { cwd: root }).toString(
          'base64',
        ),
      );
    }
  }
  return {
    root,
    commit: gitText(root, ['rev-parse', 'HEAD']),
    branch: gitText(root, ['rev-parse', '--abbrev-ref', 'HEAD']),
    statusFingerprint: hashBytes(identityParts.join('\n')),
  };
};

const artifactHashes = (root: string): ArtifactHashes => ({
  manifest: hashFile(resolve(root, 'content/packs/emberwatch/manifest.json')),
  villageMap: hashFile(resolve(root, 'content/packs/emberwatch/maps/village.json')),
  innMap: hashFile(resolve(root, 'content/packs/emberwatch/maps/inn.json')),
  atlasWebp: hashFile(
    resolve(root, 'apps/frontend/client/static/game-data/sprites/tilesets/atlas.webp'),
  ),
  atlasJson: hashFile(
    resolve(root, 'apps/frontend/client/static/game-data/sprites/tilesets/atlas.json'),
  ),
});

const writeJson = async (path: string, value: unknown): Promise<void> => {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
};

const assertArtifactLanes = (
  expected: ExpectedArtifacts,
  actual: Record<Lane, ArtifactHashes>,
): void => {
  for (const lane of ['before', 'after'] as const) {
    if (expected[lane].entityTextureGuard !== ENTITY_TEXTURE_GUARD_POLICY) {
      throw new Error(`C-553 ${lane} entity-texture policy mismatch`);
    }
    const mismatches = (Object.keys(actual[lane]) as Array<keyof ArtifactHashes>).filter(
      (key) => expected[lane][key] !== actual[lane][key],
    );
    if (mismatches.length > 0) {
      throw new Error(`C-553 ${lane} artifact mismatch: ${mismatches.join(', ')}`);
    }
  }
};

const assertPair = (pair: BuildingPair, before: CaptureRecord, after: CaptureRecord): void => {
  if (before.cameraSource !== 'worldTransform' || after.cameraSource !== 'worldTransform') {
    throw new Error(`C-553 ${pair.id} pair did not read the rendered world transform`);
  }
  if (before.actualCameraCell !== after.actualCameraCell) {
    throw new Error(
      `C-553 ${pair.id} camera mismatch: ${before.actualCameraCell} vs ${after.actualCameraCell}`,
    );
  }
  if (
    Math.abs(before.cameraWorld.x - after.cameraWorld.x) > 1 ||
    Math.abs(before.cameraWorld.y - after.cameraWorld.y) > 1
  ) {
    throw new Error(`C-553 ${pair.id} world camera coordinates differ`);
  }
  if (JSON.stringify(before.clip) !== JSON.stringify(after.clip)) {
    throw new Error(`C-553 ${pair.id} screenshot clips differ`);
  }
};

const contactSheet = async (records: readonly CaptureRecord[]): Promise<void> => {
  const columns = 4;
  const cellWidth = 480;
  const imageHeight = 270;
  const labelHeight = 30;
  const rows = Math.ceil(records.length / columns);
  const width = columns * cellWidth;
  const height = rows * (imageHeight + labelHeight);
  const composites: Array<{ input: Buffer; left: number; top: number }> = [];
  for (const [index, record] of records.entries()) {
    const label = `${record.lane.toUpperCase()} · ${record.label}`
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;');
    const image = await sharp(join(EVIDENCE_DIR, record.file))
      .resize(cellWidth, imageHeight, {
        fit: 'contain',
        background: '#10131a',
        withoutEnlargement: false,
      })
      .composite([
        {
          input: Buffer.from(
            `<svg width="${cellWidth}" height="${imageHeight}"><rect x="0" y="0" width="${cellWidth}" height="${imageHeight}" fill="none" stroke="#475569" stroke-width="2"/></svg>`,
          ),
          left: 0,
          top: 0,
        },
      ])
      .png()
      .toBuffer();
    const labelImage = Buffer.from(
      `<svg width="${cellWidth}" height="${labelHeight}"><rect width="100%" height="100%" fill="#0f172a"/><text x="10" y="20" fill="#e2e8f0" font-family="sans-serif" font-size="15">${label}</text></svg>`,
    );
    const cell = await sharp({
      create: {
        width: cellWidth,
        height: imageHeight + labelHeight,
        channels: 4,
        background: '#0f172a',
      },
    })
      .composite([
        { input: image, left: 0, top: 0 },
        { input: labelImage, left: 0, top: imageHeight },
      ])
      .png()
      .toBuffer();
    composites.push({
      input: cell,
      left: (index % columns) * cellWidth,
      top: Math.floor(index / columns) * (imageHeight + labelHeight),
    });
  }
  await sharp({ create: { width, height, channels: 4, background: '#020617' } })
    .composite(composites)
    .png()
    .toFile(join(EVIDENCE_DIR, 'sheet.png'));
};

const buildIndex = (options: {
  records: readonly CaptureRecord[];
  identities: Record<Lane, GitIdentity>;
  artifacts: Record<Lane, ArtifactHashes>;
  graphics: Awaited<ReturnType<EmberwatchHousePage['graphicsLimits']>>;
  overviewAllocation: Awaited<ReturnType<EmberwatchHousePage['canvasAllocation']>>;
}): string => {
  const lines = [
    '# C-553 Emberwatch house rollout evidence',
    '',
    'Technical WebGL evidence, not human visual acceptance. Every PNG was captured from the production `/game` route after the visible-entity texture guard passed.',
    '',
    '## Candidate identities',
    '',
    '| Lane | Root | Commit | Branch | Dirty-state fingerprint |',
    '|---|---|---|---|---|',
    ...(['before', 'after'] as const).map(
      (lane) =>
        `| ${lane} | \`${options.identities[lane].root}\` | \`${options.identities[lane].commit}\` | \`${options.identities[lane].branch}\` | \`${options.identities[lane].statusFingerprint}\` |`,
    ),
    '',
    '## Artifact fingerprints',
    '',
    '| Lane | Manifest | Village | Inn | Atlas WebP | Atlas JSON |',
    '|---|---|---|---|---|---|',
    ...(['before', 'after'] as const).map(
      (lane) =>
        `| ${lane} | \`${options.artifacts[lane].manifest}\` | \`${options.artifacts[lane].villageMap}\` | \`${options.artifacts[lane].innMap}\` | \`${options.artifacts[lane].atlasWebp}\` | \`${options.artifacts[lane].atlasJson}\` |`,
    ),
    '',
    `Renderer guard: \`WebGL\`. Entity-texture guard: \`${ENTITY_TEXTURE_GUARD_POLICY}\` (before lane: legacy-positionless-placeholder-v1 compatibility; after lane: fail-closed).`,
    `WebGL limits: ${options.graphics.maxViewportWidth}×${options.graphics.maxViewportHeight}; max texture ${options.graphics.maxTextureSize}. Overview allocation: ${options.overviewAllocation.width}×${options.overviewAllocation.height}.`,
    '',
    '## Captures',
    '',
    '| Lane | File | Map | Player | Camera | Viewport | Hour | SHA-256 |',
    '|---|---|---|---|---|---|---:|---|',
    ...options.records.map(
      (record) =>
        `| ${record.lane} | \`${record.file}\` | ${record.mapId} | ${record.actualPlayerCell} | ${record.actualCameraCell} (${record.cameraSource}) | ${record.viewport.width}×${record.viewport.height} | ${record.gameHour} | \`${record.sha256}\` |`,
    ),
    '',
    '## Review observations',
    '',
    '- Seven before/after pairs use the same full-map camera, viewport, hour and clip.',
    '- Inn and shop transitions retain IDs and named arrivals; village return markers sit outside inclusive trigger bounds.',
    '- Overview uses 8192×6144, the exact 64×48 map extent at production scale 4.',
    '- Square dawn/night, inn walk-behind and inn enter/exit use the same entity-texture guard.',
    '- The before lane records one explicitly shaped legacy placeholder compatibility; the after lane has no such exemption.',
    '- `sheet.png` is a technical contact sheet; beauty and usability remain human review decisions.',
    '',
  ];
  return `${lines.join('\n')}\n`;
};

const assertOverviewAllocation = async (options: {
  runtime: CaptureRuntime;
  definition: CaptureDefinition;
  house: EmberwatchHousePage;
}): Promise<void> => {
  if (options.definition.id !== 'village-overview') {
    return;
  }
  const allocation = await options.house.canvasAllocation();
  options.runtime.overviewAllocation = allocation;
  if (
    allocation.width !== FULL_MAP_VIEWPORT.width ||
    allocation.height !== FULL_MAP_VIEWPORT.height
  ) {
    throw new Error(`C-553 overview allocation is ${allocation.width}×${allocation.height}`);
  }
};

const assertCapturedSnapshot = (options: {
  snapshot: WorldSnapshot;
  expectedPlayer: EmberwatchHouseCell;
  mapId: string;
  label: string;
}): void => {
  if (
    options.snapshot.player.c !== options.expectedPlayer.c ||
    options.snapshot.player.r !== options.expectedPlayer.r
  ) {
    throw new Error(
      `C-553 ${options.label} expected player ${formatCell(options.expectedPlayer)}, got ${formatCell(options.snapshot.player)}`,
    );
  }
  if (options.snapshot.mapId !== options.mapId) {
    throw new Error(
      `C-553 ${options.label} expected map ${options.mapId}, got ${options.snapshot.mapId}`,
    );
  }
  if (options.snapshot.renderer !== 'webgl') {
    throw new Error(`C-553 ${options.label} renderer is ${options.snapshot.renderer}`);
  }
};

const makeCaptureRecord = (options: {
  lane: Lane;
  definition: CaptureDefinition;
  file: string;
  path: string;
  snapshot: WorldSnapshot;
  textures: readonly unknown[];
  clientUrl: string;
  artifactRoot: string;
  viewport: Viewport;
}): CaptureRecord => ({
  lane: options.lane,
  id: options.definition.id,
  label: options.definition.label,
  file: options.file,
  clientUrl: options.clientUrl,
  artifactRoot: options.artifactRoot,
  mapId: options.snapshot.mapId,
  requestedCell: formatCell(options.definition.target),
  expectedPlayerCell: formatCell(options.definition.expectedPlayer),
  actualPlayerCell: formatCell(options.snapshot.player),
  actualCameraCell: formatCell(options.snapshot.camera),
  cameraWorld: { x: options.snapshot.camera.x, y: options.snapshot.camera.y },
  worldTransform: options.snapshot.worldTransform,
  cameraSource: options.snapshot.cameraSource,
  renderer: options.snapshot.renderer,
  viewport: options.viewport,
  gameHour: options.definition.gameHour ?? 12,
  ...(options.definition.clip ? { clip: options.definition.clip } : {}),
  entityTextureFingerprint: hashBytes(Buffer.from(JSON.stringify(options.textures))),
  sha256: hashFile(options.path),
});

const captureDefinition = async (options: {
  runtime: CaptureRuntime;
  lane: Lane;
  definition: CaptureDefinition;
}): Promise<CaptureRecord> => {
  const { runtime, lane, definition } = options;
  const viewport = definition.viewport ?? DEFAULT_VIEWPORT;
  await runtime.page.setViewportSize(viewport);
  const house = new EmberwatchHousePage(runtime.page, runtime.urls[lane], {
    allowLegacyPositionlessPlaceholder: lane === 'before',
  });
  await house.goto({ gameHour: definition.gameHour ?? 12 });
  runtime.graphics ??= await house.graphicsLimits();
  await house.loadMapAt(definition.mapId, definition.target);
  for (const action of definition.actions ?? []) {
    await house.move(action.key, action.holdMs);
  }
  await runtime.page.waitForTimeout(300);
  await assertOverviewAllocation({ runtime, definition, house });
  const file = `${lane}_${definition.id}.png`;
  const path = join(EVIDENCE_DIR, file);
  const textures = await house.requireResolvedEntityTextures();
  const snapshot = await house.capture(path, definition.clip ? { clip: definition.clip } : {});
  assertCapturedSnapshot({
    snapshot,
    expectedPlayer: definition.expectedPlayer,
    mapId: definition.mapId,
    label: `${lane}/${definition.id}`,
  });
  const record = makeCaptureRecord({
    lane,
    definition,
    file,
    path,
    snapshot,
    textures,
    clientUrl: runtime.urls[lane],
    artifactRoot: runtime.roots[lane],
    viewport,
  });
  runtime.records.push(record);
  return record;
};

const captureBuildingPairs = async (runtime: CaptureRuntime): Promise<void> => {
  for (const pair of buildingPairs) {
    const before = await captureDefinition({ runtime, lane: 'before', definition: pair.before });
    const after = await captureDefinition({ runtime, lane: 'after', definition: pair.after });
    assertPair(pair, before, after);
  }
};

const captureAfterCases = async (runtime: CaptureRuntime): Promise<void> => {
  for (const definition of afterCases) {
    await captureDefinition({ runtime, lane: 'after', definition });
  }
};

const makeTransitionRecord = (options: {
  runtime: CaptureRuntime;
  id: string;
  label: string;
  file: string;
  path: string;
  requestedCell: string;
  expectedPlayerCell: string;
  snapshot: WorldSnapshot;
  textures: readonly unknown[];
}): CaptureRecord => ({
  lane: 'after',
  id: options.id,
  label: options.label,
  file: options.file,
  clientUrl: options.runtime.urls.after,
  artifactRoot: options.runtime.roots.after,
  mapId: options.snapshot.mapId,
  requestedCell: options.requestedCell,
  expectedPlayerCell: options.expectedPlayerCell,
  actualPlayerCell: formatCell(options.snapshot.player),
  actualCameraCell: formatCell(options.snapshot.camera),
  cameraWorld: { x: options.snapshot.camera.x, y: options.snapshot.camera.y },
  worldTransform: options.snapshot.worldTransform,
  cameraSource: options.snapshot.cameraSource,
  renderer: options.snapshot.renderer,
  viewport: DEFAULT_VIEWPORT,
  gameHour: 12,
  entityTextureFingerprint: hashBytes(Buffer.from(JSON.stringify(options.textures))),
  sha256: hashFile(options.path),
});

const captureInnEntry = async (options: {
  runtime: CaptureRuntime;
  house: EmberwatchHousePage;
}): Promise<void> => {
  const { runtime, house } = options;
  const file = 'after_enter_inn.png';
  const path = join(EVIDENCE_DIR, file);
  const textures = await house.requireResolvedEntityTextures();
  const snapshot = await house.capture(path);
  assertCapturedSnapshot({
    snapshot,
    expectedPlayer: { c: 14, r: 17 },
    mapId: 'inn',
    label: 'enter-inn',
  });
  runtime.records.push(
    makeTransitionRecord({
      runtime,
      id: 'enter-inn',
      label: 'C-553 inn transition arrival',
      file,
      path,
      requestedCell: 'transition:1006',
      expectedPlayerCell: '14,17',
      snapshot,
      textures,
    }),
  );
};

const captureInnExit = async (options: {
  runtime: CaptureRuntime;
  house: EmberwatchHousePage;
}): Promise<void> => {
  const { runtime, house } = options;
  const file = 'after_exit_inn.png';
  const path = join(EVIDENCE_DIR, file);
  const textures = await house.requireResolvedEntityTextures();
  const snapshot = await house.capture(path);
  assertCapturedSnapshot({
    snapshot,
    expectedPlayer: { c: 51, r: 23 },
    mapId: 'village',
    label: 'exit-inn',
  });
  runtime.records.push(
    makeTransitionRecord({
      runtime,
      id: 'exit-inn',
      label: 'C-553 inn return arrival',
      file,
      path,
      requestedCell: 'transition:inn:1005',
      expectedPlayerCell: '51,23',
      snapshot,
      textures,
    }),
  );
};

const captureInnTransitions = async (runtime: CaptureRuntime): Promise<void> => {
  const house = new EmberwatchHousePage(runtime.page, runtime.urls.after);
  await runtime.page.setViewportSize(DEFAULT_VIEWPORT);
  await house.goto({ gameHour: 12 });
  await house.loadVillageAt({ c: 51, r: 22 });
  await house.moveThroughTransition({ key: 'KeyW', fromMap: 'village', toMap: 'inn' });
  await captureInnEntry({ runtime, house });
  await house.moveThroughTransition({ key: 'KeyS', fromMap: 'inn', toMap: 'village' });
  await runtime.page.waitForTimeout(500);
  await captureInnExit({ runtime, house });
};

const assertCaptureComplete = (runtime: CaptureRuntime): void => {
  if (runtime.pageErrors.length > 0) {
    throw new Error(`C-553 page errors: ${runtime.pageErrors.join(' | ')}`);
  }
  if (runtime.records.length !== 20) {
    throw new Error(`C-553 expected 20 captures, got ${runtime.records.length}`);
  }
  if (!runtime.graphics || !runtime.overviewAllocation) {
    throw new Error('C-553 overview capability evidence is missing');
  }
  if (
    runtime.graphics.maxViewportWidth < FULL_MAP_VIEWPORT.width ||
    runtime.graphics.maxViewportHeight < FULL_MAP_VIEWPORT.height
  ) {
    throw new Error(
      `C-553 WebGL max viewport ${runtime.graphics.maxViewportWidth}×${runtime.graphics.maxViewportHeight} is too small`,
    );
  }
};

const writeEvidence = async (options: {
  runtime: CaptureRuntime;
  expected: ExpectedArtifacts;
  artifacts: Record<Lane, ArtifactHashes>;
  identities: Record<Lane, GitIdentity>;
}): Promise<void> => {
  const { runtime, expected, artifacts, identities } = options;
  if (!runtime.graphics || !runtime.overviewAllocation) {
    throw new Error('C-553 final graphics evidence is missing');
  }
  const beforeRecords = runtime.records.filter((record) => record.lane === 'before');
  const afterRecords = runtime.records.filter((record) => record.lane === 'after');
  const captureFingerprint = hashBytes(
    Buffer.from(runtime.records.map((record) => `${record.file}:${record.sha256}`).join('\n')),
  );
  const manifest = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    command:
      'C553_BEFORE_CLIENT_URL=... C553_AFTER_CLIENT_URL=... bun run --cwd apps/e2e capture:c553-house-rollout',
    expectedArtifacts: expected,
    actualArtifacts: artifacts,
    identities,
    entityTextureGuard: {
      policy: ENTITY_TEXTURE_GUARD_POLICY,
      status: 'passed',
      compatibility: {
        before: 'legacy-positionless-placeholder-v1',
        after: 'none',
      },
    },
    renderer: 'webgl',
    graphics: runtime.graphics,
    overviewAllocation: runtime.overviewAllocation,
    captureCount: runtime.records.length,
    captureFingerprint,
    pageErrors: runtime.pageErrors,
  };
  await writeJson(join(EVIDENCE_DIR, 'manifest.json'), manifest);
  await writeJson(join(EVIDENCE_DIR, 'before_index.json'), {
    ...manifest,
    captures: beforeRecords,
  });
  await writeJson(join(EVIDENCE_DIR, 'after_index.json'), {
    ...manifest,
    captures: afterRecords,
  });
  await writeFile(
    join(EVIDENCE_DIR, 'index.md'),
    buildIndex({
      records: runtime.records,
      identities,
      artifacts,
      graphics: runtime.graphics,
      overviewAllocation: runtime.overviewAllocation,
    }),
  );
  await contactSheet(runtime.records);
  console.log(`C-553 evidence captured: ${runtime.records.length} PNGs → ${EVIDENCE_DIR}`);
};

const main = async (): Promise<void> => {
  if (!BEFORE_CLIENT_URL || !AFTER_CLIENT_URL) {
    throw new Error(
      'C553_BEFORE_CLIENT_URL and C553_AFTER_CLIENT_URL are required explicit production origins',
    );
  }
  await rm(EVIDENCE_DIR, { recursive: true, force: true });
  await mkdir(EVIDENCE_DIR, { recursive: true });

  const expected = JSON.parse(readFileSync(EXPECTED_PATH, 'utf8')) as ExpectedArtifacts;
  const artifacts: Record<Lane, ArtifactHashes> = {
    before: artifactHashes(BEFORE_ROOT),
    after: artifactHashes(AFTER_ROOT),
  };
  assertArtifactLanes(expected, artifacts);
  const identities: Record<Lane, GitIdentity> = {
    before: gitIdentity(BEFORE_ROOT),
    after: gitIdentity(AFTER_ROOT),
  };
  const roots: Record<Lane, string> = {
    before: BEFORE_ROOT,
    after: AFTER_ROOT,
  };
  const urls: Record<Lane, string> = {
    before: BEFORE_CLIENT_URL,
    after: AFTER_CLIENT_URL,
  };

  const browser = await chromium.launch({
    headless: true,
    executablePath: realpathSync(process.env.C553_CHROMIUM_PATH ?? chromium.executablePath()),
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
  const context = await browser.newContext({
    viewport: DEFAULT_VIEWPORT,
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const runtime: CaptureRuntime = {
    page,
    urls,
    roots,
    records: [],
    pageErrors: [],
    graphics: undefined,
    overviewAllocation: undefined,
  };
  page.on('pageerror', (error) => runtime.pageErrors.push(error.message));

  try {
    await captureBuildingPairs(runtime);
    await captureAfterCases(runtime);
    await captureInnTransitions(runtime);
    assertCaptureComplete(runtime);
  } finally {
    await context.close();
    await browser.close();
  }

  await writeEvidence({ runtime, expected, artifacts, identities });
};

await main();
