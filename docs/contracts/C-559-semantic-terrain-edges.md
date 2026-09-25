---
id: C-559
title: "Semantic terrain edges"
source: "direct"
status: in_progress
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: "https://github.com/BearlySleeping/aikami/pull/403"
created_at: "2026-09-24T20:50:00Z"
---

# C-559 — Semantic terrain edges

## Goal

Close the C-552 report-only gap where baked outdoor path, stone, and sand cells had no semantic terrain identity. Resolve those authored material boundaries through corner16 terrain while preserving origin/main water, bridge visuals, interior output, collision, locked identities, and save-clamp behavior.

C-559 was unused at implementation start: no `docs/contracts/C-559-*` file existed.

## Metadata

| Field | Value |
|---|---|
| **Status** | in_progress |
| **Promotion** | — |
| **Docs Impact** | internal — terrain authoring and evidence. |
| **Production Surface** | production `/game`; Emberwatch content generation. |

## Scope and constraints

- Canonical terrain derivation remains in `scripts/src/lib/ops/generate_emberwatch_maps.ts`; map JSON is generated, not hand-edited.
- Existing terrain GIDs 48–127 and all existing object/spawn/transition IDs remain unchanged.
- C-559 adds only append-only path frames at manifest GIDs 177–192. Atlas capacity grows from 11 to 12 rows. Existing GIDs do not move.
- `inn` and `merchant_shop` remain exactly origin/main except unavoidable atlas `imageheight` and `tilecount` metadata. Semantic terrain plus ground/decor/overhead/collision output is pinned by regression fingerprints derived from origin/main.
- `bridge` and `bridge_*` receive no C-559 semantic mapping and retain origin/main ground/decor ownership.
- `paintWater`, water corner16 expectations, and corner16 water output remain origin/main. C-559 adds no water metric.
- The crossing approach uses existing `dirt` terrain and authored asymmetric cells. No dedicated landing terrain family, GIDs, frames, painter, or overrides remain.
- Collision layers are not authored by this contract and remain byte-identical to origin/main.
- No catalog sync/apply, publish, upload, deploy, or promotion is authorized.
- Technical tests and same-camera captures are evidence, not human aesthetic acceptance.

## Review amendment

### Rejected prior pass

The earlier execution report marked this contract `implemented` and each acceptance criterion `Pass`. Human review rejected that pass. That status and its acceptance claims are superseded by this `in_progress` amendment.

Review identified three failures:

1. **Water was changed without contract scope.** `paintWater` and bright-pixel expectations altered origin/main water/corner16 behavior. Water is now excluded and restored.
2. **Interior and bridge output drifted.** The prior pass inferred interiors through a broad grass check and moved bridge visuals from ground to decor while adding semantic identity. Interiors are now explicitly classified and fingerprinted against origin/main; bridge cells remain on origin/main ground/decor behavior.
3. **The crossing approach was not visually acceptable.** The prior 5×2 slab and tapered/stepped landing overrides read as constructed steps rather than an organic bridge-aligned contour. The dedicated landing family is removed; authored dirt cells now form an asymmetric contour under the bridge and into the existing path.

### Narrower implementation boundary

- Add semantic `path` ownership for `path_tough` and `path_tough_variant`.
- Add semantic `earth` ownership for outdoor `stone_floor`, `stone_floor_variant`, and `flagstone`.
- Add semantic `gravel` ownership for outdoor `sand`.
- Do not map or split bridge visuals.
- Do not alter interiors, water, collision, object identities, or save behavior.
- Use rendered metrics only as supporting regression evidence. Footprint geometry and same-camera appearance—not a threshold—drive the crossing decision.

## Acceptance criteria

### AC-1 — Semantic corner16 ownership for baked outdoor materials

- Outdoor `path_tough*` resolves to `path`.
- Outdoor `stone_floor*` and `flagstone` resolve to `earth`.
- Outdoor `sand` resolves to `gravel`.
- `bridge` and `bridge_*` retain origin/main ground/decor output and no C-559 terrain identity.
- Water remains origin/main and outside C-559 metrics.

### AC-2 — Interior exactness

- `inn` and `merchant_shop` have no semantic terrain channel.
- Their semantic-terrain-plus-ground/decor/overhead/collision fingerprints match origin/main.
- Only atlas `imageheight` and `tilecount` may differ in committed interior map JSON.

### AC-3 — Organic crossing approach

- Uses existing dirt terrain; no `landing` terrain family, GIDs, frames, painter, or overrides remain.
- Dirt footprint meets bridge columns 36–38, joins the existing cols 39–40 path, is asymmetric, and is not the rejected 5×2 slab.
- Same-camera evidence is captured for human review. No human acceptance is claimed.

