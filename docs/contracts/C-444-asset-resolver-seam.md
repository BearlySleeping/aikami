---
id: C-444
title: "Asset Resolution Seam — Resolver as Parameter, Two Implementations"
source: "user request 2026-08-26 — one source for hub, client dev, and the game"
status: draft
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-08-26"
---

# Contract C-444: Asset Resolution Seam — Resolver as Parameter, Two Implementations

## Metadata

| Field | Value |
|---|---|
| **Source** | User request (2026-08-26) — LPC, map, tileset and prop previews must run in the hub against the same code the game uses. |
| **Target** | `apps/frontend/client/src/lib/data/lpc_renderer.ts`, `packages/frontend/engine/src/assets/map_loader.ts`, `packages/frontend/engine/src/assets/content_pack_loader.ts`, `packages/shared/types/src/lib/game/`, new hub resolver |
| **Priority** | P1 — a module-level singleton resolver cannot serve two consumers in one bundle. Every downstream preview contract is blocked on this. |
| **Dependencies** | C-442 (LPC core package), C-443 (engine subpaths). Both must merge first. |
| **Status** | draft |
| **Promotion** | — |
| **Docs Impact** | internal → none |
| **Contract version** | 1.0.0 |

## Problem & Baseline Evidence

- **Current behavior — the LPC URL resolver is a module-level singleton.**
  `apps/frontend/client/src/lib/data/lpc_renderer.ts:52-65`:
  ```ts
  let _urlResolver: LpcUrlResolver | null = null;
  export const setLpcUrlResolver = (resolver: LpcUrlResolver): void => {
    _urlResolver = resolver;
  };
  ```
  Plus a second module-level flag `_manifestReady` (line ~86) and three
  module-level caches (`_sheetCache`, `_sheetPromises`, `_frameCache`). And
  `apps/frontend/client/src/lib/data/lpc_asset_catalog.ts` calls
  `void wireLpcUrlResolver();` at **module scope** — an import side effect.

  One process can therefore have exactly one LPC resolution strategy. A hub page
  showing a catalog preview and a client dev page showing a game sandbox cannot
  coexist, and neither can two previews with different origins.

- **The injection points for maps and packs already exist but have one caller.**
  C-434 added `RegistryBackedLoadOptions` to `map_loader.ts:229`:
  ```ts
  export type RegistryBackedLoadOptions = {
    resolveTag?: AssetTagResolver;
    releaseUrl?: (url: string) => void;
  };
  ```
  and the same pair to `loadContentPack` (`content_pack_loader.ts:284`). Both
  default to a bundled static path. No second implementation of
  `AssetTagResolver` has ever been written, so the seam has never been proven.

- **The client implementation is deeply platform-bound and correctly so.**
  `apps/frontend/client/src/lib/services/assets/asset_store.svelte.ts`
  `resolveUrl` goes through `assetManager` → Turso registry rows → OPFS or
  Tauri FS cache → refcounted blob URLs → SHA-256 verification → LRU eviction.
  The hub must not have any of that; it needs
  `${originUrl}/assets/${hash.slice(0,2)}/${hash}${ext}` and nothing else.

- **The hub already has that one-liner, unused by any loader.**
  `apps/frontend/hub/src/lib/utils/catalog.ts:28`:
  ```ts
  export const resolveAssetUrl = (originUrl: string, entry: CatalogAssetEntry): string =>
    `${stripTrailingSlash(originUrl)}/assets/${entry.hash.slice(0, 2)}/${entry.hash}${entry.ext}`;
  ```
  and `packages/shared/constants` exports the equivalent `r2AssetUrl`.

- **Known gaps**: no shared type unifies the two resolution strategies; the LPC
  renderer cannot accept one at all; caches are global so two consumers would
  poison each other's textures.

- **Baseline tests**: `bun test apps/frontend/client/src/lib/data/lpc_renderer.test.ts`,
  `bun test packages/frontend/engine/src/__tests__/` (map/pack loader tests),
  `bun test apps/frontend/hub/src/lib`.

## User Outcome

After this contract, a **developer** renders LPC sprites, maps, tilesets and
props in any host — the game, a client dev route, a hub page, a test — by
passing that host's resolver in, and the same rendering code produces the same
pixels from the same published bytes in all of them.

## Success Measures

- **Time/latency target**: hub resolution is synchronous and allocation-free
  beyond the returned string; no measurable overhead versus the current global.
- **Offline/degraded behavior**: an unresolvable tag returns `null` from every
  resolver. Callers already handle `null` — no resolver throws.
