---
id: C-545
title: "Emberwatch baseline and ambient parity"
source: "direct"
contract_type: thin
status: implemented
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-09-23T00:00:00Z"
---

# Contract C-545: Emberwatch baseline and ambient parity

## Metadata

| Field | Value |
|---|---|
| **Source** | `docs/reference/emberwatch-polish-review-and-plan.md` — findings 1.2, 1.3, 1.4 and package P0/P1 (sections 4, 7) |
| **Target** | `packages/frontend/engine/` (ambient policy), `packages/shared/schemas/`, `packages/shared/types/`, `scripts/src/lib/ops/` (prop registry), plus this baseline doc |
| **Type** | thin |
| **Priority** | P1 — rendering consistency is the prerequisite for any environment-art acceptance |
| **Dependencies** | C-378 (day/night tint), C-417 (night floor + interior pinning), C-496/C-529 (prop presentation) |
| **Status** | implemented |
| **Promotion** | — |
| **Docs Impact** | internal → none (developer/reviewer baseline only) |
| **Contract version** | 2.0.0 |
| **Production Surface** | `none — diagnosis + engine-internal rendering fix; no player-facing UI/route added. Evidence capture is blocked (see §D).` |

## Problem & Baseline Evidence

- **Current behavior**: terrain receives the day/night/interior ambient through the tilemap shader's `uTint`, but standalone prop sprites, LPC actors and static enemies render at full source brightness. The village is also built from flat ground-tile shells and a per-tile bridge stamp.
- **Reproduction**: load any outdoor map at dawn/night in the production `/game` renderer; ground darkens while props/actors do not. Cross the village stream or the old-road culvert; every 32px bridge tile repeats its own rails and water gaps.
- **Existing implementation to reuse**: `resolveSceneAmbient` (new, C-545) over `COLOR_INTERIOR`/worker UBO; the per-entity `RenderEntry.displayObject` container tree; `buildPropFrameMeta`; the prop `renderSize`/`anchor`/`shadow` presentation fields.
- **Known gaps**: no emissive field existed on prop definitions; no single resolver for terrain + entity ambient.
- **Baseline tests**: `frontend-engine:test` — `src/__tests__/environment_lighting.test.ts`, `src/__tests__/tilemap_render.test.ts`, `src/game_world/scene_transition.test.ts`, `src/rendering/prop_presentation.test.ts`.

### Baseline SHA and diff vs the review baseline

- **Baseline SHA (this branch)**: `71678c0b828150439e3c34f9e88deae01390fddb` (`main`, fetched `origin/main`).
- **Review baseline**: `ee5478ceea7cba4078a3fba901872acb61a826bf` (plan header).
- **Commits since the review baseline**: one — `71678c0b8 chore: fix dialogue modal`.
- **Files touched since `ee5478cee` that affect engine/emberwatch**:

  | File | Change | Ambient/architecture impact |
  |---|---|---|
  | `packages/frontend/engine/src/game_world.ts` | +6: clear click-to-move destination marker on map switch | None — unrelated to tint |
  | `packages/frontend/engine/src/worker/ecs_worker.ts` | +16/-2: `clearActorMovement()` on portal transition | None — unrelated to tint |
  | `packages/frontend/engine/src/systems/path_follow_system.ts` | +22: `clearActorMovement` export | None |
  | `packages/frontend/engine/src/__tests__/portal_move_reset_regression.test.ts` | new test | None |
  | `docs/reference/emberwatch-polish-review-and-plan.md` | new review doc | The plan itself |

  No file that participates in ambient tinting, atlas painting, map building or prop presentation changed between `ee5478cee` and `71678c0b8`. Findings 1.2/1.3/1.4 are therefore **not already fixed**.

## User Outcome

After this contract, terrain, standalone props, LPC actors and static enemies in the production renderer are all multiplied by the same ambient factor at noon, dawn, night and indoors; genuinely emissive props (a lit hearth, the braziers) deliberately keep their authored brightness.

## Scope Boundaries

