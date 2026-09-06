// packages/shared/local-ai/src/lib/artifact_resolver.ts
//
// Single canonical artifact resolver. Derives download URL, revision,
// checksum, size and target path from a manifest entry. No ViewModel,
// transport, or Rust default may reconstruct this logic.
//
// Artifact origins are runtime-configured and pinned by revision and checksum.

import type { ModelManifestEntry } from '@aikami/types';

/** Resolved artifact information. */
export type ResolvedArtifact = {
  /** The download URL (may redirect through CDN). */
  readonly url: string;
  /** Pinned revision (commit hash). */
  readonly revision: string;
  /** Expected SHA-256 checksum. */
  readonly sha256: string;
  /** Expected size in bytes. */
  readonly bytes: number;
  /** Target path relative to the assets directory. */
  readonly targetPath: string;
  /** The manifest entry ID. */
  readonly id: string;
  /** The kind of artifact (file or archive). */
  readonly kind: 'file' | 'archive';
};

export type ResolveArtifactOptions = {
  /** The manifest entry to resolve. */
  readonly entry: ModelManifestEntry;
  /**
   * Base origin for HuggingFace downloads. Overridable for testing or
   * mirror configuration. Defaults to https://huggingface.co.
   */
  readonly hfOrigin?: string;
};

/**
 * Resolves a manifest entry into its concrete download URL and metadata.
 * This is the SINGLE canonical place where artifact URLs are constructed.
 *
 * For file entries with HuggingFace repo coordinates (repo + revision + file):
 *   https://{hfOrigin}/{repo}/resolve/{revision}/{file}
 *
 * For file entries with a direct URL: the URL is used as-is.
 * For archive entries: the URL is used as-is.
 */
export const resolveArtifact = (options: ResolveArtifactOptions): ResolvedArtifact => {
  const { entry } = options;
  const hfOrigin = options.hfOrigin ?? 'https://huggingface.co';

  let url: string;

  // Access potentially-undefined source properties through a widened type
  // (ModelManifestEntry is an intersection with a discriminated union, so
  // TS cannot narrow repo/revision/file via kind alone).
  const sourceEntry = entry as typeof entry & {
    repo?: string;
    revision?: string;
    file?: string;
    url?: string;
  };

  if (entry.kind === 'file' && sourceEntry.repo && sourceEntry.revision && sourceEntry.file) {
    // HuggingFace repo coordinates
    url = `${hfOrigin}/${sourceEntry.repo}/resolve/${sourceEntry.revision}/${sourceEntry.file}`;
  } else if (sourceEntry.url) {
    // Direct URL (file with url override, or archive)
    url = sourceEntry.url;
  } else {
    throw new Error(`Cannot resolve artifact ${entry.id}: no repo coordinates and no direct URL`);
  }

  return {
    url,
    revision: sourceEntry.revision ?? '',
    sha256: entry.sha256,
    bytes: entry.bytes,
    targetPath: entry.targetPath,
    id: entry.id,
    kind: entry.kind,
  };
};

/**
 * Resolves companion artifacts for a manifest entry. Companion entries are
 * referenced by ID in the entry's `companions` array.
 */
export const resolveCompanionArtifacts = (options: {
  readonly entry: ModelManifestEntry;
  readonly allEntries: readonly ModelManifestEntry[];
  readonly hfOrigin?: string;
}): ResolvedArtifact[] => {
  const { entry, allEntries } = options;
  const companions = entry.companions ?? [];

  return companions
    .map((companion) => {
      const companionEntry = allEntries.find((e) => e.id === companion.id);
      if (!companionEntry) {
        return undefined;
      }
      return resolveArtifact({ entry: companionEntry, hfOrigin: options.hfOrigin });
    })
    .filter((artifact): artifact is ResolvedArtifact => artifact !== undefined);
};

export type ResolveBundleAssetOptions = {
  /** The HF repo ID. */
  readonly repo: string;
  /** The pinned revision. */
  readonly revision: string;
  /** The file path inside the repo. */
  readonly file: string;
  /**
   * Base origin for HuggingFace downloads. Defaults to https://huggingface.co.
   */
  readonly hfOrigin?: string;
};

/**
 * Resolves a download URL from bundle+asset coordinates (repo, revision, file).
 * This is the canonical URL builder for the existing bundle system
 * (LocalModelBundle + LocalModelAsset). Keeps URL construction in one place
 * so no transport or store reconstructs the pattern.
 */
export const resolveBundleAssetUrl = (options: ResolveBundleAssetOptions): string => {
  const { repo, revision, file } = options;
  const hfOrigin = options.hfOrigin ?? 'https://huggingface.co';
  return `${hfOrigin}/${repo}/resolve/${revision}/${file}`;
};
