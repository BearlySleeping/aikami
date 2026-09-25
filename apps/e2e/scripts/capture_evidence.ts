// apps/e2e/scripts/capture_evidence.ts
// C-560 persistent before/after production-route evidence capture.
// Uses caller-supplied read-only local_asset_origin inputs; never builds content.

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { type BrowserContext, chromium, type Page } from 'playwright';
import sharp from 'sharp';
import {
  type EmberwatchHouseCell,
  type EmberwatchHouseMapId,
  EmberwatchHousePage,
} from '../src/pom/emberwatch_house_page.ts';
import { ENTITY_TEXTURE_GUARD_POLICY } from '../src/visual/core/entity_texture_guard.ts';
import {
  type ChecksumInput,
  createChecksumRecords,
  createEvidenceCaptureRecord,
  createEvidenceManifest,
  createMontageLayout,
  type EvidenceCaptureRecord,
  type EvidenceCell,
  type EvidenceIdentity,
  type EvidenceLane,
  type EvidenceOrigin,
  type EvidenceViewport,
  formatEvidenceCell,
  normalizeEvidenceOrigin,
  renderChecksumsFile,
  renderEvidenceIndex,
  sha256Hex,
  validateEvidenceLaneRequests,
} from '../src/visual/core/evidence.ts';

const ROOT = resolve(import.meta.dirname, '../../..');
const DEFAULT_VIEWPORT: EvidenceViewport = { width: 1280, height: 720 };
const DEFAULT_MAP: EmberwatchHouseMapId = 'village';
const DEFAULT_CELL: EmberwatchHouseCell = { c: 54, r: 11 };
const DEFAULT_ID = 'evidence';
const DEFAULT_LABEL = 'Evidence capture';

const MAP_ALIASES: Readonly<Record<string, EmberwatchHouseMapId>> = {
  village: 'village',
  inn: 'inn',
  merchant_shop: 'merchant_shop',
  'merchant-shop': 'merchant_shop',
  old_road: 'old_road',
  'old-road': 'old_road',
  ruined_shrine: 'ruined_shrine',
  'ruined-shrine': 'ruined_shrine',
};

const CLIENT_FLAGS = new Set([
  'before-url',
  'after-url',
  'before-client-url',
  'after-client-url',
  'before-client',
  'after-client',
  'client-before-url',
  'client-after-url',
]);
const ASSET_FLAGS = new Set([
  'before-origin',
  'after-origin',
  'before-asset-origin',
  'after-asset-origin',
  'before-assets-origin',
  'after-assets-origin',
  'before-asset-url',
  'after-asset-url',
  'before-assets-url',
  'after-assets-url',
  'before-published-origin',
  'after-candidate-origin',
]);
const ROOT_FLAGS = new Set([
  'before-root',
  'after-root',
  'before-candidate-root',
  'after-candidate-root',
]);
const VALUE_FLAGS = new Set([
  'contract',
  'id',
  'label',
  'map',
  'map-id',
  'cell',
  'cell-c',
  'cell-r',
  'viewport',
  'width',
  'height',
  ...CLIENT_FLAGS,
  ...ASSET_FLAGS,
  ...ROOT_FLAGS,
]);
const BOOLEAN_FLAGS = new Set(['allow-remote-origin', 'help']);

type CliOptions = {
  contract: string;
  id: string;
  label: string;
  beforeUrl: string;
  afterUrl: string;
  beforeOrigin: string;
  afterOrigin: string;
  beforeRoot: string;
  afterRoot: string;
  mapId: EmberwatchHouseMapId;
  cell: EmberwatchHouseCell;
  viewport: EvidenceViewport;
  allowRemoteOrigin: boolean;
};

type ParsedArguments = {
  values: Map<string, string>;
  booleans: Set<string>;
};

type ParsedArgument = {
  name: string;
  value: string | undefined;
  boolean: boolean;
  consumedNext: boolean;
};

type CaptureLaneOptions = {
  lane: EvidenceLane;
  clientUrl: string;
  assetOrigin: string;
  otherAssetOrigin: string;
  originRole: EvidenceOrigin['role'];
  identity: EvidenceIdentity;
  mapId: EmberwatchHouseMapId;
  cell: EmberwatchHouseCell;
  viewport: EvidenceViewport;
  id: string;
  label: string;
  stageDir: string;
  context: BrowserContext;
};

