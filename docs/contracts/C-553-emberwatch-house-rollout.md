---
id: C-553
title: "Emberwatch house assembly rollout"
source: "direct"
contract_type: thin
status: implemented
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-09-24T00:00:00Z"
---

# Contract C-553: Emberwatch house assembly rollout

## Metadata

| Field | Value |
|---|---|
| **Source** | User-approved C-550 P2 review remediation and rollout; `docs/contracts/C-550-emberwatch-house-assembly.md` |
| **Target** | `scripts/src/lib/ops/` (shared house kit, six village building call sites, generated content and focused tests); `apps/e2e/` (production evidence); `packages/frontend/engine/src/__tests__/` (real-map restore clamp coverage); shared atlas-capacity consumers and generated Emberwatch references |
| **Type** | thin |
| **Priority** | P2 — apply the accepted C-550 assembly across the village while preserving gameplay identities and truthful thresholds |
| **Dependencies** | C-550 (accepted house kit), C-549 (village crossing and grass), C-548 (WebGL/entity-texture evidence plane), C-546 (append-only assembly pattern), C-545 (ambient parity) |
| **Status** | implemented |
| **Promotion** | — |
| **Docs Impact** | internal → this contract, generated Emberwatch authoring/release references, and external `/tmp/opencode/c553-evidence-r2/` evidence index |
| **Contract version** | 1.2.0 |
| **Production Surface** | `tooling: bun run emberwatch:studio` / `bun run emberwatch:validate`; generated Emberwatch pack consumed by production `/game` |

## FIRST — village building inventory (recorded before code edits)

Baseline: merged C-550 `origin/main` commit `a43d67c3d0a20afe15188ad5ed6309afe3c35b11` in worktree `/home/sonny/.herdr/worktrees/aikami/feat-ew-c553-house-rollout` on `feat/ew-c553-house-rollout`.

Coordinates are inclusive map cells. `building()` currently authors perimeter walls, `ROOF` interior tiles, a two-cell door and a two-row landing, but no transition. Existing village transition `1005`/`1006` rectangles are at west/east map gates rather than at the visible buildings; C-553 will retain transition IDs, target maps, target spawn IDs and interior maps while moving only the source trigger/fallback/arrival coordinates required to make the visible door truthful.

| Structure | Current source | Footprint | Role | Current door | Existing transition / interior | C-553 target |
|---|---|---|---|---|---|---|
| Inn | `building(47,12,9,8,…,'south')` | c47–55 × r12–19 (9×8) | Inn; village landmark; largest footprint | c50–51, r19; landing r20–21 | village `1006` at east gate c63 × r23–25 → `inn#inn_entrance`; return `inn:1005`; interior map `inn`; village arrival `from_inn` at (60,24); interior arrival `inn_entrance` at (14,17) | same kit, slate palette, open two-row door c51 at r18–19; source trigger c51 × r20–21; `from_inn` at (51,23), outside the inclusive trigger; interior arrival/exit retained; one existing `inn_brazier` prop as door light |
| Merchant shop | `building(47,26,9,7,…,'south')` | c47–55 × r26–32 (9×7) | Shop / merchant | c50–51, r32; landing r33–34 | village `1005` at west gate c0 × r23–25 → `merchant_shop#shop_entrance`; return `merchant_shop:1005`; interior map `merchant_shop`; village arrival `from_merchant` at (3,24); interior arrival `shop_entrance` at (12,15) | same kit, thatch palette, open two-row door c51 at r31–32; source trigger c51 × r33–34; `from_merchant` at (51,36), outside the inclusive trigger; interior arrival/exit retained |
| Smithy | `building(4,30,9,7,…,'north')` | c4–12 × r30–36 (9×7) | Smithy / forge yard | c7–8, r30; landing r28–29 | none; no interior | same kit, slate palette, south-facing closed two-row door c8 at r35–36; landing r37–38; no trigger |
| North-west cottage | `building(5,15,8,6,…,'south')` | c5–12 × r15–20 (8×6) | House | c8–9, r20; landing r21–22 | none; no interior | same kit, cedar palette, south-facing closed two-row door c9 at r19–20; landing r21–22; no trigger |
| North cottage | `building(18,13,7,6,…,'south')` | c18–24 × r13–18 (7×6) | House | c20–21, r18; landing r19–20 | none; no interior | same kit, cedar palette, south-facing closed two-row door c21 at r17–18; landing r19–20; no trigger |
| South-west shed | `building(24,36,7,6,…,'north')` | c24–30 × r36–41 (7×6) | House / shed | c26–27, r36; landing r34–35 | none; no interior | same kit, thatch palette, south-facing closed two-row door c27 at r40–41; landing r42–43; no trigger |
| North-east hut | `placeHouse` (already migrated by C-550) | c51–56 × r5–9 (6×5) | Closed ordinary hut | closed c54, r9; landing r10–11 | none; no interior | keep footprint and collision; refine to two-row closed door c54 at r8–9 and corrected roof silhouette; no trigger |

