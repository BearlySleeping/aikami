---
id: C-502
title: "Minimap HUD"
source: "direct"
contract_type: full
status: draft
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-09-08T14:01:09Z"
---

# Contract C-502: Minimap HUD

## Metadata

| Field | Value |
|---|---|
| **Source** | `tmp/TODO.md` — "Add minimap" |
| **Target** | `apps/frontend/client/src/lib/views/game/ui/hud/` + `packages/frontend/engine/src/systems/` — spatial HUD + camera/tilemap projection |
| **Type** | full |
| **Priority** | P2 — navigation quality-of-life; introduces the spatial-projection bridge reused by C-503 |
| **Dependencies** | none (consumes existing camera + tilemap data) |
| **Status** | draft |
| **Promotion** | `integrated` — production route `/game` |
| **Docs Impact** | none |
| **Contract version** | 2.0.0 |
| **Production Surface** | `/game` |

## Problem & Baseline Evidence

- **Current behavior**: the game has no minimap. The player navigates the world with only the on-screen camera and no top-down reference of the current map, NPCs, or their own position.
- **Reproduction**: enter `/game`, walk around — there is no persistent top-down map or position indicator anywhere in the HUD.
- **Existing implementation to reuse**:
  - `packages/frontend/engine/src/systems/camera_system.ts` — authoritative camera state: `cameraX`/`cameraY`, `currentZoom`, `screenWidth`/`screenHeight`, `currentWorldScale`, and map bounds `mapPixelWidth`/`mapPixelHeight` (C-161).
  - `packages/frontend/engine/src/systems/tilemap_render_system.ts` + `terrain_grid.ts` — tilemap data and walkable terrain.
  - `apps/frontend/client/src/lib/views/game/ui/hud/` — existing HUD components (`hp_bar.svelte`, `quest_overlay.svelte`) and their visibility rules in `game_ui_view_model.svelte.ts`.
  - `game_ui_view_model.svelte.ts` HUD visibility gating (e.g. HP bar visible only when `activeOverlay === 'NONE'`) — the minimap should follow the same convention.
- **Known gaps**:
  1. No world→screen (or world→minimap) projection primitive is exposed to the client HUD layer for general use (the existing `CAMERA_ZOOM_UPDATE` event is dialogue-only).
  2. No minimap component or toggle exists.
- **Baseline tests**: `packages/frontend/engine/src/systems/camera_system*` tests (if present), HUD visibility tests in `game_ui_view_model`. Run before starting.

## User Outcome

After this contract, a player can see their position and nearby landmarks on a small top-down minimap while exploring, and toggle it off.

## Success Measures

- **Time/latency target**: minimap updates stay within the frame budget; no per-tick full-map redraw.
- **Offline/degraded behavior**: minimap renders from local tilemap data only — no network/AI dependency.
- **Production journey enabled**: player can orient and navigate the current map without pausing.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Camera state | `packages/frontend/engine/src/systems/camera_system.ts` | reuse (add projection bridge if needed) |
| Tilemap / terrain | `tilemap_render_system.ts`, `terrain_grid.ts` | reuse |
| HUD component conventions | `apps/frontend/client/src/lib/views/game/ui/hud/` | reuse (add `minimap.svelte`) |
| HUD visibility rules | `game_ui_view_model.svelte.ts` | reuse |
| Persisted settings | existing settings service / storage key conventions | reuse (toggle) |

## Overview

Add a minimap HUD that projects the current map, the player position, and nearby entities onto a small top-down widget. It consumes existing camera/tilemap data through a spatial-projection bridge, follows the same visibility rules as the rest of the HUD, and persists its on/off state.

## Design Reference

- Follow `hp_bar.svelte` / `quest_overlay.svelte` structure and the `game_ui_view_model` visibility conventions.
- Reuse `camera_system.ts` state rather than introducing a second camera authority. If the client needs camera data at tick rate, expose it through the existing engine↔client event bridge (the same channel that carries `CAMERA_ZOOM_UPDATE`), not a new global.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- Put world→screen and world→minimap projection in one shared, unit-tested `projectSpatialPoint` API (in a shared client util or the engine event bridge); do not inline projection math in Svelte components. C-503 consumes the same API's `screen` mode.
- The minimap component must be a passive view over a ViewModel (`minimap_view_model.svelte.ts`), consistent with the MVVM convention.

## State & Data Models

```ts
type MinimapEntityBlip = {
  id: string;          // stable id (npcId / entityId)
  x: number;           // world-space X
  y: number;           // world-space Y
  kind: 'player' | 'npc' | 'enemy' | 'poi';
};

type MinimapViewState = {
  visible: boolean;
  mapBounds: { width: number; height: number } | null; // null = unknown/no bounds
  player: { x: number; y: number };
  blips: MinimapEntityBlip[];
};

type Point = { x: number; y: number };
type Bounds = { x: number; y: number; width: number; height: number };

type SpatialProjectionInput =
  | {
      mode: 'screen';
      world: Point;
      camera: { x: number; y: number; zoom: number; worldScale: number };
      viewportBounds: Bounds;
      clampTo: 'none' | 'viewport-edge';
      edgeInset?: number;
    }
  | {
      mode: 'minimap';
      world: Point;
      mapBounds: Bounds | null;
      widgetBounds: Bounds;
      clampTo: 'none' | 'widget';
    };

type SpatialProjectionResult = {
  point: Point;             // final point after the requested clamp
  unclampedPoint: Point;
  insideBounds: boolean;
  clamped: boolean;
  direction: Point | null; // normalized center→target vector for edge arrows
};

declare function projectSpatialPoint(
  input: SpatialProjectionInput,
): SpatialProjectionResult | null;
```

