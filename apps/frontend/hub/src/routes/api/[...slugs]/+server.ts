// src/routes/api/[...slugs]/+server.ts
//
// Mounts the Elysia internal API service. Every /api/* request that does
// not match a dedicated SvelteKit route is handled by the Elysia app
// (see src/lib/server/api/index.ts).
//
// 🔴 /api/internal_logging is NOT handled here — it has its own dedicated
// route (src/routes/api/internal_logging/+server.ts) which SvelteKit
// matches with higher priority than this catch-all.
//
// C-426 AC-3/AC-4: the Worker bindings (D1 + R2) are only available per
// request via `platform.env`. They are injected into the Better Auth /
// save-backup modules before handling so production requests initialize
// from the real DB. Better Auth (auth + device-authorization) is mounted
// inside the Elysia app via `.mount()` — see src/lib/server/api/index.ts.
// Better Auth sets its own session cookie directly on the response — no
// `__session` merge shim is needed (that was the old Firebase Hosting path,
// removed with the Firebase auth routes).

import { app, createApp, resolveGenerationRunnerEnv } from '$lib/server/api';
import { resolveAssetCommunityEnv } from '$lib/server/api/asset_community_env.ts';
import { resolveAssetThemeEnv } from '$lib/server/api/asset_themes_env.ts';
import { setBetterAuthEnv } from '$lib/server/api/better_auth.ts';
import { setCatalogStatsEnv } from '$lib/server/api/catalog_stats.ts';
import { setHealthDbEnv } from '$lib/server/api/health_db.ts';
import { setSaveBackupEnv } from '$lib/server/api/save_backup.ts';
import { setStorageEnv } from '$lib/server/api/storage.ts';
import { getWorkerEnv } from '$lib/server/worker_env.ts';

type RequestHandler = (v: {
  request: Request;
  cookies: import('@sveltejs/kit').Cookies;
  url: URL;
  platform?: App.Platform;
}) => Response | Promise<Response>;

export const fallback: RequestHandler = async ({ request }) => {
  // Bindings come from the adapter-agnostic accessor, not `platform` —
  // @sveltejs/adapter-cloudflare 8 never populates `event.platform` (see
  // src/lib/server/worker_env.ts).
  const env = getWorkerEnv();
  // biome-ignore lint/style/useNamingConvention: Cloudflare binding names
  setBetterAuthEnv(env ? { DB: env.DB } : undefined);
  // biome-ignore lint/style/useNamingConvention: Cloudflare binding names
  setCatalogStatsEnv(env ? { DB: env.DB } : undefined);
  // biome-ignore lint/style/useNamingConvention: Cloudflare binding names
  setHealthDbEnv(env ? { DB: env.DB } : undefined);
  // biome-ignore lint/style/useNamingConvention: Cloudflare binding names
  setSaveBackupEnv(env ? { DB: env.DB, SAVES_BUCKET: env.SAVES_BUCKET } : undefined);
  // biome-ignore lint/style/useNamingConvention: Cloudflare binding names
  setStorageEnv(env ? { SAVES_BUCKET: env.SAVES_BUCKET } : undefined);
  const isAccountDelete =
    request.method === 'DELETE' && new URL(request.url).pathname === '/api/account';
  const accountDeleteEnv = env
    ? {
        // biome-ignore lint/style/useNamingConvention: Cloudflare binding name
        DB: env.DB,
        // biome-ignore lint/style/useNamingConvention: Cloudflare binding name
        SAVES_BUCKET: env.SAVES_BUCKET,
      }
    : undefined;
  const mapStudioEnv = env
    ? {
        // biome-ignore lint/style/useNamingConvention: Cloudflare binding name
        DB: env.DB,
        // biome-ignore lint/style/useNamingConvention: Cloudflare binding name
        CATALOG_BUCKET: env.CATALOG_BUCKET,
      }
    : undefined;
  // C-513: the publish surface needs the D1 binding, the public catalog bucket
  // and the private intake bucket — resolved by the same helper the public
  // browse page uses. Missing any of them means the routes 503 rather than
  // half-work (the intake bucket is an ops prerequisite).
  const assetCommunityEnv = resolveAssetCommunityEnv(env);
  // C-530: the theme family needs the same bindings plus its publication gate.
  // 🔴 Resolved here, not inside `createApp`: the theme routes read
  // `options.assetThemeEnv`, so a request that never resolves it answers a bare
  // `asset_publishing_unconfigured` 503 and the whole `/api/assets/themes*`
  // family is unreachable in a real deployment.
  const assetThemeEnv = resolveAssetThemeEnv(env);
  // C-522: pairing/dispatch only needs D1. The private staging bucket is
  // optional on purpose — without it the runner is told `upload_disabled` and
  // results stay local-only, instead of the whole surface 503-ing.
  const generationRunnerEnv = resolveGenerationRunnerEnv(env);
  const requestApp =
    isAccountDelete || mapStudioEnv || assetCommunityEnv || assetThemeEnv || generationRunnerEnv
      ? createApp({
          accountDeleteEnv,
          mapStudioEnv,
          assetCommunityEnv,
          assetThemeEnv,
          generationRunnerEnv,
        })
      : app;
  return await requestApp.handle(request);
};

// 🔴 `fallback` is dispatched by SvelteKit for GET/HEAD/POST only (see
// `respond.js`'s `endpoint_can_handle`). Every other method must be exported
// explicitly or the request never reaches Elysia and answers a bare
// `405 Method Not Allowed` — which is exactly what happened to the C-513
// `PUT /api/assets/community/:slug/upload` route, and would have happened to
// C-530's `PUT /api/assets/themes/:slug/upload`.
export const GET = fallback;
export const POST = fallback;
export const PUT = fallback;
export const PATCH = fallback;
export const DELETE = fallback;
export const OPTIONS = fallback;
