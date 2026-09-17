// scripts/src/lib/catalog/pipeline.ts
//
// Catalog publish orchestration (C-395 AC-1/AC-2/AC-4).
//
// Order is load-bearing:
//   1. Load entries (manifest + hashes + credits).
//   2. Attribution preflight — hard gate, BEFORE a single object is
//      uploaded. Non-zero failures abort with every unresolved tag named
//      and zero bytes written.
//   3. Upload content-addressed asset objects (idempotent by key).
//   4. Generate the root index + category shards (size budgets asserted).
//   5. Upload the index LAST — after every object it references is
//      confirmed uploaded, so a partial publish never produces an index
//      pointing at missing bytes.
//
// A non-zero failure count exits non-zero (AC-1). The run reports
// uploaded/skipped/failed counts, bytes transferred, and elapsed time.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ContentPackManifest, PreflightRightsEvidence } from '@aikami/schemas';
import {
  CatalogIndexRootSchema,
  ContentPackManifestSchema,
  InstalledPackLockSchema,
  PACK_LOCK_KEY,
  ReleasePointerSchema,
} from '@aikami/schemas';
import { Value } from 'typebox/value';
import { type CatalogEntry, loadCatalogEntries } from './catalog_entries.ts';
import {
  ASSET_CACHE_CONTROL,
  ASSET_KEY_PREFIX,
  type CatalogConfig,
  CONTENT_PACKS_DIR,
  GAME_DATA_DIR,
  INDEX_CACHE_CONTROL,
  INDEX_KEY_PREFIX,
  ROOT_INDEX_KEY,
} from './config.ts';
import { assetKey } from './content_address.ts';
import { generateCatalogIndex } from './index_generation.ts';
import { buildPackLock } from './pack_lock.ts';
import { runAttributionPreflight } from './preflight.ts';
import { runSeedPublish } from './seed_publish.ts';
import { runThumbnailPhase } from './thumbnail_generation.ts';
import { type R2ClientLike, uploadAssets } from './upload.ts';

export type CatalogPublishOptions = {
  config: CatalogConfig;
  client: R2ClientLike;
  /** Override game-data dir (tests). */
  gameDataDir?: string;
  /** Override content-packs dir (tests). */
  contentPacksDir?: string;
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
  seed: { uploaded: number; failed: number };
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
  elapsedMs: number;
};

/**
 * Key of the versioned release pointer document (C-496 AC-4).
 *
 * Written atomically only after every required object, shard, seed file and
 * the root index are confirmed uploaded; the previous complete release stays
 * readable at this key until then.
 */
const RELEASE_POINTER_KEY = 'index/v1/release.json';

/** SHA-256 hex digest of a UTF-8 string. */
const sha256Hex = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex');

/** Content-addressed key of one immutable index revision. */
const immutableIndexKey = (options: { name: string; hash: string }): string =>
  `${INDEX_KEY_PREFIX}revisions/${options.hash}/${options.name}.json`;

/**
 * The per-pack installed lock phase (C-523 AC-5).
 *
 * The publisher previously never wrote `index/v1/pack_lock.json` at all — only
 * the dev `local_asset_origin` did — so the client's audio-lock verification had
 * no producer in a real release. This builds the lock from the pack manifest and
 * the published seed rows, then returns it for inclusion in the release graph.
 *
 * A pack with no image pins yields `undefined` (the schema requires at least one
 * asset entry); that is not a publish failure, so the caller uploads nothing.
 */
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
  /**
   * Whether the mutable `index/v1/pack_lock.json` compatibility alias was
   * advanced. Set by `runCatalogPublish` after pointer advancement; absent from
   * a standalone `runPackLockPublish`, which writes only the immutable
   * revision. A false value never means the immutable release is corrupt.
   */
  legacyAliasWritten?: boolean;
};

type PackLockPublishArtifact = {
  report: PackLockPublishReport;
  body: Buffer | undefined;
};

/** Inputs for publishing one pack's immutable installed lock. */
export type PackLockPublishOptions = {
  client: R2ClientLike;
  /** All pack ids to lock, or the Emberwatch pack by default. */
  packIds?: readonly string[];
  contentPacksDir?: string;
  /** The seed rows the release published (tag → content hash). */
  seedRows: readonly { tag: string; hash: string }[];
  /** Identifier recorded on the lock; the release id. */
  releaseId: string;
};

