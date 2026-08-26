---
id: C-446
title: "Hub Catalog Asset Previews — LPC, Tilesets, Maps and Props"
source: "user request 2026-08-26 — lpc rendering preview in hub so people can check assets"
status: draft
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-08-26"
---

# Contract C-446: Hub Catalog Asset Previews — LPC, Tilesets, Maps and Props

## Metadata

| Field | Value |
|---|---|
| **Source** | User request (2026-08-26): *"i want to add lpc rendering preview in hub so people can check assets, same with map and tileset and props."* |
| **Target** | `apps/frontend/hub/src/lib/views/catalog/`, `apps/frontend/hub/src/routes/(public)/catalog/` |
| **Priority** | P2 — user-facing value, but strictly downstream of the shared package. |
| **Dependencies** | C-442, C-443, C-444, C-445. All must merge first. |
| **Status** | draft |
| **Promotion** | `integrated` |
| **Docs Impact** | user-facing → catalog browsing page in `apps/frontend/docs/src/content/docs/` |
| **Contract version** | 1.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: the hub asset detail page renders a **static thumbnail**
  and nothing else.
  `apps/frontend/hub/src/lib/views/catalog/catalog_asset_view.svelte:46-55`:
  ```svelte
  {#if viewModel.previewUrl}
    <img src={viewModel.previewUrl} alt={`Preview of ${viewModel.displayName}`} … >
  {:else}
    …"Preview unavailable"…
  {/if}
  ```
  `previewUrl` comes from `resolveThumbnailUrl` — a single pipeline-generated
  frame (C-396 AC-5).

- **Why that is inadequate for the asset classes in question:**
  | Category | What a single frame shows | What a browser needs |
  |---|---|---|
  | `lpc` | one frame of one layer of one sheet | the composed character, all four directions, animated |
  | `tilesets` | a shrunk atlas | the tile grid at integer scale, tile indices |
  | `maps` | nothing — `.jton`/`.json` has no thumbnail | the rendered map |
  | `contentPacks` | nothing — a manifest has no thumbnail | the pack's maps and contents |

  Confirm the gap live:
  ```bash
  curl -s https://assets.bearlysleeping.com/index/v1/catalog.json | head -40
  ```

- **The hub has no renderer at all.** `apps/frontend/hub/package.json` lists no
  `pixi.js` and no engine dependency. Its whole client surface today is
  three catalog views totalling 984 lines.

- **The hub is SSR on a Cloudflare Worker** (`@sveltejs/adapter-cloudflare`).
  A renderer must never enter the server bundle.

- **Existing implementation to reuse**: the browse plumbing is done and good.
  `apps/frontend/hub/src/lib/server/catalog/catalog_index.ts` implements
  disciplined shard fetching (root index for shard discovery, only that
  category's shards, never the client boot manifest, 60 s in-process cache
  matching the CDN, negative caching on failure). `catalog_asset_view_model.svelte.ts`
  already carries the entry. Nothing about data loading changes.

- **Known gaps**: no client-side renderer; no per-category preview dispatch; no
  way to link to a specific LPC configuration.

- **Baseline tests**: `bun test apps/frontend/hub/src/lib` and the existing
  `apps/frontend/hub/src/lib/views/catalog/__tests__/`.

## User Outcome

After this contract, a **creator** browsing the hub can open any LPC asset and
see it composed and animated in all four directions, open a tileset and read its
grid, open a map and see it rendered, open a content pack and see what is in it —
all rendered by the same code the game runs, and shareable as a URL.

## Success Measures

- **Time/latency target**: an asset detail page reaches first meaningful paint
  under 1 s (the thumbnail, server-rendered); the interactive preview mounts
  within 1.5 s of that on a warm cache. The thumbnail is never replaced by an
  empty canvas — the preview paints over it.
- **Offline/degraded behavior**: if the preview fails to mount or the resolver
  cannot resolve, the existing static thumbnail remains and a one-line notice
  explains that the interactive preview is unavailable. The page never
  regresses below today's behaviour.
- **Production journey enabled**: a creator can evaluate an asset before
  installing a pack.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Index fetch + shard discipline | `hub/src/lib/server/catalog/catalog_index.ts` | **reuse** unchanged |
| Asset detail page | `hub/src/lib/views/catalog/catalog_asset_view.svelte` | **modify** — thumbnail becomes the placeholder behind a preview slot |
| Asset detail view model | `hub/src/lib/views/catalog/catalog_asset_view_model.svelte.ts` | **modify** — gains resolver + catalog derivation |
| Category grid | `hub/src/lib/views/catalog/category_view.svelte` | **reuse** — thumbnails stay; no live previews in a grid |
| Preview components | `@aikami/frontend/preview` (C-445) | **reuse** |
| CDN resolver | `hub/src/lib/client/services/cdn_asset_resolver.ts` (C-444) | **reuse** |
| Display helpers | `hub/src/lib/utils/catalog.ts` | **reuse** unchanged |

