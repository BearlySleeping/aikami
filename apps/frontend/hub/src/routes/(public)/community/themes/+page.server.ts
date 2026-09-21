// apps/frontend/hub/src/routes/(public)/community/themes/+page.server.ts
//
// The public theme listing page (C-530 AC-3).
//
// A static route resolves ahead of the sibling `[category]` dynamic route, so
// `/community/themes` is this page and never the community-asset browse page
// for a category called "themes" — which is exactly why a theme is not a
// `CatalogCategory`.
//
// 🔴 Degraded mode is a *page state*, not a 503. The community-asset browse
// page 503s because an empty grid there would be a lie; here the visitor is
// told plainly that discovery is unavailable and that installed themes keep
// working — which is true and actionable.

import { error } from '@sveltejs/kit';
import { resolveAssetThemeEnv } from '$lib/server/api/asset_themes_env.ts';
import { listThemeVersions, parseThemeVersionCursor } from '$lib/server/api/asset_themes_shared.ts';
import { getWorkerEnv } from '$lib/server/worker_env.ts';
import type { ThemeListingPageData } from '$types';
import type { PageServerLoad } from './$types';

/** Rows per page. The JSON listing caps at 100; 24 mirrors the catalog grid. */
const THEME_PAGE_SIZE = 24;

export const load: PageServerLoad = async ({ url, setHeaders }) => {
  // The cursor is part of the request shape, so it is validated before the
  // binding: a bad link is a bad link whether or not this deployment can serve
  // themes at all.
  const rawCursor = url.searchParams.get('cursor');
  const cursor = rawCursor === null ? undefined : parseThemeVersionCursor(rawCursor);
  if (rawCursor !== null && cursor === undefined) {
    error(400, 'That page link is not valid.');
  }

  // The visual runner always supplies `screenshot=true`. Its state selector is
  // intentionally inert for ordinary visits, while still making empty and
  // degraded captures independent of whichever rows happen to be in local D1.
  const visualState =
    url.searchParams.get('screenshot') === 'true'
      ? (url.searchParams.get('state') ?? undefined)
      : undefined;
  if (visualState === 'degraded') {
    return { themes: [], degraded: true } satisfies ThemeListingPageData;
  }
  if (visualState === 'empty') {
    return { themes: [], degraded: false } satisfies ThemeListingPageData;
  }

  const env = resolveAssetThemeEnv(getWorkerEnv());
  if (!env?.themePublishingEnabled) {
    // Not an error: a deployment without the intake binding (or with the
    // feature gate off) still serves a useful page.
    return {
      themes: [],
      degraded: true,
    } satisfies ThemeListingPageData;
  }

  const listing = await listThemeVersions({
    env,
    limit: THEME_PAGE_SIZE,
    ...(cursor === undefined ? {} : { cursor }),
  });

  // Set before returning: the headers are already sent once the response
  // streams, and a public browse page is CDN-cacheable.
  setHeaders({ 'cache-control': 'public, max-age=60' });

  return {
    themes: listing.items,
    degraded: false,
    ...(listing.nextCursor === undefined ? {} : { nextCursor: listing.nextCursor }),
  } satisfies ThemeListingPageData;
};
