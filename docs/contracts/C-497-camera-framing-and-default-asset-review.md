---
id: C-497
title: "Camera framing and default-asset review"
source: direct
contract_type: thin
status: implemented
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: "https://github.com/BearlySleeping/aikami/pull/308"
  pr_number: 308
created_at: "2026-09-10T00:00:00Z"
---

# Contract C-497: Camera framing and default-asset review

## Metadata

| Field | Value |
|---|---|
| **Source** | Formalizes the C-497 seed in `BACKLOG_C485_PLUS.md`; maintainer asset review, 2026-09-06 |
| **Target** | `packages/frontend/engine/src/game_world.ts` (world scale + camera wiring), `packages/frontend/engine/src/systems/camera_system.ts` (zoom/bounds, C-161/C-199), `apps/frontend/client/src/lib/views/game/` boot path, `apps/frontend/client/src/lib/views/game/hotbar/` |
| **Type** | thin |
| **Priority** | P2 — scale and composition strongly affect perceived sprite quality; cheap to fix, highly visible |
| **Dependencies** | None (preserve C-505 and C-506, both implemented; do not regress their scene semantics or readability work) |
| **Status** | approved |
| **Promotion** | — |
| **Docs Impact** | internal |
| **Contract version** | 2.0.0 |
| **Production Surface** | `/game` |

## Problem & Baseline Evidence

- **Current behavior:** a direct `/game` boot with default/transient state showed very enlarged tile repetition, an oversized portrait-like default character, and substantial empty background near the map edge. That was a transient/default setup rather than a completed onboarding journey, so it is **not** a complete art assessment — but it is enough to justify a focused framing review before any art is replaced. Do not judge LPC through a badly framed presentation.
- **Reproduction:** boot `/game` with a fresh/default profile and observe: (1) `packages/frontend/engine/src/game_world.ts:729` hard-codes `this._worldContainer.scale.set(4)` and `game_world.ts:3802` computes `scale = 4 * cameraZoom`; with 32×32 world-unit tiles this renders each tile at 128 CSS px regardless of map size, viewport size, or art pixel density. (2) `packages/frontend/engine/src/systems/camera_system.ts:51-54` treats map bounds of `0` as "no bounds (clamping disabled)", so a boot that never delivers real map dimensions renders unbounded empty space around the map edge. (3) `apps/frontend/client/src/lib/views/game/hotbar/hotbar_view.svelte:43-45` renders every unassigned slot as an empty control with a `+` glyph.
- **Existing implementation to reuse:** C-161 dialogue zoom (`camera_system.ts:224` targets 1.5× and lerps back to 1.0×), `setMapBounds` with the `disableClamping` escape hatch for visual-testing sandboxes (`camera_system.ts:124-132`), viewport-size reporting to the worker (`game_world.ts:868-894`), and the existing visual suites under `apps/e2e/src/visual/suites/` (`environment.visual.ts`, `emberwatch.visual.ts`) as the baseline-capture mechanism.
- **Known gaps:** the 4× base scale is a magic constant with no stated relationship to tile size, viewport size, or art pixel density; the transient/default `/game` boot has no guaranteed framing parity with a campaign boot; empty hotbar slots are always visible chrome.
- **Baseline tests:** existing engine camera/rendering tests under `packages/frontend/engine/src/__tests__/` and the visual suites named above. Capture the current normal-game and diagnostic-boot renders before changing framing.

## User Outcome

After this contract, a player booting into any map sees it at a deliberate, stated scale that fills the viewport without large empty margins, the HUD shows only assigned hotbar slots, and a maintainer reviewing default art sees it framed the same way a player would.

## Scope Boundaries

- **In Scope:** choosing and applying a stated base-zoom/tile-scale policy; guaranteeing framing parity between a normal campaign boot and a default/transient `/game` boot; map-edge margin behavior at boot; hiding unassigned hotbar slots; capturing new baseline screenshots via the visual suite.
- **Out of Scope:** replacing any art; the art-direction decision (proportions, palette, portrait style — a maintainer decision per `BACKLOG_C485_PLUS.md`, assumed to exist); C-161 dialogue-zoom mechanics (1.0–1.5× relative behavior is preserved); canonical scene normalization and whole-map preview (C-505, implemented); grounding/depth/readability rendering (C-506, implemented); the visual definition/import path (C-496); minimap/quest-marker HUD work (C-502/C-503); a global renderer rewrite.

## Acceptance Criteria