- **In Scope:** the baseline/diagnosis doc; one documented ambient policy applied to terrain, props, actors and enemies; an explicit per-prop `emissive` opt-out; behavioral engine tests; best-effort in-engine evidence capture.
- **Out of Scope:** asset generation; map/builder edits (findings 1.2/1.3 are diagnosed only); UI changes; guard/threshold/golden/evaluator changes; deploy/publish; human-acceptance claims. No new scene model.

## Acceptance Criteria

### AC-1: One ambient factor for terrain, props, actors, enemies
**Given** an outdoor map at a known hour (or an interior map)
**When** the frame renders
**Then** the tilemap `uTint` and every non-emissive entity container tint are the same RGB multiplier.

**Verification**: `bun moon run frontend-engine:test` — `src/__tests__/ambient_parity.test.ts` (noon/dawn/night/interior parity), plus the shared `resolveSceneAmbient` in `game_world.ts`.

### AC-2: Emissive opt-out, late loads, transitions, no HUD/terrain double tint
**Given** an emissive prop, a texture that loads after an hour change, and a map/interior transition
**When** the ambient changes
**Then** the emissive prop is untouched; a late-loading prop receives the current tint; live entities re-tint; the HUD and terrain are not tinted twice.

**Verification**: `bun moon run frontend-engine:test` — same file (emissive / late-load / transition / idempotent cases) and `frontend-engine:typecheck`/`lint`.

### AC-3: Baseline diagnosis is captured with file:line evidence
**Given** the review plan's findings 1.2/1.3/1.4
**When** a reviewer reads this document
**Then** each finding has file:line evidence, a confirmed/not/already-fixed verdict, and the method used.

**Verification**: this document + `git diff ee5478cee..71678c0b8`.

## Edge Cases & Gotchas (optional)

- **Window/fireplace are tiles, not props.** They are drawn by the tilemap and therefore cannot use the prop `emissive` flag (see Open Questions).
- **Contact shadows** are `Graphics` children of the entity container, so they receive the container tint along with the sprite. Their near-black colour stays near-black at any ambient.
- **Interior pinning now applies before the first worker UBO arrives** (previously gated on the UBO). See Open Questions.

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

# Baseline diagnosis (plan findings)

## A. Cause / evidence table

Verdicts are against `71678c0b8`; "not fixed" means the diff vs `ee5478cee` does not touch the cited file.

| Plan finding | Verdict | Evidence (file:line @ 71678c0b8) | How I know |
|---|---|---|---|
| **1.2 Buildings are flat diagrams** | **Confirmed — not fixed** | `scripts/src/lib/ops/emberwatch_map_village.ts:269-289` `paintShell()` writes `wall` with `setTile` + `block` around a rectangle; `:292-299` `paintInterior()` fills the inside with `G.ROOF` ground tiles; `:347-361` `building()` composes only shell + interior + two door cells + landing. | Read the builder. Search shows no building sprite is placed: the object layer only gets `placeProp` for furniture. `git diff ee5478cee..71678c0b8` touches neither the village builder nor the atlas. |
| **1.3 Bridge rails/water gaps repeat per tile** | **Confirmed — not fixed** | `scripts/src/lib/ops/generate_emberwatch_atlas.ts:679-691` `paintBridge()` paints water in every cell, a 16px plank band, and rails at `y=6` and `y=26`. `emberwatch_map_village.ts:241-248` stamps it 3 cols × 2 rows; `generate_emberwatch_maps_extra.ts:109-114` stamps it 4 cols × 3 rows. `emberwatch_map_village.ts:240` calls it a "stone bridge" while using the wooden `G.BRIDGE` frame. | Read both painters and both placement loops. Internal rails/water between deck rows are mechanical consequences of the per-tile art. Diff unchanged. |
| **1.4 Ambient not applied to props** | **Confirmed — fixed by C-545** | Terrain: `game_world.ts:804-825` (baseline) writes `_environmentUbo`/`COLOR_INTERIOR` into `uTint`; shader `rendering/tilemap_chunk_renderer.ts:69,78` multiplies `tex.rgb * uTint.rgb`. Props: `rendering/prop_presentation.ts:125-148` `composePropDisplay()` creates the sprite with size/anchor only; `game_world.ts:1465-1469` calls it with no tint. Actors: `game_world/entity_appearance.ts:427-443` slices LPC frames with no tint; static actors same at `:162-208`. Worker prop tint is white (`systems/entity_spawner.ts:113,602`). | Read every consumer. Nothing outside the tilemap references the ambient. The plan's "inference needing runtime verification" is hereby confirmed in source. Fix documented below. |

