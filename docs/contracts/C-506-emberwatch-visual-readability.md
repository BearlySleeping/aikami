---
id: C-506
title: "Emberwatch grounding, depth and navigation readability"
source: direct
contract_type: thin
status: draft
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
| **Status** | draft |
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

**Verification**: `/game` captures of the village/inn/shop plus controlled background comparisons through the production renderer; inspect real alpha and silhouette, not only a VLM score. Add generator tests for `scripts/src/lib/ops/generate_emberwatch_atlas.ts`: unpainted prop/decor pixels are transparent, terrain stays opaque, padding/extrusion preserves RGBA and output encoding is lossless. Preserve frame names, rectangles, spacing/margins and GIDs; never globally erase green/brown pixels. Do not publish generated assets without separate authorization.

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

Not implemented. Append actual AC evidence, changed paths, deviations and test outcomes after implementation. Do not prefill passing results.