### AC-4 — Collision and identity preservation

- Collision-layer data and serialized layer output remain byte-identical to origin/main for all five maps.
- Locked object/spawn/transition identities remain unchanged.

### AC-5 — Generated content and validation

- Canonical seven-step content generation is rerun from existing tooling.
- Focused scripts tests/typecheck, content validation, and locked-ID validation pass.
- No publish, deploy, guard-policy change, or collision alteration occurs.

## Implementation

### Semantic mapping and layer ownership

- `scripts/src/lib/ops/generate_emberwatch_maps.ts` uses explicit canonical interior IDs and adds C-559 mappings only to outdoor maps.
- The generator otherwise retains origin/main layer resolution, including the baked ground array and bridge ground/decor behavior.
- `scripts/src/lib/ops/emberwatch_terrain_pass.test.ts` asserts interior origin/main fingerprints and bridge ownership.

### Crossing geometry

- `scripts/src/lib/ops/emberwatch_map_village.ts` authors the crossing approach with irregular dirt cells under the bridge and a small kink into the path.
- The dedicated `landing` terrain declaration, GIDs 193–208, painter, terrain override list, and supporting tests are removed.
- Collision code is unchanged; existing collision pins remain the enforcement layer.

### Atlas capacity

- `content/packs/emberwatch/manifest.json` declares only the appended `path` family at GIDs 177–192.
- `scripts/src/lib/ops/generate_emberwatch_tables.ts`, atlas tests, engine content audit, and shared atlas capacity use 12 rows / 192 cells.

### Evidence

- `apps/e2e/scripts/capture_c559_semantic_terrain.ts` retains the reproducible same-camera WebGL capture lane.
- Current evidence must be regenerated for this amendment. Earlier water/landing claims and metric values from the rejected pass are not acceptance evidence.
- Technical evidence does not constitute human acceptance.

## Verification

| Check | Result |
|---|---|
| `bun scripts/src/lib/ops/emberwatch_studio.ts --no-client --no-serve` | pass — ran the canonical seven steps: portraits, audio, terrain atlas, prop atlas, maps, asset scan/hashes, asset seed; semantic validation reported 0 warnings / 0 blockers |
| `env -u CI bun moon run scripts:test -- src/lib/ops/emberwatch_terrain_pass.test.ts src/lib/ops/generate_emberwatch_atlas.test.ts src/lib/ops/emberwatch_map_compile.test.ts src/lib/ops/emberwatch_village_crossing.test.ts --timeout 30000` | pass — 58 tests, 0 failures, 14,262 assertions |
| `env -u CI bun moon run scripts:typecheck` | pass |
| `env -u CI bun moon run frontend-engine:test -- src/__tests__/emberwatch_content_audit.test.ts` | pass — 48 tests, 0 failures, 59,001 assertions |
| `bun run validate:content` | pass — all NPC appearances valid and in runtime parity |
| `bun run emberwatch:validate` | pass — five maps, 0 warnings, 0 blockers |
| `bun run emberwatch:locked-ids` | pass — locked identities unchanged |
| Moon validation | pass — `scripts:validate`, `e2e:validate`, `constants:validate`, `frontend-engine:validate` |
| same-camera capture | pass technically — six before/after pairs under `.evidence/C-559/`; every PNG is WebGL/entity-texture guarded, dimensions match the requested viewport, all 19 checksums verify, and manifests pin app/content/atlas hashes plus the dirty diff; not human acceptance |

Additional origin/main comparisons:

- `inn` and `merchant_shop` are byte/structure-equivalent to origin/main after zeroing only tileset `imageheight` and `tilecount` for comparison.
- All five collision layers are byte-identical to origin/main. SHA-256 values remain: village `09d2397f…09ffc`, inn `e0334e3d…7260d`, merchant `11d9b9b1…1a6`, old road `83bb92ec…b97db9`, ruined shrine `16b8b021…5a7f`.
- `git diff origin/main -- scripts/src/lib/ops/generate_emberwatch_terrain_frames.ts` contains only the added path seed; `paintWater` has no source diff from origin/main.

## Files

### Created

- `docs/contracts/C-559-semantic-terrain-edges.md`
- `apps/e2e/scripts/capture_c559_semantic_terrain.ts`

### Modified