**Other-map audit:** repository-wide `building()` search finds exactly the six village calls above. `inn`, `merchant_shop`, `old_road`, and `ruined_shrine` do not call `building()`; they are not rollout targets in C-553.

## Problem & Baseline Evidence

- C-550's visible door opening is only 24px high, about half the LPC actor. The facade art spans two rows, but the door does not, so thresholds do not read at actor scale.
- C-550's `house_roof_gable_left/right` and facade-corner recipes create dark side columns. In accepted evidence, the eave/side bands read as an inset middle step rather than a clean diagonal hip or straight eave.
- Six village buildings still use the flat wall/roof `building()` shell. Only the NE hut uses `placeHouse`.
- Village source transitions `1005` and `1006` target real interiors but fire at west/east perimeter gates, not at the inn/shop visible doors. Arrivals return to those same perimeter gates.
- Baseline test state on the clean C-550 worktree: `scripts:test` has 10 failures and `frontend-engine:test` has 5 failures because the bootstrapped worktree does not yet contain the gitignored generated atlas/prop/manifest plane; `apps/e2e test:unit` is 36/36. These are recorded environment-baseline failures, not C-553 failures.

## User Outcome

Every village structure uses one coherent raised-house kit at true LPC scale. Doors are readable thresholds: enterable inn/shop doors visibly align with their preserved transitions and named arrivals; every non-interior door is closed/boarded and has no trigger. The NE hut keeps its footprint/collision. Technical tests and a WebGL evidence set prove scale, roof silhouette, collision deltas, navigation, walk-behind and inn enter/exit.

## Scope Boundaries

- **In Scope:** C-550 kit refinement; one two-row upper/lower door frame pair for closed and open states; proportional windows; monotonic roof silhouette; cedar/slate/thatch palette variants sharing geometry; all six village `building()` call sites; preserved interior transitions aligned to visible doors; one existing inn light prop if it does not obstruct navigation; collision diff/clamp/nav tests; generated atlas/maps/hashes/reports; production POM/E2E/evidence/contact sheet.
- **Out of Scope:** interiors or new interior maps; C-552 terrain painters; UI; image-model art; ambient policy changes; other-map building rollout; new bespoke inn frames; guard/golden/evaluator weakening; deployment/publication; claiming human visual acceptance.
- **File budget:** fewer than 100 changed files.
- **Review spacing:** do not request CodeRabbit review until at least one hour after the previous Emberwatch review; record actual timestamps in the handoff.

## Acceptance Criteria

### AC-1: C-550 kit is refined to actor scale with a monotonic roof silhouette

