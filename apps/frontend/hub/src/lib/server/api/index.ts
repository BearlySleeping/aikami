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

import { AssetStatsSchema, CategoryStatsSchema } from '@aikami/schemas';
import { Elysia, t } from 'elysia';
import { handleAsk } from './ask.ts';
import { handleCatalogStats } from './catalog_stats.ts';
import { handleDbHealth } from './health_db.ts';
import {
  getSaveBackupEnv,
  handleCreateBackup,
  handleGetBackup,
  handleListBackups,
} from './save_backup.ts';

// ─── Schemas (TypeBox) ───────────────────────────────────────────────

// GET /api/health/db — database reachability + version (C-394 AC-1).
// Unauthenticated on purpose; reports host only, never credentials.
const dbHealthResponseSchema = t.Union([
  t.Object({
    status: t.Literal('ok'),
    databaseVersion: t.String(),
    host: t.String(),
    roundTripMs: t.Number(),
  }),
  t.Object({
    status: t.Literal('unconfigured'),
  }),
  t.Object({
    status: t.Literal('unreachable'),
    host: t.Optional(t.String()),
  }),
]);

// GET /api/catalog/stats — streamed, Postgres-backed placeholder stats
// (C-396 AC-4). Public on purpose: anonymous visitors see exactly what
// signed-in visitors see on the catalog. Unconfigured/unreachable database
// resolves to `null` — never a 500.
const catalogStatsResponseSchema = t.Union([CategoryStatsSchema, AssetStatsSchema, t.Null()]);

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

export const app = new Elysia({
  prefix: '/api',
  // Cloudflare Workers disallow `new Function` (code generation from strings).
  // Elysia's AOT handler composition uses it, so disable AOT to use the
  // dynamic handler that runs on Workers.
  aot: false,
})
  // C-426 AC-4/AC-5: Better Auth (auth + device-authorization) is mounted in
  // dedicated SvelteKit catch-all routes (api/auth/[...auth], api/device/[...])
  // that forward straight to the Better Auth handler — NOT here, because
  // Elysia consumes the request body and locks the ReadableStream.
  .get('/health/db', handleDbHealth, {
    response: dbHealthResponseSchema,
  })
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
  .get('/catalog/stats', handleCatalogStats, {
    response: catalogStatsResponseSchema,
  })
  .post('/ask', handleAsk, {
    body: askRequestSchema,
    response: askResponseSchema,
  });

export type App = typeof app;
