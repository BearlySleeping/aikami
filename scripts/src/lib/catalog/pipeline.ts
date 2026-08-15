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
import { type CatalogIndexRoot, CatalogIndexRootSchema } from '@aikami/schemas';
import { Value } from 'typebox/value';
import { type CatalogEntry, loadCatalogEntries } from './catalog_entries.ts';
import {
  ASSET_CACHE_CONTROL,
  ASSET_KEY_PREFIX,
  type CatalogConfig,
  GAME_DATA_DIR,
  INDEX_CACHE_CONTROL,
  INDEX_KEY_PREFIX,
  ROOT_INDEX_KEY,
} from './config.ts';
import { assetKey } from './content_address.ts';
import { type GeneratedShard, generateCatalogIndex } from './index_generation.ts';
import { runAttributionPreflight } from './preflight.ts';
import { type R2ClientLike, uploadAssets } from './upload.ts';

export type CatalogPublishOptions = {
  config: CatalogConfig;
  client: R2ClientLike;
  /** Override game-data dir (tests). */
  gameDataDir?: string;
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
  rootKey: string;
  shardKeys: readonly string[];
  elapsedMs: number;
};

/** Build the list of upload items from catalog entries. */
export const buildUploadItems = (options: {
  entries: readonly CatalogEntry[];
  gameDataDir: string;
}) =>
  options.entries.map((entry) => ({
    key: assetKey({ hash: entry.hash, ext: entry.ext }),
    localPath: join(options.gameDataDir, entry.path),
    ext: entry.ext,
  }));

/**
 * Run the full catalog publish: preflight → upload → index → index upload.
 */
export const runCatalogPublish = async (
  options: CatalogPublishOptions,
): Promise<CatalogPublishReport> => {
  const { config, client, gameDataDir = GAME_DATA_DIR } = options;
  const startedAt = Date.now();

  // 1. Entries
  const entries = loadCatalogEntries({ gameDataDir });

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
    items: buildUploadItems({ entries, gameDataDir }),
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
      rootKey: ROOT_INDEX_KEY,
      shardKeys: [],
      elapsedMs: Date.now() - startedAt,
    };
  }

  // 4. Generate index.
  const { root, shards } = generateCatalogIndex({
    entries,
    originUrl: config.originUrl,
  });

  // 5. Upload the index LAST.
  const rootJson = JSON.stringify(root, null, 2);
  const indexObjects: { key: string; json: string }[] = [
    { key: ROOT_INDEX_KEY, json: rootJson },
    ...shards.map((shard: GeneratedShard) => ({ key: shard.key, json: shard.json })),
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

  const rootValidation = Value.Check(CatalogIndexRootSchema, root as CatalogIndexRoot);
  const ok = uploadReport.failed === 0 && failedIndexKeys.length === 0 && rootValidation;

  const elapsedMs = Date.now() - startedAt;
  console.log('');
  console.log(
    `📤 ${uploadReport.uploaded} uploaded, ${uploadReport.skipped} skipped, ${uploadReport.failed} failed`,
  );
  console.log(
    `   bytes transferred: ${(uploadReport.bytesTransferred / (1024 * 1024)).toFixed(1)} MB`,
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
    rootKey: ROOT_INDEX_KEY,
    shardKeys: shards.map((shard) => shard.key),
    elapsedMs,
  };
};

/** Read the merged credits map from asset_credits.json. */
const loadCreditsByTag = (
  gameDataDir: string,
): Record<string, { licenses?: string[]; authors?: string[] }> => {
  try {
    const raw = readFileSync(join(gameDataDir, 'asset_credits.json'), 'utf8');
    const parsed = JSON.parse(raw) as {
      credits: Record<string, { licenses?: string[]; authors?: string[] }>;
    };
    return parsed.credits ?? {};
  } catch {
    return {};
  }
};

export { ASSET_CACHE_CONTROL, INDEX_CACHE_CONTROL, INDEX_KEY_PREFIX };
