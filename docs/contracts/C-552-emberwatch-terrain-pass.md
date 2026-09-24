---
id: C-552
title: "Emberwatch terrain pass"
source: "direct — accepted P2 baseline; docs/reference/emberwatch-polish-review-and-plan.md §1.6 and §5; C-545/C-546/C-548/C-549/C-550"
contract_type: thin
status: implemented
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: "https://github.com/BearlySleeping/aikami/pull/395"
created_at: "2026-09-24T13:16:05Z"
---

# Contract C-552: Emberwatch terrain pass

## Metadata

| Field | Value |
|---|---|
| **Source** | Human P2 acceptance sheet `/tmp/opencode/p2_acceptance_sheet.png`; `docs/reference/emberwatch-polish-review-and-plan.md` §1.6 and §5 terrain production guidance; C-545 ambient policy; C-546 pinned terrain GIDs; C-548 evidence plane; C-549 grass metrics; C-550 merged baseline |
| **Target** | `scripts/src/lib/ops/` terrain/stone/grass/sand painters, runtime grass eligibility, focused tests; generated Emberwatch atlas/maps/hashes/reports; C-548 evidence capture output under `/tmp/opencode/c552-evidence-r2/`; this contract |
| **Type** | thin |
| **Priority** | P2 — bridge and house assemblies are accepted; terrain transitions and floor value now dominate the remaining environment defects |
| **Dependencies** | C-545 (ambient parity), C-546 (append-only atlas/GID pinning), C-548 (candidate/evidence/entity-texture lane), C-549 (grass metrics and seeded patches), C-550 (merged baseline / #392) |
| **Status** | implemented |
| **Promotion** | — |
| **Docs Impact** | internal → contract and evidence index only; no player-facing docs page |
| **Contract version** | 1.1.0 |
| **Production Surface** | `tooling: bun run emberwatch:studio` regenerates and serves the terrain candidate; `tooling: bun run emberwatch:validate` validates it; runtime consumes the generated atlas/maps through production `/game` |

## Problem & Baseline Evidence

Baseline is clean `origin/main` commit `a43d67c3d0a20afe15188ad5ed6309afe3c35b11` (`feat(emberwatch): C-550 raised house assembly (#392)`), branch `feat/ew-c552-terrain-pass`.

- **Current behavior — corner16 sawtooth:** dirt/grass and sand/dirt transition frames expose repeated triangular teeth at every adjacency change. The defect is loudest at the C-549 crossing landings and the village square. The current corner16 painter derives its edge from the binary mask with a long straight diagonal, so a one-cell occupancy change becomes a full tile-length 45-degree stair rather than a soft, noise-shaped material boundary.
- **Current behavior — floor dominance:** the stone-floor material repeats a high-contrast, regular small-bevel grid. In the village square and north-south road it reads as bathroom tile and competes with actors. The same baked `stone_floor` GID/frame is shared by all five Emberwatch maps, so a painter-only correction reaches inn, merchant, old road, and shrine without map edits.
- **Current behavior — flat grass:** C-549 removed dark square variants and regular bright-fleck lattices, and its seeded `scatterPatches` now creates broad low-contrast value variation. The accepted result is restrained but can read monotone. C-552 adds only very sparse, irregular low-contrast tufts, never an independent square field and never on authored path/bank cells.
- **Current behavior — dawn sand:** dawn screenshots show warm sand shifted mauve. C-545 applies one ambient multiplier to terrain and entities, so the first diagnosis is whether the authored low-saturation sand base is being multiplied by the dawn UBO. Ambient curves are not changed in this contract.
- **Existing implementation to reuse:** `generate_emberwatch_atlas.ts` and extracted grass/bridge/house painter modules; C-549 `packAtlas()` metrics and `scatterPatches`; C-548 read-only snapshot + local candidate + WebGL/entity-texture capture guards; existing GID coverage/audit/validation.
- **Known gaps:** current tests constrain base/edge grass means but do not reject long sawtooth runs, prove all 16 mask seams, constrain mortar/stone contrast against dirt/grass means, measure grass tuft occupancy, or assert collision-layer identity across painter-only regeneration.
- **Fresh-worktree baseline tests:** `bun moon run scripts:test` = 2133 pass / 10 fail / 2 skip; all ten failures require missing generated atlas/candidate artifacts. `bun moon run frontend-engine:test` = 1805 pass / 3 fail / 1 todo; all three failures are missing `atlas.json`, `props.webp`, and `props.json` in the gitignored fresh-worktree build output. No source edit existed at baseline.

## User Outcome

Across all five Emberwatch maps, terrain families meet in soft irregular boundaries rather than repeated sawteeth; the village square and road use calm, irregular stone subordinate to actors; grass keeps C-549's broad restrained variation with only occasional small tufts; and dawn sand remains recognizably sand. Painting changes flow through regeneration only, with every map collision layer byte-identical to the accepted C-550 baseline.

## Success Measures

- **Transition quality:** all 16 corner16 cases remain opaque, seam-compatible, and free of grass-hue leakage; isolated profiles are audited for short-period correlation, while the acceptance threshold is measured on actual 3×3 placed-cell composites at the crossing landing.
- **Stone restraint:** measured stone luminance sits close to the dirt/path family; every frame actually used on a stone/cobble floor cell is enumerated from map GIDs and stays within the cobble local-contrast bound. GID 34 is reserved for restrained indoor flagstone and GID 47 is an outdoor cobble variant.
- **Grass restraint:** every grass variant mean remains within ±4% of base; explicit tuft occupancy is at most 3% of authored grass cells; tuft frames are never selected on water, sand, path, bridge, stone, or other non-grass cells.
- **Geometry identity:** all five regenerated collision layers are byte-identical to `origin/main`; object identities and map extents remain unchanged.
- **Production evidence:** same-camera 1920×1080 DPR1 noon before/after captures cover the named crossing, square, old-road and remaining-map views, plus square dawn/night; 1280×720 close-ups cover the landing, merchant floor, and inn floor; WebGL and visible-entity texture guards pass; montage and index live under `/tmp/opencode/c552-evidence-r2/`.
- **Scope:** fewer than 100 files; separate painter, regeneration, and documentation commits.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Corner16 mask semantics | `packages/frontend/engine/src/assets/autotile.ts`, manifest terrain definitions | reuse unchanged; no runtime matcher change |
| Terrain atlas painter | `scripts/src/lib/ops/generate_emberwatch_atlas.ts` and extracted frame painters | modify in place, preserving GIDs 48–127 |
| Grass metrics | `generate_emberwatch_grass_frames.ts`, `emberwatch_grass_variants.test.ts` | extend tests/painters, preserve C-549 thresholds |
| Seeded grass patches | `emberwatch_map_shared.ts#scatterPatches` | reuse; no builder/layout change |
| Generated map/collision identity | `generate_emberwatch_maps.ts`, committed map JSON | regenerate; byte-compare collision layer to baseline |
| Candidate evidence | C-548 catalog snapshot/Studio; C-550 entity-texture POM guard | reuse; capture only, no publish/apply |
| Ambient curves | C-545 `ambient_policy.ts` / environment UBO | read-only diagnosis; do not modify |

## Overview

C-552 is a terrain-material and evidence pass, not a map-layout redesign. It replaces geometric corner16 diagonals with deterministic dithered/noise-shaped boundaries, calms the shared outdoor stone material, adds a very sparse tuft layer to the existing restrained grass family, and gives interiors a dedicated existing floor GID without changing dimensions, object layers, or collision. The same fixed terrain GIDs feed all five regenerated maps. Sand receives only a base-palette correction if the dawn tint analysis proves the authored base is responsible.

## Design Reference

Follow C-549's single-material grass discipline and C-546/C-550's stable-GID, deterministic-painter pattern. Follow C-548/C-550 for same-camera production evidence and fail-closed entity-texture checks. Terrain matching remains the existing corner16 mechanism; this contract changes the pixels placed in the current 32×32 frames, not the resolver or builders.

## Scope Boundaries

- **In Scope:** deterministic corner16 edge-shape correction for all existing terrain sets; softer shared stone-floor material; sparse grass tuft painter/placement within existing GIDs; optional narrowly justified sand-base hue/value adjustment; pixel/metric/occupancy/collision-identity tests; regeneration of all five maps and existing hashes/audit/validation outputs; C-548 production evidence, montage and index; this contract.
- **Out of Scope:** map layout or path geometry; collision changes; buildings, props, bridges or UI; ambient/day-night curves; image-model generation; new terrain families; renumbering any GID; changing terrain block 48–127; guard thresholds/policies; deploy, publish, catalog apply, or `sync --apply`.
- **Under 100 files:** expected changed path count is small and bounded.

## Contract Size & Split Rule

One bounded terrain-material pass. Ambient engineering, map composition, architectural/prop work, and layout changes remain separate contracts.

## Acceptance Criteria

### AC-1: All 16 corner16 cases read as organic transitions

**Given** the existing fixed terrain GID block 48–127
**When** every corner16 frame is painted by the real atlas producer
**Then** each boundary is dithered/noise-shaped with a low-contrast fringe, matching edge-row/column signatures tile continuously across all 16 cases, and an actual 3×3 placed-cell composite at each crossing-landing window has no near-linear fringe run longer than 8 px and stays below the recorded short-period correlation bound. Existing GID-to-frame mappings remain byte-for-byte stable.

**Verification**: `tooling: bun moon run scripts:test` — focused C-552 pixel/mask tests against `packAtlas()` output; terrain GID table test; `tooling: bun run emberwatch:validate`; `tooling: bun moon run scripts:validate`.

### AC-2: Stone is irregular, low-contrast, and actor-subordinate on every map

**Given** the one shared `stone_floor` frame used by village, inn, merchant, old road, and shrine
**When** the atlas is regenerated
**Then** the outdoor material uses larger irregular stones/cobble with bounded mortar contrast; GID 34 supplies a restrained indoor flagstone frame; and the test enumerates every frame used on a stone/cobble cell across the five builders rather than checking a hand-picked GID list.

**Verification**: `tooling: bun moon run scripts:test` — C-552 stone pixel/metric tests and five-map frame-use assertions; visual evidence for every map.

### AC-3: Grass keeps broad restraint and gains only sparse irregular tufts

**Given** C-549's shared grass base, dark patch and variant material
**When** grass variants and map placement are regenerated
**Then** broad seeded value patches remain, every grass variant mean stays within ±4% of base, explicit small tufts occupy at most 3% of authored grass cells, and no tuft frame is selected on water, sand, path, bridge, stone, building pads, banks, or other non-grass cells.

**Verification**: `tooling: bun moon run scripts:test` — C-549 metrics retained plus C-552 tuft occupancy/component/exclusion assertions on all five maps.

### AC-4: Dawn sand diagnosis is explicit and ambient remains unchanged

**Given** the authored sand palette and C-545 ambient multiplier at dawn
**When** source colours and the same candidate are inspected at noon and dawn
**Then** the report states whether the mauve cast originates in the warm low-saturation sand base or solely in the ambient multiplier. If the base is causal, only the sand palette is adjusted slightly; C-545 ambient code/curves and actor/prop parity remain byte-identical.

**Verification**: focused C-552 palette/ambient diagnostic test and same-camera noon/dawn evidence; `git diff` proves no ambient-policy/environment-curve edit.

### AC-5: Painter-only regeneration preserves all collision and object identity

**Given** the five `origin/main` C-550 maps
**When** the existing map generator runs after painter changes
**Then** each regenerated map's collision layer is byte-identical to its baseline counterpart; extents, object layers, locked IDs, and authored map geometry are unchanged. Interior floor GID substitutions are limited to the shop floor and inn threshold and do not alter collision. Repeating generation is byte-deterministic. Generated files are changed only through their producers.

**Verification**: C-552 regression test compares parsed collision-layer bytes/JSON for all five maps against pinned baseline fixtures or `origin/main` content; two generator runs produce no diff; `tooling: bun run emberwatch:validate`; `tooling: bun run emberwatch:locked-ids`; `tooling: bun run emberwatch:audit`.

### AC-6: Reproducible same-camera evidence passes C-548 guards

**Given** the read-only production catalog snapshot and before/after candidate planes
**When** captures run at 1920×1080 DPR1, default world zoom, overlays off
**Then** before/after pairs cover village crossing, village square, old-road crossing, and one named view for each remaining map, with additional square dawn/night pairs and 1280×720 landing/merchant/inn close-ups. WebGL is asserted; visible entity textures are real and fingerprint-covered; requested camera cells match actual cells. `magick montage` produces `/tmp/opencode/c552-evidence-r2/sheet.png`; individual PNGs and `index.md` record identity, camera, game hour, hashes and observations.

**Verification**: C-548/C-550 capture lane and guard outputs; evidence index/manifest and contact-sheet existence; no Canvas2D or placeholder-entity capture is accepted.

## Implementation Sequence

1. Add failing C-552 pixel, metric, occupancy, all-map and collision-identity tests against the current painters/maps.
2. Repaint corner16 edges, stone, sparse grass tufts and—only if diagnosed—sand without changing GIDs or builders.
3. Run focused Moon tests, then regenerate atlas/maps/hashes/audit/validation through the canonical pipeline.
4. Run scripts and frontend-engine tests/typecheck/lint, Emberwatch validation/audit, guards, full affected Moon CI, and final `moon ci`.
5. Build before/after candidate planes from the read-only snapshot; capture same-camera evidence, montage, and index.
6. Commit painters/tests, regenerated outputs, and contract/report separately; create the requested PR.

## Edge Cases & Gotchas

- **Corner16 topology:** the binary mask still defines topology. Only boundary distance/noise is repainted; changing mask resolution or precedence would alter semantics and is out of scope.
- **Seam continuity:** edge values must share deterministic world/tile-local phase; independently randomizing every edge creates discontinuity.
- **Alpha/opacity:** terrain remains opaque. Dithering uses material pixels/tones, not transparency holes.
- **Grass exclusion:** placement must use semantic ownership, not a post-hoc visual guess. Paths/banks and explicit contributions cannot be repainted.
- **C-550 atlas capacity:** repaint existing frames in place. Terrain GIDs 48–127 and all append-only bridge/house GIDs stay stable.
- **Collision proof:** compare the actual serialized collision layer, not only builder arrays or walkability percentages.
- **Evidence plane:** snapshot/pull is read-only. Never run catalog `sync --apply`, release sealing, deployment or production promotion.
- **Visual acceptance:** technical WebGL capture and metrics do not claim human acceptance.

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
|---|---|---|---|
| 1.0.0 | 2026-09-24 | Initial contract from accepted P2 terrain findings and direct user request | user (direct prompt) |
| 1.1.0 | 2026-09-24 | R2 remediation: water-hue exclusion, interior/outdoor floor split, placed-cell transition evidence, and recaptured evidence set | user (direct prompt) |

## Promotion Lifecycle

> Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)


