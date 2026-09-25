// apps/e2e/src/visual/core/evidence.ts
// Pure, dependency-light builders for persistent before/after evidence lanes.

import { createHash } from 'node:crypto';

/** A lane in a paired evidence capture. */
export type EvidenceLane = 'before' | 'after';

/** Verify that a capture used its assigned asset lane before recording evidence. */
export const validateEvidenceLaneRequests = (options: {
  lane: EvidenceLane;
  assetOrigin: string;
  otherAssetOrigin: string;
  requestUrls: readonly string[];
}): void => {
  const assetOrigin = new URL(options.assetOrigin).origin;
  const otherAssetOrigin = new URL(options.otherAssetOrigin).origin;
  const requests = options.requestUrls.map((url) => new URL(url));
  if (!requests.some((request) => request.origin === assetOrigin)) {
    throw new Error(`Evidence lane ${options.lane} made no requests to ${assetOrigin}`);
  }
  if (
    requests.some(
      (request) =>
        request.origin === otherAssetOrigin &&
        (request.pathname.startsWith('/seed/') ||
          request.pathname.startsWith('/assets/') ||
          request.pathname.startsWith('/index/')),
    )
  ) {
    throw new Error(`Evidence lane ${options.lane} requested seed or assets from ${otherAssetOrigin}`);
  }
};

/** The two-dimensional viewport used by a capture. */
export type EvidenceViewport = {
  width: number;
  height: number;
};

/** A map cell used to position the production player before capture. */
export type EvidenceCell = {
  c: number;
  r: number;
};

/** The read-only asset plane consumed by a client lane. */
export type EvidenceOrigin = {
  /** Client origin serving the production `/game` route. */
  clientUrl: string;
  /** Asset origin configured by the client, normally a local_asset_origin. */
  assetOrigin: string;
  /** Whether this is the published seed or the candidate overlay. */
  role: 'published' | 'candidate';
};

/** Git identity captured before a lane is published. */
export type EvidenceIdentity = {
  root: string;
  commit: string;
  branch: string;
  statusFingerprint: string;
  dirty: boolean;
};

/** The renderer policy required for every published PNG. */
export type EvidenceRenderer = 'webgl';

/** One fully checked capture in a before/after lane. */
export type EvidenceCaptureRecord = {
  lane: EvidenceLane;
  id: string;
  label: string;
  file: string;
  clientUrl: string;
  assetOrigin: string;
  originRole: EvidenceOrigin['role'];
  root: string;
  commit: string;
  branch: string;
  statusFingerprint: string;
  mapId: string;
  requestedCell: string;
  actualPlayerCell: string;
  actualCameraCell: string;
  renderer: EvidenceRenderer;
  viewport: EvidenceViewport;
  entityTextureFingerprint: string;
  sha256: string;
};

/** A checked before/after pair with one shared capture id. */
export type EvidencePair = {
  id: string;
  label: string;
  before: EvidenceCaptureRecord;
  after: EvidenceCaptureRecord;
};

/** A SHA-256 checksum entry for a file in the evidence lane. */
export type ChecksumRecord = {
  path: string;
  sha256: string;
  bytes: number;
};

/** Input accepted by {@link createChecksumRecord}. */
export type ChecksumInput = {
  path: string;
  bytes: Uint8Array | string;
};

/** Input accepted by {@link createEvidenceManifest}. */
export type EvidenceManifestInput = {
  contract: string;
  id: string;
  label: string;
  capturedAt: string;
  command: string;
  cwd: string;
  identities: Readonly<Record<EvidenceLane, EvidenceIdentity>>;
  origins: Readonly<Record<EvidenceLane, EvidenceOrigin>>;
  captures: readonly EvidenceCaptureRecord[];
  entityTexturePolicy: string;
  remoteOriginAllowed?: boolean;
  pageErrors?: readonly string[];
};

/** Machine-readable evidence manifest written only after a complete capture. */
export type EvidenceManifest = {
  schemaVersion: 1;
  status: 'complete';
  contract: string;
  id: string;
  label: string;
  capturedAt: string;
  command: string;
  cwd: string;
  renderer: EvidenceRenderer;
  assetOriginPolicy: 'local_asset_origin-read-only';
  remoteOriginAllowed: boolean;
  entityTextureGuard: {
    policy: string;
    status: 'passed';
  };
  origins: Readonly<Record<EvidenceLane, EvidenceOrigin>>;
  roots: Readonly<Record<EvidenceLane, EvidenceIdentity>>;
  /** The after lane is the candidate identity; the before lane is the baseline. */
  candidate: EvidenceIdentity;
  published: EvidenceIdentity;
  pairs: readonly EvidencePair[];
  captures: readonly EvidenceCaptureRecord[];
  before: readonly EvidenceCaptureRecord[];
  after: readonly EvidenceCaptureRecord[];
  pageErrors: readonly string[];
};

