---
id: C-447
title: "Hub Walkable Map Sandbox — Collision, Z-Order and Render Ordering in the Browser"
source: "user request 2026-08-26 — have a character walk around in a map sandbox in hub to detect collision, render ordering"
status: draft
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-08-26"
---

# Contract C-447: Hub Walkable Map Sandbox — Collision, Z-Order and Render Ordering in the Browser

## Metadata

| Field | Value |
|---|---|
| **Source** | User request (2026-08-26): *"Maybe have a character walk around in a map sandbox in hub to detect collision, render ordering, etc."* |
| **Target** | `apps/frontend/hub/src/routes/(public)/sandbox/`, `apps/frontend/hub/src/lib/views/sandbox/` |
| **Priority** | P2 — high value for content authors, and the only surface that validates a map end to end. Strictly downstream. |
| **Dependencies** | C-442, C-443, C-444, C-445, C-446. All must merge first. |
| **Status** | draft |
| **Promotion** | `integrated` |
| **Docs Impact** | user-facing → map authoring page in `apps/frontend/docs/src/content/docs/` |
| **Contract version** | 1.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: the only way to walk a map is a client dev route that is
  compiled out of production builds.
  `apps/frontend/client/src/routes/(dev)/dev/(sandbox)/sandbox/map/+page.svelte`
  mounts a real `GameWorld` with the ECS worker, and
  `apps/frontend/client/svelte.config.js` (C-418 Feature B) excludes the whole
  `(dev)` group unless `AIKAMI_INCLUDE_DEV_ROUTES=true`. A content author with
  no checkout has no way to test a map at all.

- **The client sandbox is hard-wired to three fixture zones.**
  `map_sandbox_view_model.svelte.ts:56-62` exposes `loadZoneA` / `loadZoneB` /
  `loadZoneC`, and its `ZONE_TRIGGERED` handler routes by substring match on
  filenames (`event.targetMap.includes('sandbox_zone_b')`). Nothing accepts an
  arbitrary map tag.

- **The pieces needed for a real sandbox all exist and are proven:**
  | Piece | Source |
  |---|---|
  | Collision grid extraction | `engine/src/assets/map_loader.ts` `extractCollisionGrid` |
  | Walkability query | `engine/src/systems/collision_system.ts` `isWalkable`, `isCellBlocked` |
  | Z-band ordering | `engine/src/rendering/layer_bands.ts` `WORLD_Z_BANDS`, `computeEntityZIndex` (C-376 AC-4) |
  | Chunked tilemap render | `engine/src/rendering/tilemap_chunk_renderer.ts` |
  | Simulation worker | `engine/src/worker/ecs_worker.ts` |
  | Sandbox avatar | `engine/src/entities/create_sandbox_avatar.ts` |

- **Known gaps**: no map-tag-driven sandbox; no hub route; the client sandbox's
  debug affordances are not exposed as toggles.

- **Baseline tests**: `bun test packages/frontend/engine/src/__tests__/` and the
  existing `apps/e2e/tests/game/collision_e2e.spec.ts`.

## User Outcome

After this contract, a **creator** can open any published map from the hub, walk
a character around it, and see immediately where collision is wrong, where an
entity draws in front of a wall it should be behind, and where a transition zone
does not fire — without installing the game or cloning the repo.

## Success Measures

- **Time/latency target**: the sandbox is interactive within 3 s of route entry
  on a warm CDN cache, and holds 60 fps on a mid-range laptop for a map up to
  128×128 tiles.
- **Offline/degraded behavior**: no WebGL, worker construction failure, or an
  unresolvable map each produce an explicit error state naming the cause. The
  sandbox never shows a blank canvas with no message.
- **Production journey enabled**: a content author validates a map before
  publishing a pack.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Engine mounting + lifecycle | `client/.../map_sandbox_view_model.svelte.ts` | **modify** — generalised into `WalkSandbox` by C-445; consumed here |
| Map loading by tag | `engine/src/assets/map_loader.ts` (C-434 resolver hooks) | **reuse** |
| Collision + z-band data | `collision_system.ts`, `layer_bands.ts` | **reuse** — read for overlays, never modified |
| CDN resolver | `hub/src/lib/client/services/cdn_asset_resolver.ts` (C-444) | **reuse** |
| Map catalog entries | `hub/src/lib/server/catalog/catalog_index.ts` | **reuse** |
| Hub view scaffolding | `hub/src/lib/views/catalog/` | **reuse** as the pattern |

## Overview