---

## Execution Report

### Summary

Completed the C-552 R2 remediation without changing map dimensions, object
identity, collision geometry, buildings, props, UI, ambient curves, or the
reserved terrain GID block. Water corner frames now have a blue wet-bank
under-material and a full-mask endpoint invariant; the runtime only selects
sparse grass variants for authored grass cells; GID 34 is a restrained indoor
flagstone while GID 47 is a calm outdoor cobble variant; and the placed-cell
landing regression measures the real mask sequence rather than isolated frames.
All five maps regenerate deterministically with byte-identical collision layers.

### AC Status

| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | All five corner families retain GID pinning, opacity, endpoint-pure mask 15, seam classification, and bounded short-period profiles. Actual 3×3 landing composites at origins `(36,9)`, `(37,9)`, `(38,9)` have max near-linear fringe run `8`; max lag correlations are `0.967`, `0.693`, and `0.633`. |
| AC-2 | ✅ | Used floor frames are enumerated from all five builders: `stone_floor` p95 local contrast `12.068`, `flagstone` `15.213`, `path_tough` `15.213`, and indoor `stone_floor_variant` `9.842`; shop/inn use GID 34 and no outdoor GID 6/47. |
| AC-3 | ✅ | Authored-grass tuft occupancy is village `1.593%`, old road `1.788%`, shrine `2.599%`; interiors report `0`; water/sand/path/bridge/stone contamination is `0`. |
| AC-4 | ✅ | Dawn ambient remains `[0.45, 0.25, 0.15]`; sand mean is `[217.819, 197.961, 131.641]` with R−G `19.858` and G−B `66.320`. No ambient curve changed. |
| AC-5 | ✅ | All five serialized collision-layer SHA-256 digests and data arrays match C-550; two generator runs produce identical map hashes. |
| AC-6 | ✅ | Eleven same-camera pairs per plane: eight 1920×1080 DPR1 views plus three 1280×720 close-ups; WebGL/entity guards pass; evidence is under `/tmp/opencode/c552-evidence-r2/`. |

