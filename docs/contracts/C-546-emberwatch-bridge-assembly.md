---
id: C-546
title: "Emberwatch continuous oriented bridge assembly"
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

# Contract C-546: Emberwatch continuous oriented bridge assembly

## Metadata

| Field | Value |
|---|---|
| **Source** | `docs/reference/emberwatch-polish-review-and-plan.md` — finding 1.3, §5 "Bridges and shores"; C-545 §7 design notes |
| **Target** | `scripts/src/lib/ops/` (atlas painter + authoring helper + two map builders), `content/packs/emberwatch/manifest.json` (tile table), `packages/frontend/engine` (content-audit fixture) |
| **Type** | thin |
| **Priority** | P2 — the crossing is the plan's named proof item; the per-tile stamp is a confirmed construction defect |
| **Dependencies** | C-545 (baseline/diagnosis + ambient parity), C-378 (atlas geometry, corner16), C-379 (semantic authoring helpers) |
| **Status** | implemented |
| **Promotion** | — |
| **Docs Impact** | internal → none (authoring/generator change; no player-facing UI) |
| **Contract version** | 2.0.0 |
| **Production Surface** | `scripts/src/lib/ops/generate_emberwatch_atlas.ts` + `generate_emberwatch_maps.ts` (declared tooling commands); runtime consumes the generated atlas/maps through the existing `/game` tilemap path |

## Problem & Baseline Evidence

Verified against `origin/main` `8f53a249e` before any change.

- **Atlas frame is a per-cell stamp, not a structure.** `scripts/src/lib/ops/generate_emberwatch_atlas.ts:679-691` `paintBridge()` painted water into every 32px cell, a 16px plank band (`y=8..23`) and two HORIZONTAL rails (`y=6`, `y=26`). Confirmed: repeated along the crossing's depth, the tile repeats water gaps and rails inside the walkable deck.
- **Village crossing is mis-oriented and mis-labelled.** `scripts/src/lib/ops/emberwatch_map_village.ts:240-248` stamps `G.BRIDGE` over `cols 39-41 × rows 7-8`; the stream is an L-bend whose E–W reach is row 7 (`streamChannel()` `:176-195`). Travel is N–S, so the painter's horizontal rails run ACROSS the travel direction and repeat per row. The docstring called it a "stone bridge" while using the wooden frame. Confirmed — it is wood; renamed.
- **Old-road culvert repeats the rails/water per row.** `scripts/src/lib/ops/generate_emberwatch_maps_extra.ts:100-115` (`carveCulvert`) stamps `cols 20-23 × rows 17-19`; travel is E–W, so the horizontal rails happen to point the right way but still repeat on all three rows with water painted between them. Confirmed.
- **Single-GID reader.** `emberwatch_map_village.ts:532` (`reopenBridge`) compared `m.ground[...] === G.BRIDGE`; any multi-frame assembly must widen that reader or the re-opened cells would silently block.
- **Atlas headroom is zero.** The 47 baked tiles (max GID 48) + five corner16 terrains × 16 masks fill all 128 cells exactly (`docs/plans/emberwatch_rebuild.md:359`). Appending frames requires growing `ATLAS_ROWS`.
- **Baseline tests**: `scripts:test` (`emberwatch_authoring.test.ts`, `generate_emberwatch_maps.test.ts`, `emberwatch_map_compile.test.ts`, `generate_emberwatch_derivation.test.ts`), `frontend-engine:test` (`emberwatch_content_audit.test.ts`).

## User Outcome

A player crossing the village stream or the old-road culvert sees ONE continuous wooden deck: boards perpendicular to travel, rails only on the two long outer edges, and a bank abutment at each end — no rails, no water gaps, and no floating endpoints inside the walkable deck. Footsteps, collision and saves are unchanged.

## Scope Boundaries

