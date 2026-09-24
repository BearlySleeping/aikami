// apps/e2e/scripts/capture_c550_house.ts
//
// Reproducible C-550 production-route evidence capture. The script uses the
// EmberwatchHousePage POM, asserts WebGL before every screenshot, records the
// candidate commit and artifact hashes, and writes metadata beside the images.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { type EmberwatchHouseCell, EmberwatchHousePage } from '../src/pom/emberwatch_house_page.ts';

type EvidenceViewport = { width: number; height: number };

type EvidenceAction = {
  key: 'KeyW' | 'KeyA' | 'KeyS' | 'KeyD';
  holdMs?: number;
  label: string;
};

type EvidenceCase = {
  file: string;
  label: string;
  mapId: 'village' | 'inn';
  target: EmberwatchHouseCell;
  viewport?: EvidenceViewport;
  gameHour?: number;
  e2e?: boolean;
  authoring?: boolean;
  authoringLayers?: readonly string[];
  textScale?: number;
  actions?: readonly EvidenceAction[];
};

type EvidenceRecord = {
  file: string;
  label: string;
  phase: 'stills' | 'walk';
  mapId: string;
  targetCell: string;
  playerCell: string;
  cameraCell: string;
  cameraSource: 'engine' | 'playerFallback';
  renderer: string;
  viewport: EvidenceViewport;
  textScale: number;
  purpose: string;
  sha256: string;
};

type ExpectedArtifacts = {
  manifest: string;
  villageMap: string;
  atlasWebp: string;
  atlasJson: string;
};

const ROOT = resolve(import.meta.dirname, '../../..');
const EVIDENCE_DIR = resolve(
  process.env.C550_EVIDENCE_DIR ?? '/tmp/opencode/c550-evidence/automated',
);
const CLIENT_URL = process.env.C550_CLIENT_URL ?? 'http://127.0.0.1:5384';
const EXPECTED_ARTIFACTS_PATH = resolve(
  ROOT,
  'apps/e2e/src/visual/c550_house_expected_artifacts.json',
);
const ARTIFACT_PATHS = {
  manifest: resolve(ROOT, 'content/packs/emberwatch/manifest.json'),
  villageMap: resolve(ROOT, 'content/packs/emberwatch/maps/village.json'),
  atlasWebp: resolve(ROOT, 'apps/frontend/client/static/game-data/sprites/tilesets/atlas.webp'),
  atlasJson: resolve(ROOT, 'apps/frontend/client/static/game-data/sprites/tilesets/atlas.json'),
} as const;

const DEFAULT_VIEWPORT: EvidenceViewport = { width: 1280, height: 720 };
const HOUSE_LAYERS = [
  'walkable',
  'connectivity',
  'transitions',
  'destinations',
  'propBounds',
  'propCollision',
  'propAnchor',
  'shadowBounds',
  'npcs',
  'landmarks',
  'ids',
] as const;

const STILL_CASES: readonly EvidenceCase[] = [
  {
    file: 'automated_hut_front_noon_1280x720.png',
    label: 'C-550 hut front, noon',
    mapId: 'village',
    target: { c: 54, r: 8 },
  },
  {
    file: 'automated_hut_front_dawn_1920x1080.png',
    label: 'C-550 hut front, dawn',
    mapId: 'village',
    target: { c: 54, r: 8 },
    viewport: { width: 1920, height: 1080 },
    gameHour: 6,
  },
  {
    file: 'automated_hut_front_night_2048x1152.png',
    label: 'C-550 hut front, night',
    mapId: 'village',
    target: { c: 54, r: 8 },
    viewport: { width: 2048, height: 1152 },
    gameHour: 0,
  },
  {
    file: 'automated_hut_front_compact_800x600.png',
    label: 'C-550 hut front, compact viewport',
    mapId: 'village',
    target: { c: 54, r: 8 },
    viewport: { width: 800, height: 600 },
  },
  {
    file: 'automated_hut_front_collision_1920x1080.png',
    label: 'C-550 hut front, collision overlay',
    mapId: 'village',
    target: { c: 54, r: 8 },
    viewport: { width: 1920, height: 1080 },
    e2e: true,
  },
  {
    file: 'automated_hut_front_authoring_1920x1080.png',
    label: 'C-550 hut front, authoring overlay',
    mapId: 'village',
    target: { c: 54, r: 8 },
    viewport: { width: 1920, height: 1080 },
    authoring: true,
    authoringLayers: HOUSE_LAYERS,
  },
  {
    file: 'automated_hut_front_text_200_1920x1080.png',
    label: 'C-550 hut front, noon, 200% root text',
    mapId: 'village',
    target: { c: 54, r: 8 },
    viewport: { width: 1920, height: 1080 },
    textScale: 2,
  },
  {
    file: 'automated_crossing_noon_1920x1080.png',
    label: 'C-550 C-549 crossing, noon',
    mapId: 'village',
    target: { c: 40, r: 7 },
    viewport: { width: 1920, height: 1080 },
  },
  {
    file: 'automated_crossing_dawn_1920x1080.png',
    label: 'C-550 C-549 crossing, dawn',
    mapId: 'village',
    target: { c: 40, r: 7 },
    viewport: { width: 1920, height: 1080 },
    gameHour: 6,
  },
  {
    file: 'automated_inn_interior_noon_1280x720.png',
    label: 'C-550 unchanged inn comparison',
    mapId: 'inn',
    target: { c: 14, r: 10 },
  },
  {
    file: 'automated_hut_beside_unchanged_inn_noon_1920x1080.png',
    label: 'C-550 hut beside unchanged village inn, noon',
    mapId: 'village',
    target: { c: 51, r: 11 },
    viewport: { width: 1920, height: 1080 },
  },
  {
    file: 'automated_hut_with_c549_crossing_noon_3200x1080.png',
    label: 'C-550 hut with C-549 crossing, noon',
    mapId: 'village',
    target: { c: 46, r: 8 },
    viewport: { width: 3200, height: 1080 },
  },
];