### R2 root-cause report

| Finding | Root cause and responsible code | R2 correction / proof |
|---|---|---|
| Water cells showed green flecks | The C-552 water corner painter used `paintGrass` as its under-material in `generate_emberwatch_atlas.ts:587-591`. The organic compositor also allowed a few low-coverage pixels in a fully-owned frame; `paintCornerFrame()` wrote those pixels opaque, so the alpha test missed them. This was not tuft decal placement: village stream cells are authored as `G.WATER` by `emberwatch_map_village.ts:182-214`, and bridge GIDs are separate. | `paintWaterUnderlay()` in `generate_emberwatch_terrain_frames.ts:299-309` removes grass from the water underlayer; `cornerCoverage()` now makes mask 15 endpoint-pure at `generate_emberwatch_terrain_frames.ts:447-456`. `autotile.ts:440-448` restricts sparse variants to authored `grass` IDs. All 16 packed water frames report `0` grass-hue pixels; map-level non-grass tuft contamination is `0`. |
| Light square patches remained on cobble | The legacy `paintFlagstone()` painted four hard 12/13 px rectangles over the new stone base. GID 47 was scattered by the shop/village/shrine builders, and GID 34 shared the same painter. The old test measured only `stone_floor.png`, so it could not see the high-contrast frame. | GID 34 now routes to `paintInteriorFlagstone()` and GID 47 to `paintCobbleLight()` in `generate_emberwatch_atlas.ts:656-662`; the shop and inn threshold use GID 34 in `emberwatch_map_retained.ts:69-79,177-207`. The used-frame test enumerates all floor GIDs from the five builders; observed p95 local contrast is `9.842` (GID 34), `12.068` (GID 6), `15.213` (GID 47), and `15.213` (GID 5). |
| Crossing landing had a sawtooth | `paintNoticeBoardApproach()` writes the south landing after the stream in `emberwatch_map_village.ts:421-427`; the final placed mask sequence is `14,15,13,12,12`. The old isolated diagonal-run test saw at most four pixels and ignored the repeated tile-local contour. | `generate_emberwatch_terrain_frames.ts:371-444` gives adjacent and three-corner masks signed, low-frequency fields, and `:592-605` uses a low-contrast dirt fringe. The regression composites the full resolved map before cropping 3×3 actual cells at the three landing origins; max near-linear run is `8`, and baseline C-550 measured `15` with max lag correlation `0.979–0.981`. |
| Interiors read as outdoor cobble | Both the merchant floor and inn threshold used shared outdoor GID 6; GID 47 supplied the bright square wear. GID 6 remains the outdoor cobble frame, while GID 34 is now the dedicated indoor flagstone frame; the inn common room remains wood GID 7/35. | Builder assertions verify no GID 6 or GID 47 on the shop/inn interior surfaces, GID 34 on both thresholds, and wood in the inn common room. |
| Hard dirt↔grass rectangles in the ward square | This remains report-only. `SQUARE_SPANS` at `emberwatch_map_village.ts:453-464` is painted before later primary paths, pads, ward-ring calls, building shells, and flagstone scatter (`:370-373`, `:405-411`, `:470-487`, `:584-589`, `:616-617`). `buildMapJson()` maps path/stone/sand/bridge frames to an empty terrain ID (`generate_emberwatch_maps.ts:194-233`), while `cornerMaskForCell()` gives a dirt island against base grass a full `15` mask (`autotile.ts:252-287`). Those cells therefore have no corner16 edge to soften. | No R2 map rewrite was made. Minimal follow-up: add explicit semantic terrain overrides for the baked visual cells (or a dedicated transition terrain) and then organic-author the square boundary; keep this separate from the painter pass. |