`screen` mode derives coordinates only from the authoritative camera state and viewport bounds. With `viewport-edge`, it clamps to the viewport minus `edgeInset` and returns the pre-clamp direction; with `none`, it preserves the projected point. `minimap` mode fits `mapBounds` into `widgetBounds` without changing map aspect ratio, maps the world point into that fitted rectangle, and optionally clamps to it. Unknown, empty, or non-finite map bounds return `null` in `minimap` mode so the ViewModel renders the unavailable placeholder; invalid camera state or viewport/widget bounds likewise return `null`. Unknown map bounds do not disable `screen` mode, which does not consume them.

No persisted schema changes beyond a settings boolean for the toggle.

## Quality Requirements

- **Offline/degraded mode**: fully local; no network.
- **Accessibility/input**: minimap is non-interactive HUD (no input capture); toggle reachable via settings.
- **Performance budget**: update at most once per frame; blip list derived incrementally, not rebuilt per tick from the full entity set.
- **Security/privacy**: N/A — local state only.
- **Persistence/migration**: N/A — only a settings boolean.
- **Cancellation/retry/idempotency**: N/A.
- **Observability**: log `minimap:toggle`; avoid per-frame logging.

## Migration & Rollback

N/A — no persistent state changes beyond an additive settings toggle (default off).

## Scope Boundaries

- **In Scope:**
  - Shared world→screen/world→minimap projection bridge.
  - Minimap HUD component + ViewModel.
  - Player blip + nearby NPC/enemy/POI blips.
  - Visibility rules (hide during overlays/combat) and persisted toggle.
- **Out of Scope:**
  - Fog-of-war / unexplored-region masking.
  - Multiple zoom levels or a full-screen map overlay.
  - Quest markers on the minimap (C-503).
  - Route finding / path display.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** single contract. One component, one projection primitive.

## Acceptance Criteria

### AC-1: Minimap renders during exploration
**Given** the game world is loaded and `activeOverlay === 'NONE'`
**When** the player explores
**Then** a top-down minimap shows the current map region with a player blip at the correct relative position.
**Production Path**: `/game`

### AC-2: Minimap tracks the player
**Given** the minimap is visible
**When** the player moves
**Then** the player blip updates to reflect the new position within the map bounds.
**Production Path**: `/game`

### AC-3: Minimap respects HUD visibility and toggle
**Given** the minimap toggle is on
**When** an overlay (dialogue/combat/inventory/…) opens, or the player turns the toggle off
**Then** the minimap hides with the rest of the exploration HUD, and its on/off state persists across reload.
**Production Path**: `/game` + `/settings`

### AC-4: Minimap stays cheap
**Given** the minimap is visible during normal play
**When** the player explores a populated map
**Then** the frame loop keeps its normal rate (no per-tick full-map redraw or ≥5s deltas).
**Production Path**: `/game` (engine tick health via debug logs)

### AC-5: Minimap works offline
**Given** no network/AI connection
**When** the player explores
**Then** the minimap renders and tracks normally from local tilemap data.
**Production Path**: `/game`

**Evidence Matrix**:

| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | E2E + Visual | `apps/e2e/tests/client/minimap.spec.ts` + visual suite | `/game` | Filled during verification |
| AC-2 | E2E + unit | `minimap_view_model.test.ts` | `/game` | Filled during verification |
| AC-3 | E2E + unit | HUD visibility tests | `/game` + `/settings` | Filled during verification |
| AC-4 | unit + manual | projection util test | `/game` | Filled during verification |
| AC-5 | manual | offline smoke | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:typecheck`, `bun moon run engine:test`
- Integration: manual `/game` smoke — move around, open dialogue, toggle minimap.
- E2E / Visual:
    - **Functional**: `apps/e2e/tests/client/minimap.spec.ts` — minimap visible in EXPLORE, hidden in DIALOGUE, toggle persists.
    - **Visual**: `apps/e2e/src/visual/suites/minimap.visual.ts` — declarative case at `/game`; schema: minimap widget top-right with player blip; OpenRouter AI evaluation: "Score 90+: small top-down map visible in a corner with a player indicator, no visual overlap with the HP bar."

**Watch Points**:
- **One camera authority** — read `camera_system.ts` state; do not create a parallel camera.
- **Projection bridge, not per-component math** — C-503 (quest markers) will reuse the same primitive; keep it shared.
- **No per-tick full redraw** — derive the minimap image incrementally or at a throttled rate.
- **Handle missing map bounds** — `mapPixelWidth/Height === 0` means unbounded; render a placeholder, don't crash.
- **Hide during dialogue zoom** — C-161 dialogue zoom overlays a speech bubble; keep the minimap out of that layer.

## Implementation Sequence

1. **Phase 1 (Projection)**: add + unit-test the shared `projectSpatialPoint` screen/minimap modes, clamping, invalid/unknown bounds behavior, and any camera-state bridge to the client.
2. **Phase 2 (View/ViewModel)**: build `minimap_view_model.svelte.ts` + `minimap.svelte`; wire into `game_ui_view` HUD with visibility + toggle.
3. **Phase 3 (Validation)**: E2E + visual; run `validate({ test: true })` and the Moon tasks above.

## Edge Cases & Gotchas

- **Map smaller than the minimap widget**: scale up, don't stretch beyond the widget bounds.
- **No bounds / unknown map**: show an "unavailable" placeholder, not a broken image.
- **Blip culling**: only include blips within the minimap's visible radius or a capped count.
- **Entity recycling**: blip ids must not leak stale entries when an entity despawns.

## Open Questions

Must be resolved before status becomes `approved`:

- Should the minimap be square (fixed scale) or rectangular (map aspect)? Default: fixed-aspect, map-bounded.

## Amendments

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)
