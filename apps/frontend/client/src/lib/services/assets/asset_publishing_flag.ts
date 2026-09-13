// apps/frontend/client/src/lib/services/assets/asset_publishing_flag.ts
//
// `PUBLIC_ASSET_PUBLISHING` — the C-513 kill switch for the community publish
// surface.
//
// Kill-switch semantics (same as C-510's generation flag): on by default,
// disabled only by an explicit falsy value. When off, the Creator Studio hides
// the publish action entirely — nothing about local creation or use changes,
// because publishing is the only online operation in this feature.
//
// Contract: C-513 (Migration & Rollback)

import { PUBLIC_ASSET_PUBLISHING } from '$app/env/public';

/** Values that switch the publish surface off. */
const DISABLED_VALUES = new Set(['false', '0', 'off', 'no', '']);

/**
 * Whether publishing an asset to the community namespace is enabled.
 *
 * @returns True unless `PUBLIC_ASSET_PUBLISHING` is explicitly falsy.
 */
export const isAssetPublishingEnabled = (): boolean => {
  const raw = PUBLIC_ASSET_PUBLISHING;
  if (raw === undefined) {
    return true;
  }
  return !DISABLED_VALUES.has(raw.trim().toLowerCase());
};
