// apps/frontend/hub/src/lib/server/api/index.ts
//
// Internal API service — Elysia + TypeBox.
// All routes are prefixed with `/api` and mounted via the SvelteKit
// catch-all route (src/routes/api/[...slugs]/+server.ts).
// The client consumes this server with the Eden treaty client
// (src/lib/client/services/api/internal.svelte.ts).
//
// C-426 AC-4: auth is served entirely by Better Auth (mounted at /api/auth/*,
// backed by D1). The Firebase Auth routes (/api/auth/session, /api/auth/action,
// /api/auth/poll-device-handoff) were removed — the hub no longer touches
// firebase-admin.
//
// Better Auth (auth + device-authorization) is mounted here via Elysia's
// `.mount()`, which runs the handler BEFORE Elysia parses the request body
// (config.mount short-circuits in dynamic-handle). This lets the Better Auth
// fetch handler read the raw body — the reason auth previously lived in
// dedicated SvelteKit routes (api/auth/[...auth], api/device/[...device]).
// With `.mount()` everything is consolidated into this single Elysia app,
// mounted at /api/[...slugs].

import { AssetStatsSchema, CategoryStatsSchema } from '@aikami/schemas';
import { Elysia, t } from 'elysia';
import { handleAsk } from './ask.ts';
import { getBetterAuth } from './better_auth.ts';
import { getCatalogStatsEnv, handleCatalogStats } from './catalog_stats.ts';
import { getHealthDbEnv, handleDbHealth } from './health_db.ts';
import {
  getSaveBackupEnv,
  handleCreateBackup,
  handleGetBackup,
  handleListBackups,
} from './save_backup.ts';
import { getStorageEnv, handleStorageUpload, handleStorageUrl } from './storage.ts';

// ─── Schemas (TypeBox) ───────────────────────────────────────────────

// GET /api/health/db — D1 binding reachability (C-436 AC-4).
// Unauthenticated on purpose; reports only status and round-trip time.
const dbHealthResponseSchema = t.Union([
  t.Object({
    status: t.Literal('ok'),
    roundTripMs: t.Number(),
  }),
  t.Object({
    status: t.Literal('unconfigured'),
  }),
  t.Object({
    status: t.Literal('unreachable'),
  }),
]);

// GET /api/catalog/stats — streamed, Postgres-backed placeholder stats
// (C-396 AC-4). Public on purpose: anonymous visitors see exactly what
// signed-in visitors see on the catalog. Unconfigured/unreachable database
// resolves to `null` — never a 500.
const catalogStatsResponseSchema = t.Union([
  CategoryStatsSchema,
  AssetStatsSchema,
  t.Null(),
] as unknown as Parameters<typeof t.Union>[0]); // guard-ignore lint/type-safety/casting: t.Union variadic parameter type limitation in TypeBox

// POST /api/ask — the one route in this file meant for a THIRD-PARTY origin
// (the static landing page, apps/frontend/site) rather than the hub's own
// client — see hooks.server.ts's narrowly-scoped CORS allowance for it.
const askRequestSchema = t.Object({ question: t.String({ minLength: 1, maxLength: 2000 }) });
const askResponseSchema = t.Union([
  t.Object({ answer: t.String() }),
  t.Object({
    error: t.Union([t.Literal('unconfigured'), t.Literal('rate_limited'), t.Literal('failed')]),
  }),
]);
// C-426 AC-4/AC-5: Better Auth (auth + device-authorization) is mounted here
// via `.mount()`. The mount handler runs before Elysia parses the body, so the
// Better Auth fetch handler receives the raw request (body intact). The D1
// binding is injected per-request by the catch-all route before `app.handle`,
// so `getBetterAuth()` resolves lazily here. 503 when auth is unconfigured.
//
// The device-authorization plugin's endpoints live under the Better Auth base
// path (/api/auth/device/*), so a single `/auth` mount serves both auth and
// device flows — no separate `/device` mount is needed.
const betterAuthHandler = (request: Request): Response | Promise<Response> => {
  const auth = getBetterAuth();
  if (!auth) {
    return new Response(JSON.stringify({ error: 'auth_unconfigured' }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    });
  }
  return auth.handler(request);
};

export const app = new Elysia({
  prefix: '/api',
  // Cloudflare Workers disallow `new Function` (code generation from strings).
  // Elysia's AOT handler composition uses it, so disable AOT to use the
  // dynamic handler that runs on Workers.
  aot: false,
})
  .mount('/auth', betterAuthHandler)
  .get(
    '/health/db',
    () => {
      const env = getHealthDbEnv();
      if (!env) {
        return { status: 'unconfigured' as const };
      }
      return handleDbHealth();
    },
    {
      response: dbHealthResponseSchema,
    },
  )
  // C-426 AC-6/AC-7: Turso save backup/restore to R2, session-gated.
  // 503 when the hub is not yet on a Worker with the SAVES_BUCKET binding.
  .post('/saves/backup', ({ request }) => {
    const env = getSaveBackupEnv();
    if (!env) {
      return new Response(JSON.stringify({ error: 'saves_unconfigured' }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      });
    }
    return handleCreateBackup(request, env);
  })
  .get('/saves', ({ request }) => {
    const env = getSaveBackupEnv();
    if (!env) {
      return new Response(JSON.stringify({ error: 'saves_unconfigured' }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      });
    }
    return handleListBackups(request, env);
  })
  .get('/saves/:id', ({ request, params }) => {
    const env = getSaveBackupEnv();
    if (!env) {
      return new Response(JSON.stringify({ error: 'saves_unconfigured' }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      });
    }
    return handleGetBackup(request, env, params.id);
  })
  // C-426: R2 object storage (avatars, etc.), session-gated. 503 when the
  // hub is not yet on a Worker with the SAVES_BUCKET binding.
  .post('/storage/upload', ({ request }) => {
    const env = getStorageEnv();
    if (!env) {
      return new Response(JSON.stringify({ error: 'storage_unconfigured' }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      });
    }
    return handleStorageUpload(request, env);
  })
  .get('/storage/url', ({ request }) => {
    const env = getStorageEnv();
    if (!env) {
      return new Response(JSON.stringify({ error: 'storage_unconfigured' }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      });
    }
    return handleStorageUrl(request, env);
  })
  .get(
    '/catalog/stats',
    () => {
      const env = getCatalogStatsEnv();
      if (!env) {
        return new Response(JSON.stringify(null), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return handleCatalogStats().then(
        (result) =>
          new Response(JSON.stringify(result), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      );
    },
    {
      response: catalogStatsResponseSchema,
    },
  )
  .post('/ask', handleAsk, {
    body: askRequestSchema,
    response: askResponseSchema,
  });

export type App = typeof app;
