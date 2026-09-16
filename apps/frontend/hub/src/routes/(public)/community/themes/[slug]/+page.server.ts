// apps/frontend/hub/src/routes/(public)/community/themes/[slug]/+page.server.ts
//
// One theme version's public detail page (C-530 AC-3 / AC-4).
//
// The row comes from the *same* visibility query the JSON route uses
// (`readVisibleThemeVersion`), so the page and the API cannot disagree about
// which versions are public: a pending, rejected or revoked version is a 404
// here, exactly as it is there.
//
// `?version=` pins an exact immutable version. Without it the newest visible
// version is shown — which is the one a visitor arriving from the listing
// already chose, since the listing links with the version attached.

import { THEME_ID_PATTERN, THEME_VERSION_PATTERN } from '@aikami/constants';
import { error } from '@sveltejs/kit';
import { getSessionUserId } from '$lib/server/api/asset_community_shared.ts';
import { resolveAssetThemeEnv } from '$lib/server/api/asset_themes_env.ts';
import { readVisibleThemeVersion, toThemeDetail } from '$lib/server/api/asset_themes_shared.ts';
import { getWorkerEnv } from '$lib/server/worker_env.ts';
import type { ThemeDetailPageData } from '$types';
import type { PageServerLoad } from './$types';

const THEME_ID_RE = new RegExp(THEME_ID_PATTERN);
const THEME_VERSION_RE = new RegExp(THEME_VERSION_PATTERN);

export const load: PageServerLoad = async ({ params, url, request, setHeaders }) => {
  // A malformed id or version is a bad URL, not a deployment problem.
  if (!THEME_ID_RE.test(params.slug)) {
    error(404, `Theme "${params.slug}" was not found.`);
  }
  const rawVersion = url.searchParams.get('version');
  if (rawVersion !== null && !THEME_VERSION_RE.test(rawVersion)) {
    error(400, 'That version link is not valid.');
  }

  const env = resolveAssetThemeEnv(getWorkerEnv());
  if (!env?.themePublishingEnabled) {
    error(503, 'Themes are unavailable in this deployment.');
  }

  const accountId = await getSessionUserId(request);
  const row = await readVisibleThemeVersion({
    env,
    themeId: params.slug,
    ...(rawVersion === null ? {} : { version: rawVersion }),
    ...(accountId === undefined ? {} : { accountId }),
  });
  if (!row) {
    error(404, `Theme "${params.slug}" was not found.`);
  }

  const isOwner = accountId !== undefined && row.ownerAccountId === accountId;
  setHeaders({ 'cache-control': isOwner ? 'private, no-store' : 'public, max-age=60' });

  return {
    detail: toThemeDetail({ row, isOwner, env }),
    isOwner,
  } satisfies ThemeDetailPageData;
};
