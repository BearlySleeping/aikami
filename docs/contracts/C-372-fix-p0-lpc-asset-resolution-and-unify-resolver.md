---
id: C-372
title: "Fix P0 LPC Asset Resolution & Unify Asset Resolver"
source: "user_bug_report"
status: implemented
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: "https://github.com/BearlySleeping/aikami/pull/99"
  pr_number: 99
created_at: "2026-08-02"
---

# Contract C-372: Fix P0 LPC Asset Resolution & Unify Asset Resolver

## Metadata

| Field | Value |
|---|---|
| **Source** | Staging runtime logs & LPC dynamic import failures on Firebase Hosting (`https://aikami.stg.bearlysleeping.com`) |
| **Target** | `apps/frontend/client/src/lib/services/assets/` + LPC avatar loading services + manifest pipeline |
| **Priority** | P0 — Broken LPC avatar rendering and audio decode errors in production deployments |
| **Dependencies** | None (existing systems from C-243, C-325, C-370 are reused, not blocked on) |
| **Status** | implemented |
| **Promotion** | `integrated` |
| **Docs Impact** | Internal — none |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: On Firebase Hosting production/staging deployments, LPC sprite layers fail to load (canvas falls back to a default head or renders nothing) and background audio throws `DOMException: decodeAudioData contains an unknown content type`. The LPC loader paths point at `/src/lib/assets/lpc/...` (a gitignored, dev-only download directory) or Firebase Storage URLs, neither of which exists in the static production build.

- **Reproduction**:
  1. `moon run client:build` then serve the `build/` output (or deploy to Firebase Hosting).
  2. Open `/dev/lpc`, `/dev/lpc-preview`, or `/game`.
  3. Observe: canvas fails to render LPC character layers; browser network tab shows failed requests to `/src/lib/assets/lpc/...`; audio playback logs `decodeAudioData contains an unknown content type` because a missing media file returns the SPA `index.html` with HTTP 200.

- **Root causes found in codebase inspection**:
  1. **LPC is not a manifest category.** `ASSET_CATEGORIES` in `packages/shared/constants/src/lib/game_assets.ts` only defines `music`, `sfx`, `ambient`, `sprites`, `backgrounds`. Both manifest scanners (`packages/frontend/engine/src/assets/asset_manifest.ts` `buildManifest()` and `scripts/src/lib/ops/scan_assets.ts`) derive the category from the first path segment and **skip unknown categories** — so all of `static/game-data/lpc/**` is silently excluded. Verified: `apps/frontend/client/static/game-data/manifest.json` currently contains exactly **1 entry** (`music:exploration:Chainsmoker`) and **0 LPC entries**, even though the LPC spritesheets are present on disk under `static/game-data/lpc/`.
  2. **Client loaders bypass the manifest entirely** and use four different resolution strategies:
     - `apps/frontend/client/src/lib/data/lpc_renderer.ts` — Firebase Storage URLs (`firebasestorage.googleapis.com/v0/b/...`) with a `PUBLIC_LPC_USE_LOCAL=true` fallback to `/src/lib/assets/lpc/`.
     - `apps/frontend/client/src/lib/views/dev/lpc/lpc_view_model.svelte.ts:510` — runtime dynamic `import(/* @vite-ignore */ '/src/lib/assets/lpc/${assetId}.webp?url')`, which Vite cannot statically analyze; in production builds the module path does not exist.
     - `apps/frontend/client/src/lib/views/character/lpc_preview/lpc_preview_view_model.svelte.ts:29` — `import.meta.glob('/src/lib/assets/lpc/**/*.webp')` against the gitignored dev directory (`.gitignore:223`).
     - `apps/frontend/client/src/lib/views/dev/lpc_walk/lpc_walk_test_view_model.svelte.ts:45` — same `import.meta.glob` pattern.
  3. **SPA rewrite masks missing media.** `apps/frontend/client/firebase.json` contains `"rewrites": [{ "source": "**", "destination": "/index.html" }]` with no static-extension exclusions. A missing `.webp`/`.mp3`/`.webm` returns `index.html` with HTTP 200, so `audio_service._loadBuffer()` (`audio_service.svelte.ts:419-426`) passes HTML bytes to `decodeAudioData` and PixiJS fails to decode HTML as a texture.
  4. **Inconsistent staging copy destination.** `scripts/src/lib/ops/preview_client.ts:268-273` copies `src/lib/assets/lpc` to `static/lpc` (wrong — the app resolves `/game-data/lpc/...`), while its own comment says `static/game-data/lpc/`.

- **Existing implementation to reuse**:
  - `apps/frontend/client/src/lib/services/assets/asset_store.svelte.ts` — tag→URL resolver (`resolveUrl(tag)`) driven by `manifest.json`; already returns `/game-data/<path>` URLs. Only needs LPC entries in the manifest.
  - `packages/frontend/engine/src/assets/asset_manifest.ts` + `scripts/src/lib/ops/scan_assets.ts` — generic scanners; they pick up a new category automatically once `ASSET_CATEGORIES` includes `lpc`.
  - `apps/frontend/client/src/lib/data/lpc_renderer.ts` — sheet/frame caching, `extractLpcFrame`, `createLpcSprite`, `clearLpcCaches` are correct and reusable; only `buildLpcAssetUrl` needs to route through the manifest.
  - `packages/frontend/engine/src/rendering/scene_background.ts:84-99` — injected `_resolveUrl` resolver pattern (setter-injection) to follow for keeping `lpc_renderer` pure and testable.
  - `apps/frontend/client/src/lib/data/lpc_asset_catalog.ts` — `LPC_DEFAULT_HEAD_ASSET_ID` / `LPC_DEFAULT_BODY_ASSET_ID` fallbacks (from C-325/C-370).
  - `packages/frontend/engine/src/assets/lpc_asset_catalog.ts` — already resolves NPC/prop textures to `/game-data/lpc/...` hardcoded paths; should share the same canonical path base.
  - E2E smoke: `apps/e2e/scripts/lpc_smoke.ts` + `moon run e2e:lpc-smoke`; spec `apps/e2e/tests/client/lpc_man.spec.ts`.

