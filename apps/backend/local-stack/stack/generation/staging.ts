// apps/backend/local-stack/stack/generation/staging.ts
//
// C-519: namespaced, lock-protected staging for generated assets and the
// C-518-shaped candidate fragment.
//
// Two properties matter more than anything else here:
//
//   1. **Additive only.** Everything is written inside the run's own
//      namespaced directory (`<runs-dir>/<runId>/staged/...` plus the merged
//      fragments under `<runs-dir>/staging/`). The legacy `generate:asset`
//      staging root — its `manifest.json`, `hashes.json`,
//      `generated_asset.json`, `generation_audit.json` and its asset bytes —
//      is never opened for writing.
//   2. **Atomic replacement.** The bytes are written to a temp file and
//      `rename`d, and the fragment merge happens under an exclusive lock, so a
//      process killed mid-merge leaves the previous fragment byte-identical
//      and every earlier entry intact.
//
// Contract: C-519 Durable asset jobs and batch execution

import { join } from 'node:path';
import { tagToAssetPath } from '@aikami/constants';
import type {
  AssetEntry,
  AssetHashesFile,
  AssetManifest,
  CandidateRecord,
  GeneratedAsset,
} from '@aikami/types';
import {
  type GenerationStorePaths,
  readJsonIfPresent,
  withExclusiveLock,
  writeBytesAtomic,
  writeJsonAtomic,
} from './job_store.ts';

/** What one staging merge produced. */
export type StagingResult = {
  readonly relativePath: string;
  readonly stagedPath: string;
  readonly manifestPath: string;
  readonly hashesPath: string;
  readonly manifestEntries: number;
  readonly hashEntries: number;
};

/** The names of the writes a test may interrupt. */
export type StagingWriteName = 'bytes' | 'manifest' | 'hashes' | 'candidates';

/** Options for {@link stagePreparedAsset}. */
export type StagePreparedAssetOptions = {
  readonly paths: GenerationStorePaths;
  readonly descriptor: GeneratedAsset;
  readonly bytes: Uint8Array;
  /** The single-entry fragment from `runAssetGeneration`. */
  readonly manifest: AssetManifest;
  /** The single-entry hash fragment from `runAssetGeneration`. */
  readonly hashes: AssetHashesFile;
  readonly lockTimeoutMs?: number;
  /** Test seam: called after each atomic write, so a kill can be injected. */
  readonly onWrite?: (name: StagingWriteName) => void;
};

/** The manifest entry for one descriptor (the same shape C-510 stages). */
export const manifestEntryFor = (descriptor: GeneratedAsset): AssetEntry => {
  const relativePath = tagToAssetPath({ tag: descriptor.tag, ext: descriptor.ext });
  const segments = relativePath.split('/');
  const filename = segments.at(-1) ?? relativePath;
  const dotIndex = filename.lastIndexOf('.');
  return {
    tag: descriptor.tag,
    category: descriptor.category,
    subcategory: segments.length > 2 ? segments.slice(1, -1).join('/') : '',
    name: dotIndex >= 0 ? filename.slice(0, dotIndex) : filename,
    path: relativePath,
    ext: descriptor.ext,
  };
};

/**
 * Merges one generation into the run's namespaced staging.
 *
 * The merge is a read-modify-write of `manifest.json`/`hashes.json` performed
 * while holding an exclusive lock on the staging directory, with each fragment
 * replaced atomically — never merged in place.
 */