## Overview

Add a client-only preview island to the hub's asset detail page. A per-category
dispatcher chooses `LpcPreview`, `TilesetPreview`, `MapPreview`, or
`PropPreview` from `@aikami/frontend/preview`, mounts it inside the existing
preview box on top of the server-rendered thumbnail, and feeds it the CDN
resolver built from entries the server load already fetched. LPC previews sync
their configuration to the URL so a link reproduces a specific character.

## Design Reference

- The dispatcher mirrors the shape of `catalog_asset_view_model.svelte.ts` —
  a view model that derives everything from `data` via `$derived`, exactly as
  `apps/frontend/hub/src/routes/(public)/+page.svelte` does with
  `getCatalogLandingViewModel`.
- Preview mounting follows the `BaseViewModelContainer` pattern already used by
  every hub view.
- URL state uses `encodeLpcPreviewState` / `decodeLpcPreviewState` from C-445 —
  the same compact encoding the client dev route has always used.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- **The preview is a client-only island.** Every `@aikami/frontend/preview`
  import is dynamic and inside `onMount`. Pixi must not appear in the hub's
  server bundle; a build assertion enforces this.
- **Do not set `ssr = false` on the route.** The page's metadata, license,
  attribution, and thumbnail must keep server-rendering for SEO and for the
  degraded path. Only the preview is client-only.
- **`@aikami/frontend/preview/sandbox` must not be imported here.** Static
  previews only; C-447 owns the engine-mounting route.
- The resolver is built in the browser from `data.entries` — the same entries
  the server load already validated. The page must not issue a second index
  fetch.
- **The LPC catalog for a detail page is scoped to what that page needs.** Do
  not `buildLpcCatalog` over all ~12,700 entries to preview one asset. For an
  LPC detail page, build over that entry's slot shard only.
- Category dispatch is a pure function of `entry.category` plus `entry.ext`,
  with an explicit `unknown` branch that keeps the thumbnail. No `default:`
  that silently renders the wrong component.
- The route stays under `(public)` — asset browsing is the point.

## State & Data Models

```ts
// apps/frontend/hub/src/lib/views/catalog/preview_kind.ts
import type { CatalogAssetEntry } from '@aikami/schemas';

/** Which interactive preview an entry supports, if any. */
export type PreviewKind =
  | 'lpc'        // composed, animated character
  | 'tileset'    // atlas grid at integer scale
  | 'map'        // rendered tilemap
  | 'prop'       // single sprite / spritesheet frame
  | 'pack'       // content-pack contents listing
  | 'none';      // thumbnail only — audio, unknown categories

/**
 * Pure dispatch. Every branch is explicit; unknown categories return 'none'
 * so the server-rendered thumbnail is never replaced by a broken canvas.
 */
export const previewKindForEntry = (entry: CatalogAssetEntry): PreviewKind => { /* ... */ };
```

```ts
// apps/frontend/hub/src/lib/views/catalog/catalog_asset_view_model.svelte.ts — additions
export type CatalogAssetViewModelInterface = /* existing */ & {
  /** Which interactive preview to mount, if any. */
  readonly previewKind: PreviewKind;
  /** Built in the browser from entries the server load already fetched. */
  readonly resolver: AssetResolver | undefined;
  /** Slot catalog scoped to this entry's shard. Only for previewKind 'lpc'. */
  readonly lpcCatalog: LpcCatalog | undefined;
  /** True once the preview island has painted; hides the thumbnail. */
  readonly previewMounted: boolean;
  /** Set when the island failed; the thumbnail stays and a notice shows. */
  readonly previewError: string | undefined;
};
```

## Quality Requirements

- **Offline/degraded mode**: JS disabled, island load failure, or a resolver
  miss all leave the server-rendered thumbnail in place plus a notice. The page
  is never worse than today.
- **Accessibility/input**: the preview canvas carries an `aria-label` naming the
  asset; all controls are keyboard reachable and visibly focusable; animation
  defaults to paused under `prefers-reduced-motion`; the notice on
  `previewError` is announced via a live region.
- **Performance budget**: the hub's largest **client** chunk may grow, but the
  preview code must be in its own lazily-loaded chunk — the catalog landing and
  category pages must not grow at all. The hub **server** bundle must not grow.
