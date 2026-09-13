// apps/frontend/hub/src/lib/server/api/asset_community_env.ts
//
// C-513: builds the community-asset environment from a request's Worker
// bindings.
//
// Shared by the JSON API fallback (`routes/api/[...slugs]/+server.ts`) and the
// public browse page (`routes/(public)/community/[category]/+page.server.ts`),
// so both surfaces resolve the intake plane identically. A page that built its
// own environment could disagree with the API about whether publishing is
// configured — and then serve a list the API would refuse to produce.

import { CATALOG_ORIGIN_URL, MODERATION_ACCOUNT_IDS } from '$app/env/private';
import type { AssetCommunityEnv } from './asset_community.ts';

/**
 * Resolves the community-asset environment.
 *
 * @returns The environment, or undefined when the intake binding (or the
 * DB/catalog pair) is absent. Undefined is not an error: publishing is additive
 * and never a boot dependency, so callers degrade — a 503 from the API, a 503
 * page surface — rather than 500.
 */
export const resolveAssetCommunityEnv = (
  env: App.Platform['env'] | undefined,
): AssetCommunityEnv | undefined => {
  if (!env?.DB || !env.CATALOG_BUCKET || !env.UPLOADS_BUCKET) {
    return undefined;
  }
  return {
    // biome-ignore lint/style/useNamingConvention: Cloudflare binding name
    DB: env.DB,
    // biome-ignore lint/style/useNamingConvention: Cloudflare binding name
    CATALOG_BUCKET: env.CATALOG_BUCKET,
    // biome-ignore lint/style/useNamingConvention: Cloudflare binding name
    UPLOADS_BUCKET: env.UPLOADS_BUCKET,
    moderationAccountIds: (MODERATION_ACCOUNT_IDS ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0),
    ...(CATALOG_ORIGIN_URL ? { catalogOriginUrl: CATALOG_ORIGIN_URL } : {}),
  };
};
