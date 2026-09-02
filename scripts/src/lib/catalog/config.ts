// scripts/src/lib/catalog/config.ts
//
// Catalog publish configuration (C-395).
//
// R2 write credentials come from scripts/.env.{mode} (populated by
// decrypt_secrets.ts) — they belong to the publish pipeline, NOT
// to the hub: the hub never writes to R2 (invariant I-7), so they must never
// appear in apps/frontend/hub/.env.* where buildSecretArgsFromEnvFile would
// ship them to Cloud Run.
//
//   CLOUD_FLARE_CATALOG_BUCKET_ACCESS_KEY_ID      S3 access key id
//   CLOUD_FLARE_CATALOG_BUCKET_SECRET_ACCESS_KEY  S3 secret
//   CLOUD_FLARE_CATALOG_BUCKET_ENDPOINT           S3 endpoint (https://<account>.r2.cloudflarestorage.com)
//
// `originUrl` is INJECTED configuration — never a constant, never a
// hardcoded hostname in code or fixtures. The public origin is
// https://assets.bearlysleeping.com, but the first-commit rule (Open
// Question 1) forbids hardcoding it; re-pointing later must only regenerate
// the index (zero re-uploads, objects are content-addressed).

import { resolve } from 'node:path';
import { AUDIO_MIME_MAP, IMAGE_MIME_MAP, R2_BUCKETS } from '@aikami/constants';
import { getScriptsEnv, initScriptsEnv } from '../env/scripts_env.ts';

// ---------------------------------------------------------------------------
// Bucket / index layout constants
// ---------------------------------------------------------------------------

/**
 * Default R2 bucket for the catalog origin. Override via CATALOG_BUCKET env var.
 * C-454: mode-aware resolution from R2_BUCKETS.catalog.
 * Returns 'aikami-catalog' for production, 'aikami-staging-catalog' for staging,
 * and falls back to 'aikami-catalog' for emulator/testing (local-only).
 */
export const resolveDefaultCatalogBucket = (mode: string): string =>
  R2_BUCKETS.catalog[mode as keyof typeof R2_BUCKETS.catalog]?.bucketName ?? 'aikami-catalog';

/** Asset object key prefix (content-addressed, immutable). */
export const ASSET_KEY_PREFIX = 'assets/';

/** Index object key prefix (mutable, short cache). */
export const INDEX_KEY_PREFIX = 'index/v1/';

/** Root index object key. */
export const ROOT_INDEX_KEY = `${INDEX_KEY_PREFIX}catalog.json`;

/**
 * Cache-control constants moved to @aikami/schemas (C-454).
 * Re-exported for backward compatibility during migration.
 *
 * TODO(C-454): Update callers to import from @aikami/schemas directly,
 * then remove these re-exports.
 */
export {
  ASSET_CACHE_CONTROL,
  INDEX_CACHE_CONTROL,
  SEED_CACHE_CONTROL,
} from '@aikami/schemas';

/**
 * Seed/metadata object key prefix (mutable, short cache).
 * Published alongside content-addressed assets so the client can fetch the
 * compact boot seed, offline-core declaration, credits, and audio metadata
 * from the same origin (C-435 follow-up).
 */
export const SEED_KEY_PREFIX = 'seed/';

// ---------------------------------------------------------------------------
// MIME types — the existing maps in @aikami/constants are the source of truth
// ---------------------------------------------------------------------------

const EXTRA_MIME: Record<string, string> = {
  '.json': 'application/json',
  '.webm': 'audio/webm',
};

/** Content-Type for a file extension (lowercase, dot included). */
export const contentTypeForExt = (ext: string): string =>
  IMAGE_MIME_MAP[ext] ?? AUDIO_MIME_MAP[ext] ?? EXTRA_MIME[ext] ?? 'application/octet-stream';

// ---------------------------------------------------------------------------
// Config resolution
// ---------------------------------------------------------------------------