**Given** packed C-553 house frames
**When** upper/lower door frames are composed and every village roof is inspected from end to centre
**Then** the door-frame opening is at least 44px high (target 48px) and spans both facade rows; windows are proportionally smaller; gable/hip ends meet the roof on a clean diagonal or straight eave with no dark inset side columns; the measured top outline is monotonic from each end to the centre. The NE hut remains 51–56 × 5–9 with its C-550 collision roles unchanged. Large footprints cap the pale/front roof at `min(footprintRows - 2, 3)` rows, retain the full overhead collision-clear walk-behind depth as a darker back slope, and carry exactly one ridge highlight per roof column.

**Evidence Matrix**
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit + pixel | `scripts/src/lib/ops/emberwatch_house_rollout.test.ts`, refined `emberwatch_house_assembly.test.ts` | `tooling: bun run scripts/src/lib/ops/generate_emberwatch_atlas.ts` | packed-pixel door/window/roof tests; material alpha-mask equality; hut footprint/collision pin |

### AC-2: All village buildings use the shared kit with truthful doors

**Given** the FIRST inventory
**When** village maps regenerate
**Then** all six `building()` calls are gone; each structure uses `placeHouse` with the listed footprint, explicit door column, south-facing geometry and cedar/slate/thatch palette; enterable doors use open paired frames and non-interior doors use closed paired frames; no new transition or arrival identity exists. An author-time final-object-layer assertion rejects any prop visual footprint that touches a house facade/roof cell or a door approach cell.

**Evidence Matrix**
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit + source audit + E2E | rollout tests, transition-alignment tests, production `/game` spec | `tooling: bun run emberwatch:validate` | seven exact house placements, two open/two-row doors, five closed/two-row doors, zero calls to legacy `building()` |

### AC-3: Interior transitions, triggers, and arrivals align with visible doors

**Given** existing transition IDs `1005`/`1006` and arrival IDs
**When** source and destination objects are compared
**Then** IDs, target maps and target spawn IDs remain unchanged; only polishable source trigger/fallback/arrival coordinates move to the inn/shop door approaches; destination interior spawns and reverse exit transitions remain valid; every trigger is reachable from every applicable village arrival; entering and exiting the inn lands at the named markers without bounce-back.

**Evidence Matrix**
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Unit + navigation + production E2E | exact object assertions; real-map route tests; `apps/e2e/tests/game/emberwatch_house.spec.ts` | production `/game` via POM | transition matrix/route validation passes; inn village→interior→village capture and cell assertions |

### AC-4: Collision changes are exact and save-safe

**Given** generated C-550 and C-553 village collision layers
**When** the maps are diffed cell-by-cell and grouped by footprint
**Then** every changed cell is attributed to exactly one building; each newly blocked cell that was walkable is covered by the real-map `clampSpawnToWalkable` test; no unrelated cell changes; every actor-standable walk-behind roof cell is reachable from the square and every relevant arrival; raw-clear roof cells that cannot be actor-standable because the immediately adjacent terrain is blocked are explicitly enumerated rather than claimed reachable.

**Evidence Matrix**
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Unit + integration | per-building collision-delta table/test; actor-footprint roof reachability test; engine restore-clamp test; route validation | `tooling: bun run emberwatch:validate` | diffed cell counts, exact newly-blocked list, all-cell actor-footprint classification, and the explicit north-cottage blocked-row exception; zero validation blockers/warnings |

### AC-5: Reproducible WebGL/entity-texture evidence

**Given** clean C-550 before plane and final C-553 candidate plane
**When** the production `/game` capture lane runs
**Then** WebGL and resolved visible-entity textures are asserted before every screenshot; same-camera before/after noon door shots exist for every building; one maximum-lane-width village overview, square dawn/night, inn walk-behind, and inn enter/exit are captured; `/tmp/opencode/c553-evidence-r2/sheet.png`, PNGs, machine-readable indexes and `index.md` are written with commit/artifact/camera/player identities.

**Evidence Matrix**
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | Visual + E2E | `apps/e2e/scripts/capture_c553_house_rollout.ts`, POM-backed spec, `/tmp/opencode/c553-evidence-r2/` | production `/game` WebGL | paired PNG set, contact sheet, index; entity-texture guard status and hashes recorded |

