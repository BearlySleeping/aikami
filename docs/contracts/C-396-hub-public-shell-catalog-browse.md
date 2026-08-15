---
id: C-396
title: "Hub Public Shell and Catalog Browse (SSR)"
source: "user request — hub community catalog; ADR amendment A-5 (D-15)"
status: draft
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-08-15"
---

# Contract C-396: Hub Public Shell and Catalog Browse

## Metadata

| Field | Value |
|---|---|
| **Source** | User request (2026-08-15). Architecture: `docs/architecture/data-layer-target-architecture.md` D-5, D-14, D-15 and invariant I-8 (amendments A-4, A-5). |
| **Target** | `apps/frontend/hub/src/routes/`, `apps/frontend/hub/src/lib/views/catalog/`, `apps/frontend/hub/src/lib/types/data.ts`, `apps/frontend/hub/src/lib/constants/routes.ts` |
| **Priority** | P1 — this is the hub's reason to exist. C-394 and C-395 are both plumbing for it. |
| **Dependencies** | C-395 (the catalog index must exist to browse). C-394 only for the streamed stats in AC-4 — the browse pages work without it. |
| **Status** | draft |
| **Promotion** | — |
| **Docs Impact** | user-facing → a page in `apps/frontend/docs/src/content/docs/` describing the catalog |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: the hub is an authentication-walled shell with one page. `src/routes/+page.server.ts` unconditionally redirects — signed-in users to `/dashboard`, everyone else to `/login`. Every real route lives under `(authenticated)/`, whose `+layout.server.ts` redirects any request without `locals.userSession` to `/login`. `routes.ts` registers exactly two routes: `login` and `dashboard`. The navigation drawer has one entry.
- **Reproduction**: request `/` while signed out → 302 to `/login`. There is no page an anonymous visitor can read. This directly contradicts D-15 and makes D-5 ("the hub is public/community only") unimplementable as the app is currently laid out.
- **Existing implementation to reuse**:
  - The full app shell already exists and works: `app_view.svelte`, `app_bar`, `navigation_drawer`, `notification_drawer`, `app_dialogs`, `head_tags_view`, `app_error_view`, and the `BaseViewModel` + `base_view_model_container.svelte` pattern.
  - `hooks.server.ts` already resolves `locals.userSession` from the `__session` cookie on **every** request without requiring it — so the shell already has everything needed to render an optional-auth page. Only the route guards force authentication.
  - `routes.ts` already models route types (`'authenticated' | 'unauthenticated'`) via `@aikami/frontend/services`, and `routes.test.ts` guards the table.
  - The Eden treaty client (`src/lib/client/services/api/internal.svelte.ts`) is the established typed client for the Elysia API.
- **Known gaps**: no route type for "public, auth optional"; no catalog views; no index fetching; no page that renders for an anonymous visitor.
- **Baseline tests**: `bun moon run hub:test`, `bun moon run hub:build`. Both must pass before starting.

## User Outcome

After this contract, **anyone** — signed in or not — can browse the LPC sprites,
maps, tilesets and music in the catalog, filter and search them, see licenses
and attribution, and preview an asset before installing it.

## Success Measures

- **Time/latency target**: first contentful paint of a category page under 1s on a cold cache. The page must render **without waiting on Postgres** (I-8).
- **Offline/degraded behavior**: if the catalog index is unreachable, the page renders an explicit error state, not a blank list or a crash. If Postgres is unreachable, browse still works completely — only counts and ratings are missing.
- **Production journey enabled**: the first genuinely public surface of the product.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| App shell, bar, drawers, dialogs | `src/lib/views/app/**` | reuse |
| ViewModel base + container | `@aikami/frontend/services`, `base_view_model_container.svelte` | reuse |
| Session resolution (optional) | `src/hooks.server.ts` | reuse unchanged |
| Route table + type guard | `src/lib/constants/routes.ts`, `routes.test.ts` | modify |
| Auth guard | `src/routes/(authenticated)/+layout.server.ts` | reuse — scope narrows to member-only routes |
| Root redirect | `src/routes/+page.server.ts` | replace |
| Typed API client | `@elysiajs/eden` treaty | reuse |
| Catalog index | C-395 `index/v1/*.json` | reuse |

