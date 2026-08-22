// src/routes/api/device/[...device]/+server.ts
//
// C-426 AC-5: forwards Better Auth device-authorization requests
// (device/code, device/token, device/approve, …) straight to the Better Auth
// handler, bypassing the Elysia app (which would consume the request body and
// lock the ReadableStream). SvelteKit matches this route with higher priority
// than the /api/[...slugs] catch-all.

import { getBetterAuth, setBetterAuthEnv } from '$lib/server/api/better_auth.ts';

type RequestHandler = (v: {
  request: Request;
  platform?: App.Platform;
}) => Response | Promise<Response>;

export const fallback: RequestHandler = async ({ request, platform }) => {
  const env = platform?.env;
  // biome-ignore lint/style/useNamingConvention: Cloudflare D1 binding name
  setBetterAuthEnv(env ? { DB: env.DB } : undefined);
  const auth = getBetterAuth();
  if (!auth) {
    return new Response(JSON.stringify({ error: 'auth_unconfigured' }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    });
  }
  return auth.handler(request);
};