- **In Scope:** one authored `placeBridge` helper; deterministic procedural deck/rail/end/corner atlas frames for both axes; replace the two stamp loops; keep the crossing cells, collision footprint and gameplay semantics; regenerate the atlas/maps/manifest through the existing commands; unit + atlas-pixel tests; a thin contract doc.
- **Out of Scope:** image-model assets; building changes; terrain/grass changes; shore/bank transition redesign beyond the end abutment; a stone variant; any other map edit; guard/golden/evaluator changes; deploy/publish; human visual acceptance.

## Acceptance Criteria

### AC-1: Each crossing is one oriented structure

**Given** the village N–S crossing (`cols 39-41 × rows 7-8`) and the old-road E–W culvert (`cols 20-23 × rows 17-19`)
**When** the maps are built
**Then** each span cell carries a frame chosen by its position (deck interior / long-side rail / travel-end abutment / corner) and axis; rails appear only on the two long outer sides; ends only on the two short sides.

**Verification**: `bun moon run scripts:test` — `emberwatch_bridge_assembly.test.ts` "placeBridge frame layout" (NS 3×2 and EW 4×3 exact grids).

### AC-2: Collision footprint and gameplay semantics are unchanged

**Given** the same crossing cells
**When** `placeBridge` authors the span
**Then** collision is `0` on exactly those cells, water outside stays blocked, and every placed GID is recognised by one `isBridgeGid()` helper.

**Verification**: `emberwatch_bridge_assembly.test.ts` (collision matches span; every GID is a bridge GID); `bun run emberwatch:validate` (0 blockers, traversal unchanged).

### AC-3: Author-time bank validation

**Given** a crossing whose approach end is water or whose long side is land
**When** `placeBridge` runs with the default checks
**Then** it throws, naming the map and the offending cells.

**Verification**: `emberwatch_bridge_assembly.test.ts` "bank validation" (end-water and side-land throws).

### AC-4: Atlas frames are correct pixel art

**Given** the packed atlas
**When** the deck-interior and side/end frames are sampled
**Then** the deck interior is fully opaque with no water and no rail/sill pixels, and each side/end frame differs from the deck interior only on its own outer edge.

**Verification**: `emberwatch_bridge_assembly.test.ts` "bridge atlas frames" (uses `packAtlas()` output, not copied constants).

### AC-5: Existing navigation/walkability validation still passes

**Given** the regenerated maps
**When** the Emberwatch validators run
**Then** village + old road stay traversable for the companion width already checked, and locked identities are unchanged.

**Verification**: `bun run emberwatch:validate` (0 blockers), `bun run emberwatch:locked-ids`, `bun moon run scripts:test` (`emberwatch_map_compile.test.ts`).

## Design

- **Atlas** (`generate_emberwatch_tables.ts`): `ATLAS_ROWS` 8 → 10 (128 → 160 cells); `ATLAS_TERRAIN_BLOCK_START = 48` pins the corner16 terrain block so appended frames cannot move an existing terrain GID. `ATLAS_HEIGHT` 272 → 340, `ATLAS_TILE_COUNT` 128 → 160.
- **Painter** (`generate_emberwatch_bridge_frames.ts`, new): one `paintBridgeFrame` composes boards (perpendicular to travel) + an optional rail (2px water/shadow strip, 5px body, 1px contact shadow) + an optional 4px stone sill with a 2px contact shadow. The deck pattern is a pure function of the tile-local pixel (no per-cell RNG), so it tiles seamlessly. `BRIDGE_FRAME_PAINT` maps frame name → recipe; the atlas `paintFrame` dispatches through it before its switch.
- **Helper** (`emberwatch_authoring.ts`): `placeBridge(map, { region, axis, mapId?, assertBanks? })` resolves the frame table from `manifest.tiles` by frame name, writes ground + clears collision on exactly the span, then asserts both approach ends are walkable land and every long-side cell is water. `isBridgeGid` / `BRIDGE_GIDS` / `BRIDGE_FRAMES` are exported.

### Frame table