## Overview

Restructure the hub's routes into a `(public)` group that renders for anyone
and an `(authenticated)` group that keeps today's guard, then build the catalog
browse experience — category listing, filtering and search, and an asset detail
page with preview, license and attribution — rendered from C-395's static index.
Mutable metadata from C-394 streams in after first paint rather than blocking it.

## Design Reference

The Views/ViewModels convention in `.pi/skills/svelte-conventions` and the
existing `src/lib/views/**` structure. The SSR data-flow pattern is specified
below because the reference implementation being adapted
(`nordclaw/apps/frontend/app/src/routes/(authenticated)/keys/`) carries two
Firestore-specific costs that must **not** be reproduced here.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

### SSR data flow — the pattern to follow, and what changes from nordclaw

The nordclaw `keys` page uses a four-file flow:

```
+page.server.ts   repository → toJsonData()  → serialized wire type
+page.ts          fromJsonData()             → client type
+page.svelte      getXViewModel({ data })
keys_view_model   constructor seeds a service; initialize() re-fetches
```

Three changes, each with a concrete reason:

**1. Delete the `+page.ts` layer. It is Firestore-specific and does not apply.**
`toJsonData`/`fromJsonData` exist solely to move Firestore `Timestamp` objects
across the wire, converting them to `_unix` numbers and back. Drizzle returns
plain JavaScript `Date` objects, and SvelteKit does **not** serialize load data
with `JSON.stringify` — it uses `devalue`, which handles `Date`, `Map`, `Set`,
`BigInt` and cycles natively. A `Date` returned from `+page.server.ts` arrives
in `+page.svelte` as a `Date`. Adding a mapper layer here would be re-solving a
problem the framework already solved, and it is where nordclaw's
`formatCreatedDate` accumulated three defensive branches for shapes that could
not occur if the type were honest.

**2. Do not re-fetch in `initialize()`.** nordclaw's view model seeds itself
from `data` in the constructor and then calls `keysApiService.listKeys()` in
`initialize()` — so every page view costs two backend round trips, the second
discarding the first. Here that would mean a **cross-cloud** query to London on
every navigation. Seed from `data` and stop; when data genuinely needs
refreshing after a mutation, use SvelteKit's `invalidate()` with a `depends()`
key in the load function, which reruns exactly the load that owns the data.

**3. Stream the Postgres-backed data instead of awaiting it.** This is the
mechanism that makes I-8 real rather than aspirational. SvelteKit 2 streams
top-level promises returned from a server load — they are no longer awaited
before the response starts. So the statically-rendered page paints immediately
and Neon's cold start (up to ~1s after 5 minutes idle) never blocks it:

```ts
// +page.server.ts — shape only
export const load: PageServerLoad = async ({ params, setHeaders, depends }) => {
  depends('catalog:pack');

  // Awaited: the static index. Fast, CDN-cached, and the page is
  // meaningless without it.
  const pack = await catalogIndex.getPack(params.slug);
  if (!pack) error(404);

  setHeaders({ 'cache-control': 'public, max-age=60' });

  return {
    pack,
    // NOT awaited — streams in after first paint (I-8). The .catch() is
    // mandatory: an unhandled rejection in a streamed promise breaks the
    // response, and a database outage must degrade to "no stats", not to
    // a broken page.
    stats: loadPackStats(pack.id).catch(() => null),
  };
};
```

```svelte
{#await data.stats}
  <StatsSkeleton />
{:then stats}
  {#if stats}<Stats {stats} />{/if}
{/await}
```

Everything else from the nordclaw pattern is kept: `+page.svelte` stays a thin
shell that constructs a ViewModel from `data` and renders a single View
component; page data types stay in `src/lib/types/data.ts`; the ViewModel owns
all interaction state.

## Architecture Directives

- **The public group is the default; authentication is the exception.** After
  this contract, adding a route should require opting *in* to the auth guard,
  not opting out of it. The current layout has this inverted.
- **Browse never queries Postgres** (D-14, I-8). Category and detail pages
  render from the C-395 index. Postgres-backed values are streamed and optional
  in every code path that touches them.
- **`setHeaders` must be called before returning a streamed promise.** Once
  streaming starts the response headers are already sent; a later `setHeaders`
  throws.
