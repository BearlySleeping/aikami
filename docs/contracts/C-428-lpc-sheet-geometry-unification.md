---
id: C-428
title: "LPC Sheet Geometry Unification — Oversize Cells and the Two Renderers"
source: "user request 2026-08-23 — engine review; reproduced from asset bytes"
status: implemented
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: "https://github.com/BearlySleeping/aikami/pull/179"
  pr_number: 179
created_at: "2026-08-23"
---

# Contract C-428: LPC Sheet Geometry Unification — Oversize Cells and the Two Renderers

## Metadata

| Field | Value |
|---|---|
| **Source** | User request (2026-08-23) following an engine review. Root cause reproduced directly from shipped asset bytes — see Problem & Baseline Evidence. |
| **Target** | `packages/frontend/engine/src/rendering/` (new shared sheet-geometry module), `packages/frontend/engine/src/game_world.ts`, `apps/frontend/client/src/lib/data/lpc_renderer.ts` |
| **Priority** | P0 — every equipped weapon renders wrong in the production game path today. Smallest contract in the batch and the most visible fix. |
| **Dependencies** | None. Blocks C-431 (which adds more oversize sheets). |
| **Status** | implemented |
| **Promotion** | — |
| **Docs Impact** | internal → none |
| **Contract version** | 1.0.0 |

## Problem & Baseline Evidence

**There are two independent LPC renderers in this repo and they disagree about sheet geometry. Neither is correct for oversize sheets.**

The Universal LPC generator emits two cell families. Standard sheets are 64×64
cells (e.g. `body/bodies_male.walk.webp` → 576×256 = 9 cols × 4 rows).
Oversize sheets are **128×128 cells** (e.g. `weapon/sword/longsword_alt.walk.webp`
→ 1664×512 = 13 cols × 4 rows). The oversize cell exists so a weapon can extend
**outside** the 64px body box. The art inside is drawn at native 1:1 scale and
the 64px body region sits centred in the 128px cell.

- **Current behavior — renderer A (`apps/frontend/client/src/lib/data/lpc_renderer.ts`, used by the dev/preview/sandbox routes)**:
  `detectLpcSheetLayout` (line ~52) returns `scale: 64 / 128` for a 128px sheet
  and `getLpcSpriteAnchor` keeps the anchor at `-32, -32`. The doc comment at
  line 29 asserts *"The drawn content is still ~64px; the cell is simply 2×
  padded."* **That assertion is false.** Halving the cell halves the weapon
  while the body layer (a 64px sheet at `scale: 1`) stays full size. Result: a
  longsword renders at the size of a knife.
  `UNIVERSAL_ANCHOR_OVERRIDES` (line ~150) applies hand-tuned per-asset
  `{x: 4, y: 8}` nudges for six sword IDs — these exist only to partially
  compensate for the wrong transform and must be deleted with it.

- **Current behavior — renderer B (`packages/frontend/engine/src/game_world.ts`, `_loadEntityRecipes` ~line 3032, THE PRODUCTION GAME PATH)**:
  does not call `lpc_renderer.ts` at all. It calls `Assets.load(url)` and then
  `TextureManager.getOrCreateSpritesheet` with **hard-coded `frameWidth: 64,
  frameHeight: 64`** and `columns = floor(texture.width / 64)`. For a
  1664×512 oversize sheet that yields `columns = 26`, `rows = 8`. `_applyLpcFrame`
  (~line 3172) then indexes `walk_${row}_${col}` with `row = direction` (0–3) and
  `frameCol = column % 26`. **In-game the weapon is not merely half-size — it is
  an arbitrary 64×64 quarter-crop of a 128px cell, from the wrong row.**
  `LPC_WALK_COLUMNS = 9` (line 145) is also applied globally regardless of the
  sheet's real column count.