### R2 metrics and evidence

- Metrics: `/tmp/opencode/c552-evidence-r2/metrics.json`.
- Baseline comparison: `/tmp/opencode/c552-evidence-r2/baseline-metrics.json` (water grass-hue pixels `4352`, floor-frame contrasts up to `29.644`, landing near-linear run `15`).
- Collision proof: `/tmp/opencode/c552-evidence-r2/collision-proof.json`; all five current digests equal C-550 and two generator runs are deterministic.
- Baseline/current manifests: `/tmp/opencode/c552-evidence-r2/baseline/capture_manifest.json` and `/tmp/opencode/c552-evidence-r2/current/capture_manifest.json`.
- Contact sheet: `/tmp/opencode/c552-evidence-r2/sheet.png`; index: `/tmp/opencode/c552-evidence-r2/index.md`.### Files Created

| File | Purpose |
|---|---|
| `scripts/src/lib/ops/generate_emberwatch_corner_painters.ts` | Isolated corner16 material routing keeps the atlas packer within its source-size budget. |
| `scripts/src/lib/ops/generate_emberwatch_terrain_frames.ts` | Extracted terrain materials, irregular stone/cobble, warmer sand, and organic corner compositor. |
| `scripts/src/lib/ops/emberwatch_terrain_pass.test.ts` | Real packed-atlas metrics, all-mask/seam/GID checks, five-map grass exclusion/occupancy, sand, and collision identity. |
| `docs/contracts/C-552-emberwatch-terrain-pass.md` | Contract and execution report. |

