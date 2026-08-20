// scripts/src/lib/dist/config.ts
//
// Distribution-plane (R2 `aikami-dist`) publish configuration.
//
// Mirrors scripts/src/lib/catalog/config.ts but for the distribution bucket,
// which serves model weights and distribution artifacts (e.g. the vendored
// onnxruntime-web WASM) at dl.bearlysleeping.com. See
// docs/architecture/object-storage-layout.md §5.
//
// R2 write credentials come from scripts/.env.{mode} (populated by
// download_secrets.ts from GSM). Each R2 plane has its own bucket-scoped S3
// key; these must never appear in the hub's env (invariant I-7).
//
//   CLOUD_FLARE_DIST_BUCKET_ACCESS_KEY_ID      S3 access key id
//   CLOUD_FLARE_DIST_BUCKET_SECRET_ACCESS_KEY  S3 secret
//   CLOUD_FLARE_DIST_BUCKET_ENDPOINT           S3 endpoint
//   CLOUD_FLARE_DIST_BUCKET                    R2 bucket (default aikami-dist)

import { getScriptsEnv, initScriptsEnv } from '../env/scripts_env.ts';

/** Default R2 bucket for the distribution plane. */
export const DEFAULT_DIST_BUCKET = 'aikami-dist';

/** Public origin of the distribution plane — injected, never hardcoded. */
export const DIST_ORIGIN_ENV = 'DIST_ORIGIN_URL';

export type DistConfig = {
  /** S3 access key id. */
  accessKeyId: string;
  /** S3 secret access key. */
  secretAccessKey: string;
  /** S3 endpoint (https://<account>.r2.cloudflarestorage.com). */
  endpoint: string;
  /** R2 bucket name. */
  bucket: string;
  /** Public origin base URL — injected configuration. */
  originUrl: string;
};

/**
 * Resolve the distribution-plane configuration from the environment.
 *
 * @param mode - AIKAMI mode used to load scripts/.env.{mode} credentials.
 */
export const resolveDistConfig = (mode: string): DistConfig => {
  initScriptsEnv(mode);

  const accessKeyId = getScriptsEnv('CLOUD_FLARE_DIST_BUCKET_ACCESS_KEY_ID') ?? '';
  const secretAccessKey = getScriptsEnv('CLOUD_FLARE_DIST_BUCKET_SECRET_ACCESS_KEY') ?? '';
  const endpoint = getScriptsEnv('CLOUD_FLARE_DIST_BUCKET_ENDPOINT') ?? '';
  const bucket = getScriptsEnv('CLOUD_FLARE_DIST_BUCKET') ?? DEFAULT_DIST_BUCKET;
  const originUrlRaw = getScriptsEnv(DIST_ORIGIN_ENV) ?? '';

  const missing: string[] = [];
  if (!accessKeyId) {
    missing.push('CLOUD_FLARE_DIST_BUCKET_ACCESS_KEY_ID');
  }
  if (!secretAccessKey) {
    missing.push('CLOUD_FLARE_DIST_BUCKET_SECRET_ACCESS_KEY');
  }
  if (!endpoint) {
    missing.push('CLOUD_FLARE_DIST_BUCKET_ENDPOINT');
  }
  if (!originUrlRaw) {
    missing.push(DIST_ORIGIN_ENV);
  }
  if (missing.length > 0) {
    throw new Error(
      `Distribution publish config missing: ${missing.join(', ')}. ` +
        'Set them in scripts/.env.{mode} (see scripts/.env.example).',
    );
  }

  let originUrl: string;
  try {
    originUrl = new URL(originUrlRaw).toString().replace(/\/+$/, '');
  } catch {
    throw new Error(
      `Distribution publish config invalid: ${DIST_ORIGIN_ENV} is not a valid URL ` +
        `(${JSON.stringify(originUrlRaw)}). Set it in scripts/.env.{mode}.`,
    );
  }

  return { accessKeyId, secretAccessKey, endpoint, bucket, originUrl };
};