type CaptureLaneResult = {
  record: EvidenceCaptureRecord;
  pageErrors: readonly string[];
};

const usage = (): string => `Usage:
  bun run --cwd apps/e2e capture:evidence -- \\
    --contract <contract> \\
    --before-url <client-origin> --after-url <client-origin> \\
    --before-origin <asset-origin> --after-origin <asset-origin> \\
    [--before-root <path>] [--after-root <path>] \\
    [--id <id>] [--label <label>] [--map <map-id>] \\
    [--cell <column,row>] [--viewport <width>x<height>] \\
    [--allow-remote-origin]

The asset origins must be loopback by default. They are inputs to the existing
read-only local_asset_origin published/candidate plane; this command never
builds or publishes content.`;

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const parseArgument = (options: { argument: string; next: string | undefined }): ParsedArgument => {
  if (!options.argument.startsWith('--')) {
    throw new Error(`Unexpected evidence argument: ${options.argument}`);
  }
  const equalsIndex = options.argument.indexOf('=');
  const name = (
    equalsIndex >= 0 ? options.argument.slice(2, equalsIndex) : options.argument.slice(2)
  ).toLowerCase();
  if (BOOLEAN_FLAGS.has(name)) {
    if (equalsIndex >= 0) {
      throw new Error(`Boolean flag does not accept a value: --${name}`);
    }
    return { name, value: undefined, boolean: true, consumedNext: false };
  }
  if (!VALUE_FLAGS.has(name)) {
    throw new Error(`Unknown evidence flag: --${name}`);
  }
  const value = equalsIndex >= 0 ? options.argument.slice(equalsIndex + 1) : options.next;
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`Missing value for --${name}`);
  }
  return { name, value, boolean: false, consumedNext: equalsIndex < 0 };
};

const parseArguments = (args: readonly string[]): ParsedArguments => {
  const values = new Map<string, string>();
  const booleans = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === undefined) {
      throw new Error('Unexpected end of evidence arguments');
    }
    const parsed = parseArgument({ argument, next: args[index + 1] });
    if (parsed.boolean) {
      booleans.add(parsed.name);
    } else if (parsed.value !== undefined) {
      values.set(parsed.name, parsed.value);
    }
    if (parsed.consumedNext) {
      index += 1;
    }
  }
  return { values, booleans };
};

const firstValue = (
  values: ReadonlyMap<string, string>,
  names: readonly string[],
): string | undefined => {
  for (const name of names) {
    const value = values.get(name);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
};

const requiredValue = (values: ReadonlyMap<string, string>, names: readonly string[]): string => {
  const value = firstValue(values, names);
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`Missing required flag: --${names[0]}`);
  }
  return value;
};

const safeSegment = (value: string, flagName: string): string => {
  const segment = value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (segment.length === 0 || segment === '.' || segment === '..') {
    throw new Error(`${flagName} must contain a path-safe identifier`);
  }
  return segment;
};

const parseMap = (value: string | undefined): EmberwatchHouseMapId => {
  if (value === undefined) {
    return DEFAULT_MAP;
  }
  const mapId = MAP_ALIASES[value.toLowerCase()];
  if (mapId === undefined) {
    throw new Error(`Unsupported evidence map: ${value}`);
  }
  return mapId;
};

const parseCell = (options: {
  value: string | undefined;
  column: string | undefined;
  row: string | undefined;
}): EvidenceCell => {
  if (options.value !== undefined) {
    const match = /^(-?\d+)\s*[,x:]\s*(-?\d+)$/i.exec(options.value.trim());
    if (!match) {
      throw new Error('--cell must be formatted as column,row (for example 54,11)');
    }
    return { c: Number(match[1]), r: Number(match[2]) };
  }
  if (options.column !== undefined || options.row !== undefined) {
    if (options.column === undefined || options.row === undefined) {
      throw new Error('--cell-c and --cell-r must be supplied together');
    }
    const column = Number(options.column);
    const row = Number(options.row);
    if (!Number.isInteger(column) || !Number.isInteger(row)) {
      throw new Error('--cell-c and --cell-r must be integers');
    }
    return { c: column, r: row };
  }
  return DEFAULT_CELL;
};

