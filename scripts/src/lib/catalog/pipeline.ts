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

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  ContentPackManifest,
  PreflightRightsEvidence,
  ReleaseDocumentReader,
} from '@aikami/schemas';
import {
  CatalogIndexRootSchema,
  ContentPackManifestSchema,
  InstalledPackLockSchema,
  PACK_LOCK_KEY,
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
import { immutableIndexKey, publishIndexAndActivate, sha256Hex } from './index_activation.ts';
import { generateCatalogIndex } from './index_generation.ts';
import { buildPackLock } from './pack_lock.ts';
import { runAttributionPreflight } from './preflight.ts';
import {
  abortedReport,
  type CatalogPublishReport,
  type PackLockPublishReport,
} from './publish_report.ts';
import { resolvePreviousRelease } from './published_catalog.ts';

export type { CatalogPublishReport, PackLockPublishReport } from './publish_report.ts';

import {
  describeRightsGateFailure,
  loadAcknowledgedRightsTags,
  runRightsGate,
} from './rights_gate.ts';
import { runSeedPublish } from './seed_publish.ts';
import { runThumbnailPhase } from './thumbnail_generation.ts';
import { type R2ClientLike, uploadAssets } from './upload.ts';

export type CatalogPublishOptions = {
  config: CatalogConfig;
  client: R2ClientLike;
  /**
   * Reader for the previously published release graph.
   *
   * Defaults to HTTPS against `config.originUrl`. Injectable so a test can
   * supply a fixture graph (to exercise carry-forward) or an explicit
   * "no previous release" stub without reaching the network — the publish
   * path must not depend on the internet to be testable.
   */
  releaseReader?: ReleaseDocumentReader;
  /** Override game-data dir (tests). */
  gameDataDir?: string;
  /** Override content-packs dir (tests). */
  contentPacksDir?: string;
};

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
 * The post-publish console summary. Formatting lives here so the orchestration
 * body stays a sequence of phases rather than a sequence of interpolations.
 */
const logPublishSummary = (options: {
  uploadReport: { uploaded: number; skipped: number; failed: number; bytesTransferred: number };
  thumbnails: {
    generated: number;
    uploaded: number;
    skipped: number;
    failed: number;
    skippedNonImage: number;
    fallbackTags: readonly unknown[];
  };
  rootKey: string;
  shardCount: number;
  failedIndexKeys: readonly string[];
  legacyAlias: { written: boolean; error?: string };
  elapsedMs: number;
}): void => {
  const { uploadReport, thumbnails, legacyAlias } = options;
  const indexSuffix =
    options.failedIndexKeys.length > 0
      ? ` — ${options.failedIndexKeys.length} index object(s) FAILED`
      : '';
  const aliasSuffix = legacyAlias.error ? ` — ${legacyAlias.error}` : '';
  console.log('');
  console.log(
    `📤 ${uploadReport.uploaded} uploaded, ${uploadReport.skipped} skipped, ${uploadReport.failed} failed`,
  );
  console.log(
    `   bytes transferred: ${(uploadReport.bytesTransferred / (1024 * 1024)).toFixed(1)} MB`,
  );
  console.log(
    `🖼  thumbnails: ${thumbnails.generated} generated (${thumbnails.uploaded} uploaded, ${thumbnails.skipped} skipped, ${thumbnails.failed} failed), ` +
      `${thumbnails.skippedNonImage} non-image skipped, ` +
      `${thumbnails.fallbackTags.length} fallback-geometry`,
  );
  console.log(`📇 index: ${options.rootKey} (root, ${options.shardCount} shard(s))${indexSuffix}`);
  console.log(
    `🔗 legacy pack-lock alias: ${legacyAlias.written ? 'updated' : `not updated${aliasSuffix}`}`,
  );
  console.log(`⏱  elapsed: ${(options.elapsedMs / 1000).toFixed(1)}s`);
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
      seed: { uploaded: 0, carried: 0, failed: 0 },
      packLock: { written: false, key: PACK_LOCK_KEY, assetPins: 0, audioPins: 0 },
      legacyAlias: { key: PACK_LOCK_KEY, written: false },
      releaseWritten: false,
      elapsedMs: Date.now() - startedAt,
    };
  }
  console.log(
    `✅ Attribution preflight passed — ${preflight.checkedCount} assets checked, 0 unresolved.`,
  );

  // 2.6. Rights gate — does what was DECLARED permit this distribution?
  //
  // Ordered AFTER the attribution preflight on purpose: the preflight asks
  // "was anything declared?", this asks "may we ship what was declared?".
  // Running it first would relabel an undeclared tag as a licensing problem.
  //
  // A generator model's own terms are NOT the artifact's terms. This reads the
  // OUTPUT classification, corroborated against pinned evidence — see
  // model_rights_evidence.ts and rights_gate.ts.
  const rightsGate = runRightsGate({
    entries,
    creditsByTag,
    acknowledgedTags: loadAcknowledgedRightsTags(gameDataDir),
  });
  if (!rightsGate.ok) {
    console.error(describeRightsGateFailure(rightsGate));
    console.error('   No objects were uploaded and no index was written.');
    return abortedReport({
      checkedCount: entries.length,
      rightsBlockedTags: rightsGate.blockedTags,
      elapsedMs: Date.now() - startedAt,
    });
  }

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
      seed: { uploaded: 0, carried: 0, failed: 0 },
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

  // 3.6. Resolve the previous VERIFIED release — BEFORE anything is written.
  //
  // Two phases depend on it: the seed phase carries forward a required
  // dependency the checkout no longer holds, and the index phase unions the
  // entries the live catalog already carries. This repo no longer holds the
  // complete asset library (C-435 de-bundled it), so rebuilding from the local
  // scan roots alone would replace the published catalog with the few dozen
  // tags this checkout carries.
  //
  // Resolution is hash-verified through `resolveReleaseGraph` — the same
  // resolver the production client boot path uses. A corrupt pointer or any
  // integrity mismatch throws and the publish aborts: treating an unverifiable
  // previous release as "absent" would turn corruption into silent data loss.
  const previousRelease = await resolvePreviousRelease({
    originUrl: config.originUrl,
    reader: options.releaseReader,
  });
  if (!previousRelease) {
    console.log(
      '  🔗 previous release: none published at this origin — this index carries only its own entries',
    );
  } else {
    console.log(
      `  🔗 previous release: ${previousRelease.releaseId} (${previousRelease.entries.length} verified entr(ies))`,
    );
  }

  // 3.75. Upload seed/metadata files under immutable content-addressed keys.
  // These are published alongside the assets so the client can fetch the
  // compact boot seed, offline-core declaration, credits, and audio metadata
  // from the same R2 origin (C-435 follow-up: de-bundle everything from git).
  const seedReport = await runSeedPublish({
    client,
    gameDataDir,
    carriedDependencies: previousRelease?.dependencies,
  });

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
  // 4. Generate index — unioned with the previous VERIFIED release resolved in
  // step 3.6 (see there for why an unverifiable release aborts rather than
  // being treated as absent).
  const { root, shards, merge } = generateCatalogIndex({
    entries: entriesForIndex,
    originUrl: config.originUrl,
    carriedEntries: previousRelease?.entries ?? [],
  });
  console.log(
    `  🔗 catalog merge: ${merge.carried} carried, ${merge.replaced} replaced, ` +
      `${merge.added} added, ${merge.retired} retired — ${merge.total} total`,
  );

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
  // missing shards. `publishIndexAndActivate` owns that ordering and the
  // activation decision; this function owns the phases before it.
  const activation = await publishIndexAndActivate({
    client,
    root,
    shards,
    releaseId,
    seedReport,
    packLockReport,
    packLockBody,
  });
  const { rootKey, shardKeys, legacyAlias, releaseWritten, failedIndexKeys } = activation;
  const finalPackLock = activation.packLock;

  const ok =
    uploadReport.failed === 0 &&
    failedIndexKeys.length === 0 &&
    seedReport.failed === 0 &&
    releaseWritten;

  const elapsedMs = Date.now() - startedAt;
  logPublishSummary({
    uploadReport,
    thumbnails: thumbnailPhase.report,
    rootKey,
    shardCount: shardKeys.length,
    failedIndexKeys,
    legacyAlias,
    elapsedMs,
  });

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
    shardKeys,
    seed: seedReport,
    packLock: finalPackLock,
    legacyAlias,
    releaseWritten,
    releaseId,
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
