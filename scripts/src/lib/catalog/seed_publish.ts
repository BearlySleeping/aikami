// scripts/src/lib/catalog/seed_publish.ts
//
// Seed/metadata publication (C-435 follow-up, C-496 AC-4).
//
// Standalone from the rest of the catalog pipeline on purpose: since C-435
// de-bundled the raw asset library out of this repo, `manifest.json` /
// `asset_hashes.json` no longer exist here, so `loadCatalogEntries` can't run —
// but the seed files these lines read DO still live in `game-data/` and can be
// republished on their own, without touching the content-addressed assets or
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
  /** Objects reused from the previous verified release (byte-identical). */
  carried: number;
  failed: number;
  objects: readonly { key: string; hash: string; carried: boolean }[];
};

/**
 * Publishes the seed/metadata files under immutable content-addressed keys so
 * the client can fetch the compact boot seed, offline-core declaration,
 * credits, and audio metadata from the R2 origin.
 *
 * ── Completeness, not leniency ─────────────────────────────────────────────
 *
 * A release is a COMPLETE, self-contained graph. A de-bundled checkout lacking
 * one of these inputs — this repo has no `lpc_credits.json`, because the LPC
 * library is no longer committed — does NOT mean the published dependency may
 * disappear: the client still fetches it, and an offline install still pins it.
 *
 * So a file absent locally is satisfied from `carriedDependencies`: the
 * previous VERIFIED release's immutable copy, reused under its exact existing
 * key and hash. Only when neither the candidate nor the previous release
 * supplies a required file does this phase fail.
 *
 * The alternative of making the missing files non-fatal is deliberately NOT
 * implemented. That would make the failure disappear by incrementing fewer
 * counters while publishing an incomplete release — the pointer would describe
 * a graph with a hole in it, and the client would discover the hole at boot.
 *
 * @param options.carriedDependencies - Verified dependencies of the previous
 *   release, keyed by catalog key, from `resolvePreviousRelease`.
 */
export const runSeedPublish = async (options: {
  client: R2ClientLike;
  gameDataDir?: string;
  carriedDependencies?: ReadonlyMap<string, Uint8Array>;
}): Promise<SeedPublishReport> => {
  const { client, gameDataDir = GAME_DATA_DIR, carriedDependencies } = options;
  let uploaded = 0;
  let carried = 0;
  let failed = 0;
  const objects: { key: string; hash: string; carried: boolean }[] = [];

  for (const filename of SEED_FILES) {
    let body: Uint8Array;
    let reusedFromPrevious = false;

    try {
      body = readFileSync(join(gameDataDir, filename));
    } catch {
      // Absent locally. The previous release's verified copy is authoritative
      // and byte-identical to what the client already fetches.
      const carriedKey = [...(carriedDependencies?.keys() ?? [])].find((dependencyKey) =>
        dependencyKey.endsWith(`/${filename}`),
      );
      const carriedBody = carriedKey ? carriedDependencies?.get(carriedKey) : undefined;
      if (!carriedBody) {
        failed++;
        console.error(
          `  ❌ seed: ${filename} is absent from this candidate AND from the previous ` +
            'verified release — the new release would be incomplete.',
        );
        continue;
      }
      body = carriedBody;
      reusedFromPrevious = true;
    }

    const hash = createHash('sha256').update(body).digest('hex');
    const key = `${SEED_KEY_PREFIX}${hash}/${filename}`;
    try {
      await client.putObject({
        key,
        body,
        contentType: 'application/json',
        cacheControl: ASSET_CACHE_CONTROL,
      });
      objects.push({ key, hash, carried: reusedFromPrevious });
      if (reusedFromPrevious) {
        carried++;
        console.log(`  🔗 seed: ${filename} carried forward from the previous release`);
      } else {
        uploaded++;
        console.log(`  📄 seed: ${filename} (${(body.length / 1024).toFixed(1)} KB)`);
      }
    } catch (error) {
      failed++;
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`  ⚠ seed: ${filename} upload failed — ${message}`);
    }
  }

  if (failed > 0) {
    console.error(`❌ ${failed} required seed file(s) could not be supplied.`);
  }
  return { uploaded, carried, failed, objects };
};