/** Options for calculating deterministic montage cell positions. */
export type MontageLayoutOptions = {
  columns?: number;
  cellWidth?: number;
  imageHeight?: number;
  labelHeight?: number;
  gap?: number;
};

/** One cell's placement in a montage. */
export type MontageCellLayout = {
  index: number;
  row: number;
  column: number;
  left: number;
  top: number;
  width: number;
  height: number;
  imageLeft: number;
  imageTop: number;
  imageWidth: number;
  imageHeight: number;
  labelTop: number;
  labelHeight: number;
};

/** Complete dimensions and cells for a montage. */
export type MontageLayout = {
  columns: number;
  rows: number;
  cellWidth: number;
  imageHeight: number;
  labelHeight: number;
  gap: number;
  width: number;
  height: number;
  cells: readonly MontageCellLayout[];
};

const DEFAULT_MONTAGE_COLUMNS = 2;
const DEFAULT_MONTAGE_CELL_WIDTH = 480;
const DEFAULT_MONTAGE_IMAGE_HEIGHT = 270;
const DEFAULT_MONTAGE_LABEL_HEIGHT = 30;
const DEFAULT_MONTAGE_GAP = 0;

const HEX_SHA256 = /^[a-f0-9]{64}$/;

/** True for localhost and IPv4/IPv6 loopback hosts. */
export const isLoopbackEvidenceOrigin = (hostname: string): boolean => {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (normalized === 'localhost' || normalized === 'localhost.') {
    return true;
  }
  if (normalized === '::1') {
    return true;
  }
  const octets = normalized.split('.');
  return (
    octets.length === 4 &&
    octets[0] === '127' &&
    octets.every((octet) => {
      const value = Number(octet);
      return Number.isInteger(value) && value >= 0 && value <= 255;
    })
  );
};

/**
 * Validate and normalize an evidence origin without probing or mutating its
 * content plane. Credentials, query strings, and fragments are rejected so the
 * exact command recorded in a manifest cannot accidentally persist secrets.
 */
export const normalizeEvidenceOrigin = (options: {
  value: string;
  flagName: string;
  allowRemote: boolean;
}): string => {
  let parsed: URL;
  try {
    parsed = new URL(options.value);
  } catch {
    throw new Error(`${options.flagName} is not a valid URL: ${options.value}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${options.flagName} must use http or https`);
  }
  if (parsed.username.length > 0 || parsed.password.length > 0) {
    throw new Error(`${options.flagName} must not contain credentials or secrets`);
  }
  if (parsed.search.length > 0 || parsed.hash.length > 0) {
    throw new Error(`${options.flagName} must not contain a query string or fragment`);
  }
  if (!options.allowRemote && !isLoopbackEvidenceOrigin(parsed.hostname)) {
    throw new Error(
      `${options.flagName} must be loopback; pass --allow-remote-origin only for an intentional remote evidence run`,
    );
  }
  const pathname = parsed.pathname.replace(/\/+$/, '');
  return `${parsed.origin}${pathname}`;
};

const textBytes = (value: string): Uint8Array => new TextEncoder().encode(value);

/** Return the SHA-256 digest for bytes or UTF-8 text. */
export const sha256Hex = (value: Uint8Array | string): string =>
  createHash('sha256').update(value).digest('hex');

/** Normalize a checksum path to a safe, lane-relative POSIX path. */
const normalizeChecksumPath = (value: string): string => {
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//, '');
  if (
    normalized.length === 0 ||
    normalized.startsWith('/') ||
    /^[a-zA-Z]:\//.test(normalized) ||
    normalized.split('/').some((segment) => segment === '..')
  ) {
    throw new Error(`Evidence checksum path must be relative: ${value}`);
  }
  return normalized;
};

