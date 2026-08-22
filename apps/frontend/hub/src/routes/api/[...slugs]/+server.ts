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

import { app } from '$lib/server/api';
import { setBetterAuthEnv } from '$lib/server/api/better_auth.ts';
import { setSaveBackupEnv } from '$lib/server/api/save_backup.ts';
import { setStorageEnv } from '$lib/server/api/storage.ts';

type RequestHandler = (v: {
  request: Request;
  cookies: import('@sveltejs/kit').Cookies;
  url: URL;
  platform?: App.Platform;
}) => Response | Promise<Response>;

export const fallback: RequestHandler = async ({ request, platform }) => {
  const env = platform?.env;
  // biome-ignore lint/style/useNamingConvention: Cloudflare binding names
  setBetterAuthEnv(env ? { DB: env.DB } : undefined);
  // biome-ignore lint/style/useNamingConvention: Cloudflare binding names
  setSaveBackupEnv(env ? { DB: env.DB, SAVES_BUCKET: env.SAVES_BUCKET } : undefined);
  // biome-ignore lint/style/useNamingConvention: Cloudflare binding names
  setStorageEnv(env ? { SAVES_BUCKET: env.SAVES_BUCKET } : undefined);

  return await app.handle(request);
};