- **Production journey enabled**: the hub can render a real LPC sprite from the
  published catalog, which is the precondition for C-445 through C-447.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Registry-backed resolution | `services/assets/asset_store.svelte.ts` `resolveUrl` | **reuse** — wrap it as an `AssetResolver` implementation |
| Map/pack injection points | `map_loader.ts:229`, `content_pack_loader.ts:284` | **reuse** — widen `AssetTagResolver` to the shared type, keep the option names |
| CDN URL construction | `hub/src/lib/utils/catalog.ts:28`, `@aikami/constants` `r2AssetUrl` | **reuse** — the hub resolver is a thin wrapper |
| LPC URL resolution | `data/lpc_renderer.ts:52` | **replace** — singleton becomes a parameter |
| LPC texture caches | `data/lpc_renderer.ts` module scope | **modify** — caches move onto the resolver-scoped instance |

## Overview

Define `AssetResolver` in `packages/shared/types` as the single interface for
"tag → loadable URL, plus release". Provide two implementations: the existing
client registry path, and a new stateless hub path that builds content-addressed
CDN URLs from catalog index entries. Convert the LPC renderer from a module-level
singleton into an instance created from a resolver, moving its caches onto that
instance. Widen the map and content-pack loaders to accept the shared type.

## Design Reference

- `AssetTagResolver` in `packages/frontend/engine/src/assets/map_loader.ts` is
  the existing narrow shape; `AssetResolver` supersedes it and `AssetTagResolver`
  becomes an alias so C-434's call sites keep compiling.
- The client resolver must preserve the acquire/warm/fallback ordering
  documented in `asset_store.svelte.ts` — acquire a cached blob URL
  synchronously, warm in the background, fall back to the origin URL.
- Instance-scoped caches: follow the pattern already used by
  `packages/frontend/engine/src/rendering/texture_manager.ts` (`TextureManager`
  owns its cache) rather than the module-level maps in `lpc_renderer.ts`.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- `AssetResolver` lives in `packages/shared/types` (type only). Implementations
  live with their platform: the client one in
  `apps/frontend/client/src/lib/services/assets/`, the hub one in
  `apps/frontend/hub/src/lib/client/services/`.
- **No module-level mutable resolver state anywhere.** After this contract,
  `rg -n "^let _urlResolver|^let _manifestReady" apps packages` returns nothing.
- The LPC renderer becomes `createLpcRenderer({ resolver })` returning an object
  with `loadSheet`, `extractFrame`, `getFrameTexture`, `createSprite`,
  `clearCaches`. Caches are per-instance.
- **Two instances must not share texture state.** A test creates two renderers
  with different resolvers and asserts the same assetId yields different
  textures.
- Resolvers return `null` for unknown tags. They never throw, and they never
  log at `error` for a miss — a miss is a normal outcome.
- The hub resolver is **stateless and synchronous**. It must not cache, must not
  fetch, and must not hold a blob URL. `release` is a no-op.
- The engine's `AssetTagResolver` becomes
  `export type AssetTagResolver = AssetResolver['resolve'];` so C-434's existing
  option shapes are unchanged.

## State & Data Models

```ts
// packages/shared/types/src/lib/game/asset_resolver.ts

/**
 * Resolves a catalog tag to a URL a loader can fetch.
 *
 * Two implementations exist and must stay behaviourally interchangeable
 * from the caller's point of view:
 *   - client: registry → OPFS/Tauri cache → refcounted blob URL → origin
 *   - hub:    content-addressed CDN URL, no cache, no state
 */
export type AssetResolver = {
  /**
   * @param tag - Canonical catalog tag, e.g. "lpc:body:bodies_male:walk".
   * @returns A loadable URL, or null when the tag is unknown.
   */
  readonly resolve: (tag: string) => string | null;
  /**
   * Releases a URL previously returned by `resolve`.
   * A no-op for resolvers that do not hold refcounts.
   */
  readonly release: (url: string) => void;
  /** Identifies the strategy in logs and tests. */
  readonly kind: 'registry' | 'cdn' | 'fixture';
};
```

```ts
// apps/frontend/hub/src/lib/client/services/cdn_asset_resolver.ts
import type { AssetResolver } from '@aikami/types';
import type { CatalogAssetEntry } from '@aikami/schemas';

/**
 * Stateless CDN resolver. Built once per page from the entries the
 * server load function already fetched — never fetches on its own.
 */
export const createCdnAssetResolver = (options: {
  originUrl: string;
  entries: readonly CatalogAssetEntry[];
}): AssetResolver => { /* ... */ };
```

