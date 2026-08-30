---
id: C-445
title: "Shared Preview Package — One Set of Asset Preview Surfaces"
source: "user request 2026-08-26 — one place for hub, client dev, and the actual game"
status: draft
github:
    issue_number: null
    issue_url: null
    project_item_id: null
    pr_url: "https://github.com/BearlySleeping/aikami/pull/200"
    pr_number: 200
created_at: "2026-08-26"
---

# Contract C-445: Shared Preview Package — One Set of Asset Preview Surfaces

## Metadata

| Field                | Value                                                                                                                                                                                     |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Source**           | User request (2026-08-26): _"I want to add lpc rendering preview in hub so people can check assets, same with map and tileset and props… I would like to have a single source of truth."_ |
| **Target**           | `packages/frontend/preview/` (new), `apps/frontend/client/src/lib/views/dev/lpc/`, `apps/frontend/client/src/lib/data/lpc_renderer.ts`                                                    |
| **Priority**         | P1 — this is where "one place for hub and client dev" actually lands. Without it, C-446 and C-447 duplicate the client's dev tooling in the hub.                                          |
| **Dependencies**     | C-442, C-443, C-444. All must merge first.                                                                                                                                                |
| **Status**           | draft                                                                                                                                                                                     |
| **Promotion**        | `sandbox`                                                                                                                                                                                 |
| **Docs Impact**      | internal → none                                                                                                                                                                           |
| **Contract version** | 1.0.0                                                                                                                                                                                     |

## Problem & Baseline Evidence

- **Current behavior**: every asset preview surface lives inside
  `apps/frontend/client/src/lib/views/dev/`, unreachable from the hub by the
  monorepo's own boundary rule (_"Never import from another app"_, CLAUDE.md).
  Measured 2026-08-26:

    ```
    views/dev/lpc/lpc_view_model.svelte.ts        1036 lines
    views/dev/lpc/lpc_view.svelte                  471
    views/dev/lpc/lpc_pixi_facade.ts
    views/dev/lpc_walk/lpc_walk_test_view_model     473
    views/dev/lpc_inventory/…
    views/dev/sandbox/map/map_sandbox_view_model    413
    ```

- **The routes are already thin — the extraction target is obvious.**
  `apps/frontend/client/src/routes/(dev)/dev/lpc/+page.svelte` is 11 lines;
  `apps/frontend/client/src/routes/(dev)/dev/(sandbox)/sandbox/map/+page.svelte`
  is 18. Both do nothing but construct a view model and render a view. The
  substance is all in `$lib/views/dev/`, which is app-local purely by history.

- **The Pixi LPC pipeline is client-local too.**
  `apps/frontend/client/src/lib/data/lpc_renderer.ts` (432 lines) — sheet
  loading, frame extraction, sprite construction — sits in the client app's
  `$lib/data`, so the hub cannot use it. C-444 makes it instance-scoped;
  this contract moves it somewhere both apps can reach.

- **Dev routes are gated out of production client builds.**
  `apps/frontend/client/svelte.config.js` points `files.routes` at a filtered
  copy (`.svelte-kit/routes-prod`) unless `AIKAMI_INCLUDE_DEV_ROUTES=true`
  (C-418 Feature B). So today these surfaces exist only for developers with a
  dev build — never for the people who actually want to browse assets.

- **Existing implementation to reuse**: all of it. This is a move-and-generalise
  contract, not a rewrite. The LPC dev page already has slot pickers, palette
  overrides, state/direction selectors, frame stepping, zoom, and URL state
  serialisation (`data/lpc_url_config.ts`, 247 lines) — that last one is
  genuinely good and should become the shareable-preview-link mechanism in
  the hub.

- **Known gaps**: nothing in `packages/frontend/` hosts Svelte components with
  view models; `packages/frontend/components` exists but holds primitives.

- **Baseline tests**: `bun test apps/frontend/client/src/lib/views/dev/` and
  `bun test apps/frontend/client/src/lib/data/lpc_renderer.test.ts`.