const isPositiveInteger = (value: number): boolean => Number.isInteger(value) && value > 0;

const parseViewport = (options: {
  value: string | undefined;
  width: string | undefined;
  height: string | undefined;
}): EvidenceViewport => {
  if (options.value !== undefined) {
    const match = /^(\d+)\s*[x×,]\s*(\d+)$/i.exec(options.value.trim());
    if (!match) {
      throw new Error('--viewport must be formatted as widthxheight (for example 1280x720)');
    }
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (!isPositiveInteger(width) || !isPositiveInteger(height)) {
      throw new Error('--viewport dimensions must be positive integers');
    }
    return { width, height };
  }
  if (options.width !== undefined || options.height !== undefined) {
    if (options.width === undefined || options.height === undefined) {
      throw new Error('--width and --height must be supplied together');
    }
    const width = Number(options.width);
    const height = Number(options.height);
    if (!isPositiveInteger(width) || !isPositiveInteger(height)) {
      throw new Error('--width and --height must be positive integers');
    }
    return { width, height };
  }
  return DEFAULT_VIEWPORT;
};

const resolveRoot = (value: string, flagName: string): string => {
  const root = resolve(value);
  if (!existsSync(root)) {
    throw new Error(`${flagName} does not exist: ${root}`);
  }
  return root;
};

const buildCliOptions = (args: readonly string[]): CliOptions | undefined => {
  const parsedArguments = parseArguments(args);
  if (parsedArguments.booleans.has('help')) {
    return undefined;
  }
  const { values, booleans } = parsedArguments;
  const contract = safeSegment(requiredValue(values, ['contract']), '--contract');
  const id = safeSegment(firstValue(values, ['id']) ?? DEFAULT_ID, '--id');
  const label = firstValue(values, ['label']) ?? DEFAULT_LABEL;
  const beforeUrl = normalizeEvidenceOrigin({
    value: requiredValue(values, [
      'before-url',
      'before-client-url',
      'before-client',
      'client-before-url',
    ]),
    flagName: '--before-url',
    allowRemote: booleans.has('allow-remote-origin'),
  });
  const afterUrl = normalizeEvidenceOrigin({
    value: requiredValue(values, [
      'after-url',
      'after-client-url',
      'after-client',
      'client-after-url',
    ]),
    flagName: '--after-url',
    allowRemote: booleans.has('allow-remote-origin'),
  });
  const beforeOrigin = normalizeEvidenceOrigin({
    value: requiredValue(values, [
      'before-origin',
      'before-asset-origin',
      'before-assets-origin',
      'before-asset-url',
      'before-assets-url',
      'before-published-origin',
    ]),
    flagName: '--before-origin',
    allowRemote: booleans.has('allow-remote-origin'),
  });
  const afterOrigin = normalizeEvidenceOrigin({
    value: requiredValue(values, [
      'after-origin',
      'after-asset-origin',
      'after-assets-origin',
      'after-asset-url',
      'after-assets-url',
      'after-candidate-origin',
    ]),
    flagName: '--after-origin',
    allowRemote: booleans.has('allow-remote-origin'),
  });
  return {
    contract,
    id,
    label,
    beforeUrl,
    afterUrl,
    beforeOrigin,
    afterOrigin,
    beforeRoot: resolveRoot(
      firstValue(values, ['before-root', 'before-candidate-root']) ?? ROOT,
      '--before-root',
    ),
    afterRoot: resolveRoot(
      firstValue(values, ['after-root', 'after-candidate-root']) ?? ROOT,
      '--after-root',
    ),
    mapId: parseMap(firstValue(values, ['map', 'map-id'])),
    cell: parseCell({
      value: firstValue(values, ['cell']),
      column: firstValue(values, ['cell-c']),
      row: firstValue(values, ['cell-r']),
    }),
    viewport: parseViewport({
      value: firstValue(values, ['viewport']),
      width: firstValue(values, ['width']),
      height: firstValue(values, ['height']),
    }),
    allowRemoteOrigin: booleans.has('allow-remote-origin'),
  };
};