### Files Modified

| File | Change |
|---|---|
| `scripts/src/lib/ops/generate_emberwatch_atlas.ts` | Delegates terrain materials/compositor to the extracted module; fixed terrain block and packer unchanged. |
| `scripts/src/lib/ops/generate_emberwatch_atlas.test.ts` | Updated painter dispatch/pixel expectations for extracted materials. |
| `scripts/src/lib/ops/generate_emberwatch_grass_frames.ts` | Fixed material phase and irregular low-contrast tuft details. |
| `packages/frontend/engine/src/assets/autotile.ts` | Sparse variants are eligible only for authored base-terrain IDs, preventing tuft frames under baked water-adjacent/non-terrain cells while preserving base fallback resolution. |
| `packages/frontend/engine/src/assets/autotile.test.ts` | Variant distribution, determinism, base dominance, and non-grass coverage regression tests. |
| `scripts/src/lib/ops/emberwatch_map_retained.ts` | Shop and inn thresholds use the dedicated GID 34 indoor flagstone; collision arrays remain unchanged. |
| `scripts/src/lib/ops/guard_source_file_size_baseline.json` | Sanctioned reduction after extracting corner painter routing from the atlas packer. |
| `docs/reference/emberwatch-visual-report.json` | Regenerated derived report; notice-board placement now matches the C-549 authored map. |

