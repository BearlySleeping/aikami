// apps/frontend/hub/src/routes/(public)/community/[category]/+page.server.ts
//
// One category's public community-asset browse page (C-513 AC-4).
//
// Community assets are member submissions. Only an approved + promoted
// revision is ever rendered, because the listing query is the *same* helper the
// JSON route uses (`listCommunityAssets`) — the two surfaces cannot drift on
// visibility, and a pending or rejected row has no path into this HTML.
//
// Degraded mode: a deployment without the private intake binding serves an
// explicit 503 with a fixed message — never a 500 and never a silently empty
// grid (the contract's Quality Requirements: "Neither is a 500").

import { CatalogCategorySchema } from '@aikami/schemas';
import { error } from '@sveltejs/kit';
import { Value } from 'typebox/value';
import { catalogCategoryLabel } from '$lib/constants/catalog_labels.ts';
import { listCommunityAssets, parseCommunityAssetCursor } from '$lib/server/api/asset_community.ts';
import { resolveAssetCommunityEnv } from '$lib/server/api/asset_community_env.ts';
import { getWorkerEnv } from '$lib/server/worker_env.ts';
import type { CommunityCategoryPageData } from '$types';
import type { PageServerLoad } from './$types';

/** Rows per page. The JSON listing caps at 100; 48 mirrors the catalog grid. */
const COMMUNITY_PAGE_SIZE = 48;

export const load: PageServerLoad = async ({ params, url, setHeaders, depends }) => {
  depends('community:category');

  // Unknown category ⇒ 404, checked before the binding: a request for a
  // category that cannot exist is a bad URL, not a deployment problem.
  // Validated against the same schema the reserve route enforces, so the browsable
  // set and the publishable set can never disagree.
  if (!Value.Check(CatalogCategorySchema, params.category)) {
    error(404, `Category "${params.category}" was not found.`);
  }

  // The cursor is part of the request shape, so it is validated before the
  // binding: a bad link is a bad link whether or not this deployment can serve
  // community assets at all.
  const rawCursor = url.searchParams.get('cursor');
  const cursor = rawCursor === null ? undefined : parseCommunityAssetCursor(rawCursor);
  if (rawCursor !== null && cursor === undefined) {
    error(400, 'That page link is not valid.');
  }

  const env = resolveAssetCommunityEnv(getWorkerEnv());
  if (!env) {
    // The intake plane is an ops prerequisite, not a boot dependency — degrade
    // to an explicit 503 rather than attempting a query without a DB binding.
    error(503, 'Community assets are unavailable in this deployment.');
  }

  const listing = await listCommunityAssets({
    env,
    category: params.category,
    limit: COMMUNITY_PAGE_SIZE,
    ...(cursor === undefined ? {} : { cursor }),
  });

  // Set before returning: the headers are already sent once the response
  // streams, and a public browse page is CDN-cacheable.
  setHeaders({ 'cache-control': 'public, max-age=60' });

  return {
    category: params.category,
    categoryLabel: catalogCategoryLabel(params.category),
    assets: listing.items,
    ...(listing.nextCursor === undefined ? {} : { nextCursor: listing.nextCursor }),
  } satisfies CommunityCategoryPageData;
};