## Implementation Sequence

1. Keep this FIRST inventory and baseline findings current.
2. Write failing kit/layout/pixel/collision/alignment tests.
3. Refine frames and extend `placeHouse`; grow atlas append-only if required.
4. Replace six village calls; move only polishable transition/arrival coordinates; add at most the approved existing inn light prop.
5. Regenerate through producer commands; diff generated maps; never hand-resolve generated conflicts.
6. Run Moon tests/typechecks/lint, guards, affected CI, production E2E and evidence capture.
7. Update this contract to `implemented` with exact report and evidence paths.

## Edge Cases & Gotchas

- C-552 may merge while this branch is open. Fetch/rebase, take no generated map/atlas/hash/report conflict as final, and regenerate all derived files.
- Door cells stay solid; the trigger belongs on the clear landing immediately outside, not inside blocked facade art.
- Roof walk-behind remains overhead + explicit collision `0`; front eave/facade remain explicit collision `1`. Actor navigation additionally requires the cell above the feet cell to be clear; a raw-clear roof row directly below blocked terrain is documented as non-standable rather than silently counted as reachable.
- Roof material variants may change palette, never alpha silhouette or per-building geometry.
- Generated JSON, atlas JSON/WebP, asset hashes and reports are never hand-edited.
- Evidence must use WebGL and the visible-entity texture guard; Canvas2D/placeholders are failures.

## Amendments

| Version | Date | Change | Approved by |
|---|---|---|---|
| 1.0.0 | 2026-09-24 | Initial direct implementation contract and pre-edit building inventory | user (direct prompt) |
| 1.1.0 | 2026-09-24 | Independent verification clarified actor-footprint roof reachability and versioned the fail-closed entity-texture guard; no map geometry or collision footprint changed | user (direct prompt) |
| 1.2.0 | 2026-09-24 | Rebased onto C-552, regenerated the merged artifact plane, capped large-footprint front roof depth, added author-time prop keep-out enforcement, and removed the production door-threshold rectangle overlay | user (direct prompt) |

## Promotion Lifecycle

> Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle).

## Status Lifecycle

> Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle).

## Execution Report

### Summary

Rolled the refined C-550 raised-house kit across all seven Emberwatch village structures: six legacy `building()` shells were replaced with explicit south-facing `placeHouse` calls, while the north-east hut retained its footprint and collision contract. The shared kit now has paired upper/lower door frames, proportional windows, clean facade corners, monotonic transparent roof silhouettes, and cedar/slate/thatch palettes sharing one geometry. Large footprints cap the pale/front roof at three rows while retaining darker back-slope overhead cells for walk-behind navigation. Existing transition identities and interior arrival IDs were preserved; only source trigger/fallback coordinates were moved to the visible inn and shop doors. Independent verification also versioned the fail-closed entity-texture guard, removed duplicate ECS player displays, and documented the north cottage's blocked-terrain roof-row exception. Technical WebGL evidence and the full generated-artifact plane are indexed under `/tmp/opencode/c553-evidence-r2/`; this report does not claim human visual acceptance.

### Building matrix

| Structure | Footprint (inclusive) | Door and approach | Palette | Transition / arrival proof |
|---|---|---|---|---|
| Inn | c47–55 × r12–19 | open c51, r18–19; landing r20–21 | slate | `1006` source trigger c51 × r20–21 → `inn#inn_entrance`; `from_inn` c51,r23; interior `inn_entrance` c14,r17 |
| Merchant shop | c47–55 × r26–32 | open c51, r31–32; landing r33–34 | thatch | `1005` source trigger c51 × r33–34 → `merchant_shop#shop_entrance`; `from_merchant` c51,r36; interior `shop_entrance` c12,r15 |
| Smithy | c4–12 × r30–36 | closed c8, r35–36; landing r37–38 | slate | no transition or arrival; closed door has no trigger |
| North-west cottage | c5–12 × r15–20 | closed c9, r19–20; landing r21–22 | cedar | no transition or arrival; closed door has no trigger |
| North cottage | c18–24 × r13–18 | closed c21, r17–18; landing r19–20 | cedar | no transition or arrival; closed door has no trigger |
| South-west shed | c24–30 × r36–41 | closed c27, r40–41; landing r42–43 | thatch | no transition or arrival; closed door has no trigger |
| North-east hut | c51–56 × r5–9 | closed c54, r8–9; landing r10–11 | cedar | no transition or arrival; C-550 footprint and collision roles unchanged |