### Generated outputs and evidence

- `bun run emberwatch:studio --no-client --no-serve` completed the canonical
  portrait/audio/atlas/prop/map/scan/seed pipeline; the terrain atlas is
  `544×340`, 159 frames, and the derived seed has 81 rows.
- Regenerated map JSON changes are limited to interior floor GIDs in `inn.json`
  and `merchant_shop.json`; the terrain block, atlas frame rectangles, and
  collision layers remain pinned.
- Evidence index: `/tmp/opencode/c552-evidence-r2/index.md`.
- Contact sheet: `/tmp/opencode/c552-evidence-r2/sheet.png`.
- Collision proof: `/tmp/opencode/c552-evidence-r2/collision-proof.json`.
- Metrics: `/tmp/opencode/c552-evidence-r2/metrics.json` and baseline comparison
  `/tmp/opencode/c552-evidence-r2/baseline-metrics.json`.
- Baseline/current capture manifests:
  `/tmp/opencode/c552-evidence-r2/baseline/capture_manifest.json` and
  `/tmp/opencode/c552-evidence-r2/current/capture_manifest.json`.

### Validation

- `bun moon ci --base=origin/main` — PASS (54 completed, 2 skipped, 15 cached).
- `bun moon run :validate` — PASS (174 tasks, 121 cached).
- `bun moon run scripts:test -- --timeout=30000` — 2,169 pass, 0 fail.
- `bun moon run frontend-engine:test` — 1,840 pass, 1 todo, 0 fail.
- Focused C-552 terrain suite — 25 pass; atlas packer regression — 9 pass.
- `bun run scripts/src/lib/ops/run_guards.ts` — 10/10 structural guards pass.
- `emberwatch:validate`, `emberwatch:audit`, `emberwatch:locked-ids`,
  `emberwatch:visual-report`, and `emberwatch:visual-audit` — pass.
- Canonical Studio regeneration — pass; two map-generation runs are byte-identical.

### Commits

- `0b8f40d` — `fix(emberwatch): close C-552 terrain review gaps`
- `b8c19cc` — `chore(emberwatch): regenerate C-552 interior floors`
- `docs(emberwatch): record C-552 R2 evidence` (this commit)

Pull request: https://github.com/BearlySleeping/aikami/pull/395