const gitText = (root: string, args: readonly string[]): string =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

/** Record the exact root, commit, branch, and dirty-state identity of a lane. */
export const readEvidenceIdentity = (root: string): EvidenceIdentity => {
  const topLevel = gitText(root, ['rev-parse', '--show-toplevel']);
  const commit = gitText(root, ['rev-parse', 'HEAD']);
  const branch = gitText(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const status = execFileSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], {
    cwd: root,
  });
  const diff = execFileSync('git', ['diff', '--binary', 'HEAD'], { cwd: root });
  return {
    root: resolve(topLevel),
    commit,
    branch,
    statusFingerprint: sha256Hex(Buffer.concat([status, diff])),
    dirty: status.byteLength > 0 || diff.byteLength > 0,
  };
};

const shellQuote = (value: string): string => {
  if (/^[a-zA-Z0-9_./:@%+=-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
};

/** Preserve the exact argument vector in a copy/pasteable command string. */
export const formatEvidenceCommand = (argv: readonly string[] = process.argv): string => {
  const executable = argv[0] ?? 'bun';
  return [executable, ...argv.slice(1).map(shellQuote)].join(' ');
};

const resolveChromiumExecutable = (): string => {
  const configured =
    process.env.EVIDENCE_CHROMIUM_PATH ??
    process.env.CAPTURE_EVIDENCE_CHROMIUM_PATH ??
    chromium.executablePath();
  if (!existsSync(configured)) {
    throw new Error(
      `Chromium executable is unavailable at ${configured}; install Playwright Chromium or set EVIDENCE_CHROMIUM_PATH`,
    );
  }
  return realpathSync(configured);
};

const writeMontage = async (options: {
  stageDir: string;
  records: readonly EvidenceCaptureRecord[];
}): Promise<void> => {
  const layout = createMontageLayout(options.records.length);
  const composites: Array<{ input: Buffer; left: number; top: number }> = [];
  const escapeXml = (value: string): string =>
    value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&apos;');
  for (const [index, record] of options.records.entries()) {
    const cell = layout.cells[index];
    if (cell === undefined) {
      throw new Error(`Missing montage cell for ${record.file}`);
    }
    const image = await sharp(join(options.stageDir, record.file))
      .resize(cell.width, cell.imageHeight, {
        fit: 'contain',
        background: '#10131a',
        withoutEnlargement: false,
      })
      .png()
      .toBuffer();
    const label = escapeXml(`${record.lane.toUpperCase()} · ${record.label}`);
    const labelImage = Buffer.from(
      `<svg width="${cell.width}" height="${cell.labelHeight}"><rect width="100%" height="100%" fill="#0f172a"/><text x="12" y="26" fill="#e2e8f0" font-family="sans-serif" font-size="18">${label}</text></svg>`,
    );
    const cellImage = await sharp({
      create: {
        width: cell.width,
        height: cell.height,
        channels: 4,
        background: '#0f172a',
      },
    })
      .composite([
        { input: image, left: 0, top: 0 },
        { input: labelImage, left: 0, top: cell.imageHeight },
      ])
      .png()
      .toBuffer();
    composites.push({ input: cellImage, left: cell.left, top: cell.top });
  }
  await sharp({
    create: {
      width: layout.width,
      height: layout.height,
      channels: 4,
      background: '#020617',
    },
  })
    .composite(composites)
    .png()
    .toFile(join(options.stageDir, 'montage.png'));
};

const captureLane = async (options: CaptureLaneOptions): Promise<CaptureLaneResult> => {
  const page: Page = await options.context.newPage();
  const pageErrors: string[] = [];
  const requestUrls: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(errorMessage(error)));
  page.on('request', (request) => requestUrls.push(request.url()));
  const file = `${options.lane}/${options.id}.png`;
  const path = join(options.stageDir, file);
  try {
    await page.setViewportSize(options.viewport);
    const house = new EmberwatchHousePage(page, options.clientUrl);
    await house.goto({ gameHour: 12 });
    await house.loadMapAt(options.mapId, options.cell);
    await page.waitForTimeout(300);
    await mkdir(dirname(path), { recursive: true });
    // These two calls are deliberately adjacent to the screenshot. The POM's
    // capture method repeats both checks as a final fail-closed boundary.
    await house.requireWebGL();
    const entityTextures = await house.requireResolvedEntityTextures();
    const snapshot = await house.capture(path);
    if (snapshot.renderer !== 'webgl') {
      throw new Error(`Evidence renderer was ${snapshot.renderer}, expected webgl`);
    }
    if (snapshot.mapId !== options.mapId) {
      throw new Error(`Evidence loaded ${snapshot.mapId}, expected ${options.mapId}`);
    }
    validateEvidenceLaneRequests({
      lane: options.lane,
      assetOrigin: options.assetOrigin,
      otherAssetOrigin: options.otherAssetOrigin,
      requestUrls,
    });
    const record = createEvidenceCaptureRecord({
      lane: options.lane,
      id: options.id,
      label: options.label,
      file,
      clientUrl: options.clientUrl,
      assetOrigin: options.assetOrigin,
      originRole: options.originRole,
      root: options.identity.root,
      commit: options.identity.commit,
      branch: options.identity.branch,
      statusFingerprint: options.identity.statusFingerprint,
      mapId: snapshot.mapId,
      requestedCell: formatEvidenceCell(options.cell),
      actualPlayerCell: formatEvidenceCell(snapshot.player),
      actualCameraCell: formatEvidenceCell(snapshot.camera),
      renderer: 'webgl',
      viewport: options.viewport,
      entityTextureFingerprint: sha256Hex(JSON.stringify(entityTextures)),
      sha256: sha256Hex(await readFile(path)),
    });
    return { record, pageErrors };
  } finally {
    await page.close();
  }
};

const listFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(path)));
      continue;
    }
    if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
};

