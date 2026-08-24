// scripts/src/lib/catalog/thumbnail_generation.ts
//
// C-396 AC-5: thumbnail-generation phase for the catalog publish pipeline.
//
// LPC animation sheets are NOT uniform — `walk`, `thrust`, `slash`, `cast`,
// `hurt`, `idle` etc. have different frame counts and grid dimensions. A
// single global frame size would silently crop mid-frame for every layout
// that doesn't match it, so the frame-geometry table is keyed by animation
// state (measured from the actual sheets in game-data: every LPC frame is
// 64×64; most states have 4 direction rows of 256px height, `climb` and
// `hurt` have a single row of 64px).
//
// Behaviour contract (AC-5 watch points):
//   • Thumbnail = the FIRST FRAME of the FIRST direction row (south-facing),
//     cropped against known frame boundaries — asserted in tests by painting
//     each fixture frame a distinct colour.
//   • Unknown states fall back to a defined safe frame (top-left 64×64 —
//     frame 0 of row 0, which is well-defined for ANY layout) and the tag is
//     reported, never silently shipped.
//   • Non-LPC image assets (sprites, backgrounds) are already single images:
//     the thumbnail is the whole image re-encoded as webp.
//   • Non-image assets (music, sfx, ambient) have no frame to crop and get
//     NO thumbnailHash — the browse UI renders a placeholder for them.
//
// The output is a content-addressed webp stored under `thumbnails/` with the
// same scheme as assets (`thumbnails/<hash[0:2]>/<hash>.webp`); the entry's
// `thumbnailHash` points at it. The hub only ever READS these — generation
// happens here, at publish time, never in the browser (I-1/I-7).

import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CATALOG_THUMBNAIL_EXT,
  CATALOG_THUMBNAIL_KEY_PREFIX,
  IMAGE_MIME_MAP,
} from '@aikami/constants';
import type { CatalogEntry } from './catalog_entries.ts';
import type { CatalogUploadItem, R2ClientLike } from './upload.ts';
import { uploadAssets } from './upload.ts';

// ---------------------------------------------------------------------------
// Frame geometry — keyed by animation state, never assumed constant
// ---------------------------------------------------------------------------

export type LpcFrameGeometry = {
  /** Single frame size in px (square). LPC frames are 64×64. */
  frameSize: number;
  /** Animation frames per direction row. */
  framesPerRow: number;
  /** Direction rows in the sheet. */
  rows: number;
  /** Frame index within row 0 to crop. Defaults to 0 (first frame). */
  frameIndex?: number;
};

/** LPC frame size — every sheet measured in game-data is 64×64 per frame. */
export const LPC_FRAME_SIZE = 64;

/**
 * Max edge for whole-image (non-LPC) thumbnails. The browse grid renders
 * tiles at a few hundred px — re-encoding a multi-megapixel background at
 * native size would make every grid tile a full-size download. `fit: 'inside'`
 * preserves aspect ratio and `withoutEnlargement` keeps small images intact.
 */
export const THUMBNAIL_MAX_EDGE = 256;

/**
 * Per-state frame geometry, measured from the actual sheets in
 * `apps/frontend/client/static/game-data/lpc/`. `rows: 1` states (climb,
 * hurt) render a single direction and are 64px tall; all others are 4 rows
 * (256px tall). Widths are `framesPerRow * 64`.
 */