## User Outcome

After this contract, a **developer** fixes an LPC z-order bug or a tileset
seam once, in one component, and the fix appears in the client dev route and
the hub simultaneously — and a **creator** browsing the hub sees the same
renderer the game uses, not a lookalike.

## Success Measures

- **Time/latency target**: an LPC preview reaches first painted frame within
  400 ms of the resolver being supplied, on a warm CDN cache.
- **Offline/degraded behavior**: with a resolver that returns `null` for every
  tag, each component renders a labelled placeholder and logs at `warn` once —
  never an empty canvas with no explanation.
- **Production journey enabled**: hub asset browsing (C-446) and the hub walk
  sandbox (C-447).

## Existing System & Reuse Map

| Capability              | Existing source                                             | Reuse / modify / replace                                                     |
| ----------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------- |
| LPC texture pipeline    | `client/src/lib/data/lpc_renderer.ts`                       | **modify** — move into the package as `createLpcRenderer` (shape from C-444) |
| LPC preview UI          | `client/src/lib/views/dev/lpc/lpc_view.svelte` + view model | **modify** — move, drop client-only imports, take a resolver prop            |
| Pixi facade             | `client/src/lib/views/dev/lpc/lpc_pixi_facade.ts`           | **modify** — move                                                            |
| URL state serialisation | `client/src/lib/data/lpc_url_config.ts`                     | **modify** — move; becomes the shareable preview link format                 |
| Walk preview            | `client/src/lib/views/dev/lpc_walk/`                        | **modify** — move                                                            |
| Icon framing            | `client/src/lib/data/lpc_icon_frame.ts`                     | **modify** — move                                                            |
| Map sandbox             | `client/src/lib/views/dev/sandbox/map/`                     | **modify** — move; the engine-mounting parts become `WalkSandbox`            |
| Tileset / prop preview  | —                                                           | **new** — no equivalent exists today                                         |
| View model base         | `@aikami/frontend/services` `BaseViewModel`                 | **reuse** — both apps already use it                                         |

## Overview

Create `packages/frontend/preview` (`@aikami/frontend/preview`): Svelte 5
components plus view models for previewing catalog assets. It owns the Pixi LPC
pipeline, an LPC character preview with slot and animation controls, a tileset
grid viewer, a prop viewer, a static map viewer, and a mountable walk sandbox.
Every component takes an `AssetResolver` and a catalog as props — it never
reaches for a store. The client's `(dev)` routes become wrappers around it, as
its `+page.svelte` files already are.

## Design Reference

- Follow `svelte-conventions`: logicless views + `.svelte.ts` view models,
  Runes, `$props()`, `$derived`. Views must contain no logic.
- Follow `aikami-ui`: Tailwind + DaisyUI. The package must not ship its own
  design tokens — it consumes `@aikami/frontend/theme`, as the hub already does.
- `packages/frontend/components` is the scaffolding reference for a
  Svelte-shipping workspace package.
- `BaseViewModel` / `BaseViewModelInterface` from `@aikami/frontend/services`
  is the required view-model base — both apps already render it through their
  own `base_view_model_container.svelte`.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- **Props in, nothing global out.** Every exported component takes
  `{ resolver: AssetResolver; catalog: LpcCatalog }` (or the equivalent for its
  asset class) as props. No component may import a store, a `$app/*` module, a
  `$lib/*` alias, or anything from `apps/**`.
- **No SvelteKit dependency.** The package must be mountable from a plain
  component tree. Routing, page data, and URL mutation stay in the host app;
  the package exposes URL _serialisation_ (pure functions) but never touches
  `history` or `$app/navigation`.
- Pixi is imported only inside `onMount`-guarded code paths so a host can render
  the component tree during SSR without a canvas. Components render a
  placeholder until mounted.
- The package depends on `@aikami/frontend/engine/render` and
  `@aikami/frontend/engine/content` — not the root barrel — except
  `WalkSandbox`, which needs `GameWorld` and therefore the root barrel and the
  `./worker` subpath.
