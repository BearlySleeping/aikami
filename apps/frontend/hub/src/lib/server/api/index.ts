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
import { type AccountDeleteEnv, handleAccountDeleteRequest } from './account_delete.ts';
import { handleRevokeAllSessions } from './account_sessions.ts';
import { handleAsk } from './ask.ts';
import {
  type AssetCommunityEnv,
  handleCommunityAssetCounters,
  handleGetCommunityAsset,
  handleListCommunityAssets,
  handleReserveCommunityAsset,
  handleUploadCommunityAsset,
} from './asset_community.ts';
import {
  handleCommunityAssetRaw,
  handleDeleteCommunityAsset,
  handleModerateCommunityAsset,
} from './asset_community_moderation.ts';
import {
  handleGetThemeVersion,
  handleListThemeVersions,
  handleReserveThemeVersion,
  handleThemeCounters,
  handleThemeVersionPublic,
  handleThemeVersionRaw,
  handleUploadThemeVersion,
} from './asset_themes.ts';
import type { AssetThemeEnv } from './asset_themes_env.ts';
import {
  handleModerateThemeVersion,
  handleRevokeThemeVersion,
} from './asset_themes_moderation.ts';
import {
  handleGetArtifactRaw,
  handleListArtifacts,
  handleRequestArtifactTicket,
  handleUploadArtifact,
} from './asset_generation_artifacts.ts';
import {
  handleCreateDispatch,
  handleGetDispatch,
  handleListDispatches,
  handleRequestDispatchCancel,
} from './asset_generation_dispatch.ts';
import {
  type GenerationRunnerEnv,
  handleClaimDispatch,
  handleCreatePairingCode,
  handleListRunners,
  handlePairRunner,
  handleRevokeRunner,
  handleRunnerAvailability,
  handleSetRunnerArtifactUpload,
  handleUpdateStatus,
  resolveGenerationRunnerEnv,
} from './asset_generation_runner.ts';
import {
  handleListCandidates,
  handleRecordCandidate,
  handleReviewCandidate,
} from './asset_generation_seam.ts';
import { getBetterAuth } from './better_auth.ts';
import { getCatalogStatsEnv, handleCatalogStats } from './catalog_stats.ts';
import { getHealthDbEnv, handleDbHealth } from './health_db.ts';
import {
  handleCreateDraft,
  handleDeleteDraft,
  handleGetCommunityMap,
  handleGetDraft,
  handleListCommunityMaps,
  handleListDrafts,
  handlePublishCommunityMap,
  handleUpdateDraft,
  type MapStudioEnv,
} from './map_studio.ts';
import {
  getSaveBackupEnv,
  handleCreateBackup,
  handleDeleteBackup,
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

/** 503 body for map-studio routes when the Worker bindings are absent. */
const mapStudioUnconfigured = (): Response =>
  new Response(JSON.stringify({ error: 'map_studio_unconfigured' }), {
    status: 503,
    headers: { 'content-type': 'application/json' },
  });

/**
 * 503 body for community-asset routes when the private intake binding (or the
 * DB) is absent. Publishing is additive and never a boot dependency, so the
 * surface degrades here rather than 500s.
 */
const assetPublishingUnconfigured = (): Response =>
  new Response(JSON.stringify({ error: 'asset_publishing_unconfigured' }), {
    status: 503,
    headers: { 'content-type': 'application/json' },
  });

/**
 * 503 body for the generation-runner routes when D1 is absent.
 *
 * A named code rather than a bare `*_unconfigured`, so the Creator Studio can
 * distinguish "this deployment has no generation store" from "you have not
 * paired a device" and say the right thing.
 */
const generationRunnerUnconfigured = (): Response =>
  new Response(JSON.stringify({ error: 'runner_unconfigured', code: 'runner_unconfigured' }), {
    status: 503,
    headers: { 'content-type': 'application/json' },
  });

/**
 * 🔴 Load-bearing. Elysia parses an `application/octet-stream` body into an
 * ArrayBuffer *before* the route handler runs, which both defeats the
 * `Content-Length` pre-check AC-1 requires (the whole body would already be in
 * memory) and leaves the request stream unreadable (`Body already used`).
 *
 * Returning a truthy sentinel from a `parse` hook short-circuits Elysia's
 * default body parser without touching the stream, so the upload handler owns
 * the raw request. C-426's `/storage/upload` only works today because the
 * client's `File` body carries an exotic content type that Elysia does not
 * have a parser for — an accident this route does not rely on.
 */
const handleRawBody = (): { raw: true } => ({ raw: true });

/** Creates the API app with bindings captured from one request. */
export const createApp = (
  options: {
    accountDeleteEnv?: AccountDeleteEnv;
    mapStudioEnv?: MapStudioEnv;
    assetCommunityEnv?: AssetCommunityEnv;
    /** C-530: the theme surface reuses the community bindings plus its gate. */
    assetThemeEnv?: AssetThemeEnv;
    generationRunnerEnv?: GenerationRunnerEnv;
  } = {},
) =>
  new Elysia({
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
    .delete('/saves/:id', ({ request, params }) => {
      const env = getSaveBackupEnv();
      if (!env) {
        return new Response(JSON.stringify({ error: 'saves_unconfigured' }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        });
      }
      return handleDeleteBackup(request, env, params.id);
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
    // C-464 AC-3/4/5/6: Session-verified account deletion.
    // 503 when the hub is not yet on a Worker with the SAVES_BUCKET binding.
    .delete('/account', ({ request }) => {
      if (!options.accountDeleteEnv) {
        return new Response(JSON.stringify({ error: 'account_unconfigured' }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        });
      }
      return handleAccountDeleteRequest(request, options.accountDeleteEnv);
    })
    // C-464 AC-10: Revoke all sessions through Better Auth's session API.
    .post('/account/sessions/revoke-all', ({ request }) => handleRevokeAllSessions(request))
    // C-508: Map Studio Phase 3 — per-user drafts (session-gated) and the
    // public community map namespace. 503 when the hub has no DB/catalog bucket.
    .get('/maps/drafts', ({ request }) => {
      const env = options.mapStudioEnv;
      return env ? handleListDrafts(request, env) : mapStudioUnconfigured();
    })
    .post('/maps/drafts', ({ request, body }) => {
      const env = options.mapStudioEnv;
      return env ? handleCreateDraft(request, env, body) : mapStudioUnconfigured();
    })
    .get('/maps/drafts/:id', ({ request, params }) => {
      const env = options.mapStudioEnv;
      return env ? handleGetDraft(request, env, params.id) : mapStudioUnconfigured();
    })
    .put('/maps/drafts/:id', ({ request, params, body }) => {
      const env = options.mapStudioEnv;
      return env ? handleUpdateDraft(request, env, params.id, body) : mapStudioUnconfigured();
    })
    .delete('/maps/drafts/:id', ({ request, params }) => {
      const env = options.mapStudioEnv;
      return env ? handleDeleteDraft(request, env, params.id) : mapStudioUnconfigured();
    })
    .post('/maps/community', ({ request, body }) => {
      const env = options.mapStudioEnv;
      return env ? handlePublishCommunityMap(request, env, body) : mapStudioUnconfigured();
    })
    .get('/maps/community', ({ request }) => {
      const env = options.mapStudioEnv;
      return env ? handleListCommunityMaps(request, env) : mapStudioUnconfigured();
    })
    .get('/maps/community/:slug', ({ request, params }) => {
      const env = options.mapStudioEnv;
      return env ? handleGetCommunityMap(request, env, params.slug) : mapStudioUnconfigured();
    })
    // C-513: community asset publishing. Reserve → upload to the private intake
    // bucket → commit a pending revision → operator moderation + promotion into
    // the shared content-addressed `assets/` namespace. 503 while the
    // UPLOADS_BUCKET binding is absent (provisioning is an ops prerequisite).
    .post('/assets/community', ({ request, body }) => {
      const env = options.assetCommunityEnv;
      return env ? handleReserveCommunityAsset(request, env, body) : assetPublishingUnconfigured();
    })
    // 🔴 `parse: [handleRawBody]` is load-bearing — see the helper's comment.
    // The handler must read the raw request itself to check `Content-Length`
    // before buffering.
    .put(
      '/assets/community/:slug/upload',
      ({ request, params }) => {
        const env = options.assetCommunityEnv;
        return env
          ? handleUploadCommunityAsset(request, env, params.slug)
          : assetPublishingUnconfigured();
      },
      { parse: [handleRawBody] },
    )
    .get('/assets/community', ({ request }) => {
      const env = options.assetCommunityEnv;
      return env ? handleListCommunityAssets(request, env) : assetPublishingUnconfigured();
    })
    // Registered before `/assets/community/:slug` so `counters` is never read
    // as a slug.
    .get('/assets/community/counters', ({ request }) => {
      const env = options.assetCommunityEnv;
      return env ? handleCommunityAssetCounters(request, env) : assetPublishingUnconfigured();
    })
    .get('/assets/community/:slug', ({ request, params }) => {
      const env = options.assetCommunityEnv;
      return env
        ? handleGetCommunityAsset(request, env, params.slug)
        : assetPublishingUnconfigured();
    })
    .delete('/assets/community/:slug', ({ request, params }) => {
      const env = options.assetCommunityEnv;
      return env
        ? handleDeleteCommunityAsset(request, env, params.slug)
        : assetPublishingUnconfigured();
    })
    .post('/assets/community/:slug/moderation', ({ request, params, body }) => {
      const env = options.assetCommunityEnv;
      return env
        ? handleModerateCommunityAsset(request, env, params.slug, body)
        : assetPublishingUnconfigured();
    })
    .get('/assets/community/:slug/raw', ({ request, params }) => {
      const env = options.assetCommunityEnv;
      return env
        ? handleCommunityAssetRaw(request, env, params.slug)
        : assetPublishingUnconfigured();
    })
    // ── C-530: theme publishing ───────────────────────────────────────────
    //
    // A theme package is a bounded ZIP whose manifest carries
    // `kind: 'aikami-theme'`. `.zip` is in neither the image nor the audio
    // extension map, so a theme is refused at *reserve* on the community path
    // — hence this dedicated family. The bindings are the C-513 ones; the
    // extra `themePublishingEnabled` gate hides the entry points and blocks
    // new publishes without touching approved versions (AC-9).
    //
    // 🔴 `parse: [handleRawBody]` on the upload: the handler must own the raw
    // request so it can check `Content-Length` before buffering.
    .post('/assets/themes', ({ request, body }) => {
      const env = options.assetThemeEnv;
      return env ? handleReserveThemeVersion(request, env, body) : assetPublishingUnconfigured();
    })
    .put(
      '/assets/themes/:slug/upload',
      ({ request, params }) => {
        const env = options.assetThemeEnv;
        if (!env) {
          return assetPublishingUnconfigured();
        }
        const version = new URL(request.url).searchParams.get('version') ?? undefined;
        return handleUploadThemeVersion(request, env, params.slug, version);
      },
      { parse: [handleRawBody] },
    )
    .get('/assets/themes', ({ request }) => {
      const env = options.assetThemeEnv;
      return env ? handleListThemeVersions(request, env) : assetPublishingUnconfigured();
    })
    // Registered before `/assets/themes/:slug` so `counters` is never read as a
    // theme id.
    .get('/assets/themes/counters', ({ request }) => {
      const env = options.assetThemeEnv;
      return env ? handleThemeCounters(request, env) : assetPublishingUnconfigured();
    })
    .get('/assets/themes/:slug', ({ request, params }) => {
      const env = options.assetThemeEnv;
      return env ? handleGetThemeVersion(request, env, params.slug) : assetPublishingUnconfigured();
    })
    .get('/assets/themes/:slug/public', ({ request, params }) => {
      const env = options.assetThemeEnv;
      return env
        ? handleThemeVersionPublic(request, env, params.slug)
        : assetPublishingUnconfigured();
    })
    .get('/assets/themes/:slug/raw', ({ request, params }) => {
      const env = options.assetThemeEnv;
      return env ? handleThemeVersionRaw(request, env, params.slug) : assetPublishingUnconfigured();
    })
    .post('/assets/themes/:slug/moderation', ({ request, params, body }) => {
      const env = options.assetThemeEnv;
      return env
        ? handleModerateThemeVersion(request, env, params.slug, body)
        : assetPublishingUnconfigured();
    })
    .post('/assets/themes/:slug/revocation', ({ request, params, body }) => {
      const env = options.assetThemeEnv;
      return env
        ? handleRevokeThemeVersion(request, env, params.slug, body)
        : assetPublishingUnconfigured();
    })

    .post('/ask', handleAsk, {
      body: askRequestSchema,
      response: askResponseSchema,
    })
    // ── C-522: paired generation runner ───────────────────────────────────
    //
    // Runner-initiated by construction: the Worker cannot dial the creator's
    // machine, so claim/status/artifact are all requests the runner makes and
    // the Hub answers. No Queue and no Durable Object is required — the claim
    // is a conditional UPDATE against D1 (see `asset_generation_runner.ts`).
    //
    // 🔴 `parse: [handleRawBody]` on the artifact upload: the handler must own
    // the raw request so it can check `Content-Length` before buffering.
    .post('/generation/runners/pairing-code', ({ request }) => {
      const env = options.generationRunnerEnv;
      return env ? handleCreatePairingCode(request, env) : generationRunnerUnconfigured();
    })
    .get('/generation/runners', ({ request }) => {
      const env = options.generationRunnerEnv;
      return env ? handleListRunners(request, env) : generationRunnerUnconfigured();
    })
    .get('/generation/runners/availability', ({ request }) => {
      const env = options.generationRunnerEnv;
      return env ? handleRunnerAvailability(request, env) : generationRunnerUnconfigured();
    })
    .delete('/generation/runners/:deviceId', ({ request, params }) => {
      const env = options.generationRunnerEnv;
      return env
        ? handleRevokeRunner(request, env, params.deviceId)
        : generationRunnerUnconfigured();
    })
    .post('/generation/runners/:deviceId/artifact-upload', ({ request, params, body }) => {
      const env = options.generationRunnerEnv;
      return env
        ? handleSetRunnerArtifactUpload(request, env, params.deviceId, body)
        : generationRunnerUnconfigured();
    })
    .post('/generation/runners/pair', ({ request, body }) => {
      const env = options.generationRunnerEnv;
      return env ? handlePairRunner(request, env, body) : generationRunnerUnconfigured();
    })
    .post('/generation/runners/claim', ({ request, body }) => {
      const env = options.generationRunnerEnv;
      return env ? handleClaimDispatch(request, env, body) : generationRunnerUnconfigured();
    })
    .post('/generation/runners/status', ({ request, body }) => {
      const env = options.generationRunnerEnv;
      return env ? handleUpdateStatus(request, env, body) : generationRunnerUnconfigured();
    })
    .post('/generation/runners/candidates', ({ request, body }) => {
      const env = options.generationRunnerEnv;
      return env ? handleRecordCandidate(request, env, body) : generationRunnerUnconfigured();
    })
    .post('/generation/runners/artifact', ({ request, body }) => {
      const env = options.generationRunnerEnv;
      return env ? handleRequestArtifactTicket(request, env, body) : generationRunnerUnconfigured();
    })
    // Ticket-scoped writes live under their own prefix so the router never has
    // to disambiguate a ticket id from a dispatch id at the same position.
    .put(
      '/generation/runner-artifacts/:ticketId',
      ({ request, params }) => {
        const env = options.generationRunnerEnv;
        return env
          ? handleUploadArtifact(request, env, params.ticketId)
          : generationRunnerUnconfigured();
      },
      { parse: [handleRawBody] },
    )
    .get('/generation/runner-artifacts/:ticketId/raw', ({ request, params }) => {
      const env = options.generationRunnerEnv;
      return env
        ? handleGetArtifactRaw(request, env, params.ticketId)
        : generationRunnerUnconfigured();
    })
    .get('/generation/dispatches/:dispatchId/artifacts', ({ request, params }) => {
      const env = options.generationRunnerEnv;
      return env
        ? handleListArtifacts(request, env, params.dispatchId)
        : generationRunnerUnconfigured();
    })
    .post('/generation/dispatches', ({ request, body }) => {
      const env = options.generationRunnerEnv;
      return env ? handleCreateDispatch(request, env, body) : generationRunnerUnconfigured();
    })
    .get('/generation/dispatches', ({ request }) => {
      const env = options.generationRunnerEnv;
      return env ? handleListDispatches(request, env) : generationRunnerUnconfigured();
    })
    .get('/generation/dispatches/:dispatchId', ({ request, params }) => {
      const env = options.generationRunnerEnv;
      return env
        ? handleGetDispatch(request, env, params.dispatchId)
        : generationRunnerUnconfigured();
    })
    .post('/generation/dispatches/:dispatchId/cancel', ({ request, params }) => {
      const env = options.generationRunnerEnv;
      return env
        ? handleRequestDispatchCancel(request, env, params.dispatchId)
        : generationRunnerUnconfigured();
    })
    .get('/generation/candidates', ({ request }) => {
      const env = options.generationRunnerEnv;
      return env ? handleListCandidates(request, env) : generationRunnerUnconfigured();
    })
    .post('/generation/candidates/:candidateId/review', ({ request, params, body }) => {
      const env = options.generationRunnerEnv;
      return env
        ? handleReviewCandidate(request, env, params.candidateId, body)
        : generationRunnerUnconfigured();
    });

export const app = createApp();

export type { GenerationRunnerEnv };
// Re-exported so the Worker request entry can resolve the runner bindings the
// same way the durable page/route surfaces do.
export { handleListRunners, resolveGenerationRunnerEnv };

export type App = ReturnType<typeof createApp>;