- `apps/e2e/src/pom/emberwatch_house_page.ts`
- `packages/frontend/engine/src/__tests__/emberwatch_content_audit.test.ts`
- `content/packs/asset_hashes.json`
- `content/packs/emberwatch/manifest.json`
- `content/packs/emberwatch/maps/inn.json`
- `content/packs/emberwatch/maps/merchant_shop.json`
- `content/packs/emberwatch/maps/old_road.json`
- `content/packs/emberwatch/maps/ruined_shrine.json`
- `content/packs/emberwatch/maps/village.json`
- `packages/shared/constants/src/lib/media_preparation.ts`
- `scripts/src/lib/ops/emberwatch_map_village.ts`
- `scripts/src/lib/ops/emberwatch_map_compile.test.ts`
- `scripts/src/lib/ops/emberwatch_terrain_pass.test.ts`
- `scripts/src/lib/ops/emberwatch_village_crossing.test.ts`
- `scripts/src/lib/ops/generate_emberwatch_atlas.test.ts`
- `scripts/src/lib/ops/generate_emberwatch_corner_painters.ts`
- `scripts/src/lib/ops/generate_emberwatch_maps.ts`
- `scripts/src/lib/ops/generate_emberwatch_tables.ts`
- `scripts/src/lib/ops/generate_emberwatch_terrain_frames.ts`
- `scripts/src/lib/ops/guard_cognitive_complexity_baseline.json` (sanctioned reduction-only contraction; no ceiling or waiver raised)

## Open risks / human review

- Human review must decide whether the amended crossing contour is visibly better in the same-camera capture. This report does not claim acceptance.
- The path family intentionally shares the calm cobble material; a later contract may introduce a distinct path material without changing this pass.
- Local evidence generation and validation do not publish a release.

## Execution Report

### Summary

The rejected first pass was reduced to its actual scope: outdoor path, stone, and sand semantic transitions. Water and bridge rendering are restored to origin/main, interiors are fingerprinted against origin/main, and the dedicated landing terrain family was removed. The crossing now uses a narrow asymmetric dirt contour that begins under the three bridge columns and shifts into the existing path. Same-camera evidence is complete and machine-verifiable; human visual acceptance remains open.

### AC Status

| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | Outdoor path/stone/sand semantics added; water and bridge remain outside C-559 and match main behavior. |
| AC-2 | ✅ | Inn and merchant semantic/layer fingerprints match main; only atlas dimensions differ. |
| AC-3 | ⚠️ | Existing dirt contour and guarded same-camera evidence are ready; human acceptance pending. |
| AC-4 | ✅ | All five collision layers and locked identities remain unchanged. |
| AC-5 | ✅ | Canonical seven-step generation, focused tests/typechecks, content validation, and locked-ID validation pass. |

### Files Created

| File | Purpose |
|---|---|
| `docs/contracts/C-559-semantic-terrain-edges.md` | Contract, rejected-pass amendment, and execution evidence. |
| `apps/e2e/scripts/capture_c559_semantic_terrain.ts` | Repeatable WebGL/entity-guarded before/after capture lane. |

### Files Modified

| File | Change |
|---|---|
| `scripts/src/lib/ops/generate_emberwatch_maps.ts` | Applies C-559 semantic mappings only to canonical outdoor maps. |
| `scripts/src/lib/ops/emberwatch_map_village.ts` | Authors the narrow asymmetric bridge-to-path dirt contour. |
| `scripts/src/lib/ops/generate_emberwatch_{tables,corner_painters,terrain_frames}.ts` | Appends the path family and keeps water/bridge output unchanged. |
| `content/packs/emberwatch/{manifest.json,maps/*.json}` | Regenerated canonical path-aware outdoor maps. |
| `scripts/src/lib/ops/*test.ts` | Pins interior exactness, bridge ownership, crossing geometry, and generated output. |
| `apps/e2e/src/pom/emberwatch_house_page.ts` | Supports all five production-route evidence maps. |
| `.gitignore` | Keeps the local `.evidence/<contract>/` lane untracked. |

### Deviations from Spec

- The first pass's `implemented` status and visual claims were rejected and superseded. Water tuning, bridge semantic ownership, and the dedicated landing family are removed rather than iterated.
- VLM output is supporting diagnosis only. Conflicting crossing scores are not treated as acceptance; the side-by-side capture is the human review artifact.

### Test Results

- Focused scripts: 58 passed, 0 failed, 14,265 assertions.
- Frontend engine content audit: 48 passed, 0 failed, 59,001 assertions.
- Typecheck: scripts, e2e, constants, and frontend-engine passed.
- Content: canonical seven-step generation passed; five-map validation passed with 0 warnings and 0 blockers; locked identities unchanged.
- Full gate: `bun moon ci --base=origin/main` — 81 completed, 2 skipped, 0 failed.
- Visual: 6 same-camera before/after pairs; WebGL and visible-entity guards passed; 19/19 evidence checksums valid; candidate manifest SHA-256 is recorded in the after manifest. Merchant and inn preserve interior materials; crossing remains explicitly pending human review.