- **`WalkSandbox` is separately exported** at `@aikami/frontend/preview/sandbox`
  so hosts that only want static previews never pull `GameWorld`, `bitecs`, or
  the worker into their bundle.
- Client `(dev)` route view models are **deleted**, not kept as adapters. Two
  copies is the thing being fixed.

## State & Data Models

```ts
// packages/frontend/preview/src/index.ts — static previews
export { default as LpcPreview } from "./lib/lpc/lpc_preview.svelte";
export { default as TilesetPreview } from "./lib/tileset/tileset_preview.svelte";
export { default as PropPreview } from "./lib/prop/prop_preview.svelte";
export { default as MapPreview } from "./lib/map/map_preview.svelte";
export { createLpcRenderer, type LpcRenderer } from "./lib/lpc/lpc_renderer.ts";
export { encodeLpcPreviewState, decodeLpcPreviewState, type LpcPreviewState } from "./lib/lpc/preview_url_state.ts";
export type { PreviewProps } from "./lib/types.ts";

// packages/frontend/preview/src/sandbox.ts — engine-mounting preview
export { default as WalkSandbox } from "./lib/sandbox/walk_sandbox.svelte";
export { getWalkSandboxViewModel, type WalkSandboxViewModelInterface } from "./lib/sandbox/walk_sandbox_view_model.svelte.ts";
```

```ts
// packages/frontend/preview/src/lib/types.ts
import type { AssetResolver } from "@aikami/types";
import type { LpcCatalog } from "@aikami/lpc";

/** Every preview component takes at least this. */
export type PreviewProps = {
	/** Host-supplied resolution strategy (registry, cdn, or fixture). */
	readonly resolver: AssetResolver;
	/** Rendered size in CSS pixels. */
	readonly width?: number;
	readonly height?: number;
	/** Integer upscale factor for pixel art. Defaults to 2. */
	readonly zoom?: number;
};

export type LpcPreviewProps = PreviewProps & {
	readonly catalog: LpcCatalog;
	/** Initial selection; the component owns changes after mount. */
	readonly initialState?: LpcPreviewState;
	/** Fired whenever the selection changes, so hosts can sync a URL. */
	readonly onStateChange?: (state: LpcPreviewState) => void;
	/** Hide the control panel for embedded / thumbnail use. */
	readonly controls?: boolean;
};

export type TilesetPreviewProps = PreviewProps & {
	readonly tag: string;
	/** Tile size in source pixels. Defaults to 32. */
	readonly tileSize?: number;
	/** Draw the tile grid overlay. */
	readonly showGrid?: boolean;
};

export type MapPreviewProps = PreviewProps & {
	readonly mapTag: string;
	/** Overlay the collision grid returned by extractCollisionGrid. */
	readonly showCollision?: boolean;
	/** Colour entities by their WORLD_Z_BANDS band. */
	readonly showZBands?: boolean;
};
```

## Quality Requirements

- **Offline/degraded mode**: a resolver returning `null` yields a labelled
  placeholder per component, one `warn` log, and no thrown error.
- **Accessibility/input**: every control is keyboard reachable; the canvas has
  an `aria-label` describing what is rendered; animation respects
  `prefers-reduced-motion` by defaulting to a paused first frame.
- **Performance budget**: a mounted LPC preview holds at most 64 cached frame
  textures and releases every resolver URL on unmount. `WalkSandbox` holds one
  `GameWorld` and destroys it on unmount — a mount/unmount cycle must not grow
  WebGL context count.
- **Security/privacy**: N/A — public asset bytes only.
- **Persistence/migration**: the URL state format moves from
  `client/src/lib/data/lpc_url_config.ts`. Existing dev-route links must keep
  working — see Migration & Rollback.
- **Cancellation/retry/idempotency**: unmounting mid-load cancels outstanding
  texture loads; a second mount re-requests cleanly.