/** Build one deterministic SHA-256 checksum record. */
export const createChecksumRecord = (input: ChecksumInput): ChecksumRecord => {
  const path = normalizeChecksumPath(input.path);
  const bytes =
    typeof input.bytes === 'string' ? textBytes(input.bytes).byteLength : input.bytes.byteLength;
  if (!Number.isInteger(bytes) || bytes < 0) {
    throw new Error(`Evidence checksum byte count is invalid for ${path}`);
  }
  return {
    path,
    sha256: sha256Hex(input.bytes),
    bytes,
  };
};

/**
 * Build checksum records and reject duplicate paths so a checksum file cannot
 * silently identify one artifact twice while omitting another.
 */
export const createChecksumRecords = (inputs: readonly ChecksumInput[]): ChecksumRecord[] => {
  const records = inputs.map((input) => createChecksumRecord(input));
  const paths = new Set<string>();
  for (const record of records) {
    if (paths.has(record.path)) {
      throw new Error(`Duplicate evidence checksum path: ${record.path}`);
    }
    paths.add(record.path);
  }
  return records.toSorted((left, right) => left.path.localeCompare(right.path));
};

/** Render records in the standard `sha256sum` two-space format. */
export const renderChecksumsFile = (records: readonly ChecksumRecord[]): string => {
  const rendered = records
    .toSorted((left, right) => left.path.localeCompare(right.path))
    .map((record) => {
      if (!HEX_SHA256.test(record.sha256)) {
        throw new Error(`Invalid SHA-256 checksum for ${record.path}`);
      }
      return `${record.sha256}  ${record.path}`;
    });
  return rendered.length === 0 ? '' : `${rendered.join('\n')}\n`;
};

const cellText = (cell: EvidenceCell): string => `${cell.c},${cell.r}`;

/** Format a map cell without exposing mutable world objects. */
export const formatEvidenceCell = (cell: EvidenceCell): string => cellText(cell);

/** Validate and copy one capture record without touching the filesystem. */
export const createEvidenceCaptureRecord = (
  record: EvidenceCaptureRecord,
): EvidenceCaptureRecord => {
  if (record.lane !== 'before' && record.lane !== 'after') {
    throw new Error(`Invalid evidence lane: ${record.lane}`);
  }
  if (record.renderer !== 'webgl') {
    throw new Error(`Evidence ${record.id}/${record.lane} is not WebGL`);
  }
  if (!HEX_SHA256.test(record.sha256)) {
    throw new Error(`Invalid capture checksum for ${record.id}/${record.lane}`);
  }
  if (!HEX_SHA256.test(record.entityTextureFingerprint)) {
    throw new Error(`Invalid entity-texture fingerprint for ${record.id}/${record.lane}`);
  }
  return {
    ...record,
    requestedCell: formatEvidenceCell(parseEvidenceCell(record.requestedCell)),
    viewport: { ...record.viewport },
  };
};