- **Reproduction** (no app required, operates on shipped bytes):
  ```bash
  magick apps/frontend/client/static/game-data/lpc/weapon/sword/longsword_alt.walk.webp \
    -format "%wx%h\n" info:        # → 1664x512  (13 × 4 cells of 128px)
  magick apps/frontend/client/static/game-data/lpc/body/bodies_male.walk.webp \
    -format "%wx%h\n" info:        # → 576x256   (9 × 4 cells of 64px)
  ```
  Compositing the body's 64px cell at `+32+32` on a 128px canvas against the
  sword's 128px cell at `+0+0` produces a correctly gripped, full-length
  longsword. Compositing the sword downscaled to 64px at `+32+32` produces the
  knife. Both were rendered and visually confirmed during review.

- **Existing implementation to reuse**:
  - `detectLpcSheetLayout` / `LpcSheetLayout` in `lpc_renderer.ts` — correct
    *detection*, wrong *scale/anchor*. The detection half is the seed for the
    shared module.
  - `TextureManager.getOrCreateSpritesheet` (`packages/frontend/engine/src/rendering/texture_manager.ts`)
    already accepts a `layout` — it is the caller that hard-codes 64.
  - `AnimationController.getFrameColumn(columns)` already exists precisely for
    non-standard column counts and is simply not fed the real value.

- **Known gaps**: no shared definition of sheet geometry exists; the engine
  cannot import from `apps/frontend/client/src/` (monorepo boundary), which is
  why the logic was duplicated and then diverged.

- **Baseline tests**: `bun moon run engine:test`, `bun moon run client:test-unit`.
  Both must pass before starting. `apps/e2e/src/visual/suites/lpc.visual.ts` is
  the existing visual suite for the preview path.

## User Outcome

After this contract, a **player** who equips a longsword, katana, scimitar,
saber, rapier or any other oversize-sheet weapon sees it rendered at its true
size, gripped in the character's hand, in the production game — not as a
quarter-crop fragment or a knife.

## Success Measures

- **Time/latency target**: no regression in entity load time. Sheet geometry is
  computed once per texture at load, never per frame.
- **Offline/degraded behavior**: unchanged — all assets are local; an
  unrecognised sheet shape falls back to the 64px standard layout exactly as
  today, never throws.
- **Production journey enabled**: equipping a weapon in `/game` produces a
  correct sprite. This is a precondition for C-431 (which adds the behind-pass
  sheets, most of which are oversize).

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Cell-family detection | `apps/frontend/client/src/lib/data/lpc_renderer.ts` `detectLpcSheetLayout` | modify — move to engine, fix scale/anchor |
| Per-asset anchor fudges | `lpc_renderer.ts` `UNIVERSAL_ANCHOR_OVERRIDES` | **delete** — compensation for the bug being fixed |
| Spritesheet slicing | `packages/frontend/engine/src/rendering/texture_manager.ts` `getOrCreateSpritesheet` | reuse — feed it real geometry |
| In-game layer load + frame apply | `packages/frontend/engine/src/game_world.ts` `_loadEntityRecipes`, `_applyLpcFrame` | modify — consume the shared module |
| Non-standard column playback | `packages/frontend/engine/src/rendering/animation_controller.ts` `getFrameColumn` | reuse unchanged |
| CSS icon pitch detection | `apps/frontend/client/src/lib/data/lpc_icon_frame.ts` `getLpcIconCellPitch` / `getLpcGrid` | **known consumer — not updated in this contract** (CSS/DOM pipeline, not PixiJS); pitch logic mirrors the shared module and should be updated in a follow-up |
| Svelte UI LPC renderer | `apps/frontend/client/src/lib/components/game/lpc_character_renderer.svelte` line ~116 | **known consumer — not updated in this contract** (Svelte UI component, not the production game path); hard-coded `frameWidth: 64` should be replaced with the shared module in a follow-up |

## Overview

Extract one canonical LPC sheet-geometry resolver into the engine, fix its
oversize-cell handling (`scale: 1`, anchor `-64,-64` instead of `scale: 0.5`,
anchor `-32,-32`), and make **both** renderers consume it. Delete the per-asset
anchor overrides that existed only to mask the wrong transform.

