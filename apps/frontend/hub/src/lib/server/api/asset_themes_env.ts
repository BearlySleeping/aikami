// apps/frontend/hub/src/lib/server/api/asset_themes_env.ts
//
// C-530 AC-9 — the theme-publishing environment, including its feature gate.
//
// The theme surface reuses the C-513 bindings verbatim (same D1, same private
// intake bucket, same content-addressed catalog bucket, same moderator list,
// same server-owned rights resolver) and adds exactly one thing: the gate.
//
// 🔴 The gate is a *publication* switch, not a boot dependency. With it off the
// new entry points are hidden and new publishes are refused; approved versions
// stay in D1 and in R2, and a player's locally installed pack is untouched —
// the client never consults this value.

import { THEME_PUBLISHING_ENABLED } from '$app/env/private';
import { resolveAssetCommunityEnv } from './asset_community_env.ts';
import type { AssetCommunityEnv } from './asset_community_shared.ts';

/** Bindings + configuration the theme routes need. */
export type AssetThemeEnv = AssetCommunityEnv & {
  /** False ⇒ new publishes and the discovery surfaces are disabled. */
  themePublishingEnabled: boolean;
};

/** Resolves the theme environment, or undefined when the intake plane is absent. */
export const resolveAssetThemeEnv = (
  env: App.Platform['env'] | undefined,
): AssetThemeEnv | undefined => {
  const base = resolveAssetCommunityEnv(env);
  if (!base) {
    return undefined;
  }
  return { ...base, themePublishingEnabled: (THEME_PUBLISHING_ENABLED ?? '1') !== '0' };
};
