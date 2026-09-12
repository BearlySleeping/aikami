// apps/frontend/client/src/lib/services/assets/asset_generation_flag.ts
//
// `PUBLIC_ASSET_GENERATION` — the C-510 kill switch for the local
// generated-asset write seam.
//
// Kill-switch semantics: the feature is on by default and is disabled only by
// an explicit falsy value. When off, `assetManager.registerGenerated` is a
// no-op and the existing demo/placeholder path is unchanged; the
// `generate:asset` CLI stays available to developers.
//
// Declared in `env.d.ts` alongside `PUBLIC_IMAGE_ENGINE` so it is typed rather
// than `import.meta.env`-splatted.
//
// Contract: C-510 AC-4 / Migration & Rollback

import { PUBLIC_ASSET_GENERATION } from '$app/env/public';

/** Values that switch the write seam off. */
const DISABLED_VALUES = new Set(['false', '0', 'off', 'no', '']);

/**
 * Whether the local generated-asset write seam is enabled.
 *
 * @returns True unless `PUBLIC_ASSET_GENERATION` is explicitly falsy.
 */
export const isAssetGenerationEnabled = (): boolean => {
  const raw = PUBLIC_ASSET_GENERATION;
  if (raw === undefined) {
    return true;
  }
  return !DISABLED_VALUES.has(raw.trim().toLowerCase());
};