```ts
// packages/frontend/preview or client: LPC renderer instance
export type LpcRenderer = {
  loadSheet: (assetId: string, state: number) => Promise<Texture>;
  extractFrame: (/* ... */) => Texture;
  getFrameTexture: (/* ... */) => Promise<Texture>;
  createSprite: (/* ... */) => Promise<Sprite>;
  clearCaches: () => void;
};

export const createLpcRenderer = (options: {
  resolver: AssetResolver;
}) => LpcRenderer;
```

## Quality Requirements

- **Offline/degraded mode**: the client resolver still serves from the OPFS /
  Tauri cache with no network. The hub resolver requires the CDN by
  construction — that is correct, the hub is an online product.
- **Accessibility/input**: N/A.
- **Performance budget**: hub resolution is a string concatenation, O(1) after
  an entry-map build that is O(n) once per page.
- **Security/privacy**: the hub resolver must never receive an R2 write
  credential — it only builds public GET URLs (invariant I-7).
- **Persistence/migration**: N/A — no persistent state changes.
- **Cancellation/retry/idempotency**: `resolve` is pure per tag. `release` is
  idempotent; releasing an unknown URL is a no-op, not an error.
- **Observability**: each resolver logs once at `debug` on construction with its
  `kind` and entry count. Misses are counted and logged in aggregate at
  `debug`, never per-miss.

## Migration & Rollback

N/A — no persistent state changes. The change is a signature and wiring change;
rollback is a revert. Note that reverting after C-445–C-447 have landed would
break the hub, so revert the stack, not this contract alone.

## Scope Boundaries

- **In Scope:**
  - `AssetResolver` type in `packages/shared/types`.
  - Client registry resolver adapter over the existing `assetStore.resolveUrl`.
  - New hub CDN resolver.
  - `createLpcRenderer` — instance-scoped, resolver-injected.
  - Widening map/content-pack loader option types to `AssetResolver`.
  - Deleting `setLpcUrlResolver`, `setLpcManifestReady`, `wireLpcUrlResolver`
    and the module-scope `void wireLpcUrlResolver();` side effect.
- **Out of Scope:**
  - Moving `lpc_renderer.ts` into a package — C-445 does that.
  - Any hub route or Svelte component — C-446, C-447.
  - Changing what the client's registry resolver actually does internally
    (Turso, OPFS, refcounts, hashing all stay exactly as they are).
  - The de-bundling of content packs — C-448.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** one outcome — one resolution interface with two proven
implementations. Landing the interface without the second implementation would
leave the seam unproven again, which is exactly the failure C-434 left behind.

## Acceptance Criteria

### AC-1: No module-level resolver state remains
**Given** the merged branch
**When** the repo is searched for module-scope mutable resolver or manifest state
**Then** `rg -n "let _urlResolver|let _manifestReady|setLpcUrlResolver|setLpcManifestReady|wireLpcUrlResolver" apps packages`
returns zero hits.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit | `apps/frontend/client/src/lib/data/__tests__/no_global_resolver.test.ts` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `moon check`

**Watch Points**:
- `lpc_asset_catalog.ts` calls `void wireLpcUrlResolver();` at module scope.
  Deleting the function without deleting that call leaves a build error — good.
  Deleting the call without moving the wiring to an explicit composition-root
  call leaves the game with no resolver — bad. Move the wiring into
  `game_boot_service` explicitly.

---

### AC-2: Two renderers with different resolvers do not share texture state
**Given** two `createLpcRenderer` instances built from two different resolvers
that map the same assetId to two different URLs
**When** both load the same assetId and state
**Then** each returns the texture for its own URL, and clearing one instance's
caches does not affect the other.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit | `packages/frontend/engine/src/__tests__/lpc_renderer_isolation.test.ts` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run engine:test`

**Watch Points**:
- This is the AC that proves the singleton is actually gone. A shared
  module-level `_frameCache` would pass a naive single-instance test and fail
  this one.

---

### AC-3: The hub resolver builds correct content-addressed URLs
**Given** a `CatalogAssetEntry` with hash `ab34…` and ext `.webp`, and an origin
of `https://assets.example.com`
**When** `createCdnAssetResolver({ originUrl, entries }).resolve(entry.tag)` is called
**Then** it returns `https://assets.example.com/assets/ab/ab34….webp`, a
trailing slash on the origin produces no double slash, an unknown tag returns
`null`, and `release` is a no-op that does not throw.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Unit | `apps/frontend/hub/src/lib/client/services/__tests__/cdn_asset_resolver.test.ts` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run hub:test`

**Watch Points**:
- The two-character hash prefix directory is load-bearing — see
  `scripts/src/lib/catalog/content_address.ts` `assetKey`. Reuse
  `r2AssetUrl` from `@aikami/constants` rather than re-deriving the layout.

---

### AC-4: The client resolver preserves acquire/warm/fallback ordering
**Given** the client registry resolver adapter
**When** a tag is resolved that has a cached blob URL, one that is uncached but
present in the registry, and one that is unknown
**Then** the first returns the blob URL synchronously, the second returns the
origin URL and triggers a background warm, and the third returns `null` — the
same three behaviours `assetStore.resolveUrl` has today.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Unit | `apps/frontend/client/src/lib/services/assets/__tests__/registry_asset_resolver.test.ts` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:test`