const WALK_CASES: readonly EvidenceCase[] = [
  {
    file: 'automated_walk_behind_roof_01_start.png',
    label: 'C-550 walk behind, start north of hut',
    mapId: 'village',
    target: { c: 54, r: 4 },
  },
  {
    file: 'automated_walk_behind_roof_02_enter.png',
    label: 'C-550 walk behind, enter upper roof',
    mapId: 'village',
    target: { c: 54, r: 4 },
    actions: [{ key: 'KeyS', holdMs: 650, label: 'move south onto clear overhead roof' }],
  },
  {
    file: 'automated_walk_behind_roof_03_under_eave.png',
    label: 'C-550 walk behind, continue under eave',
    mapId: 'village',
    target: { c: 54, r: 4 },
    actions: [
      { key: 'KeyS', holdMs: 650, label: 'move south onto clear overhead roof' },
      { key: 'KeyS', holdMs: 650, label: 'attempt to cross the blocked front eave' },
    ],
  },
  {
    file: 'automated_walk_behind_roof_04_blocked.png',
    label: 'C-550 walk behind, front eave blocks',
    mapId: 'village',
    target: { c: 54, r: 4 },
    actions: [
      { key: 'KeyS', holdMs: 650, label: 'move south onto clear overhead roof' },
      { key: 'KeyS', holdMs: 650, label: 'attempt to cross the blocked front eave' },
      { key: 'KeyS', holdMs: 450, label: 'confirm the front eave remains blocked' },
    ],
  },
  {
    file: 'automated_door_approach_01_start.png',
    label: 'C-550 door approach, start',
    mapId: 'village',
    target: { c: 54, r: 10 },
  },
  {
    file: 'automated_door_approach_02_attempt.png',
    label: 'C-550 door approach, threshold attempt',
    mapId: 'village',
    target: { c: 54, r: 10 },
    actions: [{ key: 'KeyW', holdMs: 650, label: 'attempt the visible threshold' }],
  },
  {
    file: 'automated_door_approach_03_side_east.png',
    label: 'C-550 door approach, lateral east',
    mapId: 'village',
    target: { c: 54, r: 10 },
    actions: [
      { key: 'KeyW', holdMs: 650, label: 'attempt the visible threshold' },
      { key: 'KeyD', holdMs: 350, label: 'move laterally on the clear approach' },
    ],
  },
  {
    file: 'automated_door_approach_04_side_west.png',
    label: 'C-550 door approach, lateral west',
    mapId: 'village',
    target: { c: 54, r: 10 },
    actions: [
      { key: 'KeyW', holdMs: 650, label: 'attempt the visible threshold' },
      { key: 'KeyA', holdMs: 350, label: 'move laterally on the clear approach' },
    ],
  },
  {
    file: 'automated_door_approach_05_return.png',
    label: 'C-550 door approach, return west',
    mapId: 'village',
    target: { c: 54, r: 10 },
    actions: [
      { key: 'KeyW', holdMs: 650, label: 'attempt the visible threshold' },
      { key: 'KeyA', holdMs: 700, label: 'return across the clear approach' },
    ],
  },
];

const hashBytes = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const hashFile = (path: string): string => hashBytes(readFileSync(path));

const gitOutput = (args: readonly string[]): string =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();

const formatCell = (cell: EmberwatchHouseCell): string => `${cell.c},${cell.r}`;

