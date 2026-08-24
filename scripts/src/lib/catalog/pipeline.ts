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
import { CatalogIndexRootSchema } from '@aikami/schemas';
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
import { type GeneratedShard, generateCatalogIndex } from './index_generation.ts';
import { runAttributionPreflight } from './preflight.ts';
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
  elapsedMs: number;
};

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
  const preflight = runAttributionPreflight({ entries, creditsByTag });
  if (!preflight.ok) {
    const problems = [
      ...preflight.unresolvedTags.map((tag) => `  unresolved: ${tag}`),
      ...preflight.incompleteAttributionTags.map((tag) => `  incomplete attribution: ${tag}`),
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
      uploaded: uploadReport.uploaded,
      skipped: uploadReport.skipped,
      failed: uploadReport.failed,
      bytesTransferred: uploadReport.bytesTransferred,
      failedKeys: uploadReport.failedKeys,
      thumbnails: thumbnailPhase.report,
      rootKey: ROOT_INDEX_KEY,
      shardKeys: [],
      elapsedMs: Date.now() - startedAt,
    };
  }

  // 5. Upload the index LAST — all generated shards first, then the root,
  // so the root (the document consumers fetch first) is the final object
  // written. A partial publish therefore never leaves a root pointing at
  // missing shards.
  const rootJson = JSON.stringify(root, null, 2);
  const indexObjects: { key: string; json: string }[] = [
    ...shards.map((shard: GeneratedShard) => ({ key: shard.key, json: shard.json })),
    { key: ROOT_INDEX_KEY, json: rootJson },
  ];
  const failedIndexKeys: string[] = [];
  for (const { key, json } of indexObjects) {
    try {
      await client.putObject({
        key,
        body: Buffer.from(json, 'utf8'),
        contentType: 'application/json',
        cacheControl: INDEX_CACHE_CONTROL,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  ❌ Index upload failed: ${key} — ${message}`);
      failedIndexKeys.push(key);
    }
  }

  const ok = uploadReport.failed === 0 && failedIndexKeys.length === 0;

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
    `📇 index: ${ROOT_INDEX_KEY} (root, ${shards.length} shard(s))` +
      `${failedIndexKeys.length > 0 ? ` — ${failedIndexKeys.length} index object(s) FAILED` : ''}`,
  );
  console.log(`⏱  elapsed: ${(elapsedMs / 1000).toFixed(1)}s`);

  return {
    ok,
    checkedCount: preflight.checkedCount,
    unresolvedTags: preflight.unresolvedTags,
    incompleteAttributionTags: preflight.incompleteAttributionTags,
    uploaded: uploadReport.uploaded,
    skipped: uploadReport.skipped,
    failed: uploadReport.failed + failedIndexKeys.length,
    bytesTransferred: uploadReport.bytesTransferred,
    failedKeys: [...uploadReport.failedKeys, ...failedIndexKeys],
    thumbnails: thumbnailPhase.report,
    rootKey: ROOT_INDEX_KEY,
    shardKeys: shards.map((shard) => shard.key),
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

export { ASSET_CACHE_CONTROL, INDEX_CACHE_CONTROL, INDEX_KEY_PREFIX };
