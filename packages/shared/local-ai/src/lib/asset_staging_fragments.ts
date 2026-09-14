// packages/shared/local-ai/src/lib/asset_staging_fragments.ts
//
// C-519: the single derivation of the C-510 staging fragments
// (`AssetManifest` + `AssetHashesFile`) for one `GeneratedAsset`.
//
// Both writers call it — the one-job `generate:asset` CLI and the durable
// batch runner — so a resumed batch stages exactly the fragment a fresh run
// would have staged. Two copies of this mapping would drift and silently
// produce a different `count` or `byCategory` shape.
//
// Portable: no fs, no clock (the caller passes `scannedAt`).
//
// Contract: C-510 Engine-Agnostic Asset Generation Pipeline
// Contract: C-519 Durable asset jobs and batch execution

import { tagToAssetPath } from '@aikami/constants';
import type { AssetEntry, AssetHashesFile, AssetManifest, GeneratedAsset } from '@aikami/types';

/** The two staging fragments for one descriptor. */
export type AssetStagingFragments = {
  readonly manifest: AssetManifest;
  readonly hashes: AssetHashesFile;
};

/** The single catalog manifest entry for one descriptor. */
export const manifestEntryForDescriptor = (descriptor: GeneratedAsset): AssetEntry => {
  const path = tagToAssetPath({ tag: descriptor.tag, ext: descriptor.ext });
  const segments = path.split('/');
  const filename = segments.at(-1) ?? path;
  const dotIndex = filename.lastIndexOf('.');
  return {
    tag: descriptor.tag,
    category: descriptor.category,
    subcategory: segments.length > 2 ? segments.slice(1, -1).join('/') : descriptor.category,
    name: dotIndex >= 0 ? filename.slice(0, dotIndex) : filename,
    path,
    ext: descriptor.ext,
  };
};

/** Builds the single-entry manifest + hash fragments for a descriptor. */
export const buildAssetFragments = (options: {
  descriptor: GeneratedAsset;
  scannedAt: string;
}): AssetStagingFragments => {
  const entry = manifestEntryForDescriptor(options.descriptor);
  return {
    manifest: {
      scannedAt: options.scannedAt,
      count: 1,
      assets: { [options.descriptor.tag]: entry },
      byCategory: { [options.descriptor.category]: [entry] },
    },
    hashes: {
      scannedAt: options.scannedAt,
      hashes: {
        [options.descriptor.tag]: {
          hash: options.descriptor.sha256,
          sizeBytes: options.descriptor.sizeBytes,
        },
      },
    },
  };
};

/** Merges a fragment into an existing manifest, replacing the same tag only. */
export const mergeManifestFragment = (
  existing: AssetManifest | undefined,
  fragment: AssetManifest,
): AssetManifest => {
  const entry = Object.values(fragment.assets)[0];
  if (!existing || !entry) {
    return JSON.parse(JSON.stringify(fragment)) as AssetManifest;
  }
  const merged: AssetManifest = {
    ...existing,
    scannedAt: fragment.scannedAt,
    assets: { ...existing.assets, ...fragment.assets },
    byCategory: { ...existing.byCategory },
  };
  const categoryEntries = merged.byCategory[entry.category] ?? [];
  merged.byCategory[entry.category] = [
    ...categoryEntries.filter((existingEntry) => existingEntry.tag !== entry.tag),
    entry,
  ];
  merged.count = Object.keys(merged.assets).length;
  return merged;
};

/** Merges a hash fragment into the existing hash file. */
export const mergeHashesFragment = (
  existing: AssetHashesFile | undefined,
  fragment: AssetHashesFile,
): AssetHashesFile =>
  existing
    ? { scannedAt: fragment.scannedAt, hashes: { ...existing.hashes, ...fragment.hashes } }
    : fragment;
