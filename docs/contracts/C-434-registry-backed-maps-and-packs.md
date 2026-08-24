---
id: C-434
title: "Registry-Backed Maps, Tilesets and Content Packs"
source: "user request 2026-08-23 — make client look at the R2 bucket"
status: approved
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-08-23"
---

# Contract C-434: Registry-Backed Maps, Tilesets and Content Packs

## Metadata

| Field | Value |
|---|---|
| **Source** | User request (2026-08-23) — the client should resolve every asset class through the same origin, not just LPC sprites. |
| **Target** | `packages/frontend/engine/src/assets/map_loader.ts`, `packages/frontend/engine/src/assets/content_pack_loader.ts`, `apps/frontend/client/src/lib/services/game/`, `apps/frontend/client/src/lib/services/assets/asset_store.svelte.ts` |
| **Priority** | P1 — without it, maps, tilesets and packs remain bundle-only and C-435 cannot de-bundle them. |
| **Dependencies** | C-432 (working content-addressed R2 sources) and C-433 (the bytes exist on the origin). Both must merge first. |
| **Status** | approved |
| **Promotion** | — |
| **Docs Impact** | internal → none |
| **Contract version** | 1.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: LPC sprites and audio resolve through the C-373
  registry — cached blob URL first, background warm, static path fallback
  (`apps/frontend/client/src/lib/services/assets/asset_store.svelte.ts`
  `resolveUrl`). **Maps, tilesets and content packs bypass it entirely** and
  fetch raw static paths:
  - `packages/frontend/engine/src/assets/map_loader.ts:252` — `const fetcher = options.fetch ?? globalThis.fetch; const response = await fetcher(url);` with `url` supplied by the caller as a static path.
  - `packages/frontend/engine/src/assets/content_pack_loader.ts:282` — `const { packId, basePath = '/content-packs', fetchFn } = options;` then fetches `${basePath}/${packId}/manifest.json` directly.

  Neither consults the asset registry, neither gets hash verification, neither
  gets OPFS/Tauri caching, and neither can fall back to R2. They work only
  because the files happen to be bundled.

- **Reproduction**: with `static/game-data/maps/` removed from a build, map
  loading fails outright — there is no second source to try, even after C-432
  and C-433 have put those exact bytes on the CDN with a verified hash.

- **Existing implementation to reuse** — the hard parts are already built:
  - `AssetManager.resolve` (`asset_manager.svelte.ts` ~448) does priority-ordered
    source iteration, SHA-256 verification before caching, OPFS/Tauri FS
    persistence, quota handling with LRU eviction, and refcounted blob URLs.
  - `AssetStore.resolveUrl` is the established pattern: `acquireUrl` synchronously,
    `warm` in the background, static path as fallback. Follow it exactly.
  - **Both loaders are already parameterised for injection** — `map_loader`
    takes `url` and an optional `fetch`; `content_pack_loader` takes `basePath`
    and an optional `fetchFn`. No signature change is required; the injection
    points exist and are currently fed static defaults.
  - C-433 publishes these files with stable tags derived by `pathToTag`.

- **Known gaps**: no tag-based resolution for these categories; the engine has
  no reference to the client's `assetStore` (correctly — it is a library), so
  resolution must be injected from the client at composition time, as
  `assetUrlResolver` and `propFrameResolver` already are on `GameWorld`.

- **Baseline tests**: `bun moon run engine:test` (covers
  `packages/frontend/engine/src/assets/map_loader.test.ts`,
  `content_pack_loader.test.ts`, `content_pack_loader.integration.test.ts`),
  `bun moon run client:test-unit`. All must pass before starting.

## User Outcome

After this contract, a **player** loads maps, tilesets and content packs
through the same verified-and-cached path as character sprites: served from
local cache when present, fetched from the CDN and hash-verified when not, and
falling back to the bundle when offline.

## Success Measures

- **Time/latency target**: a cached map loads with zero network traffic and no
  regression against today's bundled read. A cache-miss map resolves from R2 in
  under 500ms on a warm edge.