const checksumStage = async (stageDir: string, manifestBytes: Buffer): Promise<void> => {
  const files = await listFiles(stageDir);
  const inputs: ChecksumInput[] = [];
  for (const path of files) {
    const relativePath = relative(stageDir, path).replaceAll(sep, '/');
    if (relativePath === 'manifest.json.pending' || relativePath === 'checksums.sha256') {
      continue;
    }
    inputs.push({ path: relativePath, bytes: await readFile(path) });
  }
  inputs.push({ path: 'manifest.json', bytes: manifestBytes });
  const records = createChecksumRecords(inputs);
  await writeFile(join(stageDir, 'checksums.sha256'), renderChecksumsFile(records));
};

const moveExistingLane = async (options: {
  finalDir: string;
  staleDir: string;
}): Promise<boolean> => {
  if (!existsSync(options.finalDir)) {
    return false;
  }
  await rename(options.finalDir, options.staleDir);
  return true;
};

const removeQuietly = async (path: string): Promise<void> => {
  await rm(path, { recursive: true, force: true }).catch(() => undefined);
};

const publishEvidence = async (options: {
  options: CliOptions;
  beforeIdentity: EvidenceIdentity;
  afterIdentity: EvidenceIdentity;
  command: string;
}): Promise<string> => {
  const evidenceRoot = join(ROOT, '.evidence');
  const finalDir = join(evidenceRoot, options.options.contract);
  const runId = `${process.pid}-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const stageDir = join(evidenceRoot, `.${options.options.contract}.staging-${runId}`);
  const staleDir = join(evidenceRoot, `.${options.options.contract}.stale-${runId}`);
  await mkdir(evidenceRoot, { recursive: true });
  await mkdir(stageDir, { recursive: true });
  let published = false;
  let staleMoved = false;
  try {
    const browser = await chromium.launch({
      headless: true,
      executablePath: resolveChromiumExecutable(),
      args: [
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-webgl',
        '--enable-unsafe-swiftshader',
        '--ignore-gpu-blocklist',
        '--disable-lcd-text',
        '--font-render-hinting=none',
        '--disable-font-subpixel-positioning',
        '--force-color-profile=srgb',
      ],
    });
    const records: EvidenceCaptureRecord[] = [];
    const pageErrors: string[] = [];
    try {
      const context = await browser.newContext({
        viewport: options.options.viewport,
        deviceScaleFactor: 1,
      });
      try {
        const before = await captureLane({
          lane: 'before',
          clientUrl: options.options.beforeUrl,
          assetOrigin: options.options.beforeOrigin,
          otherAssetOrigin: options.options.afterOrigin,
          originRole: 'published',
          identity: options.beforeIdentity,
          mapId: options.options.mapId,
          cell: options.options.cell,
          viewport: options.options.viewport,
          id: options.options.id,
          label: options.options.label,
          stageDir,
          context,
        });
        records.push(before.record);
        pageErrors.push(...before.pageErrors);
        const after = await captureLane({
          lane: 'after',
          clientUrl: options.options.afterUrl,
          assetOrigin: options.options.afterOrigin,
          otherAssetOrigin: options.options.beforeOrigin,
          originRole: 'candidate',
          identity: options.afterIdentity,
          mapId: options.options.mapId,
          cell: options.options.cell,
          viewport: options.options.viewport,
          id: options.options.id,
          label: options.options.label,
          stageDir,
          context,
        });
        records.push(after.record);
        pageErrors.push(...after.pageErrors);
      } finally {
        await context.close();
      }
    } finally {
      await browser.close();
    }
    if (pageErrors.length > 0) {
      throw new Error(`Evidence page errors: ${pageErrors.join(' | ')}`);
    }
    const manifest = createEvidenceManifest({
      contract: options.options.contract,
      id: options.options.id,
      label: options.options.label,
      capturedAt: new Date().toISOString(),
      command: options.command,
      cwd: process.cwd(),
      identities: {
        before: options.beforeIdentity,
        after: options.afterIdentity,
      },
      origins: {
        before: {
          clientUrl: options.options.beforeUrl,
          assetOrigin: options.options.beforeOrigin,
          role: 'published',
        },
        after: {
          clientUrl: options.options.afterUrl,
          assetOrigin: options.options.afterOrigin,
          role: 'candidate',
        },
      },
      captures: records,
      entityTexturePolicy: ENTITY_TEXTURE_GUARD_POLICY,
      remoteOriginAllowed: options.options.allowRemoteOrigin,
    });
    await writeMontage({ stageDir, records });
    await writeFile(join(stageDir, 'index.md'), renderEvidenceIndex(manifest));
    const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    const pendingManifestPath = join(stageDir, 'manifest.json.pending');
    await writeFile(pendingManifestPath, manifestBytes);
    await checksumStage(stageDir, manifestBytes);
    await rename(pendingManifestPath, join(stageDir, 'manifest.json'));
    // The old lane is moved only after every artifact is complete; capture
    // failures leave the prior lane untouched and never publish a partial manifest.
    staleMoved = await moveExistingLane({ finalDir, staleDir });
    try {
      await rename(stageDir, finalDir);
      published = true;
    } catch (error) {
      if (staleMoved && !existsSync(finalDir) && existsSync(staleDir)) {
        await rename(staleDir, finalDir).catch(() => undefined);
      }
      throw error;
    }
    if (staleMoved) {
      await removeQuietly(staleDir);
    }
    return finalDir;
  } catch (error) {
    await removeQuietly(stageDir);
    if (!published && staleMoved && !existsSync(finalDir) && existsSync(staleDir)) {
      await rename(staleDir, finalDir).catch(() => undefined);
    }
    throw new Error(`Evidence capture failed: ${errorMessage(error)}`);
  }
};

const main = async (): Promise<void> => {
  const options = buildCliOptions(process.argv.slice(2));
  if (options === undefined) {
    console.log(usage());
    return;
  }
  const beforeIdentity = readEvidenceIdentity(options.beforeRoot);
  const afterIdentity = readEvidenceIdentity(options.afterRoot);
  const finalDir = await publishEvidence({
    options,
    beforeIdentity,
    afterIdentity,
    command: formatEvidenceCommand([
      'bun',
      'run',
      '--cwd',
      'apps/e2e',
      'capture:evidence',
      '--',
      ...process.argv.slice(2),
    ]),
  });
  console.log(`Evidence published: ${finalDir}`);
};

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(errorMessage(error));
    process.exitCode = 1;
  });
}