All seven calls are south-facing `placeHouse` calls. The six legacy village `building()` calls are gone; the other Emberwatch maps do not call `building()`. The existing `inn_brazier` prop is the only added village prop and sits beside the inn door as the approved warm door light.

### Kit refinements and coverage

- Preserved C-550 GIDs 146–160 and appended GIDs 161–176: upper closed/open door frames, seven slate roof frames, and seven thatch roof frames. The atlas is now 16×11 / 176 cells with a 544×374 extruded surface; one frame remains free. C-552's repainted GIDs 34/47 and corner16 block 48–128 remain disjoint.
- Door frames are selected as one column across both facade rows. Pixel tests measure a continuous opening of at least 44px (64px frame stack), and windows measure 8×10px rather than competing with the actor-height doorway.
- All three roof palettes have identical alpha masks and shared front/back/ridge/gable/eave geometry. Tests enforce a monotonic end-to-centre silhouette, clean diagonal gable ends, no dark inset side column in stable facade corners, and at most one pale front band/ridge highlight per roof column.
- `placeHouse` validates bounds, south-facing input, door placement, walkable upper-roof cells, approach cells, contact-shadow cells, and blocked terrain overrides before mutating the map. The visible front roof is capped at `min(footprintRows - 2, 3)` rows; all remaining overhead cells use the darker back slope, preserving the full collision-clear walk-behind depth without a footprint shrink.
- The village builder runs an author-time prop-footprint keep-out assertion over final object layers. Violations are rejected for any house facade/roof or door-approach cell; the moved placements are `inn_brazier` `(53,20)→(53,22)`, `inn_chair` `(54,20)→(55,22)`, `inn_barrel` `(54,21)→(56,22)`, and `woodland_oak_3` `(12,20)→(15,20)`.
- Door-sized production transition overlays retain only the quiet grounded chevron; their full brass rectangle is suppressed. The outline was production-visible before remediation; the visible door art is now the threshold affordance. The red perimeter squares are report-only `plant.png` / GID 31 cells emitted by `paintOuterRing`/`thinTreeline`.

### Exact collision delta

Compared with the generated C-550 village plane, every changed cell is attributable to exactly one footprint. Counts below are changed cells, not footprint area: newly clear cells are upper-roof cells becoming walkable overhead; newly blocked cells are former open door cells becoming solid facade.

| Structure | Changed cells | Newly clear | Newly blocked |
|---|---:|---:|---|
| Inn | 47 | 45 | `(50,19)`, `(51,19)` |
| Merchant shop | 38 | 36 | `(50,32)`, `(51,32)` |
| Smithy | 34 | 34 | — |
| North-west cottage | 26 | 24 | `(8,20)`, `(9,20)` |
| North cottage | 23 | 21 | `(20,18)`, `(21,18)` |
| South-west shed | 19 | 19 | — |
| North-east hut | 0 | 0 | — |
| **Total** | **187** | **179** | **8** |

The eight newly blocked cells are covered by real-map `clampSpawnToWalkable` restore tests. The route validator also treats the trigger rectangle as inclusive, preventing an arrival exactly on the bottom boundary from producing a false pass. Against the rebased `origin/main` C-552 maps, only `village.json` changes collision: 187 cells, 179 newly clear and 8 newly blocked; all four other map collision layers are byte/digest identical.