## B. Ambient trace (producer → consumer)

Producer: worker `environment_system.ts` writes `ENV_UBO_OFFSETS.ambientColor` each tick (`systems/environment_system.ts:376-381`), applying the C-417 night floor (`:257-267`). It is flushed in `STATE_UPDATE` and mirrored on the main thread at `game_world.ts:505` (`_environmentUbo`).

| Consumer | Receives ambient? | Where | Emissive exception? |
|---|---|---|---|
| Terrain (tilemap chunks) | **Yes** — shader `uTint` | `game_world.ts:798-804` calls the controller; `game_world/scene_ambient.ts:36-63` resolves and writes the uniform (`:55-59`); `tilemap_chunk_renderer.ts:69,78` multiplies | No (tiles have no emissive field) |
| Standalone props (atlas frames) | **Before: No → After: Yes** — container tint | `game_world.ts:798-804` calls the controller; `game_world/scene_ambient.ts:74-81` tints entries, honouring `ambientExempt` | **Yes** — prop `emissive: true` |
| LPC actors (player/NPC) | **Before: No → After: Yes** — container tint over layer sprites | `game_world.ts:798-804` calls the controller; `game_world/scene_ambient.ts:74-81` tints the `RenderEntry.displayObject` that owns the layer sprites | No |
| Static actors / enemies | **Before: No → After: Yes** — container tint | `game_world.ts:798-804` calls the controller; `game_world/scene_ambient.ts:74-81` tints the entry container built by `entity_appearance.ts:162-208` | No |
| Pre-load placeholder squares | Worker debug tint, **now × ambient** | `game_world.ts:798-804` calls the controller; `game_world/scene_ambient.ts:74-81` tints the entry containing `game_world/entity_display.ts:51-57` | No |
| Contact shadows | **After: Yes** (child `Graphics` of the tinted container) | `game_world.ts:798-804` calls the controller; `game_world/scene_ambient.ts:74-81` tints the parent entry containing `rendering/prop_presentation.ts:87-106` | No |
| HUD | **No** (not in `_renderEntries`/world container) | — | N/A |
| Weather FX | **No** (separate stage controller) | `game_world/weather_fx_controller.ts` | N/A |
| Scene background fallback | **No** (own tint) | `rendering/scene_background.ts:226` | N/A |

**Interior pinning (`COLOR_INTERIOR`)**: `environment_ubo.ts:74` = `[0.82, 0.78, 0.68, 1.0]`. `_isInteriorMap` is set from `scene.packConfig.interior` in `_installScene` (`game_world.ts:1872-1880`) and passed to the controller (`game_world.ts:798-804`), whose terrain/entity paths share one resolved ambient (`game_world/scene_ambient.ts:36-63` resolve, `:74-81` tint), so both pin together and ignore the clock.

**Late-loaded textures**: the tint lives on the entity **container**, not the sprite. A prop whose atlas frame resolves after an hour change keeps the container tint; the new sprite inherits it. This is asserted in `ambient_parity.test.ts` (late-load case) using real PixiJS `getGlobalTint()`.

## C. Fix — one documented ambient policy

If B shows parity already existed, no code change; B proved it did **not**, so C-545 applies the fix:

- **New resolver** `packages/frontend/engine/src/environment/ambient_policy.ts`:
  - `resolveSceneAmbient({ isInterior, environmentUbo })` → `{ r, g, b, hex }` (`:76-110`); interior pins `COLOR_INTERIOR`, outdoor follows the UBO, neutral `(1,1,1)` before the first UBO.
  - `applyAmbientToEntity({ displayObject, ambient, exempt })` (`:112-131`) — sets a container tint only when it changes; returns `true` on change.
