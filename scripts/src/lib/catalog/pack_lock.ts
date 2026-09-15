// scripts/src/lib/catalog/pack_lock.ts
//
// C-523 AC-5 — building the installed pack lock for a published pack.
//
// `InstalledPackLockSchema` pinned image and definition hashes only. C-523
// added the optional `audioAssets` array so an offline install can hash-verify
// *audio* too, and the client reads that array through
// `installed_pack_lock.ts` before it plays an authored cue.
//
// This is the write side: given a pack manifest (with its authored
// `pack.audio.v1` section), the content hash of that manifest, and the seed
// rows the release actually published, it produces the lock document. A cue
// whose declared tag was never published is simply left out of the pin set —
// the lock states what *is* pinned, and the client treats an unpinned cue as
// nothing to verify.
//
// Contract: C-523 Emberwatch asset pilot and offline integration

import { type ContentPackManifest, type InstalledPackLock, PACK_LOCK_KEY } from '@aikami/schemas';
import { logger } from '$logger';

export { PACK_LOCK_KEY };

/** A published asset row, as the boot seed carries it. */
type SeedRow = { tag: string; hash: string };

/** The basename of a pack-relative asset URL, lowercased. */
const basename = (url: string): string => {
  const withoutQuery = url.split('?')[0] ?? url;
  const segments = withoutQuery.split('/');
  return (segments.at(-1) ?? '').trim().toLowerCase();
};

/** Finds the published row for an exact registry tag. */
const rowForTag = (rows: readonly SeedRow[], tag: string): SeedRow | undefined => {
  const normalized = tag.trim().toLowerCase();
  return rows.find((row) => row.tag.trim().toLowerCase() === normalized);
};

/** Finds the published row whose tag ends with `:<basename>`. */
const rowForBasename = (rows: readonly SeedRow[], name: string): SeedRow | undefined =>
  rows.find((row) => row.tag.trim().toLowerCase().endsWith(`:${name}`));

/**
 * Every image tag the pack's atlas declarations point at.
 *
 * A tile or prop definition lives *in* the manifest, so the manifest's own
 * content hash is the definition hash for every entry it declares.
 */
const declaredImageUrls = (manifest: ContentPackManifest): string[] => {
  const urls: string[] = [];
  if (manifest.atlas) {
    urls.push(manifest.atlas.textureUrl);
    if (manifest.atlas.spritesheetUrl) {
      urls.push(manifest.atlas.spritesheetUrl);
    }
  }
  for (const page of manifest.propAtlases ?? []) {
    urls.push(page.textureUrl);
    if (page.spritesheetUrl) {
      urls.push(page.spritesheetUrl);
    }
  }
  return urls;
};

/**
 * Builds the installed pack lock for a pack, from what the release published.
 *
 * @param options.releaseId - Identifier of the release this lock belongs to.
 * @param options.manifest - The pack manifest, including its `audio` section.
 * @param options.manifestHash - SHA-256 of the manifest bytes.
 * @param options.seedRows - The published seed rows (tag → content hash).
 * @returns The lock, or `undefined` when the pack pins no image bytes at all
 *   (the schema requires at least one asset entry).
 */
export const buildPackLock = (options: {
  releaseId: string;
  manifest: ContentPackManifest;
  manifestHash: string;
  seedRows: readonly SeedRow[];
}): InstalledPackLock | undefined => {
  const { releaseId, manifest, manifestHash, seedRows } = options;

  const assets: { id: string; imageHash: string; definitionHash: string }[] = [];
  const seenIds = new Set<string>();
  for (const url of declaredImageUrls(manifest)) {
    const row = rowForBasename(seedRows, basename(url));
    if (!row || seenIds.has(row.tag)) {
      continue;
    }
    seenIds.add(row.tag);
    assets.push({ id: row.tag, imageHash: row.hash, definitionHash: manifestHash });
  }

  if (assets.length === 0) {
    logger.warn('buildPackLock:no-image-pins', { releaseId, packId: manifest.id });
    return undefined;
  }

  const audioAssets: { id: string; renditionHash: string }[] = [];
  for (const binding of manifest.audio?.bindings ?? []) {
    const row = rowForTag(seedRows, binding.tag);
    if (!row) {
      // The cue's rendition was never published — leave it unpinned rather
      // than pinning a hash nothing serves.
      logger.warn('buildPackLock:audio-cue-unpublished', {
        releaseId,
        packId: manifest.id,
        cueId: binding.cueId,
        tag: binding.tag,
      });
      continue;
    }
    audioAssets.push({ id: binding.cueId, renditionHash: row.hash });
  }

  return {
    schemaVersion: 'catalog.release.v1',
    releaseId,
    assets,
    ...(audioAssets.length > 0 ? { audioAssets } : {}),
  };
};