- **Offline/degraded behavior**: **load-bearing.** With no network and a bundled
  build, every map and pack must load exactly as today. The registry path must
  never make offline worse.
- **Production journey enabled**: unblocks C-435 — de-bundling is only safe once
  every asset class has a working second source.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Priority sources + verify + cache + blob URL | `asset_manager.svelte.ts` `resolve` | reuse unchanged |
| Tag→URL resolution idiom | `asset_store.svelte.ts` `resolveUrl` | reuse as the pattern |
| Map fetch injection point | `packages/frontend/engine/src/assets/map_loader.ts` `fetch` option | reuse — inject a resolving fetch |
| Pack fetch injection point | `packages/frontend/engine/src/assets/content_pack_loader.ts` `fetchFn` / `basePath` | reuse — inject a resolving fetch |
| Engine dependency injection precedent | `GameWorld` `assetUrlResolver`, `propFrameResolver` | reuse as the wiring pattern |
| Published tags for these categories | C-433 | reuse unchanged |

## Overview

Inject a registry-backed resolver into the map and content-pack loaders at the
client composition root, so both resolve their files by tag through the
AssetManager — cache, then R2, then bundled static path — instead of fetching
static paths directly. The engine keeps no knowledge of the registry; the
client supplies the resolver, exactly as it already supplies `assetUrlResolver`.

## Design Reference

`apps/frontend/client/src/lib/services/assets/asset_store.svelte.ts`
`resolveUrl` is the canonical shape: try `acquireUrl` synchronously, kick off
`warm` in the background, return the static path meanwhile, and remember tags
that failed to warm so they are not retried on every call.

`GameWorld`'s existing injected resolvers (`assetUrlResolver`,
`propFrameResolver`, `recipeResolver`) are the wiring precedent — the engine
declares a function-shaped option, the client's composition root supplies the
implementation. Do **not** import client services into the engine.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- **The engine stays library-pure.** No import from `apps/frontend/client/` and
  no reference to the registry, the AssetManager or `assetStore` inside
  `packages/frontend/engine/`. Resolution is injected. This is a monorepo
  boundary rule, not a preference.
- **Reuse the existing injection points.** `map_loader.fetch` and
  `content_pack_loader.fetchFn` already exist. Widening those signatures instead
  of using them would be new surface for no gain.
- **Bundled stays the last resort and always works.** The fallback chain is
  cache → R2 → bundled static path. An offline client with a bundled build must
  behave identically to today. Regressing offline to gain CDN delivery is a
  failure of this contract.
- **Refcounted blob URLs must be released.** `acquireUrl` refcounts and
  `releaseUrl` revokes. Map and pack JSON is parsed once and the URL is then
  dead — release it after parse, or every map load leaks a blob.
- **Do not change what the loaders parse.** Only where the bytes come from
  changes. Parsing, caching-by-URL and error handling inside the loaders stay
  as they are.
- **Tags come from the same derivation as the publisher.** A tag computed
  differently on the client than by `pathToTag` in the scan resolves to nothing.

## State & Data Models

No schema change and no persisted state. One injected resolver shape, declared
by the engine and implemented by the client:

```ts
/**
 * Resolves a published asset tag (e.g. "maps:sandbox_zone_a") to a URL the
 * caller can fetch — a cached blob URL, an origin URL, or a bundled static
 * path. Returns null when the tag is unknown, so the caller can fall back.
 */
type AssetTagResolver = (tag: string) => string | null;

/** Options both loaders gain, alongside their existing fields. */
type RegistryBackedLoadOptions = {
  /** Injected by the client composition root; absent in tests and headless use. */
  resolveTag?: AssetTagResolver;
  /** Released after the fetched bytes are parsed, to revoke refcounted blob URLs. */
  releaseUrl?: (url: string) => void;
};
```

## Quality Requirements

- **Offline/degraded mode**: the primary risk surface. Bundled fallback must be
  preserved on every path, and an unreachable origin must degrade silently to it.
- **Accessibility/input**: N/A — no UI surface.
- **Performance budget**: no regression to map load time. The synchronous
  `acquireUrl` fast path must not become an `await` on the critical path.