export const LPC_STATE_GEOMETRY: Readonly<Record<string, LpcFrameGeometry>> = {
  backslash: { frameSize: LPC_FRAME_SIZE, framesPerRow: 13, rows: 4 },
  climb: { frameSize: LPC_FRAME_SIZE, framesPerRow: 6, rows: 1 },
  combat_idle: { frameSize: LPC_FRAME_SIZE, framesPerRow: 2, rows: 4 },
  emote: { frameSize: LPC_FRAME_SIZE, framesPerRow: 3, rows: 4 },
  halfslash: { frameSize: LPC_FRAME_SIZE, framesPerRow: 6, rows: 4 },
  hurt: { frameSize: LPC_FRAME_SIZE, framesPerRow: 6, rows: 1 },
  idle: { frameSize: LPC_FRAME_SIZE, framesPerRow: 2, rows: 4 },
  jump: { frameSize: LPC_FRAME_SIZE, framesPerRow: 5, rows: 4 },
  run: { frameSize: LPC_FRAME_SIZE, framesPerRow: 8, rows: 4 },
  shoot: { frameSize: LPC_FRAME_SIZE, framesPerRow: 13, rows: 4 },
  sit: { frameSize: LPC_FRAME_SIZE, framesPerRow: 3, rows: 4 },
  slash: { frameSize: LPC_FRAME_SIZE, framesPerRow: 6, rows: 4 },
  spellcast: { frameSize: LPC_FRAME_SIZE, framesPerRow: 7, rows: 4 },
  thrust: { frameSize: LPC_FRAME_SIZE, framesPerRow: 8, rows: 4 },
  walk: { frameSize: LPC_FRAME_SIZE, framesPerRow: 9, rows: 4 },
};

/**
 * Safe fallback for any state without an explicit table entry: the top-left
 * 64×64 region — frame 0 of row 0 — which is well-defined for every LPC
 * layout regardless of its frame count. The fallback tags are REPORTED by
 * the phase (silence here is how a wrong thumbnail ships unnoticed at
 * 12,707-asset scale).
 */
export const LPC_FALLBACK_GEOMETRY: LpcFrameGeometry = {
  frameSize: LPC_FRAME_SIZE,
  framesPerRow: 1,
  rows: 4,
};

/** The animation state of an entry, derived from its tag's last segment. */
export const extractStateFromTag = (tag: string): string => tag.split(':').pop() ?? '';

/** True when the extension is a raster/vector image sharp can read. */
export const isImageExt = (ext: string): boolean => ext.toLowerCase() in IMAGE_MIME_MAP;

/** Resolve geometry for a state, reporting whether the fallback was used. */
export const resolveFrameGeometry = (
  state: string,
): { geometry: LpcFrameGeometry; usedFallback: boolean } => {
  const geometry = LPC_STATE_GEOMETRY[state];
  if (geometry) {
    return { geometry, usedFallback: false };
  }
  return { geometry: LPC_FALLBACK_GEOMETRY, usedFallback: true };
};

/** Content-addressed object key for a thumbnail hash. */
export const thumbnailObjectKey = (hash: string): string =>
  `${CATALOG_THUMBNAIL_KEY_PREFIX}${hash.slice(0, 2)}/${hash}${CATALOG_THUMBNAIL_EXT}`;

const sha256Hex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

/** One generated thumbnail (bytes + the geometry decision that produced it). */
export type GeneratedThumbnail = {
  /** sha256 of the generated webp bytes — also the storage address. */
  hash: string;
  /** webp bytes, ready to upload. */
  bytes: Uint8Array;
  /** Geometry used — asserted against known boundaries in tests. */
  geometry: LpcFrameGeometry;
  /** True when the state had no explicit table entry (reported by phase). */
  usedFallback: boolean;
};

