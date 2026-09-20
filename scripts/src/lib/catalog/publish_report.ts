// scripts/src/lib/catalog/publish_report.ts
//
// The catalog publish report type and the builder for a publish that refused
// before writing anything.
//
// Extracted from `pipeline.ts` when that module crossed the source-file-size
// hard limit: every pre-write gate (attribution preflight, rights gate) returns
// the same shape, and building it in one place both removes the duplication and
// keeps the pipeline readable.

import { PACK_LOCK_KEY } from '@aikami/schemas';
import { ROOT_INDEX_KEY } from './config.ts';

export type PackLockPublishReport = {
  /** Whether a lock document was produced for the pack. */
  written: boolean;
  key: string;
  /** Content hash of the uploaded lock bytes, when written. */
  hash?: string;
  /** Number of pinned image/definition assets. */
  assetPins: number;
  /** Number of pinned audio renditions. */
  audioPins: number;
  /** Whether the mutable compatibility alias was advanced. */
  legacyAliasWritten?: boolean;
};

export type CatalogPublishReport = {
  ok: boolean;
  checkedCount: number;
  unresolvedTags: readonly string[];
  incompleteAttributionTags: readonly string[];
  /** C-518 — tags with no declared rights evidence (only when the catalog declares any). */
  missingRightsEvidenceTags?: readonly string[];
  /** C-518 — tags whose declared rights evidence cannot substantiate publication. */
  incompleteRightsTags?: readonly string[];
  /** Tags blocked by the rights gate despite having declared rights evidence. */
  rightsBlockedTags?: readonly string[];
  uploaded: number;
  skipped: number;
  failed: number;
  bytesTransferred: number;
  failedKeys: readonly string[];
  /** Thumbnail phase stats (C-396 AC-5). */
  thumbnails: {
    generated: number;
    skippedNonImage: number;
    decodeFailedTags: readonly string[];
    geometryFailedTags: readonly string[];
    fallbackTags: readonly string[];
    uploaded: number;
    skipped: number;
    failed: number;
  };
  rootKey: string;
  shardKeys: readonly string[];
  /** Seed/metadata publish stats (C-496 AC-4: seed failures block the release). */
  seed: { uploaded: number; carried: number; failed: number };
  /** Per-pack installed lock phase (C-523 AC-5). */
  packLock: PackLockPublishReport;
  /**
   * The mutable legacy compatibility alias (`index/v1/pack_lock.json`),
   * maintained only AFTER the immutable release is active. Reported separately
   * because a failed alias write leaves the immutable release intact — it must
   * never be conflated with release activation, and the report must not claim
   * the alias was updated when it was not.
   */
  legacyAlias: { key: string; written: boolean; error?: string };
  /** Whether the versioned release pointer was written this run (AC-4). */
  releaseWritten: boolean;
  /**
   * The release id this run pinned into the pointer, when one was produced.
   * Absent for a publish that refused before the activation phase.
   */
  releaseId?: string;
  elapsedMs: number;
};

/**
 * Builds the report for a publish that refused BEFORE any write.
 *
 * Every pre-write gate must return the SAME shape, or a caller cannot tell
 * "refused at the preflight" from "uploaded then failed". Building it once is
 * also what keeps `pipeline.ts` inside its size budget.
 */
export const abortedReport = (options: {
  checkedCount: number;
  unresolvedTags?: readonly string[];
  incompleteAttributionTags?: readonly string[];
  missingRightsEvidenceTags?: readonly string[];
  incompleteRightsTags?: readonly string[];
  rightsBlockedTags?: readonly string[];
  elapsedMs: number;
}): CatalogPublishReport => ({
  ok: false,
  checkedCount: options.checkedCount,
  unresolvedTags: options.unresolvedTags ?? [],
  incompleteAttributionTags: options.incompleteAttributionTags ?? [],
  missingRightsEvidenceTags: options.missingRightsEvidenceTags ?? [],
  incompleteRightsTags: options.incompleteRightsTags ?? [],
  rightsBlockedTags: options.rightsBlockedTags ?? [],
  uploaded: 0,
  skipped: 0,
  failed: 0,
  bytesTransferred: 0,
  failedKeys: [],
  thumbnails: {
    generated: 0,
    skippedNonImage: 0,
    decodeFailedTags: [],
    geometryFailedTags: [],
    fallbackTags: [],
    uploaded: 0,
    skipped: 0,
    failed: 0,
  },
  rootKey: ROOT_INDEX_KEY,
  shardKeys: [],
  seed: { uploaded: 0, carried: 0, failed: 0 },
  packLock: { written: false, key: PACK_LOCK_KEY, assetPins: 0, audioPins: 0 },
  legacyAlias: { key: PACK_LOCK_KEY, written: false },
  releaseWritten: false,
  elapsedMs: options.elapsedMs,
});