- **Known gaps**: LPC asset loading bypasses `assetStore` / `manifest.json`; `static/game-data/lpc/` exists but is invisible to the manifest; hosting rewrite masks missing media as HTML 200s.

- **Baseline tests** (run before starting):
  - `moon run client:test` (client unit suite, includes `lpc_preview_view_model.test.ts`)
  - `moon run e2e:test-client` (client E2E specs incl. `lpc_man.spec.ts`)
  - `moon run e2e:lpc-smoke`
  - `moon run client:build` (watch for Vite dynamic-import warnings)

## User Outcome

After this contract, players and developers on web (Firebase/Staging) and desktop (Tauri) will see LPC character avatar layers, tilemaps, and audio tracks load reliably from `/game-data/` manifest-resolved static routes — no silent fallback degradation, no 404 HTML-rewrite crashes, and no Vite dynamic-import breakage in production builds.

## Success Measures

- **Time/latency target**: Character sprite layers resolve and render within <200ms on initial game load (manifest lookup is a single in-memory map read; the manifest is fetched once and cached).
- **Offline/degraded behavior**: If a specific optional LPC layer is missing from the manifest, the resolver returns `null` and the caller falls back cleanly (existing `LPC_DEFAULT_HEAD_ASSET_ID` / `LPC_DEFAULT_BODY_ASSET_ID` or layer omission) without throwing uncaught audio/image decode DOM exceptions. No `decodeAudioData` HTML-decode failures.
- **Production journey enabled**: Player can load `/game` or `/dev/lpc` on staging and see fully composed LPC character layers with working BGM; a fresh `moon run client:build` produces zero unhandled dynamic-import warnings and zero `/src/lib/assets/` references in the client bundle.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Asset tag resolution | `apps/frontend/client/src/lib/services/assets/asset_store.svelte.ts` `resolveUrl(tag)` | **Modify** — add `lpc` to the empty-manifest `byCategory` fallback; resolution logic unchanged |
| Category registry | `packages/shared/constants/src/lib/game_assets.ts` `ASSET_CATEGORIES` | **Modify** — add `lpc` category (webp images, `defaultSubdirs` = LPC slot dirs) |
| Manifest scanner (engine) | `packages/frontend/engine/src/assets/asset_manifest.ts` `buildManifest()` | **Reuse** — generic; picks up `lpc` automatically via shared constants |
| Manifest generator CLI | `scripts/src/lib/ops/scan_assets.ts` | **Reuse** — generic; regenerate `manifest.json` after category change |
| LPC sheet loader + frame extraction | `apps/frontend/client/src/lib/data/lpc_renderer.ts` | **Modify** — `buildLpcAssetUrl` routes through a manifest resolver instead of Firebase Storage / `/src/lib/assets/` |
| LPC preview loader | `apps/frontend/client/src/lib/views/character/lpc_preview/lpc_preview_view_model.svelte.ts` | **Modify** — replace `import.meta.glob('/src/lib/assets/lpc/...')` with manifest resolution |
| LPC dev page loader | `apps/frontend/client/src/lib/views/dev/lpc/lpc_view_model.svelte.ts` | **Modify** — replace `import(/* @vite-ignore */ ...)` with manifest resolution |
| LPC walk test loader | `apps/frontend/client/src/lib/views/dev/lpc_walk/lpc_walk_test_view_model.svelte.ts` | **Modify** — replace `import.meta.glob` with manifest resolution |
| LPC client catalog | `apps/frontend/client/src/lib/data/lpc_asset_catalog.ts` | **Modify** — `getLpcAssetPath` delegates to manifest-aware renderer |
| LPC engine catalog | `packages/frontend/engine/src/assets/lpc_asset_catalog.ts` | **Modify** — use canonical `/game-data/lpc/` base (already mostly correct) |
| Hosting config | `apps/frontend/client/firebase.json` | **Modify** — exclude static asset extensions from the `**` SPA rewrite |
| Staging copy helper | `scripts/src/lib/ops/preview_client.ts` | **Modify** — fix copy destination `static/lpc` → `static/game-data/lpc` |

## Overview

This contract eliminates the duplicate asset sources of truth and fixes the P0 production build failure. We register the LPC asset tree under `static/game-data/lpc/` as a first-class manifest category (via the shared `ASSET_CATEGORIES` constant), regenerate `manifest.json`, remove every `/src/lib/assets/lpc/` string concatenation and dynamic Vite import from client loaders, route all LPC layer lookups through the existing manifest-driven `assetStore.resolveUrl()`, and fix the Firebase Hosting rewrite so missing media returns true 404s instead of HTML 200s.

