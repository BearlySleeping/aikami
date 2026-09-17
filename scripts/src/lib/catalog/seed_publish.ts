// scripts/src/lib/catalog/seed_publish.ts
//
// Seed/metadata publication (C-435 follow-up, C-496 AC-4).
//
// Standalone from the rest of the catalog pipeline on purpose: since C-435
// de-bundled the raw asset library out of this repo, `manifest.json` /
// `asset_hashes.json` no longer exist here, so `loadCatalogEntries` can't run —
// but the seed files these six lines read DO still live in `game-data/` and can
// be republished on their own, without touching the content-addressed assets or
// the catalog index.
//
// Extracted from `pipeline.ts` when that module crossed the source-file-size
// hard limit: this phase shares nothing with the asset/index phases beyond the
// R2 client, and `runCatalogPublish` calls it as one ordered step.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ASSET_CACHE_CONTROL, GAME_DATA_DIR, SEED_KEY_PREFIX } from './config.ts';
import type { R2ClientLike } from './upload.ts';

/** Filenames published under `seed/` alongside the content-addressed assets. */
export const SEED_FILES = [
  'asset_seed.json',
  'offline_core.json',
  'asset_credits.json',
  'lpc_credits.json',
  'lpc_credits_supplement.json',
  'audio_tracks.json',
] as const;

/** Outcome of the seed/metadata phase. */
export type SeedPublishReport = {
  uploaded: number;
  failed: number;
  objects: readonly { key: string; hash: string }[];
};

/**
 * Publishes the seed/metadata files under immutable content-addressed keys so
 * the client can fetch the compact boot seed, offline-core declaration,
 * credits, and audio metadata from the R2 origin.
 *
 * A missing or unreadable seed file is counted as a failure, never silently
 * skipped: `runCatalogPublish` treats any seed failure as blocking the release,
 * because a missing seed means offline boot/credits data is incomplete.
 */
export const runSeedPublish = async (options: {
  client: R2ClientLike;
  gameDataDir?: string;
}): Promise<SeedPublishReport> => {
  const { client, gameDataDir = GAME_DATA_DIR } = options;
  let uploaded = 0;
  let failed = 0;
  const objects: { key: string; hash: string }[] = [];

  for (const filename of SEED_FILES) {
    const localPath = join(gameDataDir, filename);
    try {
      const body = readFileSync(localPath);
      const hash = createHash('sha256').update(body).digest('hex');
      const key = `${SEED_KEY_PREFIX}${hash}/${filename}`;
      await client.putObject({
        key,
        body,
        contentType: 'application/json',
        cacheControl: ASSET_CACHE_CONTROL,
      });
      objects.push({ key, hash });
      uploaded++;
      console.log(`  📄 seed: ${filename} (${(body.length / 1024).toFixed(1)} KB)`);
    } catch (error) {
      failed++;
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`  ⚠ seed: ${filename} skipped — ${message}`);
    }
  }

  if (failed > 0) {
    console.warn(`⚠ ${failed} seed file(s) skipped.`);
  }
  return { uploaded, failed, objects };
};