const parseEvidenceCell = (value: string): EvidenceCell => {
  const match = /^(-?\d+)\s*,\s*(-?\d+)$/.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid evidence cell: ${value}`);
  }
  return { c: Number(match[1]), r: Number(match[2]) };
};

/** Pair one before and one after record by their shared capture id. */
export const pairEvidenceRecords = (
  before: EvidenceCaptureRecord,
  after: EvidenceCaptureRecord,
): EvidencePair => {
  if (before.lane !== 'before' || after.lane !== 'after') {
    throw new Error('Evidence pair must contain one before and one after record');
  }
  if (before.id !== after.id) {
    throw new Error(`Evidence pair id mismatch: ${before.id} vs ${after.id}`);
  }
  return {
    id: before.id,
    label: before.label,
    before: createEvidenceCaptureRecord(before),
    after: createEvidenceCaptureRecord(after),
  };
};

/** Group flat lane records into deterministic before/after pairs. */
export const pairEvidenceCaptures = (records: readonly EvidenceCaptureRecord[]): EvidencePair[] => {
  const grouped = new Map<string, Partial<Record<EvidenceLane, EvidenceCaptureRecord>>>();
  for (const rawRecord of records) {
    const record = createEvidenceCaptureRecord(rawRecord);
    const group = grouped.get(record.id) ?? {};
    if (group[record.lane] !== undefined) {
      throw new Error(`Duplicate ${record.lane} evidence record: ${record.id}`);
    }
    group[record.lane] = record;
    grouped.set(record.id, group);
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, group]) => {
      if (group.before === undefined || group.after === undefined) {
        throw new Error(`Evidence pair is incomplete: ${id}`);
      }
      return pairEvidenceRecords(group.before, group.after);
    });
};

/** Build a complete machine-readable manifest from already-checked captures. */
export const createEvidenceManifest = (input: EvidenceManifestInput): EvidenceManifest => {
  const pairs = pairEvidenceCaptures(input.captures);
  if (pairs.length === 0) {
    throw new Error('Evidence manifest requires at least one complete pair');
  }
  const pageErrors = [...(input.pageErrors ?? [])];
  if (pageErrors.length > 0) {
    throw new Error('Evidence manifest cannot be complete while page errors are present');
  }
  const identities = {
    before: { ...input.identities.before },
    after: { ...input.identities.after },
  };
  const origins = {
    before: { ...input.origins.before },
    after: { ...input.origins.after },
  };
  const before = pairs.map((pair) => pair.before);
  const after = pairs.map((pair) => pair.after);
  return {
    schemaVersion: 1,
    status: 'complete',
    contract: input.contract,
    id: input.id,
    label: input.label,
    capturedAt: input.capturedAt,
    command: input.command,
    cwd: input.cwd,
    renderer: 'webgl',
    assetOriginPolicy: 'local_asset_origin-read-only',
    remoteOriginAllowed: input.remoteOriginAllowed ?? false,
    entityTextureGuard: {
      policy: input.entityTexturePolicy,
      status: 'passed',
    },
    origins,
    roots: identities,
    candidate: identities.after,
    published: identities.before,
    pairs,
    captures: pairs.flatMap((pair) => [pair.before, pair.after]),
    before,
    after,
    pageErrors,
  };
};

const escapeMarkdownCell = (value: string): string =>
  value.replaceAll('|', '\\|').replaceAll('`', '\\`').replaceAll('\n', ' ');

const escapeMarkdownCode = (value: string): string => value.replaceAll('`', '\\`');

const formatViewport = (viewport: EvidenceViewport): string =>
  `${viewport.width}x${viewport.height}`;

const renderIdentityTable = (identities: EvidenceManifest['roots']): string[] => [
  '| Lane | Role | Root | Commit | Branch | Status fingerprint |',
  '|---|---|---|---|---|---|',
  `| before | published | \`${escapeMarkdownCell(identities.before.root)}\` | \`${escapeMarkdownCell(identities.before.commit)}\` | \`${escapeMarkdownCell(identities.before.branch)}\` | \`${escapeMarkdownCell(identities.before.statusFingerprint)}\` |`,
  `| after | candidate | \`${escapeMarkdownCell(identities.after.root)}\` | \`${escapeMarkdownCell(identities.after.commit)}\` | \`${escapeMarkdownCell(identities.after.branch)}\` | \`${escapeMarkdownCell(identities.after.statusFingerprint)}\` |`,
];

const renderOriginTable = (origins: EvidenceManifest['origins']): string[] => [
  '| Lane | Role | Client URL | Asset origin |',
  '|---|---|---|---|',
  `| before | ${origins.before.role} | \`${escapeMarkdownCell(origins.before.clientUrl)}\` | \`${escapeMarkdownCell(origins.before.assetOrigin)}\` |`,
  `| after | ${origins.after.role} | \`${escapeMarkdownCell(origins.after.clientUrl)}\` | \`${escapeMarkdownCell(origins.after.assetOrigin)}\` |`,
];

const renderPairTable = (pairs: readonly EvidencePair[]): string[] => [
  '| ID | Before | After | Map | Requested cell | Viewport |',
  '|---|---|---|---|---|---|',
  ...pairs.map(
    (pair) =>
      `| ${escapeMarkdownCell(pair.id)} | \`${escapeMarkdownCell(pair.before.file)}\` | \`${escapeMarkdownCell(pair.after.file)}\` | ${escapeMarkdownCell(pair.before.mapId)} | ${escapeMarkdownCell(pair.before.requestedCell)} | ${formatViewport(pair.before.viewport)} |`,
  ),
];