export const generateThumbnail = async (options: {
  /** Absolute path to the source sheet/image. */
  sourcePath: string;
  /** Category — only 'lpc' uses the frame-geometry crop. */
  category: string;
  /** Animation state (lpc only) — resolved from the tag by the caller. */
  state?: string;
}): Promise<GeneratedThumbnail> => {
  const { sourcePath, category, state } = options;

  // Dynamic import: sharp is a devDependency of scripts and is heavy — only
  // load it when a thumbnail actually needs generating.
  const sharp = (await import('sharp')).default;

  if (category === 'lpc' && state) {
    const { geometry, usedFallback } = resolveFrameGeometry(state);
    const frameIndex = geometry.frameIndex ?? 0;
    const bytes = await sharp(sourcePath)
      .extract({
        left: frameIndex * geometry.frameSize,
        top: 0,
        width: geometry.frameSize,
        height: geometry.frameSize,
      })
      .webp({ quality: 90 })
      .toBuffer();
    return {
      hash: sha256Hex(new Uint8Array(bytes)),
      bytes: new Uint8Array(bytes),
      geometry,
      usedFallback,
    };
  }

  // Non-LPC image: the asset IS the preview — re-encode as webp, bounded to
  // THUMBNAIL_MAX_EDGE (the browse grid never needs full resolution).
  const bytes = await sharp(sourcePath)
    .resize({
      width: THUMBNAIL_MAX_EDGE,
      height: THUMBNAIL_MAX_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: 90 })
    .toBuffer();
  return {
    hash: sha256Hex(new Uint8Array(bytes)),
    bytes: new Uint8Array(bytes),
    geometry: LPC_FALLBACK_GEOMETRY,
    usedFallback: false,
  };
};

// ---------------------------------------------------------------------------
// Phase orchestration (called by the publish pipeline)
// ---------------------------------------------------------------------------

export type ThumbnailPhaseReport = {
  /** Tags that received a thumbnail. */
  generated: number;
  /** Tags skipped because they are not image assets (music, sfx…). */
  skippedNonImage: number;
  /** Image tags whose source bytes sharp could not decode (corrupt/unsupported). */
  decodeFailedTags: readonly string[];
  /**
   * Image tags whose thumbnail generation failed because the crop region
   * exceeded the source sheet's dimensions (a geometry-table mismatch — the
   * exact silent-wrong-thumbnail case this module warns about). Kept
   * distinct from decodeFailedTags so a sheet that decodes fine but is
   * narrower than the declared frame grid is reported as a geometry/crop
   * problem, not as corrupt bytes.
   */
  geometryFailedTags: readonly string[];
  /** Tags whose state fell back to the default geometry (reported loudly). */
  fallbackTags: readonly string[];
  /** Upload stats for the thumbnails/ objects. */
  uploaded: number;
  skipped: number;
  failed: number;
  failedKeys: readonly string[];
};

/**
 * True when a sharp failure is an extract region-bounds error rather than a
 * decode error. sharp's `extract` throws a message that names the area and
 * the image dimensions when the crop exceeds the source; decode failures
 * instead report unsupported/corrupt input. Classifying them separately
 * keeps a geometry mismatch visible instead of burying it in decodeFailed.
 */
const isExtractBoundsError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return /(extract|exceed|dimension|area)/i.test(message);
};

/**
 * Run the thumbnail phase: generate one preview per image asset, upload the
 * content-addressed webp under `thumbnails/`, and return the entries with
 * `thumbnailHash` attached (the caller regenerates the index with them).
 *
 * A source file sharp cannot decode is skipped with a warn — never a hard
 * failure: one corrupt sheet must not block publishing the other 12,706
 * assets, and the entry simply keeps no thumbnail (the UI placeholder).
 */