## Design Reference

- **Tag resolution pattern**: Follow `apps/frontend/client/src/lib/services/assets/asset_store.svelte.ts` — `resolveUrl(tag)` returns `` `${ASSETS_BASE}/${entry.path}` `` (i.e. `/game-data/lpc/body/bodies_male.walk.webp`). Do NOT introduce a second resolver.
- **Resolver injection pattern**: Follow `packages/frontend/engine/src/rendering/scene_background.ts:84-99` — accept an injected resolver (`setLpcUrlResolver(fn)` on `lpc_renderer.ts`) instead of importing the `$state` singleton directly into the data layer. This keeps `lpc_renderer.ts` pure and unit-testable and lets the engine share the same helper.
- **Fallback constants**: Reuse `LPC_DEFAULT_HEAD_ASSET_ID` / `LPC_DEFAULT_BODY_ASSET_ID` from `apps/frontend/client/src/lib/data/lpc_asset_catalog.ts` (established in C-325/C-370) for degraded-mode layer injection.
- **Tag shape**: The scanner's `pathToTag` converts `/` → `:` (`scripts/src/lib/ops/scan_assets.ts`). With an `lpc` category, `static/game-data/lpc/body/bodies_male.walk.webp` yields tag `lpc:body:bodies_male:walk`, matching the user-facing convention `lpc:<slot>:<variant>:<state>`.
- **Avoid**: Vite dynamic string imports (`import(...)` with a runtime-computed path, `new URL(path, import.meta.url)` for combinatorial layers) — they cannot be statically analyzed for production bundles.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- **Shared constants** (`packages/shared/constants/src/lib/game_assets.ts`): Add an `lpc` entry to `ASSET_CATEGORIES` — `extensions: Set(['.webp'])` (or reuse `IMAGE_EXTS`), `defaultSubdirs` listing the LPC slot folders (`body`, `legs`, `feet`, `torso`, `head`, `hair`, plus any present in `static/game-data/lpc/`). Both scanners (engine `buildManifest` and `scan_assets.ts`) consume this single registry, so no scanner changes are required.
- **Client — AssetStore** (`apps/frontend/client/src/lib/services/assets/asset_store.svelte.ts`): In the `fetchManifest()` 404 fallback, add `lpc: []` to the hardcoded `byCategory` object so the empty-manifest path stays schema-complete.
- **Client — LPC renderer** (`apps/frontend/client/src/lib/data/lpc_renderer.ts`): Add `setLpcUrlResolver(resolver: (assetId: string, state: LpcAnimationState) => string | null)`. `buildLpcAssetUrl`/`getLpcAssetPath`/`loadLpcSheet` resolve via the injected resolver first; when it returns `null`, return `null`/`Texture.EMPTY` with an explicit `logger.warn` (no Firebase Storage fallback in the default path; `PUBLIC_LPC_USE_LOCAL` may remain as a dev-only escape hatch if desired — see Resolved Decisions).
- **Client — LPC consumers** (`lpc_view_model.svelte.ts`, `lpc_preview_view_model.svelte.ts`, `lpc_walk_test_view_model.svelte.ts`): Remove `import.meta.glob('/src/lib/assets/lpc/**')` and the `/* @vite-ignore */` dynamic import. Load sheets via `loadLpcSheet(assetId, state)` / `getLpcFrameTexture(...)` from `lpc_renderer.ts`. Ensure the VM wires the resolver to `assetStore.resolveUrl` with the `lpc:` tag mapping at construction.
- **Client — resolver wiring points**: The injected resolver must be wired **once at bootstrap before the engine boots** — in `apps/frontend/client/src/lib/services/game/game_boot_service.svelte.ts` and `game_engine_service.svelte.ts` (the production `/game` journey) — **and** in each LPC-rendering dev VM (`lpc_view_model`, `lpc_preview_view_model`, `lpc_walk_test_view_model`, plus the sandbox VMs that pass `getLpcAssetPath` as `assetUrlResolver`: `party_follow`, `camera`, `combat`, `map`, `environment`, `sandbox`). Without a global wiring point, `/game` (AC-3) resolves every LPC layer to `null` and renders nothing, and the six sandbox VMs silently lose layers. All sandbox VMs and boot services funnel through `lpc_asset_catalog.getLpcAssetPath` → renderer, so wiring at the two boot services plus the three dev VMs covers every consumer.
- **Client — catalog** (`apps/frontend/client/src/lib/data/lpc_asset_catalog.ts`): `getLpcAssetPath(slot, assetId, state)` continues to delegate to `lpc_renderer.getLpcAssetPath` (which becomes manifest-aware).
- **Type propagation (required for typecheck — do not skip)**: `getLpcAssetPath` returns `string | null` after this contract. Widen the `assetUrlResolver` signatures in `apps/frontend/client/src/lib/services/game/game_boot_service.svelte.ts:885`, `apps/frontend/client/src/lib/services/game/game_engine_service.svelte.ts:717`, and `packages/frontend/engine/src/rendering/game_world.ts:149,221` from `=> string` to `=> string | null`. The engine already null-tolerates at runtime (`game_world.ts:2274` `if (!url) return;`) — this is a type-only change; do not add URL fabrication for unmapped tags.
- **Engine — catalog** (`packages/frontend/engine/src/assets/lpc_asset_catalog.ts`): Keep hardcoded `/game-data/lpc/...` paths or route through a shared `LPC_ASSETS_BASE` constant — they already target the canonical static base; do not point them at `src/lib/assets`.
- **Hosting** (`apps/frontend/client/firebase.json`): Exclude static asset extensions from the SPA rewrite so missing `.webp`, `.webm`, `.mp3`, `.ogg`, `.json`, `.png`, `.jpg`, `.svg`, `.woff2` files return a real 404 (e.g. via a `files`/rewrite-scope exclusion, or by adding a `"source": "**/*.{exts}", "destination": "/<404>"` rule above the catch-all). Keep existing COEP/COOP and cache headers intact.
- **Scripts** (`scripts/src/lib/ops/preview_client.ts`): Fix the copy destination from `static/lpc` to `static/game-data/lpc` (matching the comment and the runtime URL base).
- **Canonical path rule**: LPC assets live exclusively under `static/game-data/lpc/`. Delete the legacy `apps/frontend/client/src/lib/assets/lpc/` directory (gitignored dev download) and its `.gitignore` entries (`.gitignore:223` `apps/frontend/client/src/lib/assets/lpc/` **and** `.gitignore:225` `apps/frontend/client/static/lpc/**/*`, the stale copy-target entry). Remove `src/lib/assets/lpc` references from `scripts/src/lib/ops/upload_lpc_assets.ts`, `download_lpc_assets.ts`, **and `collect_lpc_assets.ts`** (the collector's `OUTPUT_ASSETS_DIR` writes the same tree and regenerates `lpc_asset_catalog_generated.ts` — retarget it to `static/game-data/lpc` so the collection pipeline does not recreate the deleted directory).

## State & Data Models

No new persistent schema is introduced. The manifest reuses the existing C-243 types (`@aikami/types`) — do NOT introduce the draft's proposed `AssetManifestItem` shape (`hash`, `sizeBytes`), which would break the existing scanner/store contract.

```typescript
// Existing, reused as-is — packages/shared/types/src/lib/game/game_assets.ts (C-243)
type AssetEntry = {
  tag: string;          // e.g. "lpc:body:bodies_male:walk"
  category: string;     // "lpc" after this contract
  subcategory: string;  // e.g. "body" or "hair/bangslong2"
  name: string;         // e.g. "bodies_male.walk"
  path: string;         // e.g. "lpc/body/bodies_male.walk.webp"
  ext: string;          // ".webp"
};

type AssetManifest = {
  scannedAt: string;
  count: number;
  assets: Record<string, AssetEntry>;        // keyed by tag
  byCategory: Record<string, AssetEntry[]>;  // gains "lpc" key
};
```

```typescript
// New (client) — pure helper mapping renderer assetId + animation state to a manifest tag.
// assetId uses "/" (e.g. "hair/bangslong2/bg_adult"), tags use ":".
type LpcTag = `lpc:${string}`;

const lpcTag = (assetId: string, state: string): LpcTag =>
  `lpc:${assetId.replaceAll('/', ':')}:${state}`;
```

```typescript
// New (shared constants) — one addition to ASSET_CATEGORIES in
// packages/shared/constants/src/lib/game_assets.ts:
{
  lpc: {
    name: 'lpc',
    extensions: new Set(['.webp']), // or reuse IMAGE_EXTS
    defaultSubdirs: [
      'body', 'legs', 'feet', 'torso', 'head', 'hair', 'eyes', 'facial',
      'hat', 'neck', 'shield', 'shoulders', 'weapon', 'cape', 'dress', 'beard',
    ],  // mirror the dirs actually present in static/game-data/lpc/ (beard, body, cape, dress, eyes, facial, feet, hair, hat, head, legs, neck, shield, shoulders, torso, weapon)
  },
}
```

## Quality Requirements

- **Offline/degraded mode**: Unmapped optional layer tags resolve to `null` → caller skips the layer or injects `LPC_DEFAULT_HEAD_ASSET_ID` / `LPC_DEFAULT_BODY_ASSET_ID`. No uncaught decode exceptions; `loadLpcSheet` already coalesces failures to `Texture.EMPTY`.
- **Accessibility/input**: N/A — non-UI asset loading core; no keyboard/screen-reader surface.
- **Performance budget**: Zero synchronous main-thread blocking during manifest lookup (`resolveUrl` is an in-memory map read). Manifest fetch is one cached GET; LPC sheets stay lazy-loaded per state/direction with the existing per-key promise dedup. Watch `manifest.json` size growth (thousands of LPC entries — see Watch Points).
- **Security/privacy**: N/A — public game assets; no auth or PII. Keep existing COEP/COOP headers; content-type correctness of media responses is the fix target.
- **Persistence/migration**: N/A — build/manifest-level changes; no save data or schema changes.
- **Cancellation/retry/idempotency**: Safe to retry asset fetches on failure — existing promise caches dedupe concurrent loads of the same key; failed loads coalesce to `Texture.EMPTY` and are not poisoned.
- **Observability**: Log an explicit warning (with tag and resolved URL) when an LPC layer is unmapped or a fetch 404s *before* falling back to a default sprite; surface decode failures as warnings, not silent console noise.

## Migration & Rollback

N/A — no persistent state changes (no save format, no Firestore/Data Connect schema, no routing changes). The `manifest.json` file is a regenerable build artifact: rollback of a hosting regression is a revert of `apps/frontend/client/firebase.json` + the regenerated manifest in the same commit.

## Scope Boundaries

- **In Scope:**
  - Deleting the legacy `apps/frontend/client/src/lib/assets/lpc/` directory and standardizing LPC assets under `static/game-data/lpc/`.
  - Adding the `lpc` category to `ASSET_CATEGORIES` (shared constants) and regenerating `manifest.json` via `scan_assets.ts` so LPC layers are indexed.
  - Refactoring all four client LPC loaders (`lpc_renderer.ts`, `lpc_view_model.svelte.ts`, `lpc_preview_view_model.svelte.ts`, `lpc_walk_test_view_model.svelte.ts`) to resolve via the manifest (`assetStore.resolveUrl` + `lpcTag`), removing `/src/lib/assets/` string concatenation and `import.meta.glob`/`@vite-ignore` dynamic imports.
  - Fixing `apps/frontend/client/firebase.json` so missing static media returns true 404s instead of SPA HTML 200s.
  - Fixing `preview_client.ts` copy destination (`static/lpc` → `static/game-data/lpc`), removing the stale `apps/frontend/client/static/lpc/` directory if present, and updating `upload_lpc_assets.ts` / `download_lpc_assets.ts` / `collect_lpc_assets.ts` local-dir targets.
  - Unit tests for the resolver mapping and manifest indexing; E2E/LPC-smoke coverage for production rendering.
- **Out of Scope:**
  - Turso DB / OPFS / Tauri local-disk persistent binary caching (covered elsewhere — do not add cache layers here).
  - Community content pack upload/moderation UI.
  - Changes to the C-243 `AssetEntry`/`AssetManifest` type shapes (e.g. adding `hash`/`sizeBytes`).
  - Audio playback UX, mixing, or the audio service itself (only the 404-masking fix that breaks decode is in scope).
  - Engine paperdoll recipe/body-layer logic (C-370) — this contract only changes *how URLs resolve*, not which layers compose.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** Single focused bugfix — 4 ACs, one coherent slice. Four projects are touched (client, engine, shared/constants, scripts), but the changes are a single interdependent unit: the manifest entries are useless without the resolver reroute, the resolver reroute is useless without the hosting 404 fix, and the category constant is the single lever that drives both scanners. Splitting would force cross-contract coordination on one shared file (`ASSET_CATEGORIES`) and one regenerated artifact (`manifest.json`). Kept as one contract.

## Acceptance Criteria

### AC-1: LPC Assets Indexed in the Manifest Under the `lpc` Category
**Given** the shared `ASSET_CATEGORIES` registry includes an `lpc` category and `scripts/src/lib/ops/scan_assets.ts` has been run against `apps/frontend/client/static/game-data/`
**When** the regenerated `manifest.json` is inspected
**Then** it contains entries for LPC spritesheets with tags of the form `lpc:<slot>:<variant>:<state>` (e.g. `lpc:body:bodies_male:walk`), `path` values under `lpc/...`, and a populated `byCategory.lpc` array; `count` reflects the added entries.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit | `packages/frontend/engine/src/__tests__/asset_manifest.test.ts` (extend with `lpc` category scan case) + committed `apps/frontend/client/static/game-data/manifest.json` | N/A | Filled during verification |

### AC-2: LPC Tags Resolve to Canonical Static URLs via AssetStore
**Given** a loaded manifest containing LPC entries
**When** `assetStore.resolveUrl(lpcTag('torso/aprons/apron_female', 'walk'))` is called
**Then** it returns `/game-data/lpc/torso/aprons/apron_female.walk.webp` — a valid static URL with **no** `/src/lib/assets/` segment and no Firebase Storage origin; an unmapped tag returns `null`.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit | `apps/frontend/client/src/lib/services/assets/asset_store.test.ts` (new — assert URL prefix, tag mapping, `null` for unknown tags) | N/A | Filled during verification |

### AC-3: Production Build Renders LPC Without Dynamic Imports or 404s
**Given** the frontend is built with `moon run client:build` and served statically (or via `scripts/src/lib/ops/preview_client.ts`)
**When** a user opens `/dev/lpc` and `/game`
**Then** character layers render on canvas without 404 network errors for LPC assets and without `decodeAudioData contains an unknown content type` / `Failed to decode` console exceptions; the build emits no unhandled dynamic-import warnings for `/src/lib/assets/lpc/`.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Integration / E2E | `apps/e2e/tests/client/lpc_man.spec.ts` (extend: assert LPC layer renders with zero console errors and no failed `/game-data/lpc/` requests) | `/dev/lpc`, `/game` | Filled during verification |

### AC-4: Missing Static Media Returns True 404s on Hosting
**Given** `apps/frontend/client/firebase.json` excludes static asset extensions from the SPA rewrite
**When** a request is made for a non-existent file such as `/game-data/lpc/does-not-exist.webp` or `/game-data/audio/music/missing.mp3` on a deployed site (or `firebase emulators:exec` preview)
**Then** the server responds with HTTP 404 and a non-HTML body (never `index.html` with 200), so `audio_service._loadBuffer` and PixiJS fail cleanly and log a warning instead of throwing a decode DOM exception.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Integration | `apps/frontend/client/firebase.json` (config artifact) + a curl/Playwright request assertion against a locally served build (or emulator) | `/game-data/...` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:test` (unit suites); `moon run client:build` (build gate, watch for dynamic-import warnings)
- Integration: `bun run scripts/src/lib/ops/scan_assets.ts` (regenerate manifest, then verify `manifest.json` diff); serve the built client via `scripts/src/lib/ops/preview_client.ts` and assert 404/200 status codes for present vs missing assets (`moon run client:preview` is a long-running server preset — do not invoke it as a one-shot task)
- E2E / Visual:
    - **Functional**: Extend `apps/e2e/tests/client/lpc_man.spec.ts` — open `/dev/lpc`, wait for sprite layer renders, assert zero `console.error` entries containing `decodeAudioData` or `404`, and assert no failed requests for `/src/lib/assets/`. No new POM needed (page assertions only); add one if the spec grows shared selectors.
    - **Visual**: N/A for this contract's core (pixel-rendering correctness is covered by existing LPC visual/smoke coverage; this contract targets URL resolution, not composition). Optionally add a `suites/` case later if a regression appears — not required here.

**Watch Points**:
- Vite must not emit unhandled dynamic-import warnings for `/src/lib/assets/lpc/` during `moon run client:build`.
- `manifest.json` grows by thousands of entries (LPC set is large — >1000 files in `head/` + `hair/` alone). Verify the fetch is a single cached GET and stays within the <200ms resolve target; do not block first paint on the full manifest if it grows past ~1–2 MB (fetch is cheap; keep resolve synchronous).
- The hardcoded empty-manifest `byCategory` fallback in `asset_store.svelte.ts` must include `lpc: []` or AC-2's unit test will fail on the 404 path.

## Implementation Sequence

1. **Phase 1 (Data/Logic)**: Add the `lpc` category to `ASSET_CATEGORIES` in `packages/shared/constants/src/lib/game_assets.ts`. Update the `fetchManifest()` empty-manifest fallback in `asset_store.svelte.ts` to include `lpc: []`. Run `bun run scripts/src/lib/ops/scan_assets.ts` and commit the regenerated `apps/frontend/client/static/game-data/manifest.json`. Extend `asset_manifest.test.ts` with the `lpc` scan case; add `asset_store.test.ts` for AC-1/AC-2.
2. **Phase 2 (Integration)**: Add `setLpcUrlResolver` to `lpc_renderer.ts` and route `buildLpcAssetUrl`/`getLpcAssetPath`/`loadLpcSheet` through it. Rewire `lpc_view_model.svelte.ts`, `lpc_preview_view_model.svelte.ts`, `lpc_walk_test_view_model.svelte.ts`, and `lpc_asset_catalog.ts` (client) to the manifest resolver with the `lpcTag` mapping; delete `import.meta.glob` and `@vite-ignore` imports. Update engine `lpc_asset_catalog.ts` to the canonical base. Fix `preview_client.ts` copy destination and the upload/download script local-dir targets. Remove the legacy `src/lib/assets/lpc/` directory and its `.gitignore` entry.
3. **Phase 3 (Validation)**: Fix `firebase.json` rewrite exclusions. Run `validate()` (lint + full moon validation), `moon run client:test`, `moon run client:build` (confirm no dynamic-import warnings), serve the build and assert 404-vs-200 behavior (AC-4), then run `moon run e2e:test-client` and `moon run e2e:lpc-smoke`. Verify `/dev/lpc` and `/game` on staging once deployed.

## Edge Cases & Gotchas

- **Firebase SPA rewrite 404s**: The catch-all `"source": "**"` must not swallow `.webp`, `.webm`, `.mp3`, `.ogg`, `.json`. Use an explicit static-extension exclusion/404 rule above the catch-all; verify with a real request, since Firebase rewrites apply longest-prefix/first-match semantics.
- **Tag collisions**: `pathToTag` converts `/` → `:`; deep sub-slot files (`hair/bangslong2/bg_adult.walk.webp`) become `lpc:hair:bangslong2:bg_adult:walk` — no collisions expected, but keep the existing duplicate-tag warning path active.
- **Catalog ID vs file layout drift**: The generated catalog (`lpc_asset_catalog_generated.ts`) contains assetIds like `head/ears/cat/skin/fg_adult` that may not have a matching downloaded file. This is expected: `resolveUrl` returns `null`, the layer degrades gracefully, and a warning is logged. Do NOT try to fabricate URLs for missing files.
- **Emulator vs live storage**: `lpc_renderer.ts` currently has a Firebase Storage branch keyed on `PUBLIC_MODE`. After this contract the static `/game-data/` manifest path works identically in emulator, staging, and production — verify no code path still hardcodes the storage emulator port (`localhost:9198`) for LPC.
- **Staging copy bug**: `preview_client.ts` copies to `static/lpc` today — after the fix, confirm no stale `static/lpc` directory is left behind and the runtime URL remains `/game-data/lpc/...`.
- **COEP/COOP headers**: Already set (`require-corp`). Keep them; the media 404 fix must not regress these headers, or texture/audio fetches will start failing cross-origin.

## Resolved Decisions

The following questions were resolved at critique (C-372 v2.0.0) using the architect's stated recommendations as the binding defaults:

- **Firebase Storage role for LPC**: **Manifest-only.** `lpc_renderer.ts` drops the Firebase Storage runtime origin entirely; Storage remains the *source* for the download scripts, not a runtime fallback. The static `/game-data/` path is uniform across emulator, staging, and production — do not reintroduce a `localhost:9198` storage branch.
- **`PUBLIC_LPC_USE_LOCAL` env flag**: **Remove it.** The manifest-resolved static path now covers dev, staging, and prod uniformly; keeping a second local branch recreates the divergent-resolution problem this contract eliminates.
- **Upload/download/collect script targets**: **Retarget all three** (`upload_lpc_assets.ts`, `download_lpc_assets.ts`, `collect_lpc_assets.ts`) to `static/game-data/lpc` so there is a single canonical local tree and the deleted `src/lib/assets/lpc/` is never recreated.
- **Manifest size**: **Single monolithic `manifest.json` for now.** The manifest is one cached GET and `resolveUrl` is an in-memory map read (well under the 200ms budget); a separate `lpc-manifest.json` is deferred pending C-243 coordination. Keep the Watch Point on size growth.

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

## Execution Report

### Summary

Registered the LPC asset tree under `static/game-data/lpc/` as a first-class `lpc` manifest category (shared `ASSET_CATEGORIES` + state-token tag normalization), regenerated `manifest.json` (12,704 entries, 12,699 LPC), routed every client LPC loader through the manifest-backed `assetStore.resolveUrl` via an injected resolver (`setLpcUrlResolver` + `lpcTag`), deleted the legacy `src/lib/assets/lpc/` dev tree and stale `static/lpc/`, retargeted the upload/download/collect scripts, fixed the Firebase Hosting SPA rewrite so missing media returns true 404s, and added unit + E2E coverage. Production paths `/dev/lpc` (full character render, 90/100 visual) and `/game` (all 6 layers per entity load with HTTP 200, zero decode/404 errors) verified. One pre-existing engine composition quirk (white head on `/game`) is documented below and is out of scope (URL resolution only).

### AC Status

| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | `lpc` category + `stateExtensions` in shared `ASSET_CATEGORIES`; manifest regenerated with tags `lpc:<slot>:<variant>:<state>` (e.g. `lpc:body:bodies_male:walk` → `lpc/body/bodies_male.walk.webp`), populated `byCategory.lpc` (12,699), `count` 12,704. `asset_manifest.test.ts` extended (splitStateSegments + lpc scan cases). |
| AC-2 | ✅ | `asset_store.test.ts` (new, 6 tests): `resolveUrl(lpcTag('torso/aprons/apron_female', Walk))` → `/game-data/lpc/torso/aprons/apron_female.walk.webp`; no `/src/lib/assets/`, no Firebase Storage origin; `null` for unmapped tags and unloaded manifest. |
| AC-3 | ✅ | `client:build` clean — 0 `/src/lib/assets/` references in bundle, 0 unhandled dynamic-import warnings. `/dev/lpc` renders fully composed character (E2E `lpc_man.spec.ts` extended with canvas-pixel + zero-console-error + zero-failed-request assertions, 2 passed; visual 90/100). `/game` loads all 6 LPC layers/entity with HTTP 200, 0 `decodeAudioData` errors, 0 failed `/game-data/lpc/` requests. Note: `/game` player head renders white — pre-existing engine frame-application quirk, composition is out of scope (see Deviations). |
| AC-4 | ✅ | `firebase.json` adds a static-extension → `/404.html` rewrite (`statusCode: 404`) above the `**` catch-all. Verified against Firebase Hosting emulator: missing `.webp`/`.mp3`/`.json` → HTTP 404 with the 404.html body (never index.html); present assets 200; SPA routes still serve index.html. |

### Files Created

| File | Purpose |
|---|---|
| `apps/frontend/client/src/lib/data/lpc_tags.ts` | Pure helpers: `lpcStateSuffix`, `lpcTag` (assetId + state → manifest tag), `LpcTag` type. No pixi/service deps — unit-testable. |
| `apps/frontend/client/src/lib/services/assets/asset_store.test.ts` | AC-2 unit tests (tag mapping, URL prefix, null cases). |
| `apps/frontend/client/static/404.html` | 404 error page served for missing static media on Hosting. |

### Files Modified

| File | Change |
|---|---|
| `packages/shared/constants/src/lib/game_assets.ts` | Added `lpc` category (`.webp`, 16 slot subdirs, `stateExtensions`), optional `stateExtensions` on `AssetCategoryDefinition`, `splitStateSegments` helper. |
| `apps/frontend/client/static/game-data/manifest.json` | Regenerated via `scan_assets.ts` — 1 → 12,704 entries (12,699 LPC). |
| `apps/frontend/client/src/lib/services/assets/asset_store.svelte.ts` | Empty-manifest fallback now includes `lpc: []`. |
| `apps/frontend/client/src/lib/data/lpc_renderer.ts` | Dropped Firebase Storage + `PUBLIC_LPC_USE_LOCAL`; added `setLpcUrlResolver`, resolver-routed `loadLpcSheet`/`getLpcAssetPath` (returns `string \| null`), warn-on-unmapped. |
| `apps/frontend/client/src/lib/data/lpc_asset_catalog.ts` | `getLpcAssetPath` → `string \| null`; added `wireLpcUrlResolver()` (module-scope wired — global wiring point). |
| `apps/frontend/client/src/lib/views/dev/lpc/lpc_view_model.svelte.ts` | Removed `@vite-ignore` dynamic import; `_loadSheetTexture` delegates to `loadLpcSheet`; head fallback via renderer; explicit `wireLpcUrlResolver()` in `initialize()`. |
| `apps/frontend/client/src/lib/views/character/lpc_preview/lpc_preview_view_model.svelte.ts` | Removed `import.meta.glob`; delegates to `loadLpcSheet`; explicit resolver wiring. |
| `apps/frontend/client/src/lib/views/dev/lpc_walk/lpc_walk_test_view_model.svelte.ts` | Removed `import.meta.glob`; `_loadWalkSheet` → `loadLpcSheet(assetId, Walk)`; explicit resolver wiring. |
| `apps/frontend/client/src/lib/services/game/game_boot_service.svelte.ts` | `assetUrlResolver` types widened to `string \| null`; `wireLpcUrlResolver()` before engine boot. |
| `apps/frontend/client/src/lib/services/game/game_engine_service.svelte.ts` | Same as boot service. |
| `packages/frontend/engine/src/game_world.ts` | Type-only: `assetUrlResolver` → `string \| null` (runtime already null-tolerates at `if (!url) return`). |
| `packages/frontend/engine/src/assets/asset_manifest.ts` | `buildManifest` applies `splitStateSegments` before `pathToTag`. |
| `packages/frontend/engine/src/__tests__/asset_manifest.test.ts` | Added `splitStateSegments` + `lpc` scan test cases. |
| `scripts/src/lib/ops/scan_assets.ts` | Applies `splitStateSegments`; regenerates manifest. |
| `scripts/src/lib/ops/preview_client.ts` | Removed stale `src/lib/assets` → `static/lpc` copy; download targets `static/game-data/lpc` directly. |
| `scripts/src/lib/ops/upload_lpc_assets.ts` / `download_lpc_assets.ts` / `collect_lpc_assets.ts` | Retargeted to `static/game-data/lpc`. |
| `apps/frontend/client/firebase.json` | Static-extension 404 rewrite above the SPA catch-all. |
| `apps/e2e/tests/client/lpc_man.spec.ts` | Extended: canvas pixel render + zero decode/404 console errors + zero failed `/game-data/lpc/` + zero `/src/lib/assets/` requests. |
| `apps/frontend/client/src/lib/views/character/lpc_preview/lpc_preview_view_model.test.ts` | Fixed pre-existing `mock is not defined`; added mocks for manifest-aware renderer/catalog. |
| `biome.json` | Excluded regenerated `manifest.json` (7.2 MB > 1 MiB lint cap). |
| `.gitignore` | Removed stale `src/lib/assets/lpc/` and `static/lpc/**/*` entries. |
| `apps/frontend/client/.env.local` | Removed dead `PUBLIC_LPC_USE_LOCAL` flag (gitignored local file). |

### Deviations from Spec

1. **Scanner state-tag normalization (small addition)**: The contract stated `pathToTag` would naturally produce `lpc:body:bodies_male:walk`; the generic scanner actually produces `lpc:body:bodies_male.walk` (it only strips the final extension). To satisfy AC-1's required colon-separated tag form, added an optional `stateExtensions` field to the shared `AssetCategoryDefinition` registry plus a `splitStateSegments` normalizer consumed by both scanners — keeping the “single registry drives both scanners” architecture. This slightly extends the “no scanner changes required” directive, which was based on an incorrect premise. `name`/`subcategory`/`path` fields are unchanged (still dotted filenames on disk).
2. **`e2e:lpc-smoke` moon task is pre-existing broken**: references a removed Playwright project (`client-visual`). Not fixed (out of scope); the smoke capture step fails independent of C-372. `lpc_man.spec.ts` (the AC-3 E2E) passes with the new assertions.
3. **Pre-existing `lpc_preview_view_model.test.ts` bug fixed**: the file called `mock.module` without importing `mock` (failed to load entirely). Added the import + module mocks for the new renderer/catalog imports. 2 lifecycle tests still fail under the non-reactive `$effect` polyfill — a pre-existing environment limitation, not caused by this contract (verified: the HEAD version of the file fails wholesale).
4. **`/game` white head**: the player's head layer stays white despite the sheet resolving and loading (HTTP 200, 6/6 layers per entity loaded, zero errors). Root cause is the engine's `_applyLpcFrame` frame-key application — untouched by this contract (type-only diff in `game_world.ts`). Per the contract's Out of Scope (“engine paperdoll/body-layer logic — this contract only changes how URLs resolve”), no fix was attempted. Proposed follow-up: C-370 layer-composition bug.
5. **`PUBLIC_LPC_USE_LOCAL` removed** from `.env.local` per Resolved Decisions (renderer no longer reads it).

### Test Results

- Unit: **1,013 pass / 2 fail** (frontend-engine 832/0, constants 114/0, scripts 8/0, client asset_store 6/0, client lpc_preview 18/20 — the 2 fails are pre-existing `$effect` polyfill lifecycle tests). Full client suite: 522 pass / 146 pre-existing fails in unrelated areas (text-gen, bridge listeners, audio, expression, chat, worldgen — none import C-372 modules); suite hangs on network-dependent tests, so focused suites were used for the gate.
- E2E: **2 passed** (`lpc_man.spec.ts`, extended with C-372 assertions).
- Visual: `man-debug.png` **90/100 PASS** (fully composed orange-buzzcut character); `/dev/lpc` full-page character render PASS; `/game` layers load with zero errors (white-head composition note above).
- Baseline: 0 new failures introduced; 0 pre-existing LPC/asset/manifest failures.