/** Render the human-readable evidence index linked to all capture artifacts. */
export const renderEvidenceIndex = (manifest: EvidenceManifest): string => {
  const lines = [
    `# ${manifest.contract} evidence`,
    '',
    `Label: **${escapeMarkdownCell(manifest.label)}**`,
    `Captured: \`${escapeMarkdownCode(manifest.capturedAt)}\``,
    `Status: **${manifest.status}**`,
    '',
    'This lane is technical WebGL evidence from the production `/game` route. Human visual acceptance remains a separate review step.',
    '',
    '## Command',
    '',
    '```text',
    manifest.command,
    '```',
    '',
    '## Renderer and guard',
    '',
    `- Renderer: \`${manifest.renderer}\``,
    `- Asset-origin policy: \`${manifest.assetOriginPolicy}\``,
    `- Remote-origin override: ${manifest.remoteOriginAllowed ? 'enabled' : 'disabled'}`,
    `- Entity-texture guard: \`${manifest.entityTextureGuard.policy}\` (${manifest.entityTextureGuard.status})`,
    `- Page errors: ${manifest.pageErrors.length === 0 ? 'none' : manifest.pageErrors.map(escapeMarkdownCell).join('; ')}`,
    '',
    '## Origins',
    '',
    ...renderOriginTable(manifest.origins),
    '',
    'The asset origins are explicit inputs. They are consumed with the existing read-only published-seed/candidate-overlay semantics; this capture does not build or publish content.',
    '',
    '## Git identities',
    '',
    ...renderIdentityTable(manifest.roots),
    '',
    '## Paired captures',
    '',
    ...renderPairTable(manifest.pairs),
    '',
    '## Artifacts',
    '',
    `- [Montage](montage.png)`,
    `- [Checksums](checksums.sha256)`,
    '- [Machine-readable manifest](manifest.json)',
    '',
  ];
  for (const pair of manifest.pairs) {
    lines.push(
      `### ${escapeMarkdownCell(pair.label || pair.id)}`,
      '',
      `- Before: [${escapeMarkdownCell(pair.before.file)}](${pair.before.file}) — SHA-256 \`${pair.before.sha256}\``,
      `- After: [${escapeMarkdownCell(pair.after.file)}](${pair.after.file}) — SHA-256 \`${pair.after.sha256}\``,
      '',
    );
  }
  return `${lines.join('\n')}\n`;
};

const positiveInteger = (value: number, name: string): number => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
};

const nonNegativeInteger = (value: number, name: string): number => {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return value;
};

/** Calculate deterministic positions for a labeled image montage. */
export const createMontageLayout = (
  itemCount: number,
  options: MontageLayoutOptions = {},
): MontageLayout => {
  const count = positiveInteger(itemCount, 'Montage item count');
  const columns = Math.min(
    positiveInteger(options.columns ?? DEFAULT_MONTAGE_COLUMNS, 'Montage columns'),
    count,
  );
  const cellWidth = positiveInteger(
    options.cellWidth ?? DEFAULT_MONTAGE_CELL_WIDTH,
    'Montage cell width',
  );
  const imageHeight = positiveInteger(
    options.imageHeight ?? DEFAULT_MONTAGE_IMAGE_HEIGHT,
    'Montage image height',
  );
  const labelHeight = positiveInteger(
    options.labelHeight ?? DEFAULT_MONTAGE_LABEL_HEIGHT,
    'Montage label height',
  );
  const gap =
    options.gap === undefined
      ? DEFAULT_MONTAGE_GAP
      : nonNegativeInteger(options.gap, 'Montage gap');
  const rows = Math.ceil(count / columns);
  const width = columns * cellWidth + (columns - 1) * gap;
  const height = rows * (imageHeight + labelHeight) + (rows - 1) * gap;
  const cells = Array.from({ length: count }, (_, index) => {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const left = column * (cellWidth + gap);
    const top = row * (imageHeight + labelHeight + gap);
    return {
      index,
      row,
      column,
      left,
      top,
      width: cellWidth,
      height: imageHeight + labelHeight,
      imageLeft: left,
      imageTop: top,
      imageWidth: cellWidth,
      imageHeight,
      labelTop: top + imageHeight,
      labelHeight,
    };
  });
  return {
    columns,
    rows,
    cellWidth,
    imageHeight,
    labelHeight,
    gap,
    width,
    height,
    cells,
  };
};

/** Compatibility alias for callers that name layout construction as a build step. */
export const buildMontageLayout = createMontageLayout;

/** Compatibility alias for callers that use the checksum verb. */
export const buildChecksumRecords = createChecksumRecords;

/** Compatibility aliases for the common evidence-builder names. */
export const checksumForBytes = sha256Hex;
export const createEvidencePair = pairEvidenceRecords;
export const buildEvidenceManifest = createEvidenceManifest;
export const buildEvidenceIndex = renderEvidenceIndex;