### Actor-footprint roof reachability

The rollout test uses the production actor-footprint rule: a cell is standable only when both the feet cell and the cell one row above are clear. Every standable walk-behind roof cell is reachable from all five village arrival probes. The all-cell audit found seven raw-clear cells that are intentionally not actor-standable because the stream/terrain row immediately north of the north cottage is blocked: `(18,13)` through `(24,13)`. Those cells remain overhead roof art with explicit collision `0`, but are documented as a navigation exception rather than counted as reachable actor space. The remaining roof cells for all seven structures are actor-reachable.

### Transition and arrival proof

- `1006` keeps ID, target map `inn`, target spawn `inn_entrance`, and interior target coordinates `(14,17)`; only its village trigger moved to c51 × r20–21, directly outside the visible two-row door.
- `1005` keeps ID, target map `merchant_shop`, target spawn `shop_entrance`, and interior target coordinates `(12,15)`; only its village trigger moved to c51 × r33–34, directly outside the visible shop door.
- Reverse interior transition `inn:1005` now targets village `from_inn` at `(51,23)`; reverse `merchant_shop:1005` targets `from_merchant` at `(51,36)`. Both return arrivals are one row beyond the inclusive source trigger and remain named identities.
- `1007` and the north-gate arrival are unchanged. No transition, spawn, interior map, or arrival identity was added for a closed door.
- Production E2E enters the inn from c51,r22, lands at c14,r17, exits to c51,r23, and remains at those cells after the 500ms bounce-back window.

### Files created

| File | Purpose |
|---|---|
| `scripts/src/lib/ops/emberwatch_house_rollout.test.ts` | C-553 kit, pixel, layout, transition, reachability, and exact collision-delta tests |
| `packages/frontend/engine/src/__tests__/emberwatch_house_rollout_restore.test.ts` | Real-map navigation and save-restore clamp regressions |
| `apps/e2e/scripts/capture_c553_house_rollout.ts` | Reproducible 20-shot before/after production WebGL evidence capture |
| `apps/e2e/src/visual/c553_house_rollout_expected_artifacts.json` | Baseline/candidate artifact hashes and entity-texture policy pin |
| `docs/contracts/C-553-emberwatch-house-rollout.md` | Contract, FIRST inventory, acceptance criteria, and this report |

### Files modified

| Area | Files |
|---|---|
| House authoring and generation | `scripts/src/lib/ops/emberwatch_authoring.ts`, `emberwatch_house_authoring.ts`, `emberwatch_map_village.ts`, `emberwatch_map_retained.ts`, `emberwatch_prop_footprint.ts`, `generate_emberwatch_house_frames.ts`, `generate_emberwatch_atlas.ts`, `generate_emberwatch_canvas.ts`, `generate_emberwatch_tables.ts`, `generate_emberwatch_props_atlas.ts` |
| Focused authoring/validation tests | `scripts/src/lib/ops/emberwatch_house_assembly.test.ts`, `emberwatch_house_rollout.test.ts`, `emberwatch_terrain_pass.test.ts`, `emberwatch_map_validation.test.ts`, `emberwatch_map_validation_context.ts`, `emberwatch_map_validation_rules.ts`, `generate_emberwatch_derivation.test.ts` |
| Generated content and reports | `content/packs/asset_hashes.json`, `content/packs/emberwatch/manifest.json`, all five `content/packs/emberwatch/maps/*.json`, `docs/reference/emberwatch-coverage-audit.json`, `docs/reference/emberwatch-map-validation.json`, `docs/reference/emberwatch-visual-report.json` |
| Atlas/capacity consumers | `packages/frontend/engine/src/__tests__/emberwatch_content_audit.test.ts`, `packages/frontend/engine/src/game_world/scene_overlays.ts`, `scene_overlays.test.ts`, `packages/shared/constants/src/lib/media_preparation.ts`, `packages/shared/local-ai/src/lib/preparation/atlas_bounds.ts`, `atlas_bounds.test.ts`, `packages/shared/schemas/src/lib/game/prop_atlas.ts` |
| Candidate/evidence lane | `scripts/src/lib/ops/emberwatch_candidate_plane.ts`, `apps/e2e/package.json`, `apps/e2e/scripts/capture_c550_house.ts`, `capture_c553_house_rollout.ts`, `apps/e2e/src/pom/emberwatch_house_page.ts`, `apps/e2e/src/visual/core/entity_texture_guard.ts`, `apps/e2e/src/visual/c550_house_expected_artifacts.json`, `apps/e2e/src/visual/c553_house_rollout_expected_artifacts.json`, `apps/e2e/tests/game/emberwatch_house.spec.ts` |
| Entity display identity | `packages/frontend/engine/src/game_world/entity_display.ts`, `packages/frontend/engine/src/game_world.ts`, `packages/frontend/engine/src/__tests__/ambient_parity.test.ts` |
| Locked IDs and documentation | `scripts/src/lib/ops/emberwatch_locked_ids.golden.json`, `docs/guides/emberwatch-release.md`, `docs/plans/emberwatch_rebuild.md`, `docs/reference/asset-generation-review-2026-09.md` |