- **No credential, no database client, and no R2 write key in any browser
  bundle** (I-1, I-7). The browser fetches the public index directly from the
  CDN; it never proxies through the hub.
- Do not change `hooks.server.ts`, the session cookie, App Check, or
  `POST /api/auth/session`. The optional-session behaviour already works.

## State & Data Models

Route groups after restructuring:

```
src/routes/
  (public)/                     no guard — renders for anyone
    +layout.server.ts           passes locals.userSession through, never redirects
    +page.svelte                catalog landing (replaces the root redirect)
    catalog/
      [category]/+page.server.ts
      [category]/[tag]/+page.server.ts
  (authenticated)/              existing guard, unchanged
    dashboard/
  (unauthenticated)/            existing, login only
    login/
```

Page data types, in `src/lib/types/data.ts` (the file C-385 emptied):

```ts
/** Catalog landing: category summaries only, never the full asset list. */
type CatalogLandingPageData = {
  categories: readonly { id: string; label: string; count: number }[];
  publishedAt: string;
};

/** One category's assets, from the C-395 shard. */
type CatalogCategoryPageData = {
  category: string;
  entries: readonly CatalogAssetEntry[];
  /** Streamed — null when Postgres is unreachable or unconfigured. */
  stats: Promise<CategoryStats | null>;
};

/** A single asset, with license and attribution surfaced. */
type CatalogAssetPageData = {
  entry: CatalogAssetEntry;
  /** Resolved CDN URL for preview. */
  previewUrl: string;
  stats: Promise<AssetStats | null>;
};
```

`routes.ts` gains a third route type alongside `'authenticated'` and
`'unauthenticated'` — `'public'`, meaning "renders either way".

## Quality Requirements

- **Offline/degraded mode**: index unreachable → explicit error state. Postgres unreachable → browse fully functional, stats absent. Neither is a 500.
- **Accessibility/input**: catalog grids must be keyboard navigable with visible focus; every asset preview needs meaningful alt text (the tag is not alt text); filter controls need labels; the streamed stats region needs `aria-busy` while pending so a screen reader is not told the content is final.
- **Performance budget**: FCP under 1s cold. A category page must not ship the whole 12,707-entry index — only its shard. Image previews lazy-load.
- **Security/privacy**: no user-owned data on any page (I-3, D-5). Anonymous visitors see exactly what signed-in visitors see, minus member-only affordances.
- **Persistence/migration**: none — no persistent state changes.
- **Cancellation/retry/idempotency**: navigating away mid-stream must abort cleanly without an unhandled rejection.
- **Observability**: log index fetch failures at `error` with the URL and status; log a streamed-stats failure at `warn` — it is expected and degraded, not exceptional.

## Migration & Rollback

- **Old data compatibility**: N/A — no persistent state.
- **Migration**: the root route changes from "redirect everyone" to "render the catalog". Signed-in users who bookmarked `/dashboard` are unaffected; `/dashboard` keeps its guard.
- **Rollback**: `git revert`. The route groups are additive except for `+page.server.ts`, whose previous redirect behaviour is restored by the revert.
- **Feature flag or kill switch**: N/A — a route restructure has no runtime toggle. If the catalog index is unavailable the pages degrade to an error state, which is the practical kill switch.
- **Failure recovery**: N/A.

## Scope Boundaries

- **In Scope:**
  - The `(public)` route group, its layout, and the root landing page.
  - `catalog/[category]` and `catalog/[category]/[tag]` routes with SSR loads.
  - `src/lib/views/catalog/**` — views and view models.
  - `routes.ts` `'public'` route type + `routes.test.ts` coverage.
  - Navigation drawer and app bar entries for the catalog.
  - `src/lib/types/data.ts` page data types.
  - Index fetching + client-side filter/search within a loaded shard.
  - The streamed-stats path against C-394's API (degrading to null when absent).
  - A docs page describing the catalog.
- **Out of Scope:**
  - Uploads, submissions, moderation (C-398).
  - Ratings UI and install-count writes (C-399) — this contract only *displays* stats if present.
  - Any client (game) change (C-397).
  - Changing auth, session handling, or App Check.
  - Server-side search or pagination across the whole catalog. Filtering is within a loaded shard; if that proves insufficient it is a follow-up contract, not an improvisation here.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** Not split, but close to the line. The route restructure