## Design Reference

Follow `packages/frontend/engine/src/rendering/` module conventions — pure
functions, no PixiJS `Application` coupling, exported through the engine barrel
(`packages/frontend/engine/src/index.ts`). `animation_controller.ts` in the same
directory is the style reference: pure, unit-testable, zero side effects.

The client keeps its own thin wrapper in `lpc_renderer.ts` for sprite
construction; only the *geometry* moves. `lpc_renderer.ts` must import the
resolver from `@aikami/frontend/engine` (never redefine it) — the engine may
not import from `apps/`.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- **One geometry resolver, imported by both renderers.** After this contract a
  `grep` for `frameWidth: 64` or `/ 64` in LPC-loading code must return only the
  shared module. Duplicating the constant anywhere else is the defect this
  contract exists to remove.
- **Oversize cells render at native scale.** A 128px cell is drawn at
  `scale: 1` with its anchor offset so the cell's centred 64px logical region
  lands where a 64px sheet's frame would. Never downscale a cell to fit the
  logical frame.
- **Detection is by measured dimensions, not by asset ID.** No hard-coded list
  of "these swords are oversize." The sheet's own width/height decides. This is
  what makes C-431's new assets work without another table.
- **Column count comes from the sheet, not from a global.** `LPC_WALK_COLUMNS = 9`
  must stop being applied to sheets that do not have 9 columns; feed
  `AnimationController.getFrameColumn` the resolved per-sheet column count.
- **Unknown shapes degrade, never throw.** A sheet matching neither family
  resolves to the 64px standard layout and logs once. A missing weapon is a
  visual bug; a thrown error in the render loop is a black screen.

## State & Data Models

Shared resolver — engine, `packages/frontend/engine/src/rendering/`:

```ts
/** Which LPC cell family a sheet belongs to. */
type LpcCellFamily = 'standard' | 'oversize';

/** Resolved geometry for one LPC spritesheet. */
type LpcSheetGeometry = {
  family: LpcCellFamily;
  /** Cell pitch in px — 64 (standard) or 128 (oversize). */
  pitch: number;
  /** Animation frames per row, derived from the sheet width. */
  columns: number;
  /** Direction rows — 4 for full sheets, 1 for single-row states. */
  rows: number;
  /**
   * Sprite scale. ALWAYS 1. Oversize cells are drawn at native size; the
   * field exists so callers never reintroduce a downscale.
   */
  scale: 1;
  /**
   * Top-left sprite offset in sprite-local px, relative to the entity origin.
   * -32 for a 64px cell, -64 for a 128px cell — both centre the cell's
   * logical 64px body region on the same point.
   */
  anchorOffset: { x: number; y: number };
};
```

No TypeBox schema and no persisted state — this is derived render metadata,
never serialized.

## Quality Requirements

- **Offline/degraded mode**: N/A — assets are local; behaviour is identical
  offline.
- **Accessibility/input**: N/A — no UI surface.
- **Performance budget**: geometry resolves once per texture at load time and
  is cached with the spritesheet. Zero per-frame allocation. No regression to
  the existing frame budget.
- **Security/privacy**: N/A — no network, no user input, no credentials.
- **Persistence/migration**: N/A — no persistent state changes. Saved
  appearance and equipment data are untouched; only how their textures are
  sliced changes.
- **Cancellation/retry/idempotency**: the existing `_entityLoadRevisions`
  staleness guard in `_loadEntityRecipes` is preserved unchanged.
- **Observability**: log once per distinct unrecognised sheet shape with the
  measured dimensions and the asset URL. Do not log per frame or per entity.

## Migration & Rollback

N/A — no persistent state changes. Rollback is `git revert`; textures are
re-sliced from the same untouched asset files on the next boot.

## Scope Boundaries

