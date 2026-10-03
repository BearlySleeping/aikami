// packages/frontend/storage/src/lib/assets_catalog_snapshot.ts
//
// Device-persisted catalog snapshot (offline boot, C-523 follow-up).
//
// The asset CATALOG — the release pointer's verified tag→hash rows, the
// offline-core tag set and the release's installed pack lock — was resolved
// from `PUBLIC_ASSETS_BASE_URL` on every boot and never written down. The
// binaries it points at DO survive (Turso registry rows + OPFS / Tauri FS
// bytes), but with no local copy of the release graph nothing could find them
// again: every tag resolved to `null`, `loadContentPack` fell back to a
// relative manifest path the de-bundled client does not ship, and the boot
// aborted with a 404 on a device that had every byte it needed.
//
// This module owns the persisted form of that ONE verified release graph. It
// is public catalog metadata — release ids, content hashes, license records —
// never player identity, campaign or save data, so it belongs on the device
// plane next to the asset registry (`meta` key/value table).
//
// What it deliberately does NOT do:
//
//   • Trust the stored bytes. Every field is validated structurally and the
//     whole record carries a SHA-256 digest over its canonical form; a
//     truncated, hand-edited or half-migrated record is REJECTED, never
//     partially applied.
//   • Authenticate the release. A digest proves the record is internally
//     intact, not that the origin published it. Authenticity is established
//     once, by `resolveReleaseGraph`, at the moment the snapshot is WRITTEN —
//     a snapshot is only ever persisted from a fully verified release, and
//     every binary it names is still hash-verified against its own content
//     hash when it is read back out of the cache.
//   • Mix identities. One snapshot is one release: rows, core tags and pack
//     lock always come from the same resolution and are written as one value.

import type { InstalledPackLock } from '@aikami/schemas';
import { InstalledPackLockSchema } from '@aikami/schemas';
import type { AssetSeedDocument, AssetSeedRow } from '@aikami/types';
import { Value } from 'typebox/value';
import { logger } from '$logger';

/** Meta key holding the serialized catalog snapshot. */
export const CATALOG_SNAPSHOT_META_KEY = 'asset_catalog_snapshot';

/**
 * Snapshot record version. Bump when the persisted SHAPE changes in a way an
 * older record cannot satisfy — a record of any other version is rejected
 * outright (and simply re-derived from the network on the next online boot),
 * never coerced.
 */
export const CATALOG_SNAPSHOT_VERSION = 1;

/** How the persisted release's graph was originally resolved. */
export type CatalogSnapshotReleaseSource = 'release' | 'legacy-compat';

/** Where the persisted release's installed pack lock came from. */
export type CatalogSnapshotPackLockSource = 'release' | 'legacy-alias' | 'absent';

/**
 * One coherent, fully verified release graph.
 *
 * Every field is derived from a SINGLE `resolveCatalogRelease` result, so the
 * seed rows, the offline-core set and the pack lock always describe the same
 * release. A record assembled from two resolutions is not representable here.
 */
export type CatalogSnapshot = {
  /** Immutable release id, or `legacy` for a genuinely pointer-less origin. */
  releaseId: string;
  /** Which surface the release graph was read from. */
  releaseSource: CatalogSnapshotReleaseSource;
  /** The compact boot seed the release pinned. */
  seed: AssetSeedDocument;
  /** Offline-core tags — the prefetch/admission set for this release. */
  coreTags: readonly string[];
  /** The release's verified installed pack lock, when it pinned one. */
  packLock: InstalledPackLock | undefined;
  /** Provenance of `packLock`, so a reader never reports a legacy lock as a release one. */
  packLockSource: CatalogSnapshotPackLockSource;
};

/** The serialized envelope: versioned shape plus its integrity digest. */
type StoredCatalogSnapshot = {
  version: number;
  digest: string;
  snapshot: CatalogSnapshot;
};

/** The narrow slice of {@link AssetRegistryRepository} this module needs. */
export type CatalogSnapshotMetaStore = {
  getMeta: (key: string) => Promise<string | undefined>;
  setMeta: (key: string, value: string) => Promise<void>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isSha256 = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);

const isStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string');

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

/**
 * Deterministic JSON: object keys sorted at every depth.
 *
 * The digest must be reproducible from a re-parsed record, and `JSON.stringify`
 * preserves key insertion order — which depends on how the source text was
 * written. Sorting makes the digest a property of the VALUE, not of its
 * serialization.
 */
const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }
  if (isRecord(value)) {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
};

/**
 * Canonical form of the digest payload: sorted core tags and seed rows so a
 * reordered-but-identical record still verifies, everything else verbatim.
 */
const canonicalPayload = (snapshot: CatalogSnapshot): string =>
  stableStringify({
    coreTags: [...snapshot.coreTags].sort(),
    packLock: snapshot.packLock ?? null,
    packLockSource: snapshot.packLockSource,
    releaseId: snapshot.releaseId,
    releaseSource: snapshot.releaseSource,
    seed: {
      generatedAt: snapshot.seed.generatedAt,
      originUrl: snapshot.seed.originUrl,
      rows: [...snapshot.seed.rows].sort((left, right) => left.tag.localeCompare(right.tag)),
      schemaVersion: snapshot.seed.schemaVersion,
    },
  });

const toHex = (bytes: Uint8Array): string => {
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
};

/**
 * SHA-256 over the canonical payload — the snapshot's integrity digest.
 *
 * Detects truncated, partially written or externally edited records. It is an
 * integrity check on the local copy, not authentication of the publisher.
 */
export const catalogSnapshotDigest = async (snapshot: CatalogSnapshot): Promise<string> => {
  const bytes = new TextEncoder().encode(canonicalPayload(snapshot));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return toHex(new Uint8Array(digest));
};