and the catalog pages could merge separately — however a `(public)` group with
no public page in it is unverifiable (nothing proves the guard was correctly
narrowed), and catalog pages inside the current layout would be unreachable to
the anonymous visitors they exist for. They land together. If the work grows,
split the **asset detail page** out first — it is the most self-contained piece.

## Acceptance Criteria

### AC-1: Anonymous visitors can reach the catalog; member routes stay guarded

**Given** a visitor with no session cookie
**When** they request `/` and `/catalog/lpc`
**Then** both render with `200` and no redirect

**And when** the same visitor requests `/dashboard`
**Then** they are redirected to `/login` exactly as today

**And when** a signed-in user requests `/` and `/catalog/lpc`
**Then** both render, showing member affordances the anonymous visitor does not see

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | E2E | `apps/e2e/tests/hub/catalog_public.spec.ts` | `/`, `/catalog/lpc`, `/dashboard` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run hub:test`, `bun moon run hub:build`
- E2E / Visual:
  - **Functional**: `tests/hub/catalog_public.spec.ts` — signed-out reaches `/` and `/catalog/lpc`; signed-out is redirected from `/dashboard`; signed-in reaches all three.
  - **Visual**: `suites/hub_catalog.visual.ts` — route `/catalog/lpc`. Score 90+: a grid of sprite previews is visible, each tile shows a name and a license badge, the filter control is present, and no layout overflow.

**Watch Points**:
- 🔴 `src/routes/+page.server.ts` currently redirects **unconditionally**. Replacing it is the single change that makes the hub public — verify no other layout reintroduces a guard above the `(public)` group.
- `routes.test.ts` guards the route table; extend it rather than working around it.
- Confirm the app shell renders with `locals.userSession === undefined`. Any view model that assumes a user exists will throw only on the anonymous path, which is the path least likely to be manually tested.

### AC-2: Category pages render from the static index without touching Postgres

**Given** the C-395 catalog index is published
**When** `/catalog/[category]` is server-rendered
**Then** the page lists that category's assets from its index shard, and **zero
Postgres queries are issued** during the render

**And when** `NEON_DATABASE_URL` is unset entirely
**Then** the page still renders completely, with stats absent

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Integration | `apps/frontend/hub/src/lib/views/catalog/__tests__/category_load.test.ts` | `/catalog/lpc` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run hub:test`
- Integration: run the hub with `NEON_DATABASE_URL` unset; load `/catalog/lpc`; confirm a complete render.

**Watch Points**:
- 🔴 This AC is the enforcement point for I-8. A query that "just" fetches a count in the awaited part of the load defeats the entire design and will not be caught by any test that runs with a warm database — which is why the unset-`NEON_DATABASE_URL` case is a required assertion, not a nice-to-have.
- The index shard for LPC is the largest; assert the page does not fetch the root index *and* the shard when only the shard is needed.

### AC-3: Asset detail shows a preview, license, and attribution

**Given** an asset tag
**When** `/catalog/[category]/[tag]` renders
**Then** it shows a preview resolved from the CDN, the asset's size, its
license, and its attribution text when the license requires one

**And when** the license is `"unknown"`
**Then** the page says so explicitly rather than omitting the field

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | E2E + Visual | `apps/e2e/tests/hub/catalog_detail.spec.ts`, `suites/hub_catalog_detail.visual.ts` | `/catalog/lpc/[tag]` | Filled during verification |

**Test Hooks**:
- E2E / Visual:
  - **Functional**: navigate from a category tile to detail; assert preview, license and attribution are present.
  - **Visual**: Score 90+: preview image renders at a sensible size, license and attribution are legible, and an unknown license is shown as "Unknown" rather than blank.

**Watch Points**:
- Omitting attribution for a CC-BY-SA asset is a licensing failure, not a UI gap. If C-395's AC-4 could not recover per-asset attribution, this page must show the collection-level attribution and say that it is collection-level.
- Preview images come from the R2 custom domain — verify CSP and CORS permit them from the hub's origin.

### AC-4: Postgres-backed stats stream in and never block first paint