export const runThumbnailPhase = async (options: {
  client: R2ClientLike;
  entries: readonly CatalogEntry[];
  gameDataDir: string;
  contentPacksDir?: string;
}): Promise<{ entries: CatalogEntry[]; report: ThumbnailPhaseReport }> => {
  const { client } = options;

  const fallbackTags: string[] = [];
  const decodeFailedTags: string[] = [];
  const geometryFailedTags: string[] = [];
  /** Hash-only map — bytes are dropped once written, never held for the run. */
  const thumbnails = new Map<string, { hash: string }>();
  let skippedNonImage = 0;

  // Materialise generated bytes to a temp dir so the EXISTING uploader
  // (uploadAssets, C-395 — reused unchanged) handles the S3 put + idempotent
  // skip logic under the thumbnails/ prefix. The dir is removed once the
  // upload resolves (N13).
  const thumbDir = mkdtempSync(join(tmpdir(), 'catalog-thumbnails-'));
  const items: CatalogUploadItem[] = [];

  /** Generate + write one entry's thumbnail; never throws. */
  const generateOne = async (entry: CatalogEntry): Promise<void> => {
    const sourcePath = join(entry.rootDir, entry.path);
    const state = entry.category === 'lpc' ? extractStateFromTag(entry.tag) : undefined;
    try {
      const thumbnail = await generateThumbnail({ sourcePath, category: entry.category, state });
      if (thumbnail.usedFallback) {
        fallbackTags.push(entry.tag);
      }
      const localPath = join(thumbDir, `${thumbnail.hash}${CATALOG_THUMBNAIL_EXT}`);
      writeFileSync(localPath, thumbnail.bytes);
      items.push({
        key: thumbnailObjectKey(thumbnail.hash),
        localPath,
        ext: CATALOG_THUMBNAIL_EXT,
      });
      // Only the hash stays in memory — the bytes are on disk now.
      thumbnails.set(entry.tag, { hash: thumbnail.hash });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isExtractBoundsError(error)) {
        // Crop region exceeds the sheet — a geometry-table mismatch, not
        // corrupt bytes. Report it distinctly (AC-5 watch point).
        console.warn(
          `⚠️ thumbnail crop out of bounds for ${entry.tag} — geometry mismatch, no preview: ${message}`,
        );
        geometryFailedTags.push(entry.tag);
      } else {
        console.warn(`⚠️ thumbnail generation failed for ${entry.tag} — no preview: ${message}`);
        decodeFailedTags.push(entry.tag);
      }
    }
  };

  // Bounded concurrency: process image entries in small parallel batches so
  // the 12,707-asset scale doesn't pay a full serial decode+encode per entry
  // (N13).
  const imageEntries = options.entries.filter((entry) => isImageExt(entry.ext));
  skippedNonImage = options.entries.length - imageEntries.length;
  const CONCURRENCY_LIMIT = 4;
  for (let offset = 0; offset < imageEntries.length; offset += CONCURRENCY_LIMIT) {
    const batch = imageEntries.slice(offset, offset + CONCURRENCY_LIMIT);
    await Promise.all(batch.map(generateOne));
  }

  if (fallbackTags.length > 0) {
    // Loud, never silent — a fallback geometry can produce a plausible but
    // WRONG image, and silence is how that ships unnoticed (AC-5 watch point).
    console.warn(
      `⚠️ ${fallbackTags.length} LPC asset(s) had no frame-geometry entry and used the default first-frame crop:`,
    );
    for (const tag of fallbackTags.slice(0, 20)) {
      console.warn(`  ${tag}`);
    }
    if (fallbackTags.length > 20) {
      console.warn(`  … and ${fallbackTags.length - 20} more`);
    }
  }

  try {
    const uploadReport = await uploadAssets({
      client,
      items,
      assetKeyPrefix: CATALOG_THUMBNAIL_KEY_PREFIX,
    });

    const entriesWithThumbnails = options.entries.map((entry) => {
      const thumbnail = thumbnails.get(entry.tag);
      if (!thumbnail) {
        return entry;
      }
      return { ...entry, thumbnailHash: thumbnail.hash };
    });

    return {
      entries: entriesWithThumbnails,
      report: {
        generated: thumbnails.size,
        skippedNonImage,
        decodeFailedTags,
        geometryFailedTags,
        fallbackTags,
        uploaded: uploadReport.uploaded,
        skipped: uploadReport.skipped,
        failed: uploadReport.failed,
        failedKeys: uploadReport.failedKeys,
      },
    };
  } finally {
    // Temp dir is transient — never leave it behind after the upload resolves.
    rmSync(thumbDir, { recursive: true, force: true });
  }
};