/**
 * Builds and (when the pack pins anything) uploads the installed pack lock.
 *
 * @throws {PackLockBuildError} When an authored audio pin contradicts the
 *   published row hash — a producer defect that must block the release rather
 *   than publish a lock the client has to refuse.
 */
const publishPackLockRevision = async (
  options: PackLockPublishOptions,
): Promise<PackLockPublishArtifact> => {
  const { client, seedRows, releaseId } = options;
  const contentPacksDir = options.contentPacksDir ?? CONTENT_PACKS_DIR;
  const packIds = options.packIds ?? ['emberwatch'];

  // The schema does not model a multi-pack lock, so multiple packs would each
  // overwrite the same key. Fail loudly rather than silently pinning the last.
  if (packIds.length > 1) {
    throw new Error(
      `runPackLockPublish: ${packIds.length} packs requested but the lock key is single-pack; ` +
        'extend InstalledPackLockSchema before publishing more than one.',
    );
  }
  const packId = packIds[0];
  if (!packId) {
    return {
      report: { written: false, key: PACK_LOCK_KEY, assetPins: 0, audioPins: 0 },
      body: undefined,
    };
  }

  const manifestPath = join(contentPacksDir, packId, 'manifest.json');
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    // A missing manifest is not a publish failure for a catalog that does not
    // carry this pack; report it so the caller can decide.
    console.warn(
      `  ⚠ pack lock: no manifest at ${manifestPath} — ${error instanceof Error ? error.message : String(error)}`,
    );
    return {
      report: { written: false, key: PACK_LOCK_KEY, assetPins: 0, audioPins: 0 },
      body: undefined,
    };
  }
  if (!Value.Check(ContentPackManifestSchema, raw)) {
    // A catalog may carry packs that do not use the lock feature, or a fixture
    // with placeholder pack bytes. Building a lock for a non-conforming
    // manifest is impossible, so warn and skip rather than block the catalog
    // publish — Emberwatch's own manifest is validated by its pack guard tests.
    console.warn(
      `  ⚠ pack lock: ${manifestPath} failed ContentPackManifestSchema — no lock written`,
    );
    return {
      report: { written: false, key: PACK_LOCK_KEY, assetPins: 0, audioPins: 0 },
      body: undefined,
    };
  }
  const manifest = raw as ContentPackManifest;

  const manifestHash = seedRows.find((row) => row.tag === `${packId}:manifest`)?.hash;
  if (!manifestHash) {
    throw new Error(`runPackLockPublish: published seed has no ${packId}:manifest row`);
  }
  const lock = buildPackLock({
    releaseId,
    manifest,
    manifestHash,
    seedRows,
  });
  if (!lock) {
    return {
      report: { written: false, key: PACK_LOCK_KEY, assetPins: 0, audioPins: 0 },
      body: undefined,
    };
  }
  if (!Value.Check(InstalledPackLockSchema, lock)) {
    throw new Error('runPackLockPublish: generated pack lock failed InstalledPackLockSchema');
  }

  const body = Buffer.from(`${JSON.stringify(lock, null, 2)}\n`, 'utf8');
  const hash = sha256Hex(body.toString('utf8'));
  const key = immutableIndexKey({ name: 'pack_lock', hash });
  await client.putObject({
    key,
    body,
    contentType: 'application/json',
    cacheControl: ASSET_CACHE_CONTROL,
  });
  console.log(
    `  🔒 pack lock: ${packId} — ${lock.assets.length} image pin(s), ${lock.audioAssets?.length ?? 0} audio pin(s)`,
  );
  return {
    report: {
      written: true,
      key,
      hash,
      assetPins: lock.assets.length,
      audioPins: lock.audioAssets?.length ?? 0,
    },
    body,
  };
};

/** Builds and uploads the immutable installed pack lock revision. */
export const runPackLockPublish = async (
  options: PackLockPublishOptions,
): Promise<PackLockPublishReport> => (await publishPackLockRevision(options)).report;

/** Build the list of upload items from catalog entries. */
export const buildUploadItems = (options: {
  entries: readonly CatalogEntry[];
  gameDataDir: string;
  contentPacksDir?: string;
}) => {
  const rootDirs: Record<string, string> = {
    [options.gameDataDir]: options.gameDataDir,
  };
  if (options.contentPacksDir) {
    rootDirs[options.contentPacksDir] = options.contentPacksDir;
  }
  return options.entries.map((entry) => ({
    key: assetKey({ hash: entry.hash, ext: entry.ext }),
    localPath: join(entry.rootDir, entry.path),
    ext: entry.ext,
  }));
};