**Given** C-394 is deployed and reachable
**When** a catalog page is loaded with a **cold** Neon compute
**Then** the page's first contentful paint happens without waiting for the
database, a loading affordance appears where stats will be, and the stats
populate when the promise resolves

**And when** the database query fails or times out
**Then** the stats region resolves to absent with a `warn` log, and no
unhandled promise rejection occurs

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Integration | `apps/frontend/hub/src/lib/views/catalog/__tests__/streamed_stats.test.ts` | `/catalog/lpc` | Filled during verification |

**Test Hooks**:
- Integration: point the hub at an unreachable database host; load a category page; confirm full render, a `warn` log, and no unhandled rejection.

**Watch Points**:
- 🔴 The `.catch()` on the streamed promise is mandatory. Without it a database outage becomes an unhandled rejection that breaks the streamed response after headers are sent — a failure mode with no clean error page.
- 🔴 Call `setHeaders` **before** returning the streamed promise. After streaming begins, headers are already flushed and `setHeaders` throws.
- Streaming requires JavaScript. With JS disabled the `{#await}` block renders its pending branch and never resolves — make the pending state degrade to something acceptable as a permanent state (e.g. simply absent), not a spinner that spins forever.

## Implementation Sequence

1. **Phase 1 (Route restructure)**: create `(public)/`, move the root page into it, replace the unconditional redirect, add the `'public'` route type and extend `routes.test.ts`. Verify AC-1 with no catalog content yet.
2. **Phase 2 (Index client)**: server-side index fetching with caching and an error state; page data types. Verify AC-2 against a published index.
3. **Phase 3 (Browse UI)**: category views and view models, filtering and search, navigation entries. Verify AC-1's visual criteria.
4. **Phase 4 (Detail)**: asset detail with preview, license, attribution. Verify AC-3.
5. **Phase 5 (Streamed stats)**: the C-394-backed promise path with `.catch()` and skeletons. Verify AC-4.
6. **Phase 6 (Validation + docs)**: `hub:test`, `hub:build`, E2E, visual suites, docs page.

## Edge Cases & Gotchas

- **The auth inversion is the risky part, not the UI.** Today every route is guarded by default. After this contract the default is public — a member-only page added later without the guard leaks. Consider asserting in `routes.test.ts` that every route marked `'authenticated'` actually resolves under the `(authenticated)` group.
- **`+page.server.ts` vs `+page.ts`.** Use `+page.server.ts` for anything touching the index cache or the database. Do not add `+page.ts` files "for symmetry" with nordclaw — see Design Reference; there is nothing for them to do here.
- **Devalue handles `Date`, but not class instances.** If a value must survive the wire as something richer than a plain object, it needs a transport shape. Prefer plain data.
- **LPC previews are sprite sheets, not portraits.** A raw `<img>` of a sheet shows every frame in a grid. Either render a single frame via CSS `background-position` or generate preview thumbnails in C-395. Decide before Phase 3 — retrofitting thumbnails means republishing.
- **The catalog landing must not fetch the 7 MB root manifest.** It needs category summaries only. If C-395's root index is not small enough to satisfy that, this contract is blocked on fixing the index, not on working around it client-side.
- **`notification_drawer` and other shell pieces may assume a session.** Audit the shell view models for anonymous-path assumptions before Phase 3.

## Open Questions

Must be resolved before status becomes `approved`:

1. **What does an anonymous visitor see at `/` — the catalog itself, or a landing page that links to it?** This is a product decision that changes Phase 1's page. Recommend the catalog landing directly (categories with counts and a search box): it makes the hub's purpose legible in one screen and gives a signed-out visitor somewhere to go.
2. **Sprite-sheet previews: CSS frame-cropping or pre-generated thumbnails?** Thumbnails look better and cost a republish plus storage; CSS cropping is free but needs frame geometry the index does not currently carry. If thumbnails, C-395 must generate them — which means amending C-395 before it is implemented, not after.
3. **Do member affordances exist at all in this contract?** AC-1 asserts a signed-in user "sees member affordances the anonymous visitor does not", but every member action (submit, rate) belongs to C-398/C-399. Either narrow that clause to just the app-bar account menu, or define one concrete affordance here. Recommend narrowing — the account menu already exists.

## Amendments

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)