export type CatalogConfig = {
  /** S3 access key id. */
  accessKeyId: string;
  /** S3 secret access key. */
  secretAccessKey: string;
  /** S3 endpoint (https://<account>.r2.cloudflarestorage.com). */
  endpoint: string;
  /** R2 bucket name. */
  bucket: string;
  /** Public origin base URL — injected configuration, never hardcoded. */
  originUrl: string;
};

/**
 * Resolve the catalog publish configuration from the environment.
 *
 * @param mode - AIKAMI mode used to load scripts/.env.{mode} credentials.
 */
export const resolveCatalogConfig = (mode: string): CatalogConfig => {
  initScriptsEnv(mode);

  const accessKeyId = getScriptsEnv('CLOUD_FLARE_CATALOG_BUCKET_ACCESS_KEY_ID') ?? '';
  const secretAccessKey = getScriptsEnv('CLOUD_FLARE_CATALOG_BUCKET_SECRET_ACCESS_KEY') ?? '';
  const endpoint = getScriptsEnv('CLOUD_FLARE_CATALOG_BUCKET_ENDPOINT') ?? '';
  const originUrlRaw = getScriptsEnv('CATALOG_ORIGIN_URL') ?? '';
  // C-454: CATALOG_BUCKET env var override takes precedence (local testing),
  // otherwise resolve from R2_BUCKETS.catalog by mode.
  const bucket = getScriptsEnv('CATALOG_BUCKET') ?? resolveDefaultCatalogBucket(mode);

  const missing: string[] = [];
  if (!accessKeyId) {
    missing.push('CLOUD_FLARE_CATALOG_BUCKET_ACCESS_KEY_ID');
  }
  if (!secretAccessKey) {
    missing.push('CLOUD_FLARE_CATALOG_BUCKET_SECRET_ACCESS_KEY');
  }
  if (!endpoint) {
    missing.push('CLOUD_FLARE_CATALOG_BUCKET_ENDPOINT');
  }
  if (!originUrlRaw) {
    missing.push('CATALOG_ORIGIN_URL');
  }
  if (missing.length > 0) {
    throw new Error(
      `Catalog publish config missing: ${missing.join(', ')}. ` +
        'Set them in scripts/.env.{mode} (see scripts/.env.example).',
    );
  }

  // Validate + canonicalize the origin: new URL() rejects malformed or
  // protocol-less values, and trailing slashes are stripped so index
  // generation produces single-slash asset URLs (no double slashes when the
  // consumer joins originUrl with a hash).
  let originUrl: string;
  try {
    originUrl = new URL(originUrlRaw).toString().replace(/\/+$/, '');
  } catch {
    throw new Error(
      `Catalog publish config invalid: CATALOG_ORIGIN_URL is not a valid URL ` +
        `(${JSON.stringify(originUrlRaw)}). Set it in scripts/.env.{mode} (see scripts/.env.example).`,
    );
  }

  return {
    accessKeyId,
    secretAccessKey,
    endpoint,
    bucket,
    originUrl,
  };
};

// ---------------------------------------------------------------------------
// Repo paths
// ---------------------------------------------------------------------------

/** Monorepo root (scripts/src/lib/catalog → 4 levels up). */
export const REPO_ROOT = resolve(import.meta.dirname, '../../../../');

/** Bundled game-data directory that the publish pipeline reads. */
export const GAME_DATA_DIR = resolve(REPO_ROOT, 'apps/frontend/client/static/game-data');

/** Content-packs directory (C-433: outside the game-data tree). */
export const CONTENT_PACKS_DIR = resolve(REPO_ROOT, 'content/packs');

/**
 * All scan roots the publish pipeline reads from.
 * C-433: widened from a single game-data dir to include content-packs.
 */
export type AssetScanRoot = {
  /** Absolute path to walk. */
  dir: string;
  /** Public path prefix, e.g. "/game-data" or "/content-packs". */
  urlPrefix: string;
};

export const SCAN_ROOTS: AssetScanRoot[] = [
  { dir: GAME_DATA_DIR, urlPrefix: '/game-data' },
  { dir: CONTENT_PACKS_DIR, urlPrefix: '/content-packs' },
];