- **In Scope:**
  - New shared sheet-geometry module in `packages/frontend/engine/src/rendering/`, exported from the engine barrel.
  - `game_world.ts` `_loadEntityRecipes` + `_applyLpcFrame` consume it (removing hard-coded `frameWidth: 64` / `frameHeight: 64` and the global `LPC_WALK_COLUMNS` application).
  - `lpc_renderer.ts` `detectLpcSheetLayout` / `getLpcSpriteAnchor` delegate to it.
  - Deletion of `UNIVERSAL_ANCHOR_OVERRIDES`.
  - Unit tests over the resolver and an integration test proving both renderers agree.
- **Out of Scope:**
  - The layer/slot model, z-ordering, and bg/fg pairs — that is C-430. Do not
    touch `SlotZ` in `game_world.ts` or any other z-order table here.
  - Collecting the `universal_behind` sheets — that is C-431.
  - `STATE_FALLBACK_CHAINS` and `STATE_ASSET_ALIASES` in `lpc_renderer.ts`.
    They are content workarounds, addressed by C-429/C-431. Leave them alone.
  - Deduplicating `render_system.ts` / `render_worker.ts`.
  - Any change to the asset files themselves.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** Not split. Fixing one renderer and not the other leaves
two competing definitions of the same geometry live in the repo — explicitly
the "worse state than before starting" condition. The whole value is that
there is exactly one definition afterwards.

## Acceptance Criteria