| Frame | GID | Axis | Role |
|---|---|---|---|
| `bridge.png` (legacy, repurposed) | 42 | NS | deck interior |
| `bridge_deck_ew.png` | 129 | EW | deck interior |
| `bridge_rail_w.png` | 130 | NS | long-side rail (west edge) |
| `bridge_rail_e.png` | 131 | NS | long-side rail (east edge) |
| `bridge_rail_n.png` | 132 | EW | long-side rail (north edge) |
| `bridge_rail_s.png` | 133 | EW | long-side rail (south edge) |
| `bridge_end_n.png` | 134 | NS | travel-end abutment (north) |
| `bridge_end_s.png` | 135 | NS | travel-end abutment (south) |
| `bridge_end_w.png` | 136 | EW | travel-end abutment (west) |
| `bridge_end_e.png` | 137 | EW | travel-end abutment (east) |
| `bridge_corner_nw_ns.png` | 138 | NS | corner (rail W + abut N) |
| `bridge_corner_ne_ns.png` | 139 | NS | corner (rail E + abut N) |
| `bridge_corner_sw_ns.png` | 140 | NS | corner (rail W + abut S) |
| `bridge_corner_se_ns.png` | 141 | NS | corner (rail E + abut S) |
| `bridge_corner_nw_ew.png` | 142 | EW | corner (rail N + abut W) |
| `bridge_corner_ne_ew.png` | 143 | EW | corner (rail N + abut E) |
| `bridge_corner_sw_ew.png` | 144 | EW | corner (rail S + abut W) |
| `bridge_corner_se_ew.png` | 145 | EW | corner (rail S + abut E) |

**GID stability:** no existing GID was renumbered. The legacy `G.BRIDGE` GID 42 is kept and repainted as the NS deck interior. New frames are APPENDED at 129–145. The corner16 terrain frames keep their original GIDs because the terrain block is pinned at cell 48 (`ATLAS_TERRAIN_BLOCK_START`) instead of being allocated after the highest baked frame.

### What stays the same

- **Cells and collision footprint:** village `39-41 × 7-8` and old road `20-23 × 17-19`, collision `0` on exactly those cells, water outside still blocked. Verified by re-dumping the regenerated maps.
- **Gameplay identities:** spawn/npc/prop/transition ids untouched (`emberwatch:locked-ids` unchanged).
- **Movement/footstep semantics:** the new frames are non-terrain decor GIDs like the old bridge, so the terrain channel resolves them to the base (walkable) terrain; the explicit collision layer carries traversal.
- **Map extents, stream/culvert shapes, terrain, buildings:** untouched.

## Edge Cases & Gotchas

- **The village crossing sits at an L-bend corner.** Its east bank and north approach are dry, so the strict perpendicular bank check does not hold for the unchanged stream shape. The village call passes `assertBanks: false` with an in-code comment; the strict check remains the default and is exercised by the old-road call and by unit tests on synthetic crossings.
- **`bridge.png` is now deck-only.** Any reader that assumed the old water+rail art must use `isBridgeGid`; `reopenBridge` was the only one.
- **Atlas geometry grew.** `emberwatch_content_audit.test.ts` and `generate_emberwatch_derivation.test.ts` fixtures were updated to 544×340 / 160 cells; the coverage audit now reads `ATLAS_COLS * ATLAS_ROWS` from the shared tables module instead of carrying its own copy.

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

Replaced the per-cell bridge stamp with one authored `placeBridge` helper plus a deterministic frame set (18 frames across both travel axes: deck interior, four long-side rails, four end abutments, eight corners). The atlas grew from 16×8 to 16×10 to append the frames without renumbering any existing GID or moving the corner16 terrain block. Both Emberwatch crossings were rebuilt through the helper with their original cells and collision footprint; `isBridgeGid` replaces the single-GID reader. Unit, atlas-pixel and existing navigation validations pass. In-engine screenshot evidence is blocked by the absent local catalog snapshot (see §Evidence).

### AC Status

| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | Exact NS 3×2 / EW 4×3 frame grids in `emberwatch_bridge_assembly.test.ts` |
| AC-2 | ✅ | Collision matches span; `isBridgeGid` covers every placed GID; `emberwatch:validate` 0 blockers |
| AC-3 | ✅ | Bank validation throws naming map + cells (end-water, side-land cases) |
| AC-4 | ✅ | Deck interior has no water/rail/sill pixels; side/end frames differ only on their own edge |
| AC-5 | ✅ | `emberwatch:validate` + `emberwatch:locked-ids` + map-compile test pass |