**Watch Points**:
- The adapter must not add a second layer of caching on top of `assetStore`.
  It is a shape adapter, not a cache.

---

### AC-5: Map and pack loaders accept the shared type unchanged
**Given** `loadTilemap`, `loadJtonMap`, and `loadContentPack`
**When** each is called with an `AssetResolver` in place of the old
`AssetTagResolver`
**Then** they behave identically to today, and the existing C-434 loader tests
pass without modification.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | Unit | existing engine map/pack loader tests, unmodified | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run engine:test`

**Watch Points**:
- `AssetTagResolver` must become an alias, not a deletion. Deleting it forces a
  churn diff across C-434's call sites for no benefit.

---

### AC-6: The game still boots and renders characters
**Given** a client build with the composition root wiring the registry resolver
**When** a save is loaded and the game canvas mounts
**Then** LPC characters render exactly as before, with no new `error` logs.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-6 | E2E | `apps/e2e/tests/game/collision_e2e.spec.ts` (existing) | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:build`
- E2E / Visual:
  - **Functional**: the existing `apps/e2e/tests/game/collision_e2e.spec.ts`
    must pass unmodified — it mounts a real `GameWorld`.
  - **Visual**: N/A — C-445 owns the preview visual suite.

**Watch Points**:
- The composition root is `game_boot_service.svelte.ts`. There are two other
  places that build an LPC pipeline (`game_engine_service.svelte.ts:734` and
  the sandbox VMs). All must take the resolver from one place, not each build
  their own — that duplication is what C-400 fought and it is easy to recreate.

## Implementation Sequence

1. **Phase 1 (Type)** — add `AssetResolver` to `packages/shared/types`. Alias
   `AssetTagResolver` to it in the engine. Everything still compiles.
2. **Phase 2 (Client adapter)** — wrap `assetStore.resolveUrl` /
   `releaseUrl` as a `kind: 'registry'` resolver. Write AC-4 tests. Nothing
   consumes it yet.
3. **Phase 3 (Hub resolver)** — write `createCdnAssetResolver` and AC-3 tests.
4. **Phase 4 (Renderer)** — convert `lpc_renderer.ts` to
   `createLpcRenderer({ resolver })` with instance caches. Repoint the client's
   three pipeline-building sites to a single composition-root instance. Delete
   the singleton setters. Write AC-1 and AC-2 tests.
5. **Phase 5 (Loaders)** — widen map/pack loader option types. Confirm AC-5
   passes with unmodified tests.
6. **Phase 6 (Validation)** — `bun run fix && bun moon run :validate && bun run test`,
   then the AC-6 E2E.

## Edge Cases & Gotchas

- **`Assets.load()` is itself a PixiJS global cache.** Two renderers with
  different resolvers can still collide inside PixiJS's own asset cache if they
  pass the same URL string. They will not, because the URLs differ by
  construction — but if a future resolver returns identical URLs, AC-2 must be
  re-examined. Note this in the renderer docblock.
- **Blob URL lifetime.** The client resolver returns refcounted blob URLs; the
  renderer must call `release` when a texture is evicted from its instance
  cache, or the refcount leaks. The hub resolver's no-op `release` makes this
  safe to call unconditionally.
- **SSR safety.** The hub resolver is constructed in a client-only context. It
  must never be built inside a `+page.server.ts` — the entries come from the
  server load, the resolver is built in the browser.
- **`kind: 'fixture'`** exists so tests can supply a deterministic resolver
  without mocking either real implementation. Use it in every preview test.
- **Do not "improve" the client resolver while adapting it.** Any behaviour
  change there is a separate contract; this one is a shape change only.

## Open Questions

Must be resolved before status becomes `approved`:

- None.

## Amendments

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

---
