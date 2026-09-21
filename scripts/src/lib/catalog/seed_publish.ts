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
import {
  type CompactSeedDocument,
  mergeCompactSeeds,
  parseCompactSeed,
  serializeCompactSeed,
} from './compact_seed.ts';
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
type SeedObject = { key: string; hash: string; carried: boolean };

const errorCodeOf = (error: unknown): unknown =>
  error !== null && typeof error === 'object' && 'code' in error ? error.code : undefined;

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * The previous release's verified copy of one seed file, keyed by the exact
 * existing catalog key (dependency keys are hashed, so the file name is the
 * only stable part).
 */
const carriedSeedBody = (
  carriedDependencies: ReadonlyMap<string, Uint8Array> | undefined,
  filename: string,
): Uint8Array | undefined => {
  const carriedKey = [...(carriedDependencies?.keys() ?? [])].find((dependencyKey) =>
    dependencyKey.endsWith(`/${filename}`),
  );
  return carriedKey ? carriedDependencies?.get(carriedKey) : undefined;
};

/**
 * Resolves one seed file's bytes: the candidate's own copy first, then the
 * previous verified release's immutable copy.
 *
 * Absent from both is a FAILURE, not a skip — see the module header: making it
 * non-fatal would publish a graph with a hole in it.
 */
const resolveSeedBody = (options: {
  filename: string;
  gameDataDir: string;
  carriedDependencies: ReadonlyMap<string, Uint8Array> | undefined;
}):
  | { ok: true; body: Uint8Array; carried: boolean; mergedFromCarried: number }
  | { ok: false; reason: string } => {
  try {
    return {
      ok: true,
      body: readFileSync(join(options.gameDataDir, options.filename)),
      carried: false,
      mergedFromCarried: 0,
    };
  } catch (error) {
    if (errorCodeOf(error) !== 'ENOENT') {
      return { ok: false, reason: `could not be read — ${messageOf(error)}` };
    }
  }
  const carriedBody = carriedSeedBody(options.carriedDependencies, options.filename);
  if (!carriedBody) {
    return {
      ok: false,
      reason:
        'is absent from this candidate AND from the previous verified release — the new ' +
        'release would be incomplete.',
    };
  }
  return { ok: true, body: carriedBody, carried: true, mergedFromCarried: 0 };
};

const ASSET_SEED_FILENAME = 'asset_seed.json';

/**
 * Resolves `asset_seed.json` by UNIONING the candidate's rows with the previous
 * verified release's, rather than choosing one.
 *
 * Absent from both is still a failure — see the module header.
 */
const resolveAssetSeedBody = (options: {
  gameDataDir: string;
  carriedDependencies: ReadonlyMap<string, Uint8Array> | undefined;
}):
  | { ok: true; body: Uint8Array; carried: boolean; mergedFromCarried: number }
  | { ok: false; reason: string } => {
  let local: CompactSeedDocument | undefined;
  try {
    local = parseCompactSeed(
      readFileSync(join(options.gameDataDir, ASSET_SEED_FILENAME)),
      `the candidate's ${ASSET_SEED_FILENAME}`,
    );
  } catch (error) {
    if (errorCodeOf(error) !== 'ENOENT') {
      return { ok: false, reason: `could not be read — ${messageOf(error)}` };
    }
  }

  const carriedBytes = carriedSeedBody(options.carriedDependencies, ASSET_SEED_FILENAME);
  if (!local && !carriedBytes) {
    return {
      ok: false,
      reason:
        'is absent from this candidate AND from the previous verified release — the new ' +
        'release would be incomplete.',
    };
  }

  let carried: CompactSeedDocument | undefined;
  if (carriedBytes) {
    try {
      carried = parseCompactSeed(carriedBytes, `the previous release's ${ASSET_SEED_FILENAME}`);
    } catch (error) {
      return { ok: false, reason: `carried copy is unusable — ${messageOf(error)}` };
    }
  }
  if (!local) {
    return { ok: true, body: carriedBytes as Uint8Array, carried: true, mergedFromCarried: 0 };
  }
  if (!carried) {
    return {
      ok: true,
      body: serializeCompactSeed(local),
      carried: false,
      mergedFromCarried: 0,
    };
  }

  const localTags = new Set(local.r.map((row) => row.t));
  const mergedFromCarried = carried.r.filter((row) => !localTags.has(row.t)).length;
  return {
    ok: true,
    body: serializeCompactSeed(mergeCompactSeeds({ local, carried })),
    carried: false,
    mergedFromCarried,
  };
};

/** Uploads one seed file under its immutable content-addressed key. */
const storeSeedFile = async (options: {
  client: R2ClientLike;
  filename: string;
  body: Uint8Array;
  carried: boolean;
}): Promise<{ ok: true; object: SeedObject } | { ok: false; error: string }> => {
  const hash = createHash('sha256').update(options.body).digest('hex');
  const key = `${SEED_KEY_PREFIX}${hash}/${options.filename}`;
  try {
    await options.client.putObject({
      key,
      body: options.body,
      contentType: 'application/json',
      cacheControl: ASSET_CACHE_CONTROL,
    });
  } catch (error) {
    return { ok: false, error: messageOf(error) };
  }
  return { ok: true, object: { key, hash, carried: options.carried } };
};

export const runSeedPublish = async (options: {
  client: R2ClientLike;
  gameDataDir?: string;
  carriedDependencies?: ReadonlyMap<string, Uint8Array>;
}): Promise<SeedPublishReport> => {
  const { client, gameDataDir = GAME_DATA_DIR, carriedDependencies } = options;
  let uploaded = 0;
  let carried = 0;
  let failed = 0;
  const objects: SeedObject[] = [];

  for (const filename of SEED_FILES) {
    const resolved =
      filename === ASSET_SEED_FILENAME
        ? resolveAssetSeedBody({ gameDataDir, carriedDependencies })
        : resolveSeedBody({ filename, gameDataDir, carriedDependencies });
    if (!resolved.ok) {
      failed++;
      console.error(`  ❌ seed: ${filename} ${resolved.reason}`);
      continue;
    }
    const stored = await storeSeedFile({
      client,
      filename,
      body: resolved.body,
      carried: resolved.carried,
    });
    if (!stored.ok) {
      failed++;
      console.warn(`  ⚠ seed: ${filename} upload failed — ${stored.error}`);
      continue;
    }
    objects.push(stored.object);
    const mergedFromCarried = 'mergedFromCarried' in resolved ? resolved.mergedFromCarried : 0;
    if (mergedFromCarried > 0) {
      uploaded++;
      console.log(
        `  📄 seed: ${filename} (${(resolved.body.length / 1024).toFixed(1)} KB, ` +
          `${mergedFromCarried} row(s) unioned from the previous release)`,
      );
    } else if (resolved.carried) {
      carried++;
      console.log(`  🔗 seed: ${filename} carried forward from the previous release`);
    } else {
      uploaded++;
      console.log(`  📄 seed: ${filename} (${(resolved.body.length / 1024).toFixed(1)} KB)`);
    }
  }

  if (failed > 0) {
    console.error(`❌ ${failed} required seed file(s) could not be supplied.`);
  }
  return { uploaded, carried, failed, objects };
};