- **Terrain** consumes `r/g/b` as `uTint`: `game_world.ts:798-804` calls `SceneAmbientController.update` and `game_world/scene_ambient.ts:36-63` resolves and writes the uniform (`:55-59`). **No double tint**: the world container and stage are never tinted, so terrain is tinted exactly once (shader).
- **Props / actors / enemies** consume `hex` as the per-entity container tint each frame: `game_world.ts:798-804` calls `update` + `applyToEntries`, and `game_world/scene_ambient.ts:74-81` applies the matching factor via `applyAmbientToEntity`. Runs every frame, so hour change, map transition, interior enter/exit and late texture loads are all covered without a dedicated re-tint hook.
- **`game_world.ts` stays inside its size waiver** (2194 lines vs the 2214 ceiling): the per-frame ambient controller and its capture latch live in `game_world/scene_ambient.ts`.
- **No HUD tint** — HUD is outside `_renderEntries` and the world container.
- **Emissive opt-out** — new optional `emissive?: boolean` on `ContentPackPropSchema` (`packages/shared/schemas/src/lib/game/content_pack.ts`), defaulting to false. Carried through `PropFrameAnchor`/`buildPropFrameMeta` (`scene_transition.ts:71-78,137-148`) and onto `RenderEntry.ambientExempt` (`render_entry.ts:35`, `entity_display.ts:39,82`, `game_world.ts:1364-1381`).
  - **Marked emissive (clear light sources only)**: `inn_hearth` (`prop_hearth.png`), `inn_brazier` and `shrine_brazier` (`prop_brazier.png`). Authored in `scripts/src/lib/ops/sync_emberwatch_props.ts` and synced into `content/packs/emberwatch/manifest.json` (4-line diff). Nothing else marked.
  - `window.png` and `fireplace.png` are **tiles**, not props, and are not marked (see Known follow-ups).
- **Screenshot determinism**: `game_world/scene_ambient.ts:36-63` waits until the terrain uniform exists AND (interior OR the outdoor UBO has arrived) before latching, so an outdoor capture can never freeze at neutral; `invalidateSample` (`:66-68`) is called on every installed scene (`game_world.ts:1872`) and on an hour change (`game_world.ts:1306`), so a same-hour transition (e.g. interior → outdoor) writes the new terrain uniform and re-tints entities.

### Known follow-ups (not in C-545)

1. **Tile-level emissive for `window`/`fireplace`.** Both are autotiler tiles, not props, so a single shared `uTint` applies. A per-cell or per-frame tile opt-out is a separate change (map/atlas edits were out of scope here).
2. **Weather FX and the scene-background fallback are not ambient-tinted** (`weather_fx_controller.ts`, `scene_background.ts:226`). At dawn/night a sky/rain pass can read brighter than the now-correctly-darkened ground.
3. **Emissive is per-frame, not per-placement** (`propFrameMeta` is keyed by frame), so one emissive prop makes every placement of that frame emissive. Fine for the two braziers, but a shared frame cannot be lit in one placement and not another.
4. **Boot-frame interior pin change.** The resolver now pins interiors before the first worker UBO arrives (the pre-C-545 code only pinned once a UBO existed), so an interior no longer flashes outdoor-neutral at boot.

## D. Evidence capture (best effort)

**Blocked in this worktree.** A fresh worktree does not carry the gitignored build output the visual/Studio lanes need: the generated Emberwatch candidate plane (`apps/frontend/client/static/game-data/sprites/tilesets/*`, `.local/catalog/production/snapshots/*`) is not tracked (`git ls-files` returns nothing for those paths), and this contract's non-goals forbid regenerating assets.

Attempted command and exact failure:

```
$ cd apps/e2e && bun run src/visual/runner.ts --suite=map --capture-only
[runner] Aikami AI Visual Testing Framework
[runner] ❌ Client dev server unreachable at http://localhost:5274
[runner] Start the client before running visual tests:
[runner]   bun moon run client:dev
[runner]   or: herdr_session start client
```

(exit 1). No screenshot was fabricated and no scene was mocked. For unit verification only, the gitignored generated atlas was seeded read-only from the matching root checkout at the same SHA (`71678c0b8`), which is why `frontend-engine:test` can run its content-audit suite; this is build output, not a source change, and is not committed.

## E. Bridge and building layer model (design only — not implemented)