- **Security/privacy**: public GETs against the CDN only. No R2 credential, no
  database client, no write key reaches this code (I-1, I-7).
- **Persistence/migration**: N/A — no persistent state changes.
- **Cancellation/retry/idempotency**: navigating away mid-mount cancels cleanly;
  returning re-mounts. The island is safe to mount twice.
- **Observability**: island mount, mount failure, and unresolved-tag count are
  logged through the hub's existing `$logger`. Mount failure logs at `warn` with
  the tag and category — it is a degraded page, not an outage.

## Migration & Rollback

N/A — no persistent state changes. Rollback is a revert; the page returns to
the thumbnail-only view it has today.

## Scope Boundaries

- **In Scope:**
  - `previewKindForEntry` dispatch.
  - Client-only preview island on `/catalog/[category]/[tag]`.
  - CDN resolver construction on the client from already-fetched entries.
  - Scoped LPC catalog derivation for LPC detail pages.
  - URL sync for LPC preview configuration.
  - Content-pack detail listing (maps and constituents in the pack).
  - Docs page describing hub catalog browsing.
- **Out of Scope:**
  - The walkable map sandbox — C-447.
  - Live previews in the category **grid**. Grids keep static thumbnails;
    mounting N canvases in a grid is a performance trap.
  - Any change to `catalog_index.ts`, the shard-fetch discipline, or the
    publish pipeline.
  - Search, filtering, favouriting, or download flows.
  - Authentication. These routes stay public.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** one outcome — interactive previews on the hub asset
detail page. The four preview kinds share one island, one resolver, and one
dispatcher; splitting per category would mean four copies of the mounting
logic.

## Acceptance Criteria

### AC-1: Pixi never enters the hub server bundle
**Given** a production hub build
**When** the emitted Worker bundle is inspected
**Then** it contains no PixiJS code, and the hub's server bundle size is within
2% of its pre-change baseline.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Integration | `apps/frontend/hub/src/lib/__tests__/server_bundle_purity.test.ts` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run hub:build`
- Integration: grep the emitted Worker bundle for a PixiJS marker; assert absent.

**Watch Points**:
- A single static `import` of `@aikami/frontend/preview` anywhere in a
  `.server.ts`, a `+layout.svelte`, or a shared util pulls it in. Keep every
  preview import dynamic and inside `onMount`.

---

### AC-2: An LPC asset renders composed and animated
**Given** `/catalog/lpc/<some-lpc-tag>` on a build with a reachable origin
**When** the page loads and the island mounts
**Then** a composed character is rendered, direction and animation-state
controls change what is drawn, and the thumbnail is hidden once the canvas has
painted.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Visual | `apps/e2e/src/visual/suites/hub_lpc_preview.visual.ts` | `/catalog/lpc/[tag]` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run hub:build`
- E2E / Visual:
  - **Functional**: `apps/e2e/tests/hub/catalog_preview.spec.ts` — assert
    `[data-testid="catalog-asset-preview-canvas"]` becomes visible and
    `[data-testid="catalog-asset-preview"]` (the thumbnail) is hidden.
  - **Visual**: cases `hub-lpc-down`, `hub-lpc-up`, `hub-lpc-left`. AI criteria:
    *"Score 90+: a single coherent LPC character on the detail page, layers
    correctly stacked, facing the direction named in the case, with the license
    and attribution panel still visible beside it."*

**Watch Points**:
- The `up` direction is where layer ordering breaks first (C-430). Include it.

---

### AC-3: A tileset renders at integer scale with a grid
**Given** `/catalog/tilesets/<tag>`
**When** the island mounts
**Then** the atlas renders crisply with no smoothing and the grid overlay
toggles.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Visual | `apps/e2e/src/visual/suites/hub_tileset_preview.visual.ts` | `/catalog/tilesets/[tag]` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run hub:build`
- E2E / Visual:
  - **Functional**: N/A.
  - **Visual**: cases `hub-tileset-grid-on`, `hub-tileset-grid-off`. AI criteria:
    *"Score 90+: pixel art is crisp with no blur or resampling artifacts; grid
    lines align exactly to tile edges."*

**Watch Points**:
- CSS `image-rendering` alone is not enough — the Pixi texture scale mode must
  be nearest. C-445 handles this in the renderer factory; verify it survived.

---

### AC-4: A map renders
**Given** `/catalog/maps/<tag>` for a `.jton` or Tiled `.json` map
**When** the island mounts
**Then** the tilemap renders with its layers in order and no missing tiles.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Visual | `apps/e2e/src/visual/suites/hub_map_preview.visual.ts` | `/catalog/maps/[tag]` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run hub:build`
- E2E / Visual:
  - **Functional**: N/A.
  - **Visual**: case `hub-map-render`. AI criteria: *"Score 90+: a coherent
    tilemap with no gaps, no untextured magenta/checkerboard placeholders, and
    no misaligned tile seams."*