### AC-1: Normal boot renders within a stated framing range
**Given** a normally-configured campaign boot,
**When** the map renders at common viewport sizes (desktop window and small window),
**Then** tile scale and camera zoom are within a stated target range recorded in the contract execution report (base scale is a named, configurable policy — not a bare `4` literal — and the policy constant lives in `packages/shared/constants/` per the Allocation Truth Matrix so it is shared, not defined inside `apps/**`), and the map fills the viewport without large empty margins.

**Verification**: visual suite capture of a campaign boot on `/game` at two viewport sizes, plus an engine test asserting base scale derives from the named policy for a given tile size and viewport.

### AC-2: Diagnostic/default boot shares the normal framing
**Given** the `/game` boot with default/transient state (no completed onboarding journey),
**When** it renders,
**Then** it uses the same base-scale policy and map-bounds behavior as a normal boot — the diagnostic path does not have its own accidental defaults, and a missing/zero map dimension cannot leave the camera unbounded over empty space.

**Verification**: visual suite capture of the default `/game` boot compared against the AC-1 campaign capture at the same viewport; unit coverage of the zero-bounds path in `camera_system.ts`.

### AC-3: Unassigned hotbar slots are hidden
**Given** the in-game hotbar with fewer assigned abilities than slots,
**When** the HUD renders,
**Then** only assigned slots are shown; empty slots render no button, no `+` glyph and no keybind label. Assigning or clearing an ability updates the visible slot count without a reload.

**Verification**: component test of `hotbar_view_model.svelte.ts` slot projection plus a visual capture of the `/game` HUD with a partially-filled hotbar.

### AC-4: New framing becomes the recorded baseline
**Given** the framing change from AC-1/AC-2,
**When** the visual suite runs,
**Then** new baseline screenshots for the normal boot, the default boot and the hotbar HUD are captured and recorded as the baseline for future asset and readability reviews.

**Verification**: the relevant suites under `apps/e2e/src/visual/suites/` pass against the new framing and their captures are referenced from the execution report.

## Edge Cases & Gotchas

- **Viewport smaller than the map at minimum zoom:** the framing policy must state which constraint wins (fill vs. whole-map visibility) instead of letting clamping center on empty space.
- **C-161 dialogue zoom composes multiplicatively** with the base scale (`4 * cameraZoom` at `game_world.ts:3802`); changing the base scale silently changes dialogue framing — re-verify the 1.5× close-up visually after the change and record that capture in the execution report, since no AC below guards the C-161 regression.
- **`disableClamping` exists for visual-testing sandboxes** (`camera_system.ts:124-132`); the production boot must not rely on it, and sandbox captures must not be mistaken for the production baseline.
- **Do not "fix" perceived art quality by zooming.** This contract fixes presentation only; if sprites still read poorly at correct framing, that is input to the art-direction decision, not a reason to ship a non-standard zoom.

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
|---|---|---|---|
| 2.0.0 | 2026-09-10 | Formal draft replaces backlog seed; baseline line refs re-verified on 2026-09-10 | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

## Execution Report

### Summary

C-497 makes the world-render base scale a named, configurable policy, fixes the boot camera clamp so the map actually fills the viewport, and hides unassigned hotbar slots. The bare `4` world-scale literal in `game_world.ts` (container scale, resize reporting, render-zoom, unprojection) and `camera_system.ts` (default scale, reset) is replaced by `BASE_WORLD_SCALE` from a new shared `packages/shared/constants/src/lib/game/world_scale.ts` module, with a `computeWorldScale(tileSize, viewport, mapSize)` policy function and default-map extent constants. `setMapBounds` substitutes the default map extent when a dimension is missing/zero (AC-2). The real boot defect is fixed in the worker spawn path: `resetCameraTracking()` clears the map-bounds and screen-size config, and it previously ran *after* `setMapBounds(...)`, leaving `mapPixelWidth/Height` at 0 so the `mapPixelWidth > 0` guard skipped viewport clamping entirely and the camera drifted into empty background past the map edge. The spawn path now resets tracking first, restores the screen size, then applies the bounds (AC-1/AC-2). The hotbar renders only assigned slots via a new `assignedSlots` projection, dropping the `+`/empty-slot chrome (AC-3). A new visual baseline suite captures the framing and passes under AI evaluation (AC-4).

### AC Status

| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | `BASE_WORLD_SCALE` named policy constant in `packages/shared/constants/` (barrel-exported); `computeWorldScale` derives a scale from tile size/viewport/map and is covered by `world_scale.test.ts` + `camera_system.test.ts`. All bare `4` world-scale literals removed. Recorded target range: base scale 4 → 32px tile ≈ 128 CSS px. Visual: normal boot fills the viewport at both viewport sizes with **0** solid-background (void) rows — it was ~13% of the viewport before the clamp-order fix. |
| AC-2 | ✅ | `setMapBounds` substitutes `DEFAULT_MAP_WORLD_*` on missing/zero dimensions (unit-tested). The boot clamp now actually engages (spawn path resets tracking first, then restores screen size and applies the bounds), so a default/transient boot shares the normal framing and no unbounded empty space is visible. `disableClamping` sandbox bypass preserved. |
| AC-3 | ✅ | New `assignedSlots` projection on `hotbar_view_model.svelte.ts`; `hotbar_view.svelte` renders only assigned slots — no button, no `+` glyph and no keybind label for empty slots. 4 new component tests; reactive on assign/clear. Visual: a partially-filled hotbar capture shows only "Second Wind" (keybind 1) and "Action Surge" (keybind 3). |
| AC-4 | ✅ | New suite `apps/e2e/src/visual/suites/framing_baseline.visual.ts`: normal boot (desktop 1280×720 + small window 800×600), default/transient boot, and a partially-filled hotbar HUD. **4/4 cases pass** AI evaluation (90–95/100). Captures and `report.html` land in `apps/e2e/test-results/visual/`. |

### Files Created

| File | Purpose |
|---|---|
| `packages/shared/constants/src/lib/game/world_scale.ts` | Named framing policy: `BASE_WORLD_SCALE`, `DEFAULT_TILE_SIZE`, `computeWorldScale`, default-map extent constants. |
| `packages/shared/constants/src/lib/game/world_scale.test.ts` | Tests for the base-scale policy + default-map extents. |
| `apps/e2e/src/visual/suites/framing_baseline.visual.ts` | AC-4 baseline suite: normal boot ×2 viewports, default boot, partially-filled hotbar HUD. |

### Files Modified

| File | Change |
|---|---|
| `packages/shared/constants/src/index.ts` | Export the new `world_scale` module. |
| `packages/frontend/engine/src/game_world.ts` | Replace bare `4` world-scale literals with `BASE_WORLD_SCALE` (container scale, resize reporting, render zoom, unprojection). |
| `packages/frontend/engine/src/systems/camera_system.ts` | Use `BASE_WORLD_SCALE`; `setMapBounds` substitutes the default map extent on missing/zero dimensions (AC-2). |
| `packages/frontend/engine/src/systems/camera_system.test.ts` | AC-1 framing-policy tests + AC-2 zero-bounds clamp test. |
| `packages/frontend/engine/src/worker/ecs_worker.ts` | Spawn path: reset camera tracking before applying map bounds/screen size so the viewport clamp is not silently disarmed (AC-1/AC-2). |
| `apps/frontend/client/src/lib/views/game/hotbar/hotbar_view_model.svelte.ts` | Add `assignedSlots` projection (assigned slots only). |
| `apps/frontend/client/src/lib/views/game/hotbar/hotbar_view.svelte` | Render `assignedSlots` only; remove the `+`/empty-slot chrome. |
| `apps/frontend/client/src/lib/views/game/hotbar/hotbar_view_model.test.ts` | 4 new component tests for the `assignedSlots` projection. |
| `apps/e2e/src/visual/core/capture.ts` | Resolve the Chromium binary robustly so the visual runner never points at a non-existent `chromium-<rev>` path (unblocks the visual gate; pre-existing drift, not a framing change). |

### Deviations from Spec

No AC was wrong or changed. The base scale is preserved at 4 (128 CSS px/tile) as the named, documented target range rather than auto-downscaling at boot: per the Edge Case guidance the fix is presentation-only, the C-161 1.5× dialogue-zoom relationship (multiplicative on the base scale) is unchanged, and the framing defect was fixed in the camera clamp rather than by zooming. `computeWorldScale` is exported and unit-tested as the stated policy, but the production boot intentionally keeps the constant so no art-scale change is introduced.

### Test Results

- Unit (constants): 136/136 pass, 0 fail — includes `world_scale.test.ts` 5/5.
- Unit (engine camera): 23/23 pass, 0 fail (`camera_system.test.ts`).
- Component (client): 2523 pass, 0 fail (167 files) — includes the 12 hotbar cases.
- Typecheck: constants ✅, engine ✅, client ✅, e2e ✅.
- Visual `framing_baseline` (AI-evaluated): **4/4 pass** — `normal-boot-desktop` 95/100, `normal-boot-small-window` 90/100, `default-boot` 95/100, `hotbar-hud` 90/100; every gated boolean true, zero reported issues.
- Pre-existing/environmental (not introduced here): 2 `emberwatch_content_audit` tests fail because the generated `atlas.json` asset is not built in this worktree; that suite is `runInCI: false` and unrelated to this contract.

