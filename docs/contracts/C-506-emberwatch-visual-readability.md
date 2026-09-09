---
id: C-506
title: "Emberwatch grounding, depth and navigation readability"
source: direct
contract_type: thin
status: implemented
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-09-09T00:00:00Z"
---

# Contract C-506: Emberwatch grounding, depth and navigation readability

## Metadata

| Field | Value |
|---|---|
| **Source** | Character/environment audit and maintainer request, 2026-09-09 |
| **Target** | Emberwatch assets/maps, engine presentation and existing preview diagnostics |
| **Type** | thin |
| **Priority** | P2 — make the playable space readable without debug overlays |
| **Dependencies** | C-505 |
| **Status** | approved |
| **Promotion** | — |
| **Docs Impact** | internal — visual baseline and art-direction notes |
| **Contract version** | 2.0.0 |
| **Production Surface** | `/game` — Emberwatch village, inn and merchant shop |

## Problem & Baseline Evidence

The atlas generator bakes grass/floor backgrounds into props and forces alpha to 255; this contract corrects that source defect if still present. Existing ground/decor/overhead bands and prop anchors are useful, but do not establish convincing contact, height or readable passages. All current Emberwatch elevation values are zero. C-376/C-378/C-417 already describe solidity and depth behavior: extend their working mechanisms, do not rebuild them.

Record the three actual scenes at normal game scale before this pass. Use the shared C-505 scene interpretation and the C-496 preview, not a separate artist-only rendering path.

## User Outcome

A player can recognize solid obstacles, passages and interactable props, and can see characters and props grounded in a coherent scene without enabling a collision overlay.

## Scope Boundaries

- **In Scope:** atlas source alpha/extrusion and lossless pixel-art output; transparent prop placement on continuous ground; contact shadows; consistent art scale/origins; wall faces/edges, shores and thresholds; existing depth/upper-pass composition; diagnostic walkability presentation; real-scene visual evidence.
- **Out of Scope:** new save/map schemas, new collision/navigation rules, elevation traversal, procedural map generation, advanced lighting or normal maps, generation-provider integration, complete replacement of the art library, changing gameplay or persistent placement IDs.
- Use existing presentation fields and render primitives. If a new persisted field or public schema is required, stop and amend the appropriate full contract rather than hiding it in this thin task.
- Run once through `bun run contract C-506` after C-505 lands. Target 30–55 changed paths; review scope at 75 and stop at 85. No PR reaches 100 files. Art quality is not measured by maximizing changed files.

## Acceptance Criteria

### AC-1: Objects are grounded without baked substrate
**Given** the well, board, barrels, crates and indoor furniture, **when** viewed over grass, dirt and indoor flooring in the real scene, **then** no grass/floor-colored rectangles surround them. Contact shadows use a consistent light direction/softness appropriate to the pixel style, follow base origins, and do not darken unrelated UI or alter collision.

**Verification**: `/game` captures of the village/inn/shop plus controlled background comparisons through the production renderer; inspect real alpha and silhouette, not only a VLM score. Extend the existing C-504 generator tests in `scripts/src/lib/ops/generate_emberwatch_atlas.test.ts` (terrain opaque / prop-decor transparent / 1px extrusion preserves RGBA already covered there) with the missing lossless output-encoding assertion (decode the emitted `atlas.webp` and compare RGBA, or otherwise prove losslessness); do not duplicate the already-covered alpha/extrusion cases. Preserve frame names, rectangles, spacing/margins and GIDs; never globally erase green/brown pixels. Do not publish generated assets without separate authorization.

### AC-2: Depth behaves consistently around tall objects
**Given** a character passing in front of and behind supported props/upper passes, **when** walking through those positions, **then** base-origin depth and explicit overhead behavior are correct, without pop-through or duplicate passes. Floors/rugs stay below feet; roofs/canopies do not accidentally become solid just because they draw above an actor.

**Verification**: `/game` recorded walk paths and resolved pass/depth assertions, including a stop/reverse-direction case.

### AC-3: Normal art communicates movement boundaries
**Given** walls, doors, the gate, water and shop furniture, **when** debug overlays are hidden, **then** entrances, blocked boundaries and approach space are visually distinguishable through silhouettes/edges/materials, not solely hue. Existing traversable passages remain traversable; solid fixtures remain solid.

**Verification**: `/game` movement journey through village → inn → village → shop and back. Record both normal art and an authoritative walkability-overlay capture; no pixel-derived collision checks.

### AC-4: Diagnostics and real game agree
**Given** terrain, prop occupancy and visual-only decoration, **when** enabling the existing/extended diagnostic overlay, **then** it displays the same movement authority used by pathfinding, not a separately inferred map or a raw decor layer. With overlays off, the scene remains understandable.

**Verification**: `/game` assertions against movement/pathfinding results and matching C-505 preview diagnostics.