**Single authored bridge, no new scene model.** Extend the existing authoring helpers rather than the runtime:

- **Deck interior**: a whole-span helper (refactor `buildStreamBridge` `emberwatch_map_village.ts:241` and `carveCulvert` `generate_emberwatch_maps_extra.ts:101`) that walks the span's *inner* cells and paints a rail-free deck tile; keep `m.collision[...] = 0` over exactly those cells using the existing `setTile`/`block` helpers from `scripts/src/lib/ops/emberwatch_authoring.ts`.
- **End abutments & outer rails**: place them as props via the existing `placeProp(id, name, frame, c, r)` object-layer path, with `renderSize`/`anchor`/`shadow` declared in `EMBERWATCH_PROPS` (`sync_emberwatch_props.ts`). Rails sit along the two long edges only; abutments cap the two ends.
- **Atlas**: split `paintBridge` (`generate_emberwatch_atlas.ts:679`) into deck-only, left/right-rail and abutment frames. The engine already y-sorts props by base Y and supports multi-cell footprints; nothing in `renderTilemap` needs to change.

**Raised building, no new scene model.** Keep the interior as a separate map (existing transition system) and express the exterior volume as authored props plus the existing overhead band:

- **Facade / roof / eave**: multi-cell props placed with `placeProp`, with `renderSize`, `anchor`, `shadow` (and `emissive` for lit windows) in `EMBERWATCH_PROPS`; the eave/roof upper band uses the tilemap's existing `overhead` layer band (`renderTilemap` bands; `rendering/layer_bands.ts` `WORLD_Z_BANDS`). Base-Y sorting already draws a facade in front of the player.
- **Door threshold**: reuse `doorPlacement()` (`emberwatch_map_village.ts:302`) to align the visible threshold cell, the prop anchor and the existing `transitionZones` trigger/arrival marker — no new transition type.
- **Occupancy**: keep `paintShell`'s `block()` footprint as collision only; move the visual from ground tiles to the prop assembly. Exact functions to change: `building()`, `paintShell()`, `paintInterior()` in `emberwatch_map_village.ts`, and `placeProp` in `emberwatch_authoring.ts`.

## F. Open questions / surprising findings

1. **`window` and `fireplace` are tiles, not props.** The review names "embers/windows" as emissive, but in the current pack they are ground-grid tiles consumed by the autotiler with a single shared `uTint`. A per-tile emissive would need a tile/terrain-level opt-out (per-cell or per-frame) — a larger change than this contract, and map/atlas edits are out of scope.
2. **Interior pinning now applies before the first UBO arrives.** The old code only pinned interiors once `_environmentUbo` existed; the resolver pins immediately. This is more correct (an interior should never flash outdoor-neutral) but is a boot-frame behavior change.
3. **Contact shadows are tinted with their entity.** `Graphics` children inherit the container tint. At night the shadow is near-black × ambient — visually fine, but it is now technically ambient-affected.
4. **Weather FX and the scene-background fallback are not ambient-tinted.** A dawn sky/rain can read brighter than the now-darkened ground/props; worth a follow-up if it is noticeable.
5. **`COLOR_INTERIOR` is exported from the barrel now**; previously only `environment_ubo.ts` carried it.
6. **Emissive is per-frame, not per-placement.** Because `propFrameMeta` is keyed by frame, one emissive prop makes every placement of that frame emissive (correct for the braziers, which share `prop_brazier.png`).

---

## Execution Report

### Summary

C-545 records the `71678c0b8` baseline, diagnoses review findings 1.2/1.3/1.4 with file:line evidence, and traces the ambient path from the worker UBO to every consumer. Finding 1.4 is real (only terrain was tinted), so the contract adds one documented ambient resolver used by both terrain and per-entity container tints, with an explicit `emissive` prop opt-out (hearth + two braziers marked) and behavioral tests. Findings 1.2/1.3 are confirmed but left as diagnosis per the non-goals; the bridge/building layer-model proposal is documented without implementation. In-engine screenshot capture is blocked by absent gitignored build output.

### AC Status

| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | `ambient_parity.test.ts` — terrain/prop/actor share one multiplier at noon/dawn/night/interior |
| AC-2 | ✅ | Emissive / late-load / transition / idempotent cases in the same file; HUD and terrain untouched by the entity pass |
| AC-3 | ✅ | This document + `git diff ee5478cee..71678c0b8` |

### Files Created

| File | Purpose |
|---|---|
| `packages/frontend/engine/src/environment/ambient_policy.ts` | The single ambient resolver + entity tint applier |
| `packages/frontend/engine/src/game_world/scene_ambient.ts` | Per-frame controller: resolve → terrain `uTint` → entity containers (keeps `game_world.ts` inside its size waiver) |
| `packages/frontend/engine/src/__tests__/ambient_parity.test.ts` | Behavioral parity / emissive / late-load / transition tests |
| `docs/contracts/C-545-emberwatch-baseline-and-ambient-parity.md` | This baseline + diagnosis + execution report |

### Files Modified

| File | Change |
|---|---|
| `packages/frontend/engine/src/game_world.ts` | Use the `SceneAmbientController`; carry `emissive` → `ambientExempt`; removed the old screenshot tint latch (moved into the controller) |
| `packages/frontend/engine/src/environment/index.ts` | Export ambient policy |
| `packages/frontend/engine/src/game_world/render_entry.ts` | `ambientExempt?: boolean` |
| `packages/frontend/engine/src/game_world/entity_display.ts` | Accept + store `ambientExempt` |
| `packages/frontend/engine/src/game_world/scene_transition.ts` | `emissive` on `PropFrameAnchor` + `buildPropFrameMeta` |
| `packages/shared/schemas/src/lib/game/content_pack.ts` | Optional `emissive` on `ContentPackPropSchema` (one line; file kept within its permanent exemption ceiling) |
| `packages/shared/schemas/src/lib/game/content_pack.test.ts` | Emissive schema cases |
| `scripts/src/lib/ops/sync_emberwatch_props.ts` | `emissive` on the prop type + hearth/brazier entries |
| `content/packs/emberwatch/manifest.json` | Synced prop table (3 props gain `emissive: true`) |
| `packages/frontend/engine/src/game_world/scene_transition.test.ts` | Emissive propagation case |

### Deviations from Spec

- Marked three props emissive (hearth + two braziers) in the prop registry; the task allowed this for clear light sources. `window`/`fireplace` are tiles and were left alone (documented).
- The schema field and the `game_world.ts` refactor were kept inside the existing size guard ceilings (`content_pack.ts` ≤ 1144 physical lines; `game_world.ts` ≤ 2214) rather than changing any guard threshold, which the task forbids. The `content_pack.ts` addition is one line and one adjacent blank line was removed to hold the ceiling.
- Screenshot evidence could not be captured (blocked, §D).

### Verification Notes (inherited vs. C-545)

- `scripts:guard-source-file-size` reports one oversize: `packages/frontend/engine/src/worker/ecs_worker.ts` (2497 vs its 2488 waiver ceiling). That file is unchanged on this branch and is already over its ceiling at `origin/main` (`71678c0b8` added 14 lines without re-running the guard); C-545 does not touch it, and the guard forbids raising the ceiling, so it is reported, not fixed.
- `client:test-browser` fails locally with `launch: Executable doesn't exist at ~/.cache/ms-playwright/...` — Chromium is not installed in this environment (CI installs it in the PR `validate` job).

### Test Results

- Unit (`frontend-engine:test`): **1820 pass / 0 fail** (after seeding the gitignored generated atlas from the matching root checkout at `71678c0b8`; without it the 3 `emberwatch_content_audit` texture-existence tests fail for environment reasons only).
- Unit (`schemas:test`): **905 pass / 0 fail**.
- Unit (`scripts:test`): **2011 pass / 9 fail**, all reproduced identically with the C-545 changes stashed — pre-existing environment failures (`candidate-plane-incomplete`, `scan_assets`, declared-membership, sandbox); `scripts:test` is `runInCI: false`.
- Typecheck: `frontend-engine`, `schemas`, `types`, `scripts` — all pass.
- Lint: `frontend-engine`, `schemas`, `types`, `scripts` — all pass.
- E2E/visual: not run (see §D).