The ignored local build outputs (`atlas.webp`, `atlas.json`, regenerated asset seed, local candidate origin, and client build directory) were regenerated through the producer commands and are represented by the tracked hashes/reports; they were not hand-edited.

### Rebase, regeneration, and GID audit

- Fetched `origin` and rebased the WIP commit onto `origin/main` `3f30e75eb` (C-552 #395). The only rebase conflict was `content/packs/asset_hashes.json`; main's generated version was selected, then all generated outputs were rebuilt from the merged source.
- Regeneration order: `generate_emberwatch_atlas.ts` → `generate_emberwatch_props_atlas.ts` → `generate_emberwatch_maps.ts` → `scan_assets.ts` → `generate_asset_seed.ts --write` → `emberwatch:audit` → `emberwatch:validate` → `emberwatch:visual-report`. No generated JSON was hand-edited.
- C-552 owns GID 34 (`stone_floor_variant.png`), GID 47 (`flagstone.png`), and the corner16 allocation GIDs 48–128. C-553 appends GIDs 161–176: 161–162 upper door frames, 163–169 slate roof frames, and 170–176 thatch roof frames. The sets are disjoint; atlas coverage remains 16×11 / 176 cells with one free frame.
- Comparing the final generated maps with `origin/main` shows only `village.json` collision changes: 187 cells, 179 newly clear and 8 newly blocked. `inn`, `merchant_shop`, `old_road`, and `ruined_shrine` collision layers are unchanged.

### Test results

| Check | Result |
|---|---|
| `bun moon run scripts:test -- src/lib/ops/emberwatch_house_rollout.test.ts` | **16 pass, 0 fail** |
| `bun moon run scripts:test -- src/lib/ops/emberwatch_house_assembly.test.ts` | **19 pass, 0 fail** |
| `bun moon run scripts:test` | **2184 pass, 2 inherited 5s release-CLI timeouts**; focused release file with `--timeout 15000` is **10 pass, 0 fail** |
| `bun moon run frontend-engine:test -- src/game_world/scene_overlays.test.ts` | **9 pass, 0 fail** |
| `bun moon run frontend-engine:test` | **1854 pass, 0 fail, 1 existing todo** |
| `apps/e2e` `bun run test:unit` | **38 pass, 0 fail** |
| Targeted production game spec (`test:game -- emberwatch_house.spec.ts`) | **12 pass, 0 fail** |
| `bun run emberwatch:validate` | **0 warnings, 0 blockers** |
| `bun run scripts/src/lib/ops/run_guards.ts` | **10 structural guards passed** |
| `scripts:typecheck`, `e2e:typecheck`, `frontend-engine:typecheck`, `local-ai:typecheck`, `constants:typecheck`, `schemas:typecheck` | all passed |
| `bun moon ci --base=origin/main` | **73 actions completed, 2 skipped, 0 failed**; client production build and affected tests/typechecks/lints passed |
| `bun run scripts/src/lib/ops/lint_contracts.ts --contract C-553` | **0 errors, 0 warnings**; the unscoped repository contract audit remains baseline-red on unrelated historical contracts |
| C-553 capture | **20 PNGs**, WebGL and `visible-entity-textures-v2` passed for every capture; before lane recorded `legacy-positionless-placeholder-v1` compatibility, after lane had no exemption; `pageErrors: []` |

The full scripts run has two inherited `emberwatch:release --plan` tests exceeding Bun's 5-second per-test timeout. Rerunning that exact file with `--timeout 15000` passes all 10 tests; the two timeouts are not C-553 failures.

### Evidence

- Index and machine-readable metadata: `/tmp/opencode/c553-evidence-r2/index.md`, `manifest.json`, `before_index.json`, `after_index.json`.
- Contact sheet: `/tmp/opencode/c553-evidence-r2/sheet.png`.
- Seven paired noon building shots: `before_*.png` / `after_*.png` for inn, merchant-shop, smithy, north-west-cottage, north-cottage, south-west-shed, and north-east-hut.
- Additional candidate shots: `after_village-overview.png`, `after_square-dawn.png`, `after_square-night.png`, `after_inn-walk-behind.png`, `after_enter_inn.png`, and `after_exit_inn.png`.
- Capture used `C553_BEFORE_CLIENT_URL=http://127.0.0.1:5291`, `C553_BEFORE_ROOT=/tmp/opencode/c552-baseline`, `C553_AFTER_CLIENT_URL=http://127.0.0.1:5290`, `C553_AFTER_ROOT=/home/sonny/.herdr/worktrees/aikami/feat-ew-c553-house-rollout`, and `C553_EVIDENCE_DIR=/tmp/opencode/c553-evidence-r2`.
- Both lanes recorded WebGL; the browser reported 16384×16384 maximum viewport dimensions and the overview canvas allocated exactly 8192×6144. Pair cameras, world transforms, clips, player cells, artifact hashes, and entity-texture fingerprints are recorded in the indexes.

### Deviations and surprises

- No map, interior, terrain, UI, or deployment scope deviation. The branch was rebased onto `origin/main` `3f30e75eb` (C-552 #395); C-552's generated maps/atlas/hashes/reports were taken from main and regenerated from the merged source rather than hand-merged. The only post-main collision delta is the explicit C-553 village delta described above.
- The maximum-width overview exposed an unpositioned ECS transition/spawn marker as a visible white placeholder at map origin. The v2 entity guard no longer exempts unmatched positioned displays: entity displays carry an `entity-<id>` label, and only explicitly labelled non-actor markers are filtered. The C-550 before lane uses one recorded, narrowly shaped `legacy-positionless-placeholder-v1` compatibility for its pre-v2 client; the C-553 after lane has no such exemption. Both lanes still require the player and every positioned visible actor to have resolved textures.
- The overview requested and actual center were both c31,r23. The production nearest-walkable clamp instead affected the inn walk-behind probe, requested c51,r11 and resolved to c51,r13; both values are recorded in the index.
- The existing `inn_brazier` was reused as the single approved door-light prop; no bespoke interior frame or image-model asset was introduced.
- Evidence is technical WebGL evidence only. Human visual acceptance, deployment, and publication remain outside this contract.

### Review spacing and handoff

The last substantive Emberwatch CodeRabbit review recorded for the preceding work was `2026-09-24T01:08:16Z`; the final r2 evidence capture occurs more than one hour later. The branch has 53 changed paths including six new files, remains below the 100-file budget, and is prepared for the requested PR. Intended PR title: `feat(emberwatch): C-553 roll house assembly out across the village`.