**Watch Points**:
- A map references tilesets by tag. If the tileset entries are in a different
  shard than the map entry, the resolver will miss. The page must fetch the
  tileset shard too — this is the one place the strict "only this category's
  shards" rule needs a documented, narrow exception. Fetch the `tilesets` shard
  only, and only for map and pack detail pages.

---

### AC-5: The degraded path never loses the thumbnail
**Given** an asset detail page where the island fails to load or the resolver
resolves nothing
**When** the page settles
**Then** the server-rendered thumbnail is still visible, a notice explains that
the interactive preview is unavailable, and the license and attribution panel is
unaffected.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | E2E | `apps/e2e/tests/hub/catalog_preview_degraded.spec.ts` | `/catalog/[category]/[tag]` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run hub:test`
- E2E / Visual:
  - **Functional**: `apps/e2e/tests/hub/catalog_preview_degraded.spec.ts` —
    block the CDN origin via route interception, assert the thumbnail and the
    notice are both present and the page did not 500.
  - **Visual**: N/A.

**Watch Points**:
- Also cover JS-disabled. The page must still server-render fully.

---

### AC-6: An LPC preview configuration is linkable
**Given** an LPC detail page where the user has changed slots, direction, and
state
**When** the URL is copied and opened in a fresh tab
**Then** the preview reproduces the same configuration.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-6 | E2E | `apps/e2e/tests/hub/catalog_preview.spec.ts` | `/catalog/lpc/[tag]` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run hub:test`
- E2E / Visual:
  - **Functional**: change three controls, read `location.search`, open it in a
    new context, assert the control values match.
  - **Visual**: N/A.

**Watch Points**:
- Use `replaceState`, not `pushState` — every frame step would otherwise add a
  history entry and trap the back button.

---

### AC-7: Category and landing pages do not grow
**Given** the production hub build
**When** chunk sizes are compared against the pre-change baseline
**Then** the chunks for `/catalog` and `/catalog/[category]` are unchanged
within 2%, because the preview code is in a separate lazily-loaded chunk.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-7 | Integration | `moon run hub:build` chunk report in the PR | `/catalog` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run hub:build`

**Watch Points**:
- `rollup-plugin-visualizer` is already a hub devDependency. Use it and attach
  the before/after to the PR.

## Implementation Sequence

1. **Phase 1 (Dispatch)** — `previewKindForEntry` plus unit tests. No UI change.
2. **Phase 2 (Island)** — add the client-only preview slot to
   `catalog_asset_view.svelte`, layered over the thumbnail. Wire the CDN
   resolver. Get one category (`lpc`) working end to end. Write AC-1, AC-2,
   AC-5.
3. **Phase 3 (Remaining kinds)** — tileset, map, prop, pack. Add the narrow
   tileset-shard fetch for map and pack pages. Write AC-3, AC-4.
4. **Phase 4 (URL sync)** — LPC configuration in the URL. Write AC-6.
5. **Phase 5 (Docs + budget)** — docs page; chunk report; AC-7.
6. **Phase 6 (Validation)** — `bun run fix && bun moon run :validate && bun run test`,
   then the visual suites.

## Edge Cases & Gotchas

- **Shard cost.** An LPC detail page must not fetch all `lpc__*` shards. It
  needs the one shard containing its own entry, discovered from the root index —
  the discipline `catalog_index.ts` already documents. Fetching everything to
  build a full catalog would pull megabytes for one sprite.
- **Cloudflare Worker CPU limits.** Everything preview-related is client-side,
  so the Worker's per-request budget is unaffected. Keep it that way — no
  server-side rendering of previews, ever.
- **Content packs are not a single asset.** A pack detail page lists the pack's
  constituent entries (`contentPacks:<pack>:maps:*` and friends) and links to
  each. Do not try to render "the pack" as one preview.
- **Thumbnail-to-canvas swap must not flash.** Keep the thumbnail visible
  underneath and hide it only after the canvas has painted its first frame, not
  when the component mounts.
- **Audio categories (`music`, `sfx`, `ambient`)** map to `PreviewKind.none`
  here. An audio player is reasonable follow-up work but is not in scope.

## Open Questions

Must be resolved before status becomes `approved`:

- None. Route visibility decided 2026-08-26: these stay under `(public)` —
  public asset browsing is the stated purpose.

## Amendments

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

---