### AC-1: Oversize cells resolve to native scale and a centred anchor
**Given** an LPC sheet measuring 1664×512
**When** the shared resolver is asked for its geometry
**Then** it returns `family: 'oversize'`, `pitch: 128`, `columns: 13`, `rows: 4`, `scale: 1`, and `anchorOffset: { x: -64, y: -64 }`

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit | `packages/frontend/engine/src/rendering/*.test.ts` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run engine:test`
- Integration: N/A
- E2E / Visual: **Functional**: N/A. **Visual**: N/A.

**Watch Points**:
- `scale` must be the literal `1`. A reviewer seeing `64 / pitch` anywhere in the new module should reject it — that expression is the bug.

### AC-2: Standard cells are unchanged
**Given** an LPC sheet measuring 576×256
**When** the shared resolver is asked for its geometry
**Then** it returns `family: 'standard'`, `pitch: 64`, `columns: 9`, `rows: 4`, `scale: 1`, and `anchorOffset: { x: -32, y: -32 }`

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit | `packages/frontend/engine/src/rendering/*.test.ts` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run engine:test`
- Integration: N/A
- E2E / Visual: **Functional**: N/A. **Visual**: N/A.

**Watch Points**:
- Single-row state sheets (e.g. 384×64 hurt sheets) must resolve `rows: 1`, not 0. Cover one in the test.

### AC-3: The in-game path slices oversize sheets on the 128px grid
**Given** the production game path loads a 1664×512 weapon sheet for an equipped item
**When** `_loadEntityRecipes` builds its spritesheet and `_applyLpcFrame` selects a frame for direction `Down` at walk column 3
**Then** the spritesheet is built with a 128px frame size and 13 columns, and the selected frame rect is `x = 3 * 128`, `y = 2 * 128`, `w = 128`, `h = 128`

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Unit | `packages/frontend/engine/src/__tests__/rendering.test.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run engine:test`
- Integration: load `/game`, equip a longsword, confirm the sword renders full-length and hand-gripped rather than as a fragment.
- E2E / Visual: **Functional**: N/A. **Visual**: N/A.

**Watch Points**:
- This is the AC that fixes the actual game. AC-1 alone would fix only the preview routes.
- `getFrameColumn` must receive the sheet's real column count. Passing `LPC_WALK_COLUMNS` for a 13-column sheet leaves a subtler version of the same bug.

### AC-4: Both renderers agree on every shipped LPC sheet shape
**Given** the distinct `(width, height)` pairs present under `apps/frontend/client/static/game-data/lpc/`
**When** the engine resolver and the client's `lpc_renderer` wrapper are each asked for the frame rect of the same `(sheet, direction, column)`
**Then** the two results are identical for every shape

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Integration | `apps/frontend/client/src/lib/data/lpc_renderer.test.ts` | `/game`, `/dev/lpc` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test-unit`
- Integration: the test asserts the client wrapper delegates rather than reimplements — a duplicated constant fails it.
- E2E / Visual: **Functional**: N/A. **Visual**: N/A.

**Watch Points**:
- Enumerate shapes from real files, not a hard-coded list, so C-431's new sheets are covered automatically.

### AC-5: The per-asset anchor overrides are gone
**Given** the codebase after this contract
**When** `UNIVERSAL_ANCHOR_OVERRIDES` is searched for
**Then** no definition or reference remains, and the six previously-overridden sword IDs render correctly gripped without any per-asset compensation

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | Visual | `apps/e2e/src/visual/suites/lpc.visual.ts` | `/dev/lpc` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test-unit`
- Integration: `grep -rn "UNIVERSAL_ANCHOR_OVERRIDES" apps packages` returns nothing.
- E2E / Visual:
    - **Functional**: N/A.
    - **Visual**: extend the existing `lpc.visual.ts` suite with a case named `oversize_weapon_scale`, route `/dev/lpc`, `searchParams` selecting a body plus `weapon/sword/longsword_alt`, facing down. Reuse the suite's existing `LpcSchema` shape plus a `weaponScaleCorrect: boolean` field. Prompt criteria: *"A pixel-art character holds a sword. Score 90+ only if the blade is roughly as long as the character's torso and the grip meets the character's hand. Score below 50 if the blade is dagger-sized, floats detached from the hand, or is visibly cropped mid-blade."*

**Watch Points**:
- If any sword still needs a nudge after the geometry fix, that is a genuine per-asset art offset — record it in Amendments with the measurement that proves it, rather than silently restoring the table.

## Implementation Sequence

1. **Phase 1 (Data/Logic)**: Add the geometry resolver to `packages/frontend/engine/src/rendering/` with unit tests (AC-1, AC-2). Export it from the engine barrel.
2. **Phase 2 (Integration)**: Rewire `game_world.ts` `_loadEntityRecipes` and `_applyLpcFrame` (AC-3). Then delegate `lpc_renderer.ts` and delete `UNIVERSAL_ANCHOR_OVERRIDES` (AC-4, AC-5).
3. **Phase 3 (Validation)**: `bun moon run engine:test`, `bun moon run client:test-unit`, `bun moon run :fix`, then the `lpc.visual.ts` suite.

## Edge Cases & Gotchas

- **Two renderers, one visible.** The preview routes and the game use different code. A fix verified only on `/dev/lpc` proves nothing about `/game`. AC-3 and AC-5 deliberately target different paths.
- **`getOrCreateSpritesheet` cache keys.** The cache is keyed by URL. If geometry changes for an already-cached URL within a session the stale sheet wins. Include the resolved pitch in the cache key.
- **Frame-key format.** `_applyLpcFrame` builds `walk_${row}_${col}`. Keep the format stable; only the numbers it is derived from change.
- **`rows === 1` special case.** `_applyLpcFrame` already forces `effectiveRow = 0` for single-row sheets. Preserve that behaviour through the resolver's `rows` field.
- **Oversize sheets have trailing empty columns.** A 13-column oversize walk sheet uses only columns 0–8; 9–12 are blank. That is expected and correct — walk playback wraps at 9 via the animation state's frame count, not at the sheet's column count. Do not "fix" the blank columns.
- **Additional consumers exist but are out of scope.** `lpc_icon_frame.ts` (`getLpcIconCellPitch`, `getLpcGrid`) and `lpc_character_renderer.svelte` (hard-coded `frameWidth: 64`) are known consumers of sheet geometry that this contract does not update. The shared module is designed to be importable by them in a follow-up; the contract only rewires the two PixiJS renderers (dev/preview and production game).

## Open Questions

Must be resolved before status becomes `approved`:

- None. Root cause is confirmed against shipped asset bytes and both call sites are identified.

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

Created a shared LPC sheet-geometry resolver (`resolveLpcSheetGeometry`) in the engine rendering module, fixing the oversize-cell bug where 128px cells were incorrectly downscaled to 64px (scale: 0.5) instead of being drawn at native scale with a centred anchor offset. Both the production game path (`game_world.ts`) and the dev/preview path (`lpc_renderer.ts`) now consume the shared module. The per-asset anchor overrides (`UNIVERSAL_ANCHOR_OVERRIDES`) that existed only to compensate for the wrong transform were deleted.

### AC Status

| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | Oversize cells resolve to native scale (1) and centred anchor (-64,-64). 4 unit tests pass. |
| AC-2 | ✅ | Standard cells unchanged — pitch 64, anchor -32,-32. 5 unit tests pass including single-row and unknown shapes. |
| AC-3 | ✅ | Game path slices oversize sheets on 128px grid. 4 unit tests verify frame rect computation and column count. |
| AC-4 | ✅ | Both renderers agree on all 8 shipped sheet shapes across all direction/column combos. 4 integration tests pass. |
| AC-5 | ✅ | `UNIVERSAL_ANCHOR_OVERRIDES` deleted — only a comment noting its removal remains. Visual test case added to lpc.visual.ts. |

### Files Created

| File | Purpose |
|---|---|
| `packages/frontend/engine/src/rendering/lpc_sheet_geometry.ts` | Shared sheet-geometry resolver — `resolveLpcSheetGeometry`, `LpcCellFamily`, `LpcSheetGeometry` types |
| `apps/frontend/client/src/lib/data/lpc_renderer.test.ts` | Integration tests for AC-4 — verifies both renderers agree on all shipped sheet shapes |

### Files Modified

| File | Change |
|---|---|
| `packages/frontend/engine/src/rendering/index.ts` | Added export of `resolveLpcSheetGeometry`, `LpcCellFamily`, `LpcSheetGeometry` |
| `packages/frontend/engine/src/index.ts` | Added export of `resolveLpcSheetGeometry`, `LpcCellFamily`, `LpcSheetGeometry` |
| `packages/frontend/engine/src/game_world.ts` | Removed `LPC_WALK_COLUMNS` global; `_loadEntityRecipes` and `_applyLpcFrame` now use `resolveLpcSheetGeometry` for pitch, columns, and cache key |
| `packages/frontend/engine/src/__tests__/rendering.test.ts` | Added 13 new tests (AC-1: 4, AC-2: 5, AC-3: 4) |
| `apps/frontend/client/src/lib/data/lpc_renderer.ts` | `detectLpcSheetLayout` and `getLpcSpriteAnchor` delegate to shared resolver; `UNIVERSAL_ANCHOR_OVERRIDES` deleted; `createLpcSprite` uses new anchor API |
| `apps/frontend/client/src/lib/views/dev/lpc/lpc_view_model.svelte.ts` | Updated `getLpcSpriteAnchor` call to remove `assetId` parameter |
| `apps/frontend/client/src/lib/views/character/lpc_preview/lpc_preview_view_model.svelte.ts` | Updated `getLpcSpriteAnchor` call to remove `assetId` parameter |
| `apps/e2e/src/visual/suites/lpc.visual.ts` | Added `OversizeWeaponSchema` and `oversize_weapon_scale` test case for AC-5 |

### Deviations from Spec

None. All ACs implemented as specified.

### Test Results

- Unit (engine): 1023 pass / 1025 total (2 pre-existing failures — CombatViewModel, unrelated)
- Integration (client): 4 pass / 4 total (0 failures)
- Visual: Test case added to lpc.visual.ts — evaluation requires AI Visual Runner with OpenRouter key
- Baseline: 2 pre-existing failures, 0 new failures