const parseSeedRow = (value: unknown): AssetSeedRow | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const { tag, hash, sizeBytes, category, ext, licenses } = value;
  if (
    !isNonEmptyString(tag) ||
    !isSha256(hash) ||
    typeof sizeBytes !== 'number' ||
    !Number.isFinite(sizeBytes) ||
    sizeBytes < 0 ||
    !isNonEmptyString(category) ||
    typeof ext !== 'string' ||
    (licenses !== undefined && !isStringArray(licenses))
  ) {
    return undefined;
  }
  return {
    tag,
    hash,
    sizeBytes,
    category,
    ext,
    ...(licenses === undefined ? {} : { licenses }),
  };
};

const parseSeed = (value: unknown): AssetSeedDocument | undefined => {
  if (!isRecord(value) || !Array.isArray(value.rows)) {
    return undefined;
  }
  const rows: AssetSeedRow[] = [];
  for (const entry of value.rows) {
    const row = parseSeedRow(entry);
    if (!row) {
      return undefined;
    }
    rows.push(row);
  }
  if (
    value.schemaVersion !== 1 ||
    !isNonEmptyString(value.generatedAt) ||
    !isNonEmptyString(value.originUrl) ||
    rows.length === 0
  ) {
    return undefined;
  }
  return {
    schemaVersion: 1,
    generatedAt: value.generatedAt,
    originUrl: value.originUrl,
    rows,
  };
};

/**
 * Validates an unknown value into a {@link CatalogSnapshot}, or returns
 * `undefined`. Every field is checked — an untrusted record is never coerced,
 * defaulted, or partially applied.
 */
export const parseCatalogSnapshot = (value: unknown): CatalogSnapshot | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const { releaseId, releaseSource, seed, coreTags, packLock, packLockSource } = value;
  if (
    !isNonEmptyString(releaseId) ||
    (releaseSource !== 'release' && releaseSource !== 'legacy-compat') ||
    !isStringArray(coreTags) ||
    (packLockSource !== 'release' &&
      packLockSource !== 'legacy-alias' &&
      packLockSource !== 'absent') ||
    (packLock !== null &&
      packLock !== undefined &&
      !Value.Check(InstalledPackLockSchema, packLock)) ||
    // Provenance must agree with the payload: a lock cannot be "absent" while
    // present, and an unpinned release cannot carry one. A record that
    // contradicts itself is not a coherent release graph.
    (packLockSource === 'absent' && packLock !== null && packLock !== undefined) ||
    (packLockSource !== 'absent' && (packLock === null || packLock === undefined))
  ) {
    return undefined;
  }
  const parsedSeed = parseSeed(seed);
  if (!parsedSeed) {
    return undefined;
  }
  return {
    releaseId,
    releaseSource,
    seed: parsedSeed,
    coreTags,
    packLock: packLock === null ? undefined : (packLock as InstalledPackLock),
    packLockSource,
  };
};

/** Serializes a snapshot into the persisted envelope. */
export const encodeCatalogSnapshot = async (snapshot: CatalogSnapshot): Promise<string> => {
  const stored: StoredCatalogSnapshot = {
    version: CATALOG_SNAPSHOT_VERSION,
    digest: await catalogSnapshotDigest(snapshot),
    snapshot,
  };
  return JSON.stringify(stored);
};

/**
 * Parses and verifies a persisted envelope.
 *
 * @returns The snapshot, or `undefined` when the record is absent, of an
 *   unknown version, malformed, or fails its digest check. A rejected record
 *   is left on disk untouched — the caller decides whether to re-derive it.
 */
export const decodeCatalogSnapshot = async (raw: string): Promise<CatalogSnapshot | undefined> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    logger.warn('catalogSnapshot:unparseable', {
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
  if (!isRecord(parsed) || parsed.version !== CATALOG_SNAPSHOT_VERSION) {
    logger.warn('catalogSnapshot:unknown-version', {
      version: isRecord(parsed) ? parsed.version : undefined,
    });
    return undefined;
  }
  const snapshot = parseCatalogSnapshot(parsed.snapshot);
  if (!snapshot) {
    logger.warn('catalogSnapshot:invalid-shape');
    return undefined;
  }
  const expected = await catalogSnapshotDigest(snapshot);
  if (expected !== parsed.digest) {
    logger.warn('catalogSnapshot:digest-mismatch');
    return undefined;
  }
  return snapshot;
};

/**
 * Reads the device's persisted catalog snapshot.
 *
 * @returns The verified snapshot, or `undefined` when none is stored or the
 *   stored one does not verify. Never throws for a bad record — an unreadable
 *   snapshot is a cache miss, not a boot failure.
 */
export const readCatalogSnapshot = async (
  store: CatalogSnapshotMetaStore,
): Promise<CatalogSnapshot | undefined> => {
  let raw: string | undefined;
  try {
    raw = await store.getMeta(CATALOG_SNAPSHOT_META_KEY);
  } catch (error) {
    logger.warn('catalogSnapshot:read-failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
  if (raw === undefined) {
    return undefined;
  }
  return decodeCatalogSnapshot(raw);
};

/**
 * Persists a fully verified release graph.
 *
 * The caller owns the verification: this is written only after the release
 * pointer resolved and every pinned dependency hash-verified, so the last good
 * snapshot is replaced by a strictly better-or-equal one. It is a single meta
 * write, so a crash mid-write leaves the previous record intact rather than a
 * half-updated one.
 */
export const writeCatalogSnapshot = async (
  store: CatalogSnapshotMetaStore,
  snapshot: CatalogSnapshot,
): Promise<void> => {
  await store.setMeta(CATALOG_SNAPSHOT_META_KEY, await encodeCatalogSnapshot(snapshot));
};