Add `/sandbox/[mapTag]` to the hub: a client-only route that mounts
`WalkSandbox` from `@aikami/frontend/preview/sandbox` against a published map
tag, with a controllable avatar and three debug overlays — collision grid, z-band
colouring, and render-order labels. The server load resolves the map tag against
the catalog index and 404s cleanly for an unknown tag; everything else happens in
the browser.

## Design Reference

- `WalkSandbox` (C-445) is the mounting surface. This contract supplies the map
  tag, the resolver, and the overlay toggles — it must not re-implement engine
  mounting.
- Route shape follows `apps/frontend/hub/src/routes/(public)/catalog/[category]/[tag]/`:
  a `+page.server.ts` that validates and loads, and a `+page.svelte` that
  constructs a view model from `data` via `$derived`.
- Debug overlay semantics come from the engine's own data: `isCellBlocked` for
  collision, `computeEntityZIndex` and `WORLD_Z_BANDS` for ordering. Overlays
  read engine state; they never compute their own.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- **`export const ssr = false;` on this route only.** Unlike the catalog detail
  page (C-446), a walk sandbox has nothing meaningful to server-render. It must
  not be reachable from the hub's SSR path at all.
- The route lives under `(public)`. Map validation is the stated purpose.
- All engine and preview imports are dynamic and inside `onMount`.
- **The overlays read engine state; they never fork it.** A collision overlay
  that computes its own walkability would be able to disagree with the engine —
  which defeats the entire purpose of the sandbox.
- Movement uses the engine's existing `keybinding_config` defaults so the
  sandbox exercises the same input path as the game.
- **One `GameWorld` per route instance, destroyed on unmount.** Navigating
  between maps tears down and rebuilds rather than mutating a live world.
- The route accepts an optional `?spawn=<x>,<y>` for reproducible bug reports,
  matching the existing `position_x` / `position_y` behaviour in the client
  sandbox.
- The map tag is validated **server-side** against the catalog index. An unknown
  tag 404s from the load function — never a client-side error state.

## State & Data Models

```ts
// apps/frontend/hub/src/routes/(public)/sandbox/[mapTag]/+page.server.ts
export type SandboxPageData = {
  /** Validated map entry from the catalog index. */
  readonly entry: CatalogAssetEntry;
  /** Tileset entries the map references — needed by the resolver. */
  readonly tilesetEntries: readonly CatalogAssetEntry[];
  /** Injected origin; never hardcoded. */
  readonly originUrl: string;
};
```

```ts
// apps/frontend/hub/src/lib/views/sandbox/walk_sandbox_view_model.svelte.ts
export type DebugOverlays = {
  /** Tint cells that isCellBlocked reports as blocked. */
  readonly collision: boolean;
  /** Colour entities by their WORLD_Z_BANDS band. */
  readonly zBands: boolean;
  /** Label each sprite with its computeEntityZIndex value. */
  readonly renderOrder: boolean;
  /** Draw transition-zone rectangles from extractTransitionZones. */
  readonly transitions: boolean;
  /** Draw spawn points from extractSpawnPoints. */
  readonly spawns: boolean;
};

export type HubWalkSandboxViewModelInterface = BaseViewModelInterface & {
  readonly ready: boolean;
  /** Explicit, human-readable failure — never an empty canvas. */
  readonly error: string | undefined;
  readonly overlays: DebugOverlays;
  /** Live player cell, shown in the HUD for bug reports. */
  readonly playerCell: { readonly x: number; readonly y: number } | undefined;
  /** Whether the player's current cell is walkable per the engine. */
  readonly playerCellWalkable: boolean | undefined;
  toggleOverlay: (key: keyof DebugOverlays) => void;
  /** Copy a ?spawn= link reproducing the current position. */
  copyReproLink: () => Promise<void>;
  mount: (canvas: HTMLCanvasElement) => Promise<void>;
  destroy: () => void;
};
```

## Quality Requirements

- **Offline/degraded mode**: three named failure states — *"WebGL is not
  available in this browser"*, *"Could not start the simulation worker"*,
  *"Could not load map `<tag>`"*. Each is rendered as text, not a blank canvas.