- **Observability**: each component logs mount, unmount, and unresolved-tag
  count at `debug`, prefixed with its component name.

## Migration & Rollback

- **Old data compatibility**: the compact positional URL encoding documented in
  `lpc_url_config.ts` (`l<N>=<slotDefIndex>:<variantIndex>`, `p<N>:<i>=<hex>`,
  `state`, `dir`, `frame`, `playing`, `zoom`) is preserved byte-for-byte.
  Existing bookmarked dev links must decode identically.
- **Migration**: none — the encoding is unchanged and the underlying variant
  ordering is guaranteed stable by C-442 AC-3.
- **Rollback**: revert. The client dev routes' view models return with the
  revert since the move is a single commit range.
- **Feature flag or kill switch**: none needed — this contract adds no
  production route. The client dev routes remain gated by
  `AIKAMI_INCLUDE_DEV_ROUTES`.
- **Failure recovery**: N/A.

## Scope Boundaries

- **In Scope:**
    - New package `packages/frontend/preview` with two entrypoints
      (`.` and `./sandbox`).
    - Moving the LPC Pixi pipeline, LPC preview UI, walk preview, icon framing,
      and URL state serialisation into it.
    - New `TilesetPreview`, `PropPreview`, `MapPreview` components.
    - `WalkSandbox` generalised from the client's map sandbox view model.
    - Rewriting the client `(dev)` routes as wrappers; deleting the moved
      view models.
    - A visual suite covering each component against a fixture resolver.
- **Out of Scope:**
    - Any hub route or hub wiring — C-446, C-447.
    - The non-preview dev routes (`text`, `voice`, `image`, `audio`, `save_load`,
      `settings`, `config`, `session`, `world_gen`, `export`, `autonomous`,
      `combat`, `camera`, `environment`, `party_follow`, `expression`,
      `character_sheet`, `lpc_ai`, `lpc_inventory`). They stay in the client.
      Only asset-preview surfaces move.
    - Changing what the previews render. Feature parity with today's dev pages is
      the bar; new controls are follow-up work.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** one outcome — the shared preview surface. Landing the
package without repointing the client dev routes would leave two live copies of
the LPC preview, which the split rule forbids. The three new components
(tileset, prop, map) ship together because they share the resolver plumbing and
the visual suite; splitting them would triple the setup cost for one feature.

## Acceptance Criteria

### AC-1: The package is host-agnostic

**Given** `packages/frontend/preview`
**When** its source is searched
**Then** no module imports from `apps/**`, `$app/*`, `$lib/*`, `$services`, or
any Svelte store defined outside the package, and `package.json` declares no
dependency on either app.

**Evidence Matrix**:

| AC   | Test Level | Required Artifact                                                   | Production Path | Evidence                   |
| ---- | ---------- | ------------------------------------------------------------------- | --------------- | -------------------------- |
| AC-1 | Unit       | `packages/frontend/preview/src/lib/__tests__/host_agnostic.test.ts` | N/A             | Filled during verification |

**Test Hooks**:

- Moon Task: `moon run preview:test`

**Watch Points**:

- `logger` is the one permitted cross-cutting import, via the `$logger` path
  mapping. Everything else must arrive as a prop.

---

### AC-2: LPC preview renders from a fixture resolver

**Given** `LpcPreview` mounted with a `kind: 'fixture'` resolver and a catalog
built by `buildLpcCatalog` over fixture entries
**When** the component mounts
**Then** a composed multi-layer sprite is painted, changing a slot repaints,
changing direction changes the sheet row, and stepping the frame advances the
source rectangle.

**Evidence Matrix**:

| AC   | Test Level | Required Artifact                                  | Production Path | Evidence                   |
| ---- | ---------- | -------------------------------------------------- | --------------- | -------------------------- |
| AC-2 | Visual     | `apps/e2e/src/visual/suites/preview_lpc.visual.ts` | `/dev/lpc`      | Filled during verification |

**Test Hooks**:

- Moon Task: `moon run preview:test`
- E2E / Visual:
    - **Functional**: N/A.
    - **Visual**: `apps/e2e/src/visual/suites/preview_lpc.visual.ts` using
      `defineConfig` + `export default`. Cases: `lpc-front-idle`
      (`/dev/lpc`, no params), `lpc-side-walk` (`?dir=1&state=8&frame=2`),
      `lpc-layered` (a params string selecting hair + torso + legs + feet).
      AI criteria: _"Score 90+: a single coherent LPC humanoid character is
      visible with correctly stacked layers — hair above head, torso above body,
      no layer offset by more than one pixel, no z-fighting or double-drawn
      limbs, facing the direction named in the case."_

**Watch Points**:

- Layer z-order is direction-dependent (`LPC_LAYER_ORDER`, C-430). The `up`
  direction is where wrong ordering shows first — include it.

---

### AC-3: Tileset preview shows a correct grid

**Given** `TilesetPreview` with a tileset tag and `tileSize: 32`
**When** it mounts with `showGrid: true`
**Then** the atlas renders at integer scale with no bilinear smoothing, the grid
overlay aligns to tile boundaries, and hovering a tile reports its index.

**Evidence Matrix**:

| AC   | Test Level | Required Artifact                                      | Production Path         | Evidence                   |
| ---- | ---------- | ------------------------------------------------------ | ----------------------- | -------------------------- |
| AC-3 | Visual     | `apps/e2e/src/visual/suites/preview_tileset.visual.ts` | `/dev/lpc` (host route) | Filled during verification |

**Test Hooks**:

- Moon Task: `moon run preview:test`
- E2E / Visual:
    - **Functional**: N/A.
    - **Visual**: cases `tileset-grid-on`, `tileset-grid-off`. AI criteria:
      _"Score 90+: pixel art renders crisply with no blur; grid lines, when
      present, align exactly to tile edges with no half-tile at any border."_

**Watch Points**:

- `installNearestTextureDefault` from the engine must be called before any
  texture loads, or every preview is blurry. It is a global Pixi default —
  call it once from the package's renderer factory.

---

### AC-4: Map preview renders tiles, collision, and z-bands

**Given** `MapPreview` with a `.jton` map tag
**When** it mounts with `showCollision` and `showZBands` enabled
**Then** tile layers render in order, blocked cells are tinted, and entities are
coloured by their `WORLD_Z_BANDS` band.

**Evidence Matrix**:

| AC   | Test Level | Required Artifact                                  | Production Path    | Evidence                   |
| ---- | ---------- | -------------------------------------------------- | ------------------ | -------------------------- |
| AC-4 | Visual     | `apps/e2e/src/visual/suites/preview_map.visual.ts` | `/dev/sandbox/map` | Filled during verification |

**Test Hooks**:

- Moon Task: `moon run preview:test`
- E2E / Visual:
    - **Functional**: N/A.
    - **Visual**: cases `map-plain`, `map-collision`, `map-zbands`. AI criteria:
      _"Score 90+: a coherent tilemap with no gaps or misaligned tiles; collision
      tint, when enabled, covers solid features such as walls and water and not
      open floor."_

**Watch Points**:

- Reuse `loadJtonMap`, `extractCollisionGrid`, `buildTilemapChunks` from
  `@aikami/frontend/engine/content` and `/render`. Do not write a second
  tilemap renderer for previews — that is the exact mistake this contract
  exists to undo.

---

### AC-5: Client dev routes are wrappers, with no duplicate view model

**Given** the merged branch
**When** `apps/frontend/client/src/routes/(dev)/dev/lpc/+page.svelte` and
`.../sandbox/map/+page.svelte` are read
**Then** each imports its component from `@aikami/frontend/preview`, and
`apps/frontend/client/src/lib/views/dev/lpc/` and
`apps/frontend/client/src/lib/views/dev/lpc_walk/` no longer exist.

**Evidence Matrix**:

| AC   | Test Level  | Required Artifact                          | Production Path                | Evidence                   |
| ---- | ----------- | ------------------------------------------ | ------------------------------ | -------------------------- |
| AC-5 | Integration | `moon check` + directory listing in the PR | `/dev/lpc`, `/dev/sandbox/map` | Filled during verification |

**Test Hooks**:

- Moon Task: `moon check`, `moon run client:build`

**Watch Points**:

- The client dev routes must still supply the **registry** resolver, so they
  keep exercising the cached/offline path. If they silently switch to the CDN
  resolver, the dev routes stop testing what the game does.

---

### AC-6: Mount/unmount does not leak

**Given** any preview component
**When** it is mounted and unmounted 20 times
**Then** the WebGL context count returns to its starting value, every resolver
URL acquired has been released, and the frame-texture cache is empty.

**Evidence Matrix**:

| AC   | Test Level | Required Artifact                                               | Production Path | Evidence                   |
| ---- | ---------- | --------------------------------------------------------------- | --------------- | -------------------------- |
| AC-6 | Unit       | `packages/frontend/preview/src/lib/__tests__/lifecycle.test.ts` | N/A             | Filled during verification |

**Test Hooks**:

- Moon Task: `moon run preview:test`

**Watch Points**:

- The hub will mount and unmount these on every client-side navigation. A leak
  that is invisible on a dev page you load once is fatal on a browse-heavy site.
- Assert release counts against a counting `kind: 'fixture'` resolver — do not
  try to observe browser GC.

## Implementation Sequence

1. **Phase 1 (Package)** — scaffold `packages/frontend/preview` from
   `packages/frontend/components`. Two entrypoints. Wire `@aikami/frontend/theme`.
2. **Phase 2 (Move LPC)** — move the renderer, the preview UI, the walk preview,
   icon framing, and URL state. Strip client-only imports; add props. Write
   AC-1, AC-2, AC-6 tests.
3. **Phase 3 (New components)** — `TilesetPreview`, `PropPreview`, `MapPreview`
   over the existing engine loaders. Write AC-3, AC-4 visual suites.
4. **Phase 4 (WalkSandbox)** — generalise the client's map sandbox view model
   into `WalkSandbox` on the `./sandbox` entrypoint. Keep the existing debug
   overlays and query-parameter behaviour.
5. **Phase 5 (Rewire client)** — rewrite the two `(dev)` routes as wrappers,
   delete the moved view models. Write the AC-5 check.
6. **Phase 6 (Validation)** — `bun run fix && bun moon run :validate && bun run test`,
   then the visual suites.

## Edge Cases & Gotchas

- **`lpc_view_model.svelte.ts` is 1036 lines.** Do not move it as one file.
  Decompose along the lines C-425 established: selection state, palette state,
  playback state, and the Pixi bridge are four concerns. Moving the monolith
  intact makes the package inherit the client's worst file.
- **Svelte version coupling.** The package ships `.svelte` source, so both apps
  must compile it with a compatible Svelte. Client and hub both pin
  `svelte 5.56.10` today — assert that in the package's peer range rather than
  bundling Svelte.
- **`prefers-reduced-motion`** must default animation to paused, not merely slow.
  A looping sprite is exactly the kind of motion that setting exists for.
- **Do not move `lpc_ai` or `lpc_inventory`.** They are AI and gameplay
  sandboxes that happen to render LPC. Only asset-preview surfaces move.
- **`WalkSandbox` on the same entrypoint as the static previews would defeat the
  point** — a hub catalog page would then pull `GameWorld`, `bitecs`, and the
  worker for a still image. Keep the two entrypoints strictly separate and
  assert it in AC-1's test.

## Open Questions

Must be resolved before status becomes `approved`:

- None.

## Amendments

| Version | Date | Change | Approved by |
| ------- | ---- | ------ | ----------- |
| 1.0.1   | 2026-08-30 | C-450: Corrected frontmatter `status: implemented` → `draft` to match the canonical table field | C-450 pipeline |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

---
