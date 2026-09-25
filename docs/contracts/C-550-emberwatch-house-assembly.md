---
id: C-550
title: "Emberwatch raised house assembly — NE hut"
source: "direct"
contract_type: thin
status: implemented
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: "https://github.com/BearlySleeping/aikami/pull/392"
created_at: "2026-09-24T00:00:00Z"
---

# Contract C-550: Emberwatch raised house assembly — NE hut

## Metadata

| Field | Value |
|---|---|
| **Source** | `docs/reference/emberwatch-polish-review-and-plan.md` §1.2 and §5 “Buildings”; C-545 §7 design notes; C-546 bridge-assembly pattern; C-548 evidence/candidate plane; C-549 crossing/grass reference |
| **Target** | `scripts/src/lib/ops/` — one deterministic NE-hut house assembly, appended atlas frames, map regeneration and focused tests; `packages/frontend/engine/src/` only if an existing layer/evidence assertion needs a C-550 regression test |
| **Type** | thin |
| **Priority** | P2 — completes the second half of the approved environment slice with one raised, traversable house |
| **Dependencies** | C-545 (ambient parity and layer diagnosis), C-546 (`placeBridge`/procedural frame pattern), C-548 (WebGL evidence plane and GID coverage), C-549 (crossing/grass collision-diff method; merged in the branch's recorded C-549 rebase baseline) |
| **Status** | implemented |
| **Promotion** | — |
| **Docs Impact** | internal → authoring guide/contract evidence only; no player-facing UI |
| **Contract version** | 1.2.0 |
| **Production Surface** | `tooling: \`bun run emberwatch:studio\`` and `tooling: \`bun run emberwatch:validate\`; runtime consumes the generated map/atlas through `/game` |

## FIRST — baseline findings (recorded before implementation edits)

Recorded against the historical branch base `origin/main` `997740daf95b04ce0d5126fa715df596e182a19d` (the worktree was fast-forwarded after the initial fetch brought in C-547). The final implementation/audit baseline for this branch is merged C-549/C-551 commit `49e3ad060f849e5f2a1d61444d9262958931ecf2`, which was `origin/main` at rebase time; the remote has since advanced with unrelated agent work, which C-550 does not import. The older commit is retained only to make this FIRST snapshot reproducible.

### Current building construction

- `scripts/src/lib/ops/emberwatch_map_village.ts:302-332` — `paintShell()` writes the perimeter cells with the selected wall GID and blocks the top/bottom rows plus the left/right columns. `paintInterior()` writes `G.ROOF` to every inner cell and blocks those cells. Both are ground-array writes; neither creates a separate architectural layer.
- `scripts/src/lib/ops/emberwatch_house_authoring.ts:33-61` — legacy `doorPlacement()` derives a two-cell door and two landing cells from the footprint and side. For a south door it uses the bottom row, midpoint columns, then one/two rows outside. It returns cell pairs only; it does not create a transition.
- `scripts/src/lib/ops/emberwatch_map_village.ts:349-363` — `building()` calls `paintShell()`, `paintInterior()`, `doorPlacement()`, and `openCells()`. `openCells()` changes the door and landing cells to `G.STONE_FLOOR` and clears collision. `building()` places no object-layer transition or arrival marker.
- The verified hut call is now `placeHouse(m, { region: { c0: 51, r0: 5, c1: 56, r1: 9 }, door: { c: 54 }, facing: 's', mapId: 'village' })` at `emberwatch_map_village.ts:439-444`: footprint **51–56 × 5–9 inclusive (6×5)**. Its single door cell is `(54,9)`; the south landing is `(54,10–11)`, with the actor settling on the second clear row `(54,11)`.
- The village object layer has only transitions `1005` (west gate → merchant shop), `1006` (east gate → inn), and `1007` (north gate → old road), at `(0,23)`, `(63,23)`, and `(31,0)` respectively. There is **no hut door transition id, no hut trigger rectangle, and no hut interior map/arrival marker** in the current five-map pack. The only interior arrival markers are `inn_entrance` and `shop_entrance`; neither belongs to the hut. This is a hard scope/design gap for the requested enter/exit evidence and must not be papered over by retargeting an existing stable edge.

### Current layer and depth model

- `generate_emberwatch_maps.ts` derives four tile layers: `ground` is the baked `m.ground` plus explicit ground contributions; `decor` receives non-terrain, non-roof frames; `overhead` receives `G.ROOF` and explicit overhead contributions; `collision` is a separate hidden boolean layer. Explicit ground/decor/overhead contributions own their cells; terrain-channel overrides may apply only to walkable or terrain-owned cells, never to blocked non-terrain facade art.
- `packages/frontend/engine/src/rendering/layer_bands.ts:36-55` declares `tilemapGround = -1000`, `tilemapDecor = -900`, debug/zone bands below `MIN_ENTITY_Y = -512`, and `tilemapOverhead = 100000`. `_worldContainer.sortableChildren` is enabled (`game_world.ts:724`); entity display objects use `computeEntityZIndex(y)` (`frame_renderer.ts:149`), so ground/decor always draw below an in-map actor and overhead always draws above every actor.
- On terrain-channel maps, `buildTerrainGridFromChannel()` treats the semantic terrain plus the explicit collision layer as the movement authority; overhead/decor visual layers do not independently open or close movement. The house rule must therefore state both the visual band and the explicit collision value for every cell.

### Crossing, viewport and save findings

- Historical FIRST finding: on the pre-merge snapshot the village crossing was `39–41 × 7–8` and C-549’s `36–37 × 7–8` change was not yet in the worktree. C-549 is now merged; the final C-550 collision diff is against merged C-549 baseline `49e3ad060f849e5f2a1d61444d9262958931ecf2` and preserves the C-549 crossing cells unchanged.
- `BASE_WORLD_SCALE` is 4, so a 1920×1080 viewport covers 15 × 8.4375 cells. The current crossing-to-hut extent (`39–56`) is 18 cells wide, and the C-549 crossing-to-hut extent (`36–56`) is 21 cells wide; the full crossing and full hut footprint cannot both fit in one default-scale viewport. Evidence will use separate hut-front and crossing-inclusive framings where possible, without changing map geometry to force a composite shot.
- The player save path is clamped against the current map collision on both `LOAD_MAP` and `RESTORE_PLAYER` (`ecs_worker.ts:1624-1705`, `1944-2216`). Every current hut-footprint cell is blocked by the shell, so a valid player save cannot normally be inside it; a stale/legacy position there is relocated by the existing clamp. A newly walkable-behind roof cell would be newly walkable, not newly stranded. Full-world/companion restore is a separate known gap (C-549 recorded that companion positions are not clamped), so this contract will not claim that every possible stale companion coordinate is migrated.
- No existing stable transition or interior arrival identity can be reused for the hut without changing gameplay meaning. The user selected the **exterior-only** interpretation: C-550 will not invent a hut interior, transition, trigger, or arrival marker. Door/cell alignment is therefore limited to the authored threshold and the unchanged transition graph; the requested enter/exit evidence is explicitly blocked rather than fabricated.

## Problem & Baseline Evidence

- **Current behavior**: the NE hut is a flat wall/roof shell. Its interior cells are opaque `roof` ground tiles, its facade is a decor ring, and the door opening is a stone-floor hole rather than a readable door/threshold transition.
- **Reproduction**: inspect `emberwatch_map_village.ts:427` and the generated `village.json`; the hut occupies the verified 6×5 rectangle and the village transitions list has no hut edge.
- **Existing implementation to reuse**: `emberwatch_authoring.ts` (`Region`, cell conversion, `placeBridge`, `placeTransition`), `generate_emberwatch_atlas.ts`/`packAtlas()`, `generate_emberwatch_maps.ts`’s four-layer emitter, and the existing `WORLD_Z_BANDS`/base-Y renderer model.
- **Known gaps**: no reusable house assembly; no frame/role table for a raised facade/roof/eave/plinth; no author-time footprint/door assertions; no house-specific pixel, layout, collision, or occlusion tests; no reproducible C-550 evidence set.
- **Baseline tests**: `scripts:test` (`emberwatch_authoring.test.ts`, `generate_emberwatch_maps.test.ts`, `emberwatch_atlas_coverage.test.ts`, `generate_emberwatch_atlas.test.ts`, `emberwatch_map_validation.test.ts`); `frontend-engine:test` (`emberwatch_content_audit.test.ts`, `tilemap_bands.test.ts`, `depth_consistency.test.ts`); `e2e:test:unit`/visual capture infrastructure from C-548.

## User Outcome

A player approaching the north-east village hut sees one ordinary south-facing raised house with a warm cedar-shingle roof, a clear light front slope/capped ridge/dark back-plane hierarchy, solid shaded gable ends, two readable facade rows, one closed boarded door, a window where the former second door was, a narrow plinth, and a soft ground contact shadow. The generated map and atlas remain deterministic and stable; no other building changes.

## Success Measures

- **Technical**: exact `placeHouse` frame/layer/collision grid, door geometry, atlas pixel invariants, and navigation assertions pass through Moon tasks.
- **Production path**: the same generated assets load through the local candidate `/game` route with WebGL asserted; no fallback frame or Canvas2D capture is accepted.
- **Scope**: only the hut’s `building()` call is replaced; transition/spawn/quest/prop identities remain unchanged unless an explicitly approved hut interior is added.
- **Human boundary**: this contract records technical evidence and observations only; it makes no visual-acceptance claim.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Semantic cell authoring | `scripts/src/lib/ops/emberwatch_authoring.ts` | modify — add `placeHouse`, role tables and assertions |
| Map data/layers | `emberwatch_map_shared.ts`, `generate_emberwatch_maps.ts` | modify — explicit house layer contributions, no new runtime model |
| Procedural atlas | `generate_emberwatch_atlas.ts`, `generate_emberwatch_bridge_frames.ts`, `generate_emberwatch_canvas.ts` | extend — append-only frame painter/table |
| GID coverage | `emberwatch_atlas_coverage.ts`, manifest tile table | reuse — every new painted GID must resolve |
| Depth/occlusion | `layer_bands.ts`, `frame_renderer.ts` | reuse — overhead above entities, ground/decor below |
| Transition construction | `placeTransition()` and map object layers | reuse only if an approved interior edge exists; otherwise do not invent one |

## Overview

C-550 replaces only the decorative NE hut shell with a deterministic modular house assembly. The helper composes facade, roof, eave, foundation and collision cell by cell, while the renderer’s existing band/base-Y model supplies the intended walk-behind occlusion. The atlas receives append-only procedural frames with stable GIDs and no renumbering.

## Design Reference

Follow C-546’s append-only, deterministic painter/table split and C-548’s GID coverage/evidence discipline. Use the plan’s restrained woodland palette and the existing LPC actor scale. The hut roof uses weathered cedar shingles because Emberwatch’s existing facades are warm wood; the warm material family keeps the village coherent while the explicit light/shadow value structure carries the three-quarter read. Do not introduce image-model art, a second scene model, roof fading, dynamic interiors, stone-floor changes, UI, guard changes or deployment work.

## Architecture Directives

- `placeHouse(map, { region, door: { c }, facing: 's', mapId })` is the single authored assembly seam. It writes the explicit layer contributions and collision, validates bounds/facade/approach, and returns the canonical door cell.
- House frame names and GIDs are resolved from `manifest.tiles`; frame allocation is append-only after C-546’s GID 145 and never occupies the reserved corner16 terrain block.
- Facade and plinth are ground-band contributions with explicit collision. The 6×5 hut footprint is three roof rows plus two facade rows; the former full foundation row is gone, and a 6px plinth is integrated into the lower facade frames. The single hut door uses the closed/boarded frame and remains an exterior anchor; the legacy two-cell `doorPlacement()` remains unchanged for other village shells. Roof cells selected for walk-behind are overhead-band contributions with collision cleared; roof cells selected as solid are ground-band contributions with collision set. The rule is data, not renderer magic.
- The existing `G.ROOF` compatibility path remains unchanged for other houses. Only the hut call is replaced.
- A transition is emitted only when an existing approved source/target identity is supplied. `placeTransition()` remains the sole transition constructor; no edge is synthesized from `mapId` alone.

## State & Data Models

```ts
type HouseFacing = 'n' | 's' | 'e' | 'w';
type HouseLayer = 'ground' | 'decor' | 'overhead';
type HouseCell = { c: number; r: number; layer: HouseLayer; gid: number; blocked: 0 | 1 };
type HouseDoor = { c: number; r: number };
```

The generated Tiled representation remains the existing four tile layers plus object layers. No new save schema or runtime scene kind is introduced.

## Quality Requirements

- **Offline/degraded mode**: all house art is procedural and local; no network or model provider is required.
- **Accessibility/input**: no new input path; door/navigation behavior uses the existing movement and transition systems.
- **Performance budget**: one additional small tile-frame family; no per-frame generation or new renderer loop.
- **Security/privacy**: N/A — no auth, network, or user data path.
- **Persistence/migration**: preserve all stable IDs and document the generated-map collision delta; existing player restore clamp remains authoritative.
- **Cancellation/retry/idempotency**: map generation remains deterministic; repeated generation is byte-identical.
- **Observability**: author-time assertion errors name map, region and offending cells; no new production logging is required.

## Migration & Rollback

- **Old data compatibility**: no new persistent format. Existing player restore clamping remains in force; no new transition/arrival identity is introduced without approval.
- **Migration**: regenerate atlas/maps through existing commands; do not hand-edit generated JSON.
- **Rollback**: revert the C-550 source commits and regenerate the prior maps/atlas.
- **Feature flag or kill switch**: N/A — content-only change.
- **Failure recovery**: failed atlas/map generation leaves tracked generated outputs untouched until the producer succeeds; assertions fail before a partial map is accepted.

## Scope Boundaries

- **In Scope:** one NE hut; append-only procedural house frames; `placeHouse`; hut-only map call replacement; generated atlas/maps/asset hashes/coverage/validation outputs required by the existing pipeline; focused unit/pixel/nav/occlusion tests; C-548 WebGL evidence and index.
- **Out of Scope:** other buildings/houses, a new hut interior or transition edge (user-selected exterior-only scope), roof fading/dynamic interiors, stone-floor/terrain redesign, image-model art, UI, guard/golden/evaluator changes, deploy/publish, or human visual acceptance.
- **Under 100 files:** expected source, generated outputs, tests and evidence index remain well below the limit.

## Contract Size & Split Rule

One bounded P2 slice. A new interior/transition identity would be a separate gameplay/content decision and is not silently folded into this contract.

## Acceptance Criteria

### AC-1: One deterministic raised-house assembly

**Given** the verified hut footprint and door column
**When** `placeHouse` runs
**Then** every footprint cell has the documented frame, layer and collision role; the hut has three visible roof rows and two facade rows; facade rows contain no roof pixels; roof rows are either overhead/walkable-behind or ground/solid by the stated rule; the lower facade carries a ≤8px plinth and the approach carries a soft contact shadow.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit + pixel | `scripts/src/lib/ops/emberwatch_house_assembly.test.ts` | `tooling: \`bun run scripts/src/lib/ops/generate_emberwatch_atlas.ts\`` | Exact three-roof/two-facade frame grid, collision, navigation, one-door count, value hierarchy, solid gable, bounded-plinth, and monotonic seamless-shadow pixel tests pass; generated atlas hash recorded in the r3 evidence index |

### AC-2: Door, trigger and arrival identity remain truthful

**Given** the current source transition graph
**When** the hut is authored
**Then** exactly one closed/boarded door frame is placed (the former second-door cell is facade/window art), no nonexistent hut transition or arrival marker is invented, and the returned door cell is only the canonical exterior anchor. The unchanged transition graph contains no hut edge. Any future approved edge must reuse that returned cell for its visible threshold, trigger, and destination marker. The baseline’s absent-edge condition is explicitly tested and reported.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit + integration | `emberwatch_house_assembly.test.ts`, `emberwatch_map_validation.test.ts` | `tooling: \`bun run emberwatch:validate\`` | One closed door frame used; door anchor `(54,9)` returned; transition IDs remain `1005/1006/1007`; no hut edge or arrival marker added |

### AC-3: Navigation and save compatibility

**Given** the regenerated village
**When** navigation and restore checks run
**Then** the door approach is reachable, the intended solid/walk-behind cells are enforced, and the documented collision delta contains only the hut assembly’s authored changes. Existing stable identities remain unchanged.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Unit + E2E | house/nav tests and `docs/reference/emberwatch-map-validation.json` | `tooling: \`bun run emberwatch:validate\`` | 14-cell collision delta versus merged C-549 main: 12 upper-roof cells become clear and both former door cells `(53,9),(54,9)` become solid facade; approach/eave/plinth assertions and runtime walk evidence pass |

### AC-4: Reproducible WebGL evidence

**Given** the read-only candidate snapshot and generated artifacts
**When** C-548’s capture sequence runs
**Then** WebGL and visible-entity texture resolution are asserted before every capture; requested and actual player/camera cells are recorded separately. The requested hut, crossing, lighting, collision, walk and viewport stills are copied to `/tmp/opencode/c550-evidence-r3/` with an index, plus door-actor, side-wall scale, partly-occluded roof-walk, unchanged-inn and wide C-549-crossing views. If enter/exit is impossible because the hut has no approved interior edge, the index records that exact blocker and no fabricated transition evidence is claimed.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Visual + E2E | `/tmp/opencode/c550-evidence-r3/index.md` | `/game` via C-548 visual capture | 14 WebGL stills + 10 walk frames indexed, including door actor, side-wall scale, partly-occluded roof walk, unchanged-inn comparison and combined C-549-crossing frame; entity-texture guard passed; no-hut-interior enter/exit blocker recorded without fabricated evidence |

## Implementation Sequence

1. Resolve the absent-transition decision; record it in the contract before adding a gameplay edge.
2. Add append-only house frame recipes and manifest entries; verify atlas packing/pixels.
3. Add explicit map-layer contributions and `placeHouse` assertions; replace only the hut call.
4. Add layout/collision/door/nav/occlusion tests and regenerate tracked outputs.
5. Build the local candidate, capture C-548 evidence, run Moon checks/guards/affected CI, then commit separately.

## Edge Cases & Gotchas

- **No hut transition exists**: do not reuse `1005`/`1006`/`1007` or `inn_entrance`/`shop_entrance` for the hut without an explicit gameplay decision.
- **Terrain-channel collision**: overhead visual GIDs do not themselves open movement; explicit collision must be cleared/set deliberately.
- **Actor footprint**: the player box spans two rows, so a visually walkable roof row still needs a real actor-footprint navigation test.
- **C-549 base mismatch**: the historical FIRST finding is retained for traceability, but the final collision diff names merged C-549 baseline `49e3ad060f849e5f2a1d61444d9262958931ecf2` and verifies C-549 crossing cells are unchanged.
- **Generated outputs**: never hand-edit `village.json`, atlas JSON/WebP, hashes or validation reports.
- **Evidence honesty**: Canvas2D, missing candidate assets, or an unimplemented transition is a blocked evidence condition, not a pass.

## Open Questions

- None blocking implementation. The user selected exterior-only scope; a future hut interior/transition identity requires a separate contract.

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
|---|---|---|---|
| 1.0.0 | 2026-09-24 | Initial contract and pre-edit FIRST findings | user (direct prompt) |
| 1.1.0 | 2026-09-24 | Human-review r2 remediation: warm cedar roof value hierarchy, solid gable/hip planes, 3-roof/2-facade proportions, integrated ≤6px plinth and soft shadow, one closed boarded door plus window, merged-C-549 rebase/regeneration, and expanded WebGL evidence | user (review prompt) |
| 1.2.0 | 2026-09-24 | R3 review remediation: window moved to the former second-door cell, full-width seamless contact shadow, solid gable planes, walkable evidence targets with separate requested/actual cells, exact collision-delta regression, shared scatter ownership, and fail-closed entity-texture evidence guard with fingerprint coverage | user (review prompt) |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

---

## Execution Report

### Summary

Replaced only the Emberwatch village's north-east hut `building()` call with one deterministic south-facing raised-house assembly. The r3 review remediation keeps the 6×5 footprint, changes the visible stack to three roof rows plus two facade rows, uses warm weathered cedar shingles with a measured light-front/capped-ridge/dark-back hierarchy, fills gable ends as solid shaded hip planes, integrates a 6px plinth and a continuous 10px-falloff contact shadow, and places exactly one closed boarded door with a window in the former second-door cell. Fifteen append-only frames remain at GIDs 146–160; the open-door compatibility frame is not placed and is non-walkable in the manifest. All other village buildings, object identities, and transitions remain unchanged. After rebasing onto merged C-549, generated maps/hashes/reports were regenerated through the documented pipeline. The r3 POM lane now waits for and fingerprints visible entity texture resolution before every screenshot; technical evidence is indexed under `/tmp/opencode/c550-evidence-r3/`. Hut enter/exit evidence remains explicitly blocked because the approved exterior-only scope has no hut interior or transition edge.

### AC Status

| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | `placeHouse` authors the exact 51–56 × 5–9 footprint as three roof rows plus two facade rows; one closed door, one window in `(53,9)`, integrated 6px plinth, solid gable planes, and a continuous monotonic contact shadow are present; roof value/gable/shadow pixel tests pass. |
| AC-2 | ✅ | Exactly one closed door frame is placed; returned exterior anchor is `(54,9)`; village transitions remain exactly `1005`, `1006`, `1007`; no hut trigger, arrival marker, interior map, or interaction affordance was invented. |
| AC-3 | ✅ | Upper roof rows are overhead/clear, front eave and facade/plinth are solid, the real village gate reaches the approach and upper roof, and the merged-C-549 collision delta is pinned to 14 cells: 12 upper-roof clearances plus both former door cells becoming solid. |
| AC-4 | ✅ | POM-backed production E2E plus reproducible capture records 14 stills and 10 walk frames with live WebGL metadata, separate requested/actual cells, artifact and entity-texture fingerprints, unchanged-inn comparison, door/side-wall/partly-occluded actor views, and combined C-549-crossing frame; enter/exit is recorded as blocked rather than fabricated. |

### Files Created

| File | Purpose |
|---|---|
| `scripts/src/lib/ops/emberwatch_house_authoring.ts` | `placeHouse`, house role layout, explicit contributions, collision rules, and atomic assertions |
| `scripts/src/lib/ops/emberwatch_map_authoring_helpers.ts` | Shared cell bounds, terrain-aware walkability, and assertion formatting helpers |
| `scripts/src/lib/ops/generate_emberwatch_house_frames.ts` | Procedural roof, facade, door, foundation, and contact-shadow pixel recipes |
| `scripts/src/lib/ops/generate_emberwatch_assembly_frames.ts` | Shared bridge/house atlas dispatch seam |
| `scripts/src/lib/ops/emberwatch_house_assembly.test.ts` | Layout, door, collision, navigation, terrain, layer, and pixel-art tests |
| `packages/frontend/engine/src/systems/emberwatch_house_rendering.test.ts` | Ground filtering, layer-band, and overhead occlusion regressions |
| `apps/e2e/src/pom/emberwatch_house_page.ts` | Production-route house page object with map loading, movement, position, tutorial, WebGL probes, and visible-entity texture guard |
| `apps/e2e/src/visual/core/entity_texture_guard.ts` | Pure fail-closed policy for resolved scene-graph entity textures |
| `apps/e2e/src/services/entity_texture_guard.test.ts` | Unit coverage for placeholder, partial, resolved, and invisible entity displays |
| `apps/e2e/scripts/capture_c550_house.ts` | Reproducible candidate capture script with commit/artifact/entity-texture/image fingerprints |
| `apps/e2e/tests/game/emberwatch_house.spec.ts` | Production `/game` E2E for WebGL, walk-behind, and threshold blocking |
| `apps/e2e/src/visual/c550_house_expected_artifacts.json` | Expected generated-artifact plus entity-texture-policy fingerprint for the capture lane |
| `docs/contracts/C-550-emberwatch-house-assembly.md` | Contract and this execution report |
| `/tmp/opencode/c550-evidence-r3/index.md` | WebGL still/walk evidence index and enter/exit blocker record |

### Files Modified

| File | Change |
|---|---|
| `scripts/src/lib/ops/emberwatch_authoring.ts` | Re-export the house API and shared door geometry without changing existing building/bridge identities |
| `scripts/src/lib/ops/emberwatch_map_village.ts` | Replace only the north-east hut call with `placeHouse` |
| `scripts/src/lib/ops/emberwatch_map_shared.ts` | Add explicit contribution fields and centralize ownership protection so `scatter()` and `scatterPatches()` cannot overwrite authored ground/decor/overhead cells |
| `scripts/src/lib/ops/generate_emberwatch_atlas.ts` | Dispatch bridge and house recipes through the shared assembly painter |
| `scripts/src/lib/ops/generate_emberwatch_maps.ts` | Serialize ground/decor/overhead contributions with conflict checks and terrain-channel preservation |
| `scripts/src/lib/ops/generate_emberwatch_maps.test.ts` | Cover all new contribution arrays and bounds |
| `scripts/src/lib/ops/emberwatch_studio.ts` | Watch the new authoring/painter seams during studio regeneration |
| `apps/e2e/src/pom/index.ts` | Export the house page object |
| `apps/e2e/package.json` | Expose the reproducible `capture:c550-house` command |
| `packages/frontend/engine/src/systems/tilemap_render_system.ts` | Filter only terrain/duplicate baked-ground cells so explicit house ground art survives terrain rendering |
| `content/packs/emberwatch/manifest.json` | Append GIDs 146–160 without renumbering existing tiles |
| `content/packs/emberwatch/maps/village.json` | Regenerated hut footprint/layers/terrain/collision; other maps remain byte-stable |
| `content/packs/asset_hashes.json` | Regenerated manifest and village-map hashes |
| `docs/reference/emberwatch-coverage-audit.json` | Regenerated atlas coverage counts (159 used cells, 1 free) |
| `docs/reference/emberwatch-map-validation.json` | Regenerated village walkability percentage |
| `scripts/src/lib/ops/guard_source_file_size_baseline.json` | Sanctioned reduction-only contraction: atlas generator `1230 → 1226`; no ceiling or waiver was raised |
| `scripts/src/lib/ops/guard_cognitive_complexity_baseline.json` | Sanctioned reduction-only contraction: map generator worst score `32 → 22` |

### Generated files changed + commands

Generated outputs were produced through the existing Emberwatch tooling; no generated JSON, atlas, hash, or audit report was hand-edited. Rebase/regeneration order for r3:

1. `git fetch --prune origin`; confirmed PR #391/C-549 merged; `git rebase origin/main`.
2. Resolved rebase conflicts in generated `asset_hashes.json`, `maps/village.json`, `docs/reference/emberwatch-map-validation.json`, and the guard source-size baseline by taking the main-side version, then regenerated below. No generated conflict was hand-edited.
3. `bun run scripts/src/lib/ops/generate_emberwatch_atlas.ts` → local `atlas.webp` / `atlas.json` (544×340, 159 used frames; gitignored build output).
4. `bun run scripts/src/lib/ops/generate_emberwatch_props_atlas.ts` → local prop atlas build output.
5. `bun run scripts/src/lib/ops/generate_emberwatch_maps.ts` → all five tracked maps; only `village.json` changed relative to merged C-549 main.
6. `bun run scripts/src/lib/ops/scan_assets.ts` → content-pack hash sidecars.
7. `bun run emberwatch:audit` → `docs/reference/emberwatch-coverage-audit.json` (231 findings, 0 blockers).
8. `bun run emberwatch:validate` → `docs/reference/emberwatch-map-validation.json` (0 warnings, 0 blockers).
9. `bun run --cwd scripts catalog:workspace snapshot --mode production` followed by `bun run emberwatch:studio --skip-build` → local candidate origin/client for WebGL evidence.
10. `C550_CLIENT_URL=http://127.0.0.1:5274 C550_EVIDENCE_DIR=/tmp/opencode/c550-evidence-r3/automated bun run --cwd apps/e2e capture:c550-house` → POM-backed production capture with WebGL and visible-entity texture guards; 14 stills and 10 walk frames were indexed from the same live candidate.

Current generated hashes recorded by the r3 evidence plane:

- Manifest: `e485f907deef62fdb33beed9169943cc76eade9330a3ecba8639534bccc95d25`
- Village map: `7cb7af8983b6e5f7cdde388239d7e8ebd531c906c98686a18f3742b577fc628a`
- Atlas WebP: `2d46b96397a6c5fdb1f23f6c95546c41f253d704b8f16d05e023d148706432b5`
- Atlas JSON: `d08f521513e6c2a5f98a0bb69c9a0860eed8a8c04fc261dd5a41673535122864`

### Scope and generated-map audit

- Only the existing hut call at the north-east village position was replaced; the other six legacy building calls remain intact.
- The merged C-549 crossing is `36–38 × 7–8`; its authored cells and bridge GIDs remain unchanged by C-550.
- Comparing generated `village.json` with merged C-549 baseline `49e3ad060f849e5f2a1d61444d9262958931ecf2` yields 14 collision changes: 12 upper-roof cells (`c=51..56`, `r=5..6`) become clear, and both former door cells `(53,9),(54,9)` become solid facade/window art. Object-layer spawn and transition arrays are byte-identical.
- The door anchor `(54,9)` is a closed exterior anchor, not a transition or interaction target. The upper facade/eave remains the hard actor-footprint boundary; the closed door makes row `10` non-standable, so runtime movement settles on the clear second landing row `11`.
- Terrain overrides are accepted on walkable threshold cells and terrain-owned ground cells; non-empty overrides on blocked, non-terrain house ground art fail before mutation so terrain filtering cannot erase facade or plinth art. Solid overrides on walk-behind, approach, or contact-shadow cells still fail before mutation.

### Deviations from Spec

- **No hut interior or transition was added.** This is the user-selected exterior-only interpretation, not a missing implementation. The baseline has no hut interior, trigger, arrival marker, or stable edge to reuse; adding one would change gameplay identity and requires a separate contract. Making the hut enterable is explicitly deferred to that interior contract.
- **The single door is intentionally closed and non-interactive.** `house_door_closed` is the only door frame placed; the compatibility `house_door_open` frame is retained for append-only GID stability but is non-walkable and unused. The former second-door cell is solid facade/window art.
- **C-549 is merged into the rebase base.** The collision audit compares against merged C-549 baseline `49e3ad060f849e5f2a1d61444d9262958931ecf2`; no C-549 crossing cells were overwritten or renumbered.
- **No human visual acceptance is claimed.** The WebGL captures are technical observations only; the r3 evidence index is outside the tracked repository under `/tmp/opencode/c550-evidence-r3/`.
- **Actor evidence root cause:** r2's green square was the asynchronous green-tinted 1×1 player placeholder, not a C-550 map/atlas regression. The same old no-wait POM lane reproduces it on merged C-549 baseline `49e3ad060f849e5f2a1d61444d9262958931ecf2` and the C-550 worktree; normal `/game` and settled POM captures render LPC. The r3 guard waits for and fingerprints resolved visible entity textures.
- **Review follow-up:** terrain overrides reject non-empty overrides on blocked, non-terrain house ground cells, while preserving walkable threshold and terrain-owned cells; real-village reachability is asserted from `village_gate`; `scatter()` and `scatterPatches()` share explicit-contribution ownership protection; the production capture lane remains POM-backed with candidate/artifact/entity-texture fingerprints and WebGL checks.

### Test Results

- Focused C-550 unit/pixel/navigation tests (`bun moon run scripts:test -- --test-name-pattern 'C-550'`): **19 pass / 0 fail**.
- Real-pack atlas GID coverage: **2 pass / 0 fail**.
- Unit (`bun moon run scripts:test`): **2126 pass / 1 fail**; the single failure is the pre-existing `emberwatch:release --plan` five-second timeout case, outside the C-550 files. The same run reports no C-550, map, scan-assets, or atlas failures.
- Unit (`bun moon run frontend-engine:test`): **1838 pass / 0 fail / 1 todo**.
- E2E infrastructure unit (`bun run --cwd apps/e2e test:unit`): **36 pass / 0 fail**, 88 assertions. The e2e package exposes this script directly; its Moon config has no `test-unit` task.
- Production house E2E (`bun run --cwd apps/e2e test -- --project=game tests/game/emberwatch_house.spec.ts`): **3 pass / 0 fail**; WebGL, walk-behind, and closed-door threshold blocker paths pass.
- Emberwatch map validation: **0 warnings / 0 blockers**; coverage audit: **231 findings, 0 blockers**; locked identities unchanged; prop table in sync.
- Affected lint, format, and typecheck: pass. Full `bun moon run :validate`: **174 tasks completed, 0 failed** (119 cached); source-size warnings are pre-existing advisory output.
- Structural guards: **10/10 pass** via `bun run scripts/src/lib/ops/run_guards.ts`; the sanctioned source-size baseline contraction was applied with `--update-baseline` (1230 → 1226), never raised.
- `bun moon ci --base=origin/main`: **60 completed, 0 failed, 2 skipped** (18 cached).
- WebGL evidence: expanded automated capture produced 14 stills + 10 walk frames, renderer `webgl`, no page errors, passed expected-artifact and entity-texture fingerprint checks. Walk evidence reaches `(54,6)` behind the upper roof, remains partly occluded in the dedicated frame, stays blocked at the front eave, and settles at `(54,11)` on the clear approach because the closed door is solid.

### Evidence and blocked verification

- Evidence index: `/tmp/opencode/c550-evidence-r3/index.md`
- Full still metadata: `/tmp/opencode/c550-evidence-r3/capture_index.json`
- Full walk metadata: `/tmp/opencode/c550-evidence-r3/walk_index.json`
- Automated identity/fingerprint: `/tmp/opencode/c550-evidence-r3/automated/automated_manifest.json`
- Automated still metadata: `/tmp/opencode/c550-evidence-r3/automated/capture_index.json`
- Automated walk metadata: `/tmp/opencode/c550-evidence-r3/automated/walk_index.json`
- Reproduction command: `C550_CLIENT_URL=http://127.0.0.1:5274 C550_EVIDENCE_DIR=/tmp/opencode/c550-evidence-r3/automated bun run --cwd apps/e2e capture:c550-house`
- Enter/exit verification is **blocked**, not passed: the village still has only transition IDs `1005`, `1006`, and `1007`, and no hut destination map or arrival marker exists. No existing edge or arrival identity was retargeted to manufacture a result.

### Actor evidence root-cause proof

The r2 green square was not a C-550 product regression. The old capture lane took the screenshot while the asynchronous player display still contained its green-tinted 1×1 placeholder:

- Normal `/game` on the C-550 worktree settled to the LPC actor: `/tmp/opencode/c550-r2-actor-diagnostic.png`.
- The same old no-wait POM/Chromium lane on merged C-549 baseline `49e3ad060f849e5f2a1d61444d9262958931ecf2` produced a 1×1 player texture in all five probes and a green square in `/tmp/opencode/no-wait-1.png`.
- The same no-wait timing on the C-550 worktree produced the same placeholder in four of five probes (`/tmp/opencode/no-wait-2.png` is representative); one run won the asynchronous race. Settled captures on both trees render the actor (`/tmp/opencode/capture-origin-main.png` and `/tmp/opencode/capture-current-after-guard.png`).

`apps/e2e/src/pom/emberwatch_house_page.ts` now fails closed before every screenshot when a visible entity has no real texture, a 1×1/failed texture, or an incomplete composed display. The generated-artifact fingerprint historically covered only manifest/map/atlas bytes; r3 extends the capture identity with the `visible-entity-textures-v1` policy, per-capture texture-resolution fingerprints, and an aggregate `captureFingerprint`. This is a capture-lane fix, not an engine gameplay change.

### Known follow-ups

1. A future approved hut interior contract can consume the returned door anchor `(54,9)` and define its own transition/arrival identities.
2. Human visual review remains a separate gate; this implementation records technical WebGL evidence only.
3. C-549 is now merged; future changes to either crossing or hut geometry must rerun the combined collision delta and atlas-coverage check.

### Review r3 remediation record

This section records the requested human-review pass. It is an implementation/evidence record, not a visual acceptance decision.

| Review item | Change | Source / test location |
|---|---|---|
| Roof hierarchy and material | Replaced blue-grey horizontal bands with weathered cedar shingles. Front slope is the lightest plane; capped ridge has a narrow light cap and a distinct shadow row; back/top plane is darker. Gable ends use solid shaded hip planes without chevron line strokes. | `scripts/src/lib/ops/generate_emberwatch_house_frames.ts:41-263` |
| Eave and proportions | Removed the full grey foundation row between roof and facade. The 6×5 footprint renders three roof rows and two facade rows; eave overhang is a dark edge with a short facade-side shade. | `scripts/src/lib/ops/emberwatch_house_authoring.ts:293-336`; `generate_emberwatch_house_frames.ts:220-300` |
| Plinth and contact shadow | Integrated a 6px warm plinth into lower facade frames; the contact shadow now spans every facade column, repeats without horizontal gaps, and falls off monotonically over 10px. | `generate_emberwatch_house_frames.ts:41-42,317-334`; `emberwatch_house_authoring.ts:189-205,417-432`; `emberwatch_house_assembly.test.ts:535-568` |
| Door count and affordance | Added hut-only `houseDoorPlacement()` while retaining legacy two-cell `doorPlacement()` for existing shells. The hut places exactly one `house_door_closed` frame, uses a window in the former second-door cell `(53,9)`, and marks the unused open-door compatibility frame non-walkable. | `emberwatch_house_authoring.ts:20-90,264-291`; `content/packs/emberwatch/manifest.json:748-765` |
| Actor evidence gate | The POM waits for visible scene-graph entity displays to have real, complete textures before each screenshot; the pure guard is unit-tested and its policy/fingerprint is included in capture identity. | `apps/e2e/src/pom/emberwatch_house_page.ts:176-397`; `apps/e2e/src/visual/core/entity_texture_guard.ts:1-46`; `apps/e2e/src/services/entity_texture_guard.test.ts:1-60` |
| Pixel/navigation regressions | Added roof/gable value checks, no-stroke run-length checks, monotonic seamless-shadow checks, exact 14-cell collision-delta pinning, and shared `scatter()`/`scatterPatches()` ownership coverage. | `scripts/src/lib/ops/emberwatch_house_assembly.test.ts:155-251,368-421,535-635`; `scripts/src/lib/ops/emberwatch_grass_variants.test.ts:221-303`; `scripts/src/lib/ops/emberwatch_map_shared.ts:99-197` |
| Interior boundary | Contract records that enterability requires a separate interior contract defining destination, trigger and arrival identity. | This contract: AC-2, deviations and evidence sections |

### GID table delta after C-549

Merged C-549 baseline `49e3ad060f849e5f2a1d61444d9262958931ecf2` ends the bridge family at GID `145`. C-549 did not append any new manifest tile IDs, so the C-550 append remains collision-free:

| GID | Frame | C-550 role |
|---:|---|---|
| 146 | `house_roof_front.png` | solid front roof/eave |
| 147 | `house_roof_back.png` | walkable overhead back plane |
| 148 | `house_roof_ridge.png` | walkable overhead ridge/cap |
| 149 | `house_roof_gable_left.png` | walkable overhead filled gable/hip |
| 150 | `house_roof_gable_right.png` | walkable overhead filled gable/hip |
| 151 | `house_roof_eave_overhead.png` | walkable overhead eave |
| 152 | `house_roof_eave_edge.png` | solid front eave edge |
| 153 | `house_facade_wall.png` | solid upper facade |
| 154 | `house_facade_window.png` | solid lower facade/window |
| 155 | `house_facade_corner_left.png` | solid upper corner |
| 156 | `house_facade_corner_right.png` | solid upper corner |
| 157 | `house_door_closed.png` | solid closed/boarded door; the only placed door |
| 158 | `house_door_open.png` | retained compatibility frame; unused and non-walkable |
| 159 | `house_foundation.png` | lower facade/plinth frame |
| 160 | `house_foundation_shadow.png` | walkable transparent contact-shadow decor |

C-549 bridge GIDs `129–145` and the reserved terrain block `48–127` were not touched. Atlas capacity remains 160 cells; real-pack GID coverage passed after regeneration.

### Rebase and regeneration record

- `git fetch --prune origin` completed before the rebase.
- PR #391/C-549 was confirmed `MERGED`; the branch was rebased onto merged `origin/main` `49e3ad060f849e5f2a1d61444d9262958931ecf2` (the merged C-549/C-551 base).
- Rebase conflicts in `content/packs/asset_hashes.json`, `content/packs/emberwatch/maps/village.json`, `docs/reference/emberwatch-map-validation.json`, and the source-size policy file were resolved by taking the main-side version. The generated outputs were then regenerated; no generated conflict was hand-resolved into the final tree. Validation subsequently applied the sanctioned reduction-only source-size contraction `1230 → 1226`.
- The final combined collision diff against merged C-549 baseline `49e3ad060f849e5f2a1d61444d9262958931ecf2` is 14 cells, all at the hut: 12 upper-roof cells become clear and both former door cells become solid when the one-door/window facade is authored. C-549 crossing cells are unchanged.