### Files Created

| File | Purpose |
|---|---|
| `scripts/src/lib/ops/generate_emberwatch_bridge_frames.ts` | Procedural bridge frames (boards/rail/abutment) + `BRIDGE_FRAME_PAINT` |
| `scripts/src/lib/ops/emberwatch_bridge_assembly.test.ts` | Frame layout, collision, bank validation, atlas-pixel tests |
| `docs/contracts/C-546-emberwatch-bridge-assembly.md` | This contract |

### Files Modified

| File | Change |
|---|---|
| `scripts/src/lib/ops/generate_emberwatch_tables.ts` | `ATLAS_ROWS` 8→10; `ATLAS_TERRAIN_BLOCK_START`; geometry comments |
| `scripts/src/lib/ops/generate_emberwatch_atlas.ts` | Remove `paintBridge` stamp; dispatch bridge frames via the new table; comments |
| `scripts/src/lib/ops/generate_emberwatch_canvas.ts` | Scratch-size comments (512×320 / 544×340) |
| `scripts/src/lib/ops/emberwatch_authoring.ts` | `BRIDGE_FRAMES`/`BRIDGE_GIDS`/`isBridgeGid` + `placeBridge` + bank validation |
| `scripts/src/lib/ops/emberwatch_map_village.ts` | `buildStreamBridge` → `placeBridge` (NS); `reopenBridge` → `isBridgeGid`; docstring "stone"→"wooden" |
| `scripts/src/lib/ops/generate_emberwatch_maps_extra.ts` | `carveCulvert` bridge loop → `placeBridge` (EW) |
| `scripts/src/lib/ops/emberwatch_coverage_rules.ts` | Atlas geometry from the shared tables module |
| `scripts/src/lib/ops/generate_emberwatch_derivation.test.ts` | Out-of-bounds GID 129→161; committed-atlas size 544×340 |
| `packages/frontend/engine/src/__tests__/emberwatch_content_audit.test.ts` | Atlas fixture size/tilecount 544×340 / 160 |
| `scripts/src/lib/ops/guard_source_file_size_baseline.json` | Locked-in reduction (atlas generator 1321→1311, sanctioned contraction) |
| `content/packs/emberwatch/manifest.json` | 17 appended bridge tiles (GIDs 129–145) |
| `content/packs/emberwatch/maps/*.json` | Regenerated (bridge cells + tileset block) |
| `content/packs/asset_hashes.json` | Regenerated by `scan_assets.ts` |
| `docs/reference/emberwatch-coverage-audit.json` | Regenerated (0 blockers) |

### Generated files changed + commands

Commands (all existing repo commands; no hand-editing of generated output):

1. `bun scripts/src/lib/ops/generate_emberwatch_atlas.ts` → `apps/frontend/client/static/game-data/sprites/tilesets/atlas.webp` + `atlas.json` (gitignored build output; 544×340, 144 frames).
2. `bun scripts/src/lib/ops/generate_emberwatch_props_atlas.ts` → `props.webp`/`props.json`/`props.pages.json` (gitignored; rebuilt for a complete local plane).
3. `bun scripts/src/lib/ops/install_emberwatch_portraits.ts` + `install_emberwatch_audio.ts` → gitignored portraits/audio.
4. `bun scripts/src/lib/ops/generate_emberwatch_maps.ts` → `content/packs/emberwatch/maps/{village,inn,merchant_shop,old_road,ruined_shrine}.json` (tracked).
5. `bun scripts/src/lib/ops/scan_assets.ts` → `content/packs/asset_hashes.json` (tracked; `content/packs/manifest.json` unchanged).
6. `bun scripts/src/lib/ops/emberwatch_coverage_audit.ts` → `docs/reference/emberwatch-coverage-audit.json` (tracked; 0 blockers).
7. `bun run emberwatch:validate` → `docs/reference/emberwatch-map-validation.json` (unchanged).