- **Security/privacy**: SHA-256 verification applies to maps and packs exactly
  as to sprites — this is what makes fetching structured data from a public
  origin safe. Never skip verification for JSON.
- **Persistence/migration**: no persistent state changes. Cached map bytes are
  ordinary registry cache entries subject to existing eviction.
- **Cancellation/retry/idempotency**: preserve the loaders' existing URL-keyed
  caches (`_mapCache`, the pack cache) so a repeat load does not refetch. A
  failed remote fetch must fall through, not throw.
- **Observability**: log which source served each map and pack at debug level.
  When a load fails, log the tag and every source tried.

## Migration & Rollback

- **Old data compatibility**: N/A — no persisted format changes. Saved games
  reference maps by id, and that id→tag mapping is unchanged.
- **Migration**: none.
- **Rollback**: `git revert`. The loaders return to static-path fetching; the
  bundled files are still present, so nothing breaks.
- **Feature flag or kill switch**: omitting the injected `resolveTag` at the
  composition root disables the registry path entirely and restores today's
  behaviour — the loaders must treat it as optional, which also keeps the
  engine's existing tests running unmodified.
- **Failure recovery**: any failure in tag resolution falls through to the
  bundled static path. A map must never become unloadable because the registry
  is unavailable.

## Scope Boundaries