export const stagePreparedAsset = async (
  options: StagePreparedAssetOptions,
): Promise<StagingResult> => {
  const { paths } = options;
  const entry = manifestEntryFor(options.descriptor);
  const stagedPath = join(paths.stagedDir, entry.path);

  writeBytesAtomic(stagedPath, options.bytes);
  options.onWrite?.('bytes');

  return withExclusiveLock(
    {
      path: join(paths.stagingDir, '.merge.lock'),
      ...(options.lockTimeoutMs === undefined ? {} : { timeoutMs: options.lockTimeoutMs }),
    },
    () => {
      const existingManifest = readJsonIfPresent<AssetManifest>(paths.stagingManifestPath);
      const mergedManifest: AssetManifest = existingManifest
        ? {
            ...existingManifest,
            scannedAt: options.manifest.scannedAt,
            assets: { ...existingManifest.assets, ...options.manifest.assets },
            byCategory: { ...existingManifest.byCategory },
          }
        : (JSON.parse(JSON.stringify(options.manifest)) as AssetManifest);

      const categoryEntries = mergedManifest.byCategory[entry.category] ?? [];
      mergedManifest.byCategory[entry.category] = [
        ...categoryEntries.filter((existing) => existing.tag !== entry.tag),
        entry,
      ];
      mergedManifest.count = Object.keys(mergedManifest.assets).length;
      writeJsonAtomic(paths.stagingManifestPath, mergedManifest);
      options.onWrite?.('manifest');

      const existingHashes = readJsonIfPresent<AssetHashesFile>(paths.stagingHashesPath);
      const mergedHashes: AssetHashesFile = existingHashes
        ? {
            scannedAt: options.hashes.scannedAt,
            hashes: { ...existingHashes.hashes, ...options.hashes.hashes },
          }
        : options.hashes;
      writeJsonAtomic(paths.stagingHashesPath, mergedHashes);
      options.onWrite?.('hashes');

      return {
        relativePath: entry.path,
        stagedPath,
        manifestPath: paths.stagingManifestPath,
        hashesPath: paths.stagingHashesPath,
        manifestEntries: mergedManifest.count,
        hashEntries: Object.keys(mergedHashes.hashes).length,
      };
    },
  );
};

/**
 * Appends a C-518-shaped candidate record to the run's candidate fragment.
 *
 * The fragment is the seam the client-plane (C-518) store consumes; C-519
 * never imports that store, and never deletes accepted bytes.
 */
export const appendCandidateRecord = async (options: {
  paths: GenerationStorePaths;
  record: CandidateRecord;
  lockTimeoutMs?: number;
  onWrite?: (name: StagingWriteName) => void;
}): Promise<readonly CandidateRecord[]> =>
  withExclusiveLock(
    {
      path: join(options.paths.stagingDir, '.merge.lock'),
      ...(options.lockTimeoutMs === undefined ? {} : { timeoutMs: options.lockTimeoutMs }),
    },
    () => {
      const existing = readJsonIfPresent<CandidateRecord[]>(options.paths.candidatesPath) ?? [];
      const merged = [
        ...existing.filter((entry) => entry.candidateId !== options.record.candidateId),
        options.record,
      ];
      writeJsonAtomic(options.paths.candidatesPath, merged);
      options.onWrite?.('candidates');
      return merged;
    },
  );

/**
 * Reads pre-existing staging only through this explicit opt-in.
 *
 * Import is read-only by construction: it returns the tags and hashes it found
 * so a plan can reuse them, and writes nothing. A malformed legacy fragment is
 * reported rather than repaired.
 */
export const importLegacyStaging = (options: {
  legacyOutDir: string;
}): {
  readonly tags: readonly string[];
  readonly hashes: AssetHashesFile;
  readonly error?: string;
} => {
  const manifest = readJsonIfPresent<AssetManifest>(join(options.legacyOutDir, 'manifest.json'));
  const hashes = readJsonIfPresent<AssetHashesFile>(join(options.legacyOutDir, 'hashes.json'));
  if (!manifest) {
    return {
      tags: [],
      hashes: { scannedAt: new Date(0).toISOString(), hashes: {} },
      error: 'no manifest.json in the legacy staging root',
    };
  }
  return {
    tags: Object.keys(manifest.assets),
    hashes: hashes ?? { scannedAt: manifest.scannedAt, hashes: {} },
  };
};
