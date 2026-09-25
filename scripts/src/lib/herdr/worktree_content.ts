// scripts/src/lib/herdr/worktree_content.ts
//
// Deterministic, checkout-local Emberwatch content preparation for fresh
// worktrees. The ordered build is intentionally sourced from
// EMBERWATCH_BUILD_STEPS: this module owns cache identity and safety checks,
// not a second content-build list.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { BuildStep } from '../ops/emberwatch_build_steps.ts';
import { EMBERWATCH_BUILD_STEPS } from '../ops/emberwatch_build_steps.ts';

/** Cache marker path, relative to the checkout being prepared. */
export const WORKTREE_CONTENT_CACHE_RELATIVE_PATH = '.local/herdr/worktree-content.json';

const GAME_DATA_RELATIVE_ROOT = 'apps/frontend/client/static/game-data';
const PACK_RELATIVE_ROOT = 'content/packs/emberwatch';
const CONTENT_PACKS_RELATIVE_ROOT = 'content/packs';
const MANIFEST_RELATIVE_PATH = `${PACK_RELATIVE_ROOT}/manifest.json`;
const STATUS_ARGUMENTS = ['status', '--porcelain=v1', '--untracked-files=all'] as const;

/** A source file included in the dirty-state portion of a fingerprint. */
export type WorktreeContentUntrackedSource = {
  path: string;
  digest: string;
};

/** Inputs that determine whether a checkout's generated content is current. */
export type WorktreeContentFingerprintInput = {
  revision: string;
  dirtyDiff: string;
  untrackedSources: readonly WorktreeContentUntrackedSource[];
  toolVersion: string;
  steps: readonly BuildStep[];
};

/** Injectable process and filesystem boundary for deterministic unit tests. */
export type WorktreeContentIO = {
  git: (args: readonly string[]) => string;
  runStep: (step: BuildStep) => void;
  toolVersion: () => string;
  exists: (path: string) => boolean;
  readBytes: (path: string) => Uint8Array;
  readText: (path: string) => string;
  writeText: (path: string, text: string) => void;
  mkdir: (path: string) => void;
  now: () => number;
};

/** A successful content phase, including cache and clean-generation outcome. */
export type ContentBootstrapResult = {
  fingerprint: string;
  cacheHit: boolean;
  steps: string[];
  cleanGeneration: boolean;
  durationMs: number;
};