- **In Scope:**
  - Injected `resolveTag` / `releaseUrl` options on the map and content-pack loaders.
  - Client composition-root wiring supplying a registry-backed implementation.
  - Tileset resolution on the same path (the map renderer's atlas fetch).
  - Blob URL release after parse.
  - Tests covering cache hit, R2 fallback, bundled fallback and offline.
- **Out of Scope:**
  - **Removing any bundled file** — C-435. The bundle stays intact here; this contract only adds a resolution path in front of it.
  - Publishing changes — C-433 owns what is on the origin.
  - The R2 key scheme — C-432.
  - Any change to `AssetManager.resolve`, the cache backends or eviction policy.
  - Hub-side consumption.
  - Prefetch or install-ahead strategies for maps.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** Not split. Maps, tilesets and packs share one resolver,
one injection pattern and one fallback chain; routing one and not the others
leaves two competing resolution paths live for the same class of file. Each
category still has its own independently verifiable AC.

## Acceptance Criteria

### AC-1: A map loads from the registry cache without network traffic
**Given** a map whose bytes are already in the asset cache
**When** the map is loaded
**Then** it resolves from the cached blob URL, no network request is made, and the parsed result matches a direct static-path load

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Integration | `packages/frontend/engine/src/assets/map_loader.test.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run engine:test`
- Integration: load `/game`, confirm the debug log reports a cache source for the map.
- E2E / Visual: **Functional**: N/A. **Visual**: N/A.

**Watch Points**:
- Assert *no* network call, not merely a correct result — a passing parse proves nothing about which source served it.

### AC-2: A map missing from the bundle is fetched from R2 and verified
**Given** a map absent from the bundle but published to the origin with a registry hash
**When** the map is loaded
**Then** it is fetched from R2, its SHA-256 is verified against the registry, it is cached, and it parses correctly

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Integration | `packages/frontend/engine/src/assets/map_loader.test.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run engine:test`, `bun moon run client:test-unit`
- Integration: stub the bundled path to 404 and the R2 URL to real bytes; confirm the load succeeds and caches.
- E2E / Visual: **Functional**: N/A. **Visual**: N/A.

**Watch Points**:
- Include a negative case: wrong bytes from R2 must fail verification and fall through, not parse.

### AC-3: Offline with a bundled build is unchanged
**Given** no network and a fully bundled build
**When** every map, tileset and content pack is loaded
**Then** all load successfully from bundled paths, with no thrown error and no user-visible delay beyond today's

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Integration | `packages/frontend/engine/src/assets/map_loader.test.ts`, `packages/frontend/engine/src/assets/content_pack_loader.integration.test.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run engine:test`
- Integration: boot with the network blocked; play through a map transition and load the `emberwatch` pack.
- E2E / Visual: **Functional**: N/A. **Visual**: N/A.

**Watch Points**:
- The most important AC in this contract. Everything else is an enhancement; this is the thing that must not regress.
- Ensure a failed `warm` does not block or delay the synchronous fallback.

### AC-4: Content packs resolve through the registry
**Given** the `emberwatch` content pack published to the origin
**When** it is loaded with the registry resolver injected
**Then** its manifest and every constituent file resolve through the registry, with bundled paths as fallback

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Integration | `packages/frontend/engine/src/assets/content_pack_loader.test.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run engine:test`
- Integration: load the pack with the bundled path stubbed to 404; confirm it resolves from the origin.
- E2E / Visual: **Functional**: N/A. **Visual**: N/A.

**Watch Points**:
- A pack manifest names its constituents by relative path. Those must be mapped to published tags using the same `pathToTag` derivation as the scan, or the manifest resolves and its contents do not.

### AC-5: Tilesets resolve through the registry
**Given** a map referencing a tileset atlas and its JSON descriptor
**When** the map renders
**Then** both atlas files resolve through the registry with bundled fallback, and the map renders identically to today

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | Visual | `apps/e2e/src/visual/suites/` (existing map/tilemap suite) | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run engine:test`
- Integration: load a textured sandbox map and confirm tiles render.
- E2E / Visual:
    - **Functional**: N/A.
    - **Visual**: extend the existing tilemap/environment visual suite with a case named `tileset_via_registry`, route `/game` on a textured sandbox map. Reuse that suite's schema plus `tilesRendered: boolean`. Prompt criteria: *"A tile-based game map is visible. Score 90+ only if terrain tiles render with texture and no untextured placeholder blocks or missing-texture artifacts are present."*

**Watch Points**:
- The atlas image and its descriptor must resolve consistently. A cached image against a bundled descriptor of a different revision produces silently wrong tile mapping.

### AC-6: Blob URLs are released after parse
**Given** repeated map loads served from cache
**When** many loads complete
**Then** each acquired blob URL is released after parsing, and the count of live blob URLs does not grow across loads

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-6 | Unit | `packages/frontend/engine/src/assets/map_loader.test.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run engine:test`
- Integration: load and unload maps repeatedly; assert the refcount returns to its starting value.
- E2E / Visual: **Functional**: N/A. **Visual**: N/A.

**Watch Points**:
- `acquireUrl` refcounts. Forgetting `releaseUrl` leaks a blob per load and the URL is never revoked — invisible in a short test, fatal over a long session.

## Implementation Sequence

1. **Phase 1 (Data/Logic)**: Add the optional `resolveTag` / `releaseUrl` options to both loaders, defaulting to today's static-path behaviour. Unit tests for resolution and fallback.
2. **Phase 2 (Integration)**: Wire the registry-backed implementation at the client composition root, including tileset resolution (AC-1, AC-2, AC-4, AC-5).
3. **Phase 3 (Validation)**: `bun moon run engine:test`, `bun moon run client:test-unit`, `bun moon check`; then the offline pass (AC-3) and the tilemap visual suite.

## Edge Cases & Gotchas

- **Tag derivation must match the publisher exactly.** `pathToTag` maps `/` to `:` and strips the extension. A client-side reimplementation that differs by one character resolves nothing and silently falls back forever — masking the fact that the registry path never works.
- **Blob URLs and relative references.** A map fetched as a blob URL cannot resolve sibling files by relative path. Resolve every referenced file by tag explicitly.
- **The loaders' own caches are URL-keyed.** `_mapCache` keys on the URL string; a blob URL differs every acquisition. Key the loader cache on the tag or the original path, not on the resolved URL, or caching breaks.
- **Do not await on the render path.** `AssetStore.resolveUrl` is synchronous with background warming for good reason. An async resolver on the map path will stall first paint.
- **Engine tests run headless.** They must keep passing with `resolveTag` absent — that is why it is optional.
- **Content pack `basePath` default.** `'/content-packs'` remains the fallback. Do not remove it.

## Open Questions

Must be resolved before status becomes `approved`:

- None. Both injection points exist and the resolution pattern is established.

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

---