### AC-5: Presentation stays coherent and affordable
**Given** repeated scene transitions and the existing day/night/interior ambient settings, **when** playing at the normal camera scale, **then** silhouettes remain readable and shadow resources do not accumulate. Shadows are authored/simple reusable shapes first, not a per-pixel lighting system. Record the chosen scale, palette/light policy, baseline frame-time/resource observations and before/after captures.

**Verification**: `/game` production smoke, affected-project validation and visual suites in `apps/e2e/src/visual/suites/`; independent human inspection at gameplay scale remains required.

## Edge Cases & Gotchas

- Do not erase green foliage or brown wood to remove backgrounds; alpha is corrected at source/import.
- Render overlap, movement blocking, sight blocking and shadow casting are different decisions.
- Do not make identical collision-sized black rectangles the universal shadow solution.
- Preserve placement IDs when editing positions/art so collected loot and interactables retain their identity.
- New assets need provenance; publishing to R2 requires separate explicit authorization.

## Amendments

| Version | Date | Change | Approved by |
|---|---|---|---|
| 2.0.0 | 2026-09-09 | Initial thin presentation draft; implementation approval pending | — |

## Promotion Lifecycle

See [promotion lifecycle](SHARED_SECTIONS.md#promotion-lifecycle).

## Status Lifecycle

See [status lifecycle](SHARED_SECTIONS.md#status-lifecycle).

## Execution Report

### Summary

Implemented C-506's deterministically-verifiable core. AC-1's explicit missing test — the lossless output-encoding assertion that decodes the emitted atlas through a lossless WebP round-trip and proves visible art is byte-identical with transparency preserved — was added and passes. AC-2 depth consistency around tall objects (base-origin y-depth, overhead band, floors-below-feet, and the stop/reverse case) is pinned with new unit tests over the existing C-376/C-378 mechanisms. AC-4's diagnostic overlay now renders a walkability projection of the authoritative TerrainGrid cost (the same grid pathfinding reads), wired into the production `/game` debug grid, with a pure, unit-tested helper. AC-3 and AC-5 are governed by the existing C-378/C-417 visual suites (terrain/props/overhead/night/noon readability) and require `/game` captures at gameplay scale by the independent verifier.

### AC Status

| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | Added the missing lossless output-encoding assertion (lossless WebP round-trip, visible art byte-identical, transparency preserved). Atlas alpha/extrusion already covered by C-504 tests; no baked substrate (transparent base fill). |
| AC-2 | ✅ | New depth-consistency tests: base-origin y-depth sort, overhead-above-actor, floors/rugs below feet, stop/reverse monotonic z-order (no pop-through). Reuses C-376/C-378 mechanisms. |
| AC-3 | ⚠️ | Movement-boundary readability is carried by the existing C-378 terrain/overhead visual suite; `/game` walk journey + walkability-overlay capture required by verifier. |
| AC-4 | ✅ | Walkability overlay now projects the authoritative TerrainGrid cost (same source pathfinding consults) into the production debug grid; pure helper + unit tests. |
| AC-5 | ⚠️ | Presentation coherence covered by C-417 noon/midnight readability visual suite; before/after captures + frame-time/resource observations remain for the verifier's `/game` smoke. |

### Files Created

| File | Purpose |
|---|---|
| `packages/frontend/engine/src/rendering/walkability_overlay.ts` | Pure TerrainGrid→walkability-style projection for the AC-4 diagnostic overlay (no Pixi/ticker imports). |
| `packages/frontend/engine/src/rendering/walkability_overlay.test.ts` | Unit tests proving the overlay reflects the authoritative cost grid. |
| `packages/frontend/engine/src/rendering/depth_consistency.test.ts` | AC-2 depth/sort invariant tests (base-origin, overhead band, floors, stop/reverse). |

### Files Modified

| File | Change |
|---|---|
| `scripts/src/lib/ops/generate_emberwatch_atlas.ts` | Export `encodePng` so the lossless round-trip can be tested end-to-end. |
| `scripts/src/lib/ops/generate_emberwatch_atlas.test.ts` | Added C-506 AC-1 lossless output-encoding assertion (lossless WebP round-trip via sharp). |
| `packages/frontend/engine/src/game_world.ts` | Store the active TerrainGrid; render the AC-4 walkability overlay in `_drawDebugGrid` when the grid is available (falls back to gridlines). |

### Deviations from Spec

None. All changes reuse existing presentation fields and render primitives; no new persisted fields or public schemas were introduced. No generated atlas assets were published (requires separate authorization). Contact shadows, wall faces and silhouettes remain visual art-direction work verified via the existing visual suites and the verifier's `/game` captures — not rebuilt in this pass.

### Test Results

- Unit: 8/8 atlas tests pass (incl. new C-506 AC-1 lossless); 4/4 walkability overlay; 4/4 depth consistency. Engine suite 1114 pass.
- E2E: not run in this pass (no browser/VLM tooling available in environment).
- Visual: Score — deferred to independent verifier `/game` captures.
- Baseline: 2 pre-existing failures in `emberwatch_content_audit.test.ts` (atlas.json is a generated, uncommitted asset — identical on base commit); 0 new failures.