/** On-disk marker written only after generation and its safety checks pass. */
export type WorktreeContentCacheMarker = {
  version: 1;
  fingerprint: string;
  revision: string;
  requiredOutputs: string[];
  steps: string[];
  completedAt: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const sha256Bytes = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

const parseNullDelimitedPaths = (value: string): string[] =>
  value.split('\0').filter((path) => path.length > 0);

const gameDataOutputPath = (url: string): string | undefined => {
  const prefix = '/game-data/';
  let relativePath: string | undefined;
  if (url.startsWith(prefix)) {
    relativePath = url.slice(prefix.length);
  } else if (!url.startsWith('/') && !url.includes('://')) {
    relativePath = url;
  }
  if (relativePath === undefined || relativePath.length === 0 || relativePath.includes('..')) {
    return undefined;
  }
  return `${GAME_DATA_RELATIVE_ROOT}/${relativePath}`;
};

const addGameDataUrls = (options: {
  record: Record<string, unknown>;
  outputs: Set<string>;
}): void => {
  for (const key of ['textureUrl', 'spritesheetUrl'] as const) {
    const value = options.record[key];
    if (typeof value !== 'string') {
      continue;
    }
    const output = gameDataOutputPath(value);
    if (output) {
      options.outputs.add(output);
    }
  }
};

const addManifestAtlasOutputs = (options: {
  manifest: Record<string, unknown>;
  outputs: Set<string>;
}): void => {
  if (isRecord(options.manifest.atlas)) {
    addGameDataUrls({ record: options.manifest.atlas, outputs: options.outputs });
  }
  if (!Array.isArray(options.manifest.propAtlases)) {
    return;
  }
  for (const propAtlas of options.manifest.propAtlases) {
    if (isRecord(propAtlas)) {
      addGameDataUrls({ record: propAtlas, outputs: options.outputs });
    }
  }
};

const addManifestMapOutputs = (options: {
  manifest: Record<string, unknown>;
  outputs: Set<string>;
}): void => {
  if (!isRecord(options.manifest.maps)) {
    return;
  }
  for (const mapId of Object.keys(options.manifest.maps)) {
    options.outputs.add(`${PACK_RELATIVE_ROOT}/maps/${mapId}.json`);
  }
};

const addManifestPortraitOutputs = (options: {
  manifest: Record<string, unknown>;
  outputs: Set<string>;
}): void => {
  if (!isRecord(options.manifest.npcs)) {
    return;
  }
  for (const npc of Object.values(options.manifest.npcs)) {
    if (!isRecord(npc) || !isRecord(npc.portraits)) {
      continue;
    }
    const variants = npc.portraits.variants;
    if (!isRecord(variants)) {
      continue;
    }
    for (const value of Object.values(variants)) {
      if (typeof value !== 'string') {
        continue;
      }
      const output = gameDataOutputPath(value);
      if (output) {
        options.outputs.add(output);
      }
    }
  }
};

const addManifestAudioOutputs = (options: {
  manifest: Record<string, unknown>;
  outputs: Set<string>;
}): void => {
  const audio = options.manifest.audio;
  if (!isRecord(audio) || !Array.isArray(audio.bindings)) {
    return;
  }
  for (const binding of audio.bindings) {
    if (!isRecord(binding) || !isRecord(binding.source)) {
      continue;
    }
    const source = binding.source;
    if (
      source.kind !== 'asset' ||
      typeof source.tag !== 'string' ||
      !source.tag.startsWith('music:')
    ) {
      continue;
    }
    const output = gameDataOutputPath(`/game-data/${source.tag.replaceAll(':', '/')}.webm`);
    if (output) {
      options.outputs.add(output);
    }
  }
};

const addManifestOutputs = (options: { manifest: unknown; outputs: Set<string> }): void => {
  if (!isRecord(options.manifest)) {
    throw new Error(`Cannot read content output inventory from ${MANIFEST_RELATIVE_PATH}.`);
  }
  addManifestAtlasOutputs({ manifest: options.manifest, outputs: options.outputs });
  addManifestMapOutputs({ manifest: options.manifest, outputs: options.outputs });
  addManifestPortraitOutputs({ manifest: options.manifest, outputs: options.outputs });
  addManifestAudioOutputs({ manifest: options.manifest, outputs: options.outputs });
};

/** The generated and boot-critical files that must exist before reporting ready. */
export const requiredWorktreeContentOutputPaths = (options: {
  checkoutPath: string;
  io: WorktreeContentIO;
  manifestText?: string;
}): string[] => {
  const manifestText =
    options.manifestText ?? options.io.readText(join(options.checkoutPath, MANIFEST_RELATIVE_PATH));
  let manifest: unknown;
  try {
    manifest = JSON.parse(manifestText);
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot parse ${MANIFEST_RELATIVE_PATH}: ${detail}`);
  }

  const outputs = new Set<string>([
    `${GAME_DATA_RELATIVE_ROOT}/sprites/tilesets/atlas.webp`,
    `${GAME_DATA_RELATIVE_ROOT}/sprites/tilesets/atlas.json`,
    `${GAME_DATA_RELATIVE_ROOT}/sprites/tilesets/props.webp`,
    `${GAME_DATA_RELATIVE_ROOT}/sprites/tilesets/props.json`,
    `${GAME_DATA_RELATIVE_ROOT}/manifest.json`,
    `${GAME_DATA_RELATIVE_ROOT}/asset_hashes.json`,
    `${GAME_DATA_RELATIVE_ROOT}/asset_credits.json`,
    `${GAME_DATA_RELATIVE_ROOT}/asset_seed.json`,
    `${GAME_DATA_RELATIVE_ROOT}/offline_core.json`,
    `${CONTENT_PACKS_RELATIVE_ROOT}/manifest.json`,
    `${CONTENT_PACKS_RELATIVE_ROOT}/asset_hashes.json`,
    `${CONTENT_PACKS_RELATIVE_ROOT}/asset_credits.json`,
    MANIFEST_RELATIVE_PATH,
    `${PACK_RELATIVE_ROOT}/maps/inn.json`,
    `${PACK_RELATIVE_ROOT}/maps/merchant_shop.json`,
    `${PACK_RELATIVE_ROOT}/maps/old_road.json`,
    `${PACK_RELATIVE_ROOT}/maps/ruined_shrine.json`,
    `${PACK_RELATIVE_ROOT}/maps/village.json`,
  ]);
  addManifestOutputs({ manifest, outputs });
  return [...outputs].sort();
};

/** Return required output paths absent from the checkout, using injected IO. */
export const missingRequiredWorktreeContentOutputs = (options: {
  checkoutPath: string;
  io: WorktreeContentIO;
  manifestText?: string;
}): string[] => {
  const required = requiredWorktreeContentOutputPaths(options);
  return required.filter(
    (relativePath) => !options.io.exists(join(options.checkoutPath, relativePath)),
  );
};

/** Compute a stable SHA-256 identity from all content-build inputs. */
export const computeWorktreeContentFingerprint = (
  input: WorktreeContentFingerprintInput,
): string => {
  const payload = JSON.stringify({
    schema: 'aikami.worktree-content.fingerprint.v1',
    revision: input.revision.trim(),
    dirtyDiff: input.dirtyDiff,
    untrackedSources: [...input.untrackedSources]
      .sort((left, right) => left.path.localeCompare(right.path))
      .map((source) => ({ path: source.path, digest: source.digest })),
    toolVersion: input.toolVersion.trim(),
    steps: input.steps.map((step) => ({
      label: step.label,
      script: step.script,
      args: [...(step.args ?? [])],
    })),
  });
  return createHash('sha256').update(payload, 'utf8').digest('hex');
};

/** Collect the fingerprint inputs from a checkout through its injected boundary. */
export const collectWorktreeContentFingerprintInput = (options: {
  checkoutPath: string;
  io: WorktreeContentIO;
}): WorktreeContentFingerprintInput => {
  const revision = options.io.git(['rev-parse', 'HEAD']).trim();
  const dirtyDiff = options.io.git(['diff', '--binary', '--no-ext-diff', 'HEAD', '--']);
  const untrackedPaths = parseNullDelimitedPaths(
    options.io.git(['ls-files', '--others', '--exclude-standard', '-z']),
  );
  const untrackedSources = untrackedPaths.sort().map((path) => ({
    path,
    digest: sha256Bytes(options.io.readBytes(join(options.checkoutPath, path))),
  }));
  return {
    revision,
    dirtyDiff,
    untrackedSources,
    toolVersion: options.io.toolVersion(),
    steps: EMBERWATCH_BUILD_STEPS,
  };
};

/** Normalize porcelain status output into stable, comparable entries. */
export const gitStatusEntries = (value: string): string[] =>
  value.split(/\r?\n/).filter((entry) => entry.length > 0);

/** Status entries present after generation but absent before it. */
export const newGitStatusEntries = (options: { before: string; after: string }): string[] => {
  const before = new Set(gitStatusEntries(options.before));
  return [...new Set(gitStatusEntries(options.after).filter((entry) => !before.has(entry)))];
};

const isCacheMarker = (value: unknown): value is WorktreeContentCacheMarker => {
  if (!isRecord(value)) {
    return false;
  }
  return (
    value.version === 1 &&
    typeof value.fingerprint === 'string' &&
    typeof value.revision === 'string' &&
    typeof value.completedAt === 'string' &&
    Array.isArray(value.requiredOutputs) &&
    value.requiredOutputs.every((entry) => typeof entry === 'string') &&
    Array.isArray(value.steps) &&
    value.steps.every((entry) => typeof entry === 'string')
  );
};

const cacheMarkerPath = (checkoutPath: string): string =>
  join(checkoutPath, WORKTREE_CONTENT_CACHE_RELATIVE_PATH);

const readCacheMarker = (options: {
  checkoutPath: string;
  io: WorktreeContentIO;
}): WorktreeContentCacheMarker | undefined => {
  const path = cacheMarkerPath(options.checkoutPath);
  if (!options.io.exists(path)) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(options.io.readText(path));
    return isCacheMarker(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

const writeCacheMarker = (options: {
  checkoutPath: string;
  io: WorktreeContentIO;
  marker: WorktreeContentCacheMarker;
}): void => {
  const path = cacheMarkerPath(options.checkoutPath);
  options.io.mkdir(dirname(path));
  options.io.writeText(path, `${JSON.stringify(options.marker, undefined, 2)}\n`);
};

const createDefaultWorktreeContentIO = (checkoutPath: string): WorktreeContentIO => ({
  git: (args) =>
    execFileSync('git', [...args], {
      cwd: checkoutPath,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    }),
  runStep: (step) => {
    const output = execFileSync('bun', [join(checkoutPath, step.script), ...(step.args ?? [])], {
      cwd: checkoutPath,
      encoding: 'utf8',
      // Keep generator stdout off the Pi bridge's protocol stream; stderr is
      // still visible to the operator and stdout is forwarded below.
      stdio: ['pipe', 'pipe', 'inherit'],
      windowsHide: true,
    });
    if (output.length > 0) {
      process.stderr.write(output);
    }
  },
  toolVersion: () =>
    execFileSync('bun', ['--version'], {
      cwd: checkoutPath,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    }).trim(),
  exists: (path) => existsSync(path),
  readBytes: (path) => new Uint8Array(readFileSync(path)),
  readText: (path) => readFileSync(path, 'utf8'),
  writeText: (path, text) => writeFileSync(path, text, 'utf8'),
  mkdir: (path) => {
    mkdirSync(path, { recursive: true });
  },
  now: () => Date.now(),
});

/**
 * Prepare the complete local Emberwatch plane for one worktree.
 *
 * A cache hit is conditional on both identity and required-output presence. A
 * miss runs the canonical seven-step build, compares Git status before and
 * after, and refuses to write a marker if generation introduced a new status
 * entry. Existing dirty entries are deliberately preserved.
 */
export const bootstrapWorktreeContent = async (options: {
  checkoutPath: string;
  io?: WorktreeContentIO;
}): Promise<ContentBootstrapResult> => {
  const io = options.io ?? createDefaultWorktreeContentIO(options.checkoutPath);
  const startedAt = io.now();
  const fingerprintInput = collectWorktreeContentFingerprintInput({
    checkoutPath: options.checkoutPath,
    io,
  });
  const fingerprint = computeWorktreeContentFingerprint(fingerprintInput);
  const requiredOutputs = requiredWorktreeContentOutputPaths({
    checkoutPath: options.checkoutPath,
    io,
  });
  const missingOutputs = requiredOutputs.filter(
    (relativePath) => !io.exists(join(options.checkoutPath, relativePath)),
  );
  const marker = readCacheMarker({ checkoutPath: options.checkoutPath, io });

  if (marker?.fingerprint === fingerprint && missingOutputs.length === 0) {
    return {
      fingerprint,
      cacheHit: true,
      steps: [],
      cleanGeneration: true,
      durationMs: Math.max(0, io.now() - startedAt),
    };
  }

  const statusBefore = io.git(STATUS_ARGUMENTS);
  const preExistingStatus = gitStatusEntries(statusBefore);
  if (preExistingStatus.length > 0) {
    console.warn(
      `ℹ️  Preserving ${preExistingStatus.length} pre-existing Git status entries while generating worktree content: ${preExistingStatus.join('; ')}`,
    );
  }
  let failed = false;
  let failure: unknown;
  const steps: string[] = [];
  try {
    for (const step of EMBERWATCH_BUILD_STEPS) {
      steps.push(step.label);
      io.runStep(step);
    }
  } catch (error: unknown) {
    failed = true;
    failure = error;
  }
  const statusAfter = io.git(STATUS_ARGUMENTS);
  const introducedStatus = newGitStatusEntries({ before: statusBefore, after: statusAfter });
  if (introducedStatus.length > 0) {
    throw new Error(
      `Worktree content generation introduced new Git status entries: ${introducedStatus.join(', ')}`,
    );
  }
  if (failed) {
    throw failure instanceof Error ? failure : new Error(String(failure));
  }

  const missingAfterGeneration = missingRequiredWorktreeContentOutputs({
    checkoutPath: options.checkoutPath,
    io,
    manifestText: io.readText(join(options.checkoutPath, MANIFEST_RELATIVE_PATH)),
  });
  if (missingAfterGeneration.length > 0) {
    throw new Error(
      `Worktree content generation completed without required outputs: ${missingAfterGeneration.join(', ')}`,
    );
  }

  const completedAtMs = io.now();
  writeCacheMarker({
    checkoutPath: options.checkoutPath,
    io,
    marker: {
      version: 1,
      fingerprint,
      revision: fingerprintInput.revision,
      requiredOutputs,
      steps,
      completedAt: new Date(completedAtMs).toISOString(),
    },
  });

  return {
    fingerprint,
    cacheHit: false,
    steps,
    cleanGeneration: true,
    durationMs: Math.max(0, completedAtMs - startedAt),
  };
};