Tracked generated files changed: the five map JSONs, `content/packs/asset_hashes.json`, `docs/reference/emberwatch-coverage-audit.json`.

### Deviations from Spec

- **The task's village geometry model did not match the map.** The village crossing sits at an L-bend of the stream (E–W reach at row 7 + N–S reach at col 40), so the "cells beside the long sides are water" and even "cells outside the north end are land" assertions do not hold for the unchanged stream shape. The helper keeps the strict check as the default (old-road passes it; unit tests exercise it) and the village call opts out with a documented comment. Reshaping the stream was explicitly out of scope.
- **The atlas had zero headroom**, so appending frames required `ATLAS_ROWS` 8→10 and updating two test fixtures + the coverage rules' geometry. No existing GID was renumbered; the terrain block was pinned.
- **`assertBanks: false` on the village** is the one place the strict author-time check is not applied.
- **Screenshot evidence could not be captured** (see §Evidence).

### Test Results

- Unit (`scripts:test`): **2044 pass / 1 fail** — the single failure is the pre-existing, flaky `emberwatch:release --plan … staging does NOT require a staging approval` timeout; the same file fails on the base checkout too (2 timeouts there). No new failures.
- Unit (`frontend-engine:test`): **1823 pass / 0 fail** (requires the generated atlas, which is produced by the documented atlas command).
- `scripts:lint` / `scripts:format` / `scripts:typecheck`: pass.
- Structural guards (`run_guards.ts`): **10/10 pass**; `guard-contract` locked in the atlas-generator size reduction only.
- `bun moon ci --base=origin/main`: **54 completed, 0 failed, 2 skipped**.
- Emberwatch: `emberwatch:validate` 0 blockers; `emberwatch:locked-ids` unchanged; `emberwatch:props --check` in sync; `emberwatch:audit` 0 blockers.

### Evidence (best effort — blocked)

The local candidate plane is absent, so the client cannot load the Emberwatch pack and no gameplay screenshot of the crossings can be captured. The generated sprites/atlas/maps/seed were produced with the documented commands above (not copied from another checkout), but the local asset origin additionally needs a catalog snapshot pinned from R2.

Exact commands and errors:

```text
$ bun run emberwatch:studio --no-client
...
⚠ no catalog snapshot at <worktree>/.local/catalog/production/snapshots — skipping the local origin.
  Run a catalog snapshot first, or start the client against another origin.
```

```text
$ bun moon run client:dev            # http://127.0.0.1:5274/ (emulator mode)
# Playwright (1920×1080, WebGL flags) → /game?gameHour=12&screenshot=true
[console:error] Failed to load resource: the server responded with a status of 404 (Not Found)
[console:error] [GameBootService] boot:stage-failed {stage: preloading_content,
                 error: ContentPackLoader: manifest not found (HTTP 404)}
# document.body.innerText → "Boot Failed … ContentPackLoader: manifest not found (HTTP 404)"
```

`apps/frontend/client/.env.emulator.local` points `PUBLIC_ASSETS_BASE_URL` at the studio origin (`http://localhost:8788`); with no snapshot the origin does not start, and the pack manifest 404s. The catalog snapshot command (`catalog:workspace snapshot`) pins inventory from R2 and is a cloud/deploy-adjacent operation (out of scope). A diagnostic screenshot of the boot failure was saved to the gitignored `apps/e2e/test-results/visual/c546/diag_boot.png`; no bridge screenshot was fabricated. **No visual acceptance is claimed — the human decides.**

### Known follow-ups

1. **Village stream shape.** The crossing would read better if the stream were straightened/reshaped at the crossing so the strict bank check holds; that is a map-layout change, not part of this contract.
2. **No stone variant.** The plan allows one later stone bridge; this contract is wood only.
3. **Corner rail post art.** Corners combine rail + abutment; a dedicated rail-post cap is a future polish item.
4. **Evidence plane.** Capturing crossing stills requires a local catalog snapshot (or serving the pack from a non-R2 origin); tracked as an evidence-infrastructure gap, not fixed here.