/**
 * Run the full catalog publish: preflight → upload → index → index upload.
 */
export const runCatalogPublish = async (
  options: CatalogPublishOptions,
): Promise<CatalogPublishReport> => {
  const {
    config,
    client,
    gameDataDir = GAME_DATA_DIR,
    contentPacksDir = CONTENT_PACKS_DIR,
  } = options;
  const startedAt = Date.now();

  // 1. Entries
  const entries = loadCatalogEntries({ gameDataDir, contentPacksDir });

  // 2. Preflight — hard gate before any upload.
  const creditsByTag = loadCreditsByTag(gameDataDir);

  // C-518 AC-5: when the catalog declares rights evidence, the preflight asks
  // for it — an asset whose intended-use rights are absent or `unknown` is
  // reported before a byte is uploaded. Catalogs without the block keep the
  // pre-C-518 behaviour.
  const rightsEvidenceByTag = loadRightsEvidenceByTag(gameDataDir);
  const preflight = runAttributionPreflight({
    entries,
    creditsByTag,
    ...(rightsEvidenceByTag === undefined ? {} : { rightsEvidenceByTag }),
  });
  if (!preflight.ok) {
    const problems = [
      ...preflight.unresolvedTags.map((tag) => `  unresolved: ${tag}`),
      ...preflight.incompleteAttributionTags.map((tag) => `  incomplete attribution: ${tag}`),
      ...preflight.missingRightsEvidenceTags.map((tag) => `  missing rights evidence: ${tag}`),
      ...preflight.incompleteRightsTags.map((tag) => `  incomplete rights evidence: ${tag}`),
    ];
    console.error(
      `❌ Attribution preflight FAILED for ${problems.length} of ${preflight.checkedCount} assets:`,
    );
    for (const line of problems) {
      console.error(line);
    }
    console.error('   No objects were uploaded and no index was written.');
    return {
      ok: false,
      checkedCount: preflight.checkedCount,
      unresolvedTags: preflight.unresolvedTags,
      incompleteAttributionTags: preflight.incompleteAttributionTags,
      missingRightsEvidenceTags: preflight.missingRightsEvidenceTags,
      incompleteRightsTags: preflight.incompleteRightsTags,
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
      seed: { uploaded: 0, failed: 0 },
      packLock: { written: false, key: PACK_LOCK_KEY, assetPins: 0, audioPins: 0 },
      legacyAlias: { key: PACK_LOCK_KEY, written: false },
      releaseWritten: false,
      elapsedMs: Date.now() - startedAt,
    };
  }
  console.log(
    `✅ Attribution preflight passed — ${preflight.checkedCount} assets checked, 0 unresolved.`,
  );

  // 3. Upload assets (idempotent by content-addressed key).
  const uploadReport = await uploadAssets({
    client,
    items: buildUploadItems({ entries, gameDataDir, contentPacksDir }),
    assetKeyPrefix: ASSET_KEY_PREFIX,
  });

  if (uploadReport.failed > 0) {
    console.error(`❌ ${uploadReport.failed} asset upload(s) failed — index NOT written.`);
    return {
      ok: false,
      checkedCount: preflight.checkedCount,
      unresolvedTags: preflight.unresolvedTags,
      incompleteAttributionTags: preflight.incompleteAttributionTags,
      missingRightsEvidenceTags: preflight.missingRightsEvidenceTags,
      incompleteRightsTags: preflight.incompleteRightsTags,
      uploaded: uploadReport.uploaded,
      skipped: uploadReport.skipped,
      failed: uploadReport.failed,
      bytesTransferred: uploadReport.bytesTransferred,
      failedKeys: uploadReport.failedKeys,
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
      seed: { uploaded: 0, failed: 0 },
      packLock: { written: false, key: PACK_LOCK_KEY, assetPins: 0, audioPins: 0 },
      legacyAlias: { key: PACK_LOCK_KEY, written: false },
      releaseWritten: false,
      elapsedMs: Date.now() - startedAt,
    };
  }

  // 3.5. Thumbnail phase (C-396 AC-5): one single-frame preview per image
  // asset, content-addressed under thumbnails/. The index is generated from
  // the entries WITH thumbnailHash, so a republished index resolves previews.
  // A failed thumbnail upload DROPS that entry's thumbnailHash (the grid
  // shows a placeholder) rather than publishing a dangling reference — the
  // index stays internally consistent either way.
  const thumbnailPhase = await runThumbnailPhase({ client, entries, gameDataDir, contentPacksDir });
  const thumbnailFailedHashes = new Set(
    thumbnailPhase.report.failedKeys.map((key) => key.split('/').pop()?.split('.')[0] ?? ''),
  );
  const entriesForIndex = thumbnailPhase.entries.map((entry) =>
    entry.thumbnailHash && thumbnailFailedHashes.has(entry.thumbnailHash)
      ? { ...entry, thumbnailHash: undefined }
      : entry,
  );

  // 3.75. Upload seed/metadata files under immutable content-addressed keys.
  // These are published alongside the assets so the client can fetch the
  // compact boot seed, offline-core declaration, credits, and audio metadata
  // from the same R2 origin (C-435 follow-up: de-bundle everything from git).
  const seedReport = await runSeedPublish({ client, gameDataDir });

  // 3.8. Publish the per-pack installed lock (C-523 AC-5) under an immutable
  // content-addressed key. The mutable compatibility alias is advanced only
  // after the release pointer succeeds.
  const releaseId = new Date().toISOString();
  let packLockReport: PackLockPublishReport = {
    written: false,
    key: PACK_LOCK_KEY,
    assetPins: 0,
    audioPins: 0,
  };
  let packLockBody: Buffer | undefined;
  try {
    const artifact = await publishPackLockRevision({
      client,
      contentPacksDir,
      seedRows: entriesForIndex.map((entry) => ({ tag: entry.tag, hash: entry.hash })),
      releaseId,
    });
    packLockReport = artifact.report;
    packLockBody = artifact.body;
  } catch (error) {
    // A contradictory audio pin is a producer defect: block the release rather
    // than publish a lock the client is required to refuse.
    console.error(
      `❌ Pack lock generation failed — release NOT advanced: ${error instanceof Error ? error.message : String(error)}`,
    );
    return {
      ok: false,
      checkedCount: preflight.checkedCount,
      unresolvedTags: preflight.unresolvedTags,
      incompleteAttributionTags: preflight.incompleteAttributionTags,
      missingRightsEvidenceTags: preflight.missingRightsEvidenceTags,
      incompleteRightsTags: preflight.incompleteRightsTags,
      uploaded: uploadReport.uploaded,
      skipped: uploadReport.skipped,
      failed: uploadReport.failed + 1,
      bytesTransferred: uploadReport.bytesTransferred,
      failedKeys: [...uploadReport.failedKeys, 'pack-lock'],
      thumbnails: thumbnailPhase.report,
      rootKey: ROOT_INDEX_KEY,
      shardKeys: [],
      seed: seedReport,
      packLock: packLockReport,
      legacyAlias: { key: PACK_LOCK_KEY, written: false },
      releaseWritten: false,
      elapsedMs: Date.now() - startedAt,
    };
  }

  // 4. Generate index.
  const { root, shards } = generateCatalogIndex({
    entries: entriesForIndex,
    originUrl: config.originUrl,
  });

  // Validate the root BEFORE constructing or uploading any index object —
  // an invalid index is worse than none (it produces 404s the client will
  // cache), so a validation failure aborts without writing.
  if (!Value.Check(CatalogIndexRootSchema, root)) {
    console.error(
      '❌ Generated root index failed CatalogIndexRootSchema validation — index NOT uploaded.',
    );
    return {
      ok: false,
      checkedCount: preflight.checkedCount,
      unresolvedTags: preflight.unresolvedTags,
      incompleteAttributionTags: preflight.incompleteAttributionTags,
      missingRightsEvidenceTags: preflight.missingRightsEvidenceTags,
      incompleteRightsTags: preflight.incompleteRightsTags,
      uploaded: uploadReport.uploaded,
      skipped: uploadReport.skipped,
      failed: uploadReport.failed,
      bytesTransferred: uploadReport.bytesTransferred,
      failedKeys: uploadReport.failedKeys,
      thumbnails: thumbnailPhase.report,
      rootKey: ROOT_INDEX_KEY,
      shardKeys: [],
      seed: seedReport,
      packLock: packLockReport,
      legacyAlias: { key: PACK_LOCK_KEY, written: false },
      releaseWritten: false,
      elapsedMs: Date.now() - startedAt,
    };
  }

  // 5. Upload the index LAST — all generated shards first, then the root,
  // so the root (the document consumers fetch first) is the final object
  // written. A partial publish therefore never leaves a root pointing at
  // missing shards.
  const rootJson = JSON.stringify(root, null, 2);
  const rootHash = sha256Hex(rootJson);
  const rootKey = immutableIndexKey({ name: 'catalog', hash: rootHash });
  const immutableShards = shards.map((shard) => {
    const hash = sha256Hex(shard.json);
    return {
      ...shard,
      hash,
      key: immutableIndexKey({ name: shard.id, hash }),
    };
  });

  const failedIndexKeys: string[] = [];
  const putIndexObject = async (object: {
    key: string;
    json: string;
    cacheControl?: string;
  }): Promise<void> => {
    try {
      await client.putObject({
        key: object.key,
        body: Buffer.from(object.json, 'utf8'),
        contentType: 'application/json',
        cacheControl: object.cacheControl ?? ASSET_CACHE_CONTROL,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  ❌ Index upload failed: ${object.key} — ${message}`);
      failedIndexKeys.push(object.key);
    }
  };

  // Upload every shard first.
  for (const shard of immutableShards) {
    await putIndexObject({ key: shard.key, json: shard.json });
  }

  // The mutable legacy compatibility alias is maintained ONLY after the
  // immutable release is active. Its outcome is tracked separately from
  // `failedIndexKeys`: a failed alias write leaves the immutable release
  // internally correct, so it must not be reported as a release failure — but
  // the report must not claim the alias was updated either.
  const legacyAlias: { key: string; written: boolean; error?: string } = {
    key: PACK_LOCK_KEY,
    written: false,
  };
  const writeLegacyAlias = async (body: string): Promise<void> => {
    try {
      await client.putObject({
        key: PACK_LOCK_KEY,
        body: Buffer.from(body, 'utf8'),
        contentType: 'application/json',
        cacheControl: INDEX_CACHE_CONTROL,
      });
      legacyAlias.written = true;
    } catch (error) {
      legacyAlias.error = error instanceof Error ? error.message : String(error);
      console.warn(
        `  ⚠ legacy pack-lock alias not updated (immutable release unaffected): ${legacyAlias.error}`,
      );
    }
  };

  // Only advance the release pointer (root) when every shard it references
  // is confirmed uploaded — never a root pointing at missing shards. A shard
  // failure leaves the previous complete release readable (C-496 AC-4).
  let releaseWritten = false;
  if (failedIndexKeys.length === 0) {
    await putIndexObject({ key: rootKey, json: rootJson });

    // Seed failures block the release too: a missing seed file means offline
    // boot/credits data is incomplete, so the publish must not report ok.
    const seedOk = seedReport.failed === 0;
    const okSoFar = uploadReport.failed === 0 && failedIndexKeys.length === 0 && seedOk;

    if (okSoFar && failedIndexKeys.length === 0) {
      // Write the versioned release pointer LAST, pinning the exact root,
      // shard and dependency revisions of this complete release. Writing it
      // here (after every required object is confirmed) means readers fetch
      // either the old complete release or the new complete release, never a
      // mixture. On any failure the pointer is left untouched (AC-4).
      // Dependencies pin every immutable seed file, plus the per-pack installed
      // lock when one was produced — so the release graph names the lock the
      // client verifies audio against (C-523 AC-5).
      const dependencies = [
        ...seedReport.objects,
        ...(packLockReport.written && packLockReport.hash
          ? [{ key: packLockReport.key, hash: packLockReport.hash }]
          : []),
      ];
      const releasePointer = {
        schemaVersion: 'catalog.release.v1',
        releaseId,
        rootKey,
        rootHash,
        shards: immutableShards.map((shard) => ({
          category: shard.id,
          key: shard.key,
          hash: shard.hash,
        })),
        dependencies,
        publishedAt: releaseId,
      };
      if (Value.Check(ReleasePointerSchema, releasePointer)) {
        await putIndexObject({
          key: RELEASE_POINTER_KEY,
          json: JSON.stringify(releasePointer, null, 2),
          cacheControl: INDEX_CACHE_CONTROL,
        });
        // Activation point: the pointer is the authoritative surface. Only now
        // is the mutable compatibility alias allowed to move.
        releaseWritten = failedIndexKeys.length === 0;
        if (releaseWritten && packLockBody) {
          await writeLegacyAlias(packLockBody.toString('utf8'));
          packLockReport = { ...packLockReport, legacyAliasWritten: legacyAlias.written };
        }
      } else {
        console.error('  ⛔ Generated release pointer failed validation — release NOT advanced.');
      }
    }
  } else {
    console.error(
      `  ⛔ ${failedIndexKeys.length} shard(s) failed — release pointer NOT advanced (previous release preserved).`,
    );
  }

  const ok =
    uploadReport.failed === 0 &&
    failedIndexKeys.length === 0 &&
    seedReport.failed === 0 &&
    releaseWritten;

  const elapsedMs = Date.now() - startedAt;
  console.log('');
  console.log(
    `📤 ${uploadReport.uploaded} uploaded, ${uploadReport.skipped} skipped, ${uploadReport.failed} failed`,
  );
  console.log(
    `   bytes transferred: ${(uploadReport.bytesTransferred / (1024 * 1024)).toFixed(1)} MB`,
  );
  console.log(
    `🖼  thumbnails: ${thumbnailPhase.report.generated} generated (${thumbnailPhase.report.uploaded} uploaded, ${thumbnailPhase.report.skipped} skipped, ${thumbnailPhase.report.failed} failed), ` +
      `${thumbnailPhase.report.skippedNonImage} non-image skipped, ` +
      `${thumbnailPhase.report.fallbackTags.length} fallback-geometry`,
  );
  console.log(
    `📇 index: ${rootKey} (root, ${immutableShards.length} shard(s))` +
      `${failedIndexKeys.length > 0 ? ` — ${failedIndexKeys.length} index object(s) FAILED` : ''}`,
  );
  console.log(
    `🔗 legacy pack-lock alias: ${legacyAlias.written ? 'updated' : `not updated${legacyAlias.error ? ` — ${legacyAlias.error}` : ''}`}`,
  );
  console.log(`⏱  elapsed: ${(elapsedMs / 1000).toFixed(1)}s`);

  return {
    ok,
    checkedCount: preflight.checkedCount,
    unresolvedTags: preflight.unresolvedTags,
    incompleteAttributionTags: preflight.incompleteAttributionTags,
    missingRightsEvidenceTags: preflight.missingRightsEvidenceTags,
    incompleteRightsTags: preflight.incompleteRightsTags,
    uploaded: uploadReport.uploaded,
    skipped: uploadReport.skipped,
    failed: uploadReport.failed + failedIndexKeys.length + seedReport.failed,
    bytesTransferred: uploadReport.bytesTransferred,
    failedKeys: [
      ...uploadReport.failedKeys,
      ...failedIndexKeys,
      ...Array.from({ length: seedReport.failed }, (_, i) => `seed:${i}`),
    ],
    thumbnails: thumbnailPhase.report,
    rootKey,
    shardKeys: immutableShards.map((shard) => shard.key),
    seed: seedReport,
    packLock: packLockReport,
    legacyAlias,
    releaseWritten,
    elapsedMs,
  };
};

/**
 * Read the merged credits map from asset_credits.json.
 *
 * File/parse errors PROPAGATE (they are real failures — a missing or
 * corrupt credits file must not silently look like an empty attribution
 * map); the `parsed.credits` fallback applies only to valid files where the
 * `credits` field is absent.
 */
const loadCreditsByTag = (
  gameDataDir: string,
): Record<string, { licenses?: string[]; authors?: string[] }> => {
  const raw = readFileSync(join(gameDataDir, 'asset_credits.json'), 'utf8');
  const parsed = JSON.parse(raw) as {
    credits?: Record<string, { licenses?: string[]; authors?: string[] }>;
  };
  return parsed.credits ?? {};
};

/**
 * C-518 AC-5 — the declared per-tag rights evidence, or undefined when the
 * catalog declares none (in which case the preflight keeps its pre-C-518
 * behaviour rather than failing every tag on a catalog that never recorded
 * rights metadata).
 *
 * Shape in `asset_credits.json`:
 * ```json
 * { "rights": { "portraits:hero": {
 *     "evidenceUrl": "https://…/model-card", "evidenceVersion": "v1.2.0",
 *     "evidenceDate": "2026-09-13",
 *     "scopes": { "gameInclusion": "allowed", "standaloneDistribution": "allowed" } } } }
 * ```
 */
const loadRightsEvidenceByTag = (
  gameDataDir: string,
): Record<string, PreflightRightsEvidence> | undefined => {
  const raw = readFileSync(join(gameDataDir, 'asset_credits.json'), 'utf8');
  const parsed = JSON.parse(raw) as { rights?: Record<string, PreflightRightsEvidence> };
  return parsed.rights === undefined ? undefined : parsed.rights;
};

export { ASSET_CACHE_CONTROL, INDEX_CACHE_CONTROL, INDEX_KEY_PREFIX };