const writeJson = async (path: string, value: unknown): Promise<void> => {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
};

const main = async (): Promise<void> => {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  process.env.C550_CLIENT_URL = CLIENT_URL;

  const expected = JSON.parse(readFileSync(EXPECTED_ARTIFACTS_PATH, 'utf8')) as ExpectedArtifacts;
  const artifactHashes: Record<keyof ExpectedArtifacts, string> = {
    manifest: hashFile(ARTIFACT_PATHS.manifest),
    villageMap: hashFile(ARTIFACT_PATHS.villageMap),
    atlasWebp: hashFile(ARTIFACT_PATHS.atlasWebp),
    atlasJson: hashFile(ARTIFACT_PATHS.atlasJson),
  };
  const mismatchedArtifacts = (Object.keys(expected) as Array<keyof ExpectedArtifacts>).filter(
    (key) => expected[key] !== artifactHashes[key],
  );
  if (mismatchedArtifacts.length > 0) {
    throw new Error(
      `C-550 evidence artifact fingerprint mismatch: ${mismatchedArtifacts.join(', ')}`,
    );
  }

  const commit = gitOutput(['rev-parse', 'HEAD']);
  const branch = gitOutput(['rev-parse', '--abbrev-ref', 'HEAD']);
  const diff = execFileSync('git', ['diff', '--binary', 'HEAD'], { cwd: ROOT });
  const candidateFingerprint = hashBytes(
    Buffer.from(`${commit}\n${branch}\n${hashBytes(diff)}\n${JSON.stringify(artifactHashes)}`),
  );
  const browser = await chromium.launch({
    headless: true,
    executablePath: realpathSync(process.env.C550_CHROMIUM_PATH ?? chromium.executablePath()),
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
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const house = new EmberwatchHousePage(page);
  const stillRecords: EvidenceRecord[] = [];
  const walkRecords: EvidenceRecord[] = [];

  const captureCase = async (definition: EvidenceCase, phase: 'stills' | 'walk'): Promise<void> => {
    const viewport = definition.viewport ?? DEFAULT_VIEWPORT;
    await page.setViewportSize(viewport);
    await house.goto({
      gameHour: definition.gameHour ?? 12,
      e2e: definition.e2e,
      authoring: definition.authoring,
      authoringLayers: definition.authoringLayers,
      textScale: definition.textScale,
    });
    await house.loadMapAt(definition.mapId, definition.target);
    for (const action of definition.actions ?? []) {
      await house.move(action.key, action.holdMs);
    }
    const path = join(EVIDENCE_DIR, definition.file);
    const snapshot = await house.capture(path);
    const record: EvidenceRecord = {
      file: definition.file,
      label: definition.label,
      phase,
      mapId: definition.mapId,
      targetCell: formatCell(definition.target),
      playerCell: formatCell(snapshot.player),
      cameraCell: formatCell(snapshot.camera),
      cameraSource: snapshot.cameraSource,
      renderer: snapshot.renderer,
      viewport,
      textScale: definition.textScale ?? 1,
      purpose: definition.actions?.at(-1)?.label ?? definition.label,
      sha256: hashFile(path),
    };
    if (phase === 'stills') {
      stillRecords.push(record);
    } else {
      walkRecords.push(record);
    }
  };

  try {
    for (const definition of STILL_CASES) {
      await captureCase(definition, 'stills');
    }
    for (const definition of WALK_CASES) {
      await captureCase(definition, 'walk');
    }
    if (pageErrors.length > 0) {
      throw new Error(`C-550 evidence page errors: ${pageErrors.join(' | ')}`);
    }
  } finally {
    await context.close();
    await browser.close();
  }

  const identity = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    command: 'bun run --cwd apps/e2e scripts/capture_c550_house.ts',
    baseUrl: CLIENT_URL,
    branch,
    commit,
    candidateFingerprint,
    artifactHashes,
    expectedArtifactHashes: expected,
    artifactFingerprintCheck: 'passed',
    renderer: 'webgl',
  };
  await writeJson(join(EVIDENCE_DIR, 'automated_manifest.json'), {
    ...identity,
    pageErrors,
    stillCount: stillRecords.length,
    walkCount: walkRecords.length,
  });
  await writeJson(join(EVIDENCE_DIR, 'capture_index.json'), {
    ...identity,
    captures: stillRecords,
  });
  await writeJson(join(EVIDENCE_DIR, 'walk_index.json'), {
    ...identity,
    records: walkRecords,
  });
  console.log(
    `C-550 evidence captured: ${stillRecords.length} stills, ${walkRecords.length} walk frames → ${EVIDENCE_DIR}`,
  );
};

await main();
