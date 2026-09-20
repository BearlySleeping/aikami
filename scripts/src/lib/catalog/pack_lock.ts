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
// whose declared tag is unpublished is left out of the pin set; a cue whose
// published hash disagrees with the binding's `sha256` is a producer defect
// and fails lock generation rather than pinning a contradictory value.
//
// Contract: C-523 Emberwatch asset pilot and offline integration

import { type ContentPackManifest, type InstalledPackLock, PACK_LOCK_KEY } from '@aikami/schemas';
import { logger } from '$logger';

export { PACK_LOCK_KEY };

/** A published asset row, as the boot seed carries it. */
type SeedRow = { tag: string; hash: string };

/** A typed lock-generation failure. */
export class PackLockBuildError extends Error {
  readonly code: 'audio-hash-mismatch' | 'ambiguous-image-pin';

  constructor(code: PackLockBuildError['code'], message: string) {
    super(message);
    this.name = 'PackLockBuildError';
    this.code = code;
  }
}

/** The basename of a pack-relative asset URL, lowercased. */
const basename = (url: string): string => {
  const withoutQuery = url.split('?')[0] ?? url;
  const segments = withoutQuery.split('/');
  return (segments.at(-1) ?? '').trim().toLowerCase();
};

/**
 * Derives the canonical registry tag from a pack-relative asset URL.
 *
 * `PUBLIC_ASSETS_BASE_URL` assets are content-addressed under a
 * `/game-data/<category>/<subcategory...>/<name>` path whose colon-joined form
 * is the tag, so the URL itself carries unambiguous identity — no sibling
 * pack's same-named atlas can be pinned by mistake.
 */
const tagFromUrl = (url: string): string | undefined => {
  const withoutQuery = (url.split('?')[0] ?? url).trim();
  const marker = '/game-data/';
  const markerIndex = withoutQuery.indexOf(marker);
  const relative =
    markerIndex >= 0
      ? withoutQuery.slice(markerIndex + marker.length)
      : withoutQuery.replace(/^\/+/, '');
  const segments = relative.split('/').filter((segment) => segment.length > 0);
  if (segments.length < 2) {
    return undefined;
  }
  return segments.join(':');
};

/** Finds the published row for an exact registry tag. */
const rowForTag = (rows: readonly SeedRow[], tag: string): SeedRow | undefined => {
  const normalized = tag.trim().toLowerCase();
  return rows.find((row) => row.tag.trim().toLowerCase() === normalized);
};

/**
 * Finds the published image row for a declared atlas URL.
 *
 * The URL's canonical tag is tried first. Only when that has no row does this
 * fall back to a basename suffix match — and an ambiguous suffix (more than
 * one published tag ends with the same name) is rejected rather than pinning a
 * different pack's same-named atlas.
 */
const rowForImageUrl = (rows: readonly SeedRow[], url: string): SeedRow | undefined => {
  const canonical = tagFromUrl(url);
  if (canonical) {
    const exact = rowForTag(rows, canonical);
    if (exact) {
      return exact;
    }
  }

  const name = basename(url);
  const matches = rows.filter((row) => row.tag.trim().toLowerCase().endsWith(`:${name}`));
  if (matches.length > 1) {
    const tags = matches.map((row) => row.tag).join(', ');
    logger.error('buildPackLock:ambiguous-image-pin', { url, matches: tags });
    throw new PackLockBuildError(
      'ambiguous-image-pin',
      `Atlas URL "${url}" matches multiple published tags (${tags}); refusing to pin an ambiguous image.`,
    );
  }
  return matches[0];
};

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
 * @throws {PackLockBuildError} When an authored audio pin contradicts the
 *   published row hash, or an image URL is ambiguous.
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
    const row = rowForImageUrl(seedRows, url);
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
    // An intentional-silence cue names no bytes, so there is nothing to pin.
    // It is not an unpublished rendition — the pack never claimed one.
    if (binding.source.kind === 'silence') {
      continue;
    }
    const row = rowForTag(seedRows, binding.source.tag);
    if (!row) {
      // The cue's rendition was never published — leave it unpinned rather
      // than pinning a hash nothing serves.
      logger.warn('buildPackLock:audio-cue-unpublished', {
        releaseId,
        packId: manifest.id,
        cueId: binding.cueId,
        tag: binding.source.tag,
      });
      continue;
    }
    // The manifest names the bytes this cue must be; the published row names
    // the bytes it actually is. A disagreement is a producer defect — pinning
    // either hash would produce a lock the client must refuse.
    if (row.hash.trim().toLowerCase() !== binding.source.sha256.trim().toLowerCase()) {
      logger.error('buildPackLock:audio-hash-mismatch', {
        releaseId,
        packId: manifest.id,
        cueId: binding.cueId,
        tag: binding.source.tag,
        declared: binding.source.sha256,
        published: row.hash,
      });
      throw new PackLockBuildError(
        'audio-hash-mismatch',
        `Audio cue "${binding.cueId}" declares sha256 ${binding.source.sha256} but published tag "${binding.source.tag}" has hash ${row.hash}.`,
      );
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