- **Accessibility/input**: keyboard movement (the engine's default bindings) is
  the primary input and must work without a mouse; every overlay toggle is a
  real focusable control; the canvas has an `aria-label`; a text HUD reports the
  player cell and its walkability so the information is available without
  reading pixels.
- **Performance budget**: 60 fps on a 128×128 map on a mid-range laptop; one
  WebGL context; one worker. Mount/unmount 10 times without growing either
  count.
- **Security/privacy**: public GETs only. No credential, no database client,
  no write key (I-1, I-7).
- **Persistence/migration**: overlay toggles persist in `localStorage` and must
  degrade silently when it throws (private windows, blocked site data).
- **Cancellation/retry/idempotency**: navigating away mid-load aborts the map
  fetch and terminates the worker. `mount` is idempotent.
- **Observability**: mount, map-load, worker-start, and each failure state log
  through the hub's `$logger` with the map tag.

## Migration & Rollback

N/A — no persistent state changes beyond a `localStorage` overlay preference,
which is per-viewer and disposable. Rollback is a revert; the route disappears.

## Scope Boundaries

- **In Scope:**
  - `/sandbox/[mapTag]` route with server-side tag validation.
  - Mounting `WalkSandbox` with the CDN resolver.
  - Five debug overlays: collision, z-bands, render order, transitions, spawns.
  - Keyboard movement via engine defaults.
  - Text HUD with player cell + walkability.
  - `?spawn=x,y` and a copy-repro-link control.
  - Docs page on validating a map.
- **Out of Scope:**
  - **Editing.** This is a viewer. No tile painting, no collision authoring, no
    saving. A map editor is a much larger contract.
  - NPCs, dialogue, combat, quests, AI, or any gameplay system beyond movement
    and collision.
  - Multi-map transitions that actually change map. Transition zones are drawn
    and their triggers reported in the HUD; the sandbox does not navigate.
  - Authentication or rate limiting.
  - Uploading a local map to test. Published tags only.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** one outcome — a walkable validation surface for published
maps. The five overlays share one mounting path and one overlay-toggle mechanism;
splitting them would multiply pipeline runs for one feature. Editing is
deliberately excluded because it is independently mergeable and independently
useful.

## Acceptance Criteria

### AC-1: A published map loads and is walkable
**Given** `/sandbox/<a published map tag>` on a build with a reachable origin
**When** the page loads and the player presses a movement key
**Then** the map renders, an avatar is visible, and the avatar's world position
changes in the direction pressed.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | E2E | `apps/e2e/tests/hub/walk_sandbox.spec.ts` | `/sandbox/[mapTag]` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run hub:build`
- E2E / Visual:
  - **Functional**: `apps/e2e/tests/hub/walk_sandbox.spec.ts` — read the HUD's
    player cell, press a direction key, assert the cell changed.
  - **Visual**: `apps/e2e/src/visual/suites/hub_walk_sandbox.visual.ts`, case
    `sandbox-loaded`. AI criteria: *"Score 90+: a rendered tilemap with a
    single visible humanoid character standing on it; no untextured
    placeholders; no character drawn outside the map bounds."*

**Watch Points**:
- The E2E must assert on the HUD text, not on canvas pixels. Pixel assertions
  on a WebGL canvas are flaky; that is what the visual suite is for.

---

### AC-2: Collision blocks movement, and the overlay agrees
**Given** the sandbox with the collision overlay enabled
**When** the player walks into a cell the engine reports as blocked
**Then** the player's cell does not change, and that cell is tinted by the
overlay — the overlay and the engine never disagree.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | E2E | `apps/e2e/tests/hub/walk_sandbox.spec.ts` | `/sandbox/[mapTag]` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run hub:test`
- E2E / Visual:
  - **Functional**: navigate to a known-blocked adjacent cell via `?spawn=`,
    press toward it, assert the HUD cell is unchanged and
    `playerCellWalkable` for the target reads false.
  - **Visual**: case `sandbox-collision-overlay`. AI criteria: *"Score 90+:
    tinted cells cover solid features — walls, water, cliffs — and do not cover
    open walkable floor."*

**Watch Points**:
- The overlay must call `isCellBlocked` from the engine. If it derives blocking
  from the tile layer itself, it can pass while the engine disagrees, which is
  the exact bug class this route exists to find.

---

### AC-3: Z-band and render-order overlays reflect engine values
**Given** the sandbox with `zBands` and `renderOrder` enabled
**When** the player walks behind and then in front of a tall object
**Then** the avatar's render-order label changes across the object's Y
threshold, and the avatar draws behind the object when above it and in front
when below it.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Visual | `apps/e2e/src/visual/suites/hub_walk_sandbox.visual.ts` | `/sandbox/[mapTag]` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run hub:test`
- E2E / Visual:
  - **Functional**: assert the reported z-index value changes across the
    threshold.
  - **Visual**: cases `sandbox-behind-object` and `sandbox-in-front-of-object`,
    driven by `?spawn=`. AI criteria: *"Score 90+: in the 'behind' case the
    character is partly occluded by the object; in the 'in front' case the
    character fully occludes the object's base. No case shows the character
    both overlapping and occluded."*

**Watch Points**:
- `computeEntityZIndex` and `MIN_ENTITY_Y` (C-376 AC-4) are the source of
  truth. Read them; do not recompute.

---

### AC-4: Failure states are explicit
**Given** each of: an unknown map tag, a blocked CDN origin, a browser without
WebGL, and a failed worker construction
**When** each is exercised
**Then** the unknown tag 404s from the server load, and each of the other three
renders its named message rather than a blank canvas.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | E2E | `apps/e2e/tests/hub/walk_sandbox_failures.spec.ts` | `/sandbox/[mapTag]` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run hub:test`
- E2E / Visual:
  - **Functional**: `apps/e2e/tests/hub/walk_sandbox_failures.spec.ts` — four
    cases, asserting status code for the 404 and message text for the rest.
  - **Visual**: N/A.

**Watch Points**:
- The unknown-tag case must be a real 404 from `+page.server.ts`. Rendering a
  client-side "not found" for a URL that returns 200 is wrong for SEO and wrong
  for the API contract.

---

### AC-5: Mounting is leak-free
**Given** the sandbox route
**When** it is entered and left 10 times
**Then** exactly one WebGL context and one worker exist at any time, and both
counts return to zero after the final navigation away.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | E2E | `apps/e2e/tests/hub/walk_sandbox.spec.ts` | `/sandbox/[mapTag]` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run hub:test`
- E2E / Visual:
  - **Functional**: instrument `Worker` construction and `getContext('webgl2')`
    from the test page, navigate repeatedly, assert the counts.
  - **Visual**: N/A.

**Watch Points**:
- Browsers cap concurrent WebGL contexts (typically 8–16). A leak here breaks
  the whole hub after a handful of navigations, not just this route.

---

### AC-6: The route is client-only and adds nothing to the Worker bundle
**Given** a production hub build
**When** the emitted Cloudflare Worker bundle is inspected
**Then** it contains no PixiJS, no bitECS, and no engine simulation code, and
its size is within 2% of the C-446 baseline.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-6 | Integration | `apps/frontend/hub/src/lib/__tests__/server_bundle_purity.test.ts` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run hub:build`

**Watch Points**:
- `export const ssr = false;` prevents rendering, not bundling. A static import
  anywhere in the route module graph still pulls the engine into the Worker
  build. Keep the imports dynamic.

## Implementation Sequence

1. **Phase 1 (Route)** — `+page.server.ts` that resolves the map tag and its
   tileset entries from the catalog index and 404s on miss. `+page.svelte`
   renders the error and loading states only. Write AC-4's 404 case.
2. **Phase 2 (Mount)** — mount `WalkSandbox` with the CDN resolver. Get AC-1
   passing with no overlays.
3. **Phase 3 (Overlays)** — collision, z-bands, render order, transitions,
   spawns, each reading engine state. Write AC-2, AC-3.
4. **Phase 4 (HUD + repro)** — text HUD, `?spawn=`, copy-repro-link. Overlay
   persistence with a guarded `localStorage` access.
5. **Phase 5 (Robustness)** — remaining AC-4 failure states, AC-5 leak test,
   AC-6 bundle assertion.
6. **Phase 6 (Validation)** — `bun run fix && bun moon run :validate && bun run test`,
   then the E2E and visual suites, then the docs page.

## Edge Cases & Gotchas

- **The worker needs a real URL in the hub's build.** The client resolves it via
  `import('@aikami/frontend/engine/worker/ecs_worker.ts?worker&type=module')`
  (`map_sandbox_view_model.svelte.ts:27`). The hub's Vite config must emit the
  same worker chunk. This is the single most likely thing to break — do it in
  Phase 2, not Phase 5.
- **Map → tileset resolution crosses shards.** A map entry lives in the `maps`
  shard; its tilesets live in `tilesets`. The load function must fetch both.
  This is the documented narrow exception to the one-category-per-page fetch
  discipline, introduced in C-446 AC-4 — reuse it, do not widen it further.
- **Large maps.** `buildTilemapChunks` + `frustumCullChunks` already handle
  this. Do not add a second culling path.
- **Keyboard capture.** The sandbox must not swallow browser shortcuts or trap
  Tab. Capture movement keys only while the canvas has focus, and show a visible
  focus ring so the user knows where input is going.
- **`?spawn=` out of bounds.** The collision system clamps out-of-bounds spawns
  (the client sandbox relies on this). Report the clamp in the HUD rather than
  silently moving the player — a content author needs to know their coordinates
  were wrong.
- **Do not port the client sandbox's zone A/B/C fixture routing.** It is
  substring matching on filenames and has no place in a tag-driven route.

## Open Questions

Must be resolved before status becomes `approved`:

- None. Route visibility decided 2026-08-26: `(public)`.

## Amendments

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

---
