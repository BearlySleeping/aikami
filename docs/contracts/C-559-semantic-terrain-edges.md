---
id: C-559
title: "Semantic terrain edges"
source: "direct"
status: implemented
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-09-24T20:50:00Z"
---

# C-559 — Semantic terrain edges

## Goal

Close the C-552 report-only gap where baked path, stone, sand, and bridge cells had no semantic terrain identity. Every such material boundary now resolves through a corner16 transition family, while the ward square and crossing landing receive authored organic edge geometry. Collision, locked identities, and save-clamp behavior remain unchanged.

C-559 was unused at implementation start: no `docs/contracts/C-559-*` file existed.

## Scope and constraints

- Canonical terrain derivation remains in `scripts/src/lib/ops/generate_emberwatch_maps.ts`; no map JSON was hand-edited.
- Existing terrain GIDs 48–127 and all existing object/spawn/transition IDs remain unchanged.
- C-559 adds append-only path GIDs 177–192 and landing GIDs 193–208; atlas capacity grows from 11 to 13 rows. Existing GIDs do not move.
- Collision layers are not authored by this contract and are proven byte-identical to `origin/main`.
- No catalog sync/apply, publish, upload, deploy, or promotion was performed. The evidence plane used the authorized read-only snapshot plus a local origin serving local candidate files.
- Technical WebGL/entity evidence is not a human visual acceptance decision.

## Acceptance criteria

### AC-1 — Semantic corner16 ownership for baked materials

**Pass.** `path_tough` and its variant map to the new `path` corner16 terrain; outdoor `stone_floor`/`flagstone` map to `earth`; `sand` maps to `gravel`; bridge and bridge-assembly frames retain their detailed decor visual while receiving `earth` terrain semantics. Interior maps intentionally omit the semantic terrain channel because they have no grass base, preserving the C-552 indoor/outdoor floor split.

### AC-2 — Organic ward and landing boundaries

**Pass.** The ward square spans and spurs are asymmetric. The crossing landing uses a dedicated dirt-material corner16 family with a tapered, stepped lower approach; the regression metric rejects rendered axis-aligned runs over 32 px.

### AC-3 — Collision identity

**Pass.** Serialized collision-layer JSON and data arrays are byte-identical to `origin/main` for all five maps. Proof is recorded in `/tmp/opencode/c559-evidence/collision-proof.json` and summarized below.

### AC-4 — Perceptual placed-composite regression

**Pass.** The C-552 3×3 placed-cell method now reads the production semantic channel and measures exact axis-aligned boundary runs on the rendered composite. The regression test requires landing/ward composites to remain within `≤32 px` straight runs, `≤8` near-linear run, and `≤0.99` lag correlation. Results are recorded in `/tmp/opencode/c559-evidence/metric-placed-composites.json` and `/tmp/opencode/c559-evidence/metric-after.json`.

### AC-5 — Locked identity and Emberwatch validation

**Pass.** `emberwatch:locked-ids` reports locked identities unchanged. `emberwatch:validate` reports five maps, zero warnings, and zero blockers.

### AC-6 — WebGL evidence

**Pass.** Six same-camera before/after pairs cover ward square, crossing landing, inn, merchant, old road, and ruined shrine. Every capture is WebGL and passes `visible-entity-textures-v2`. Evidence is under `/tmp/opencode/c559-evidence/`, including `index.md`, `sheet.png`, before/after PNGs, manifests, collision proof, and metrics.

## Implementation

### Interior and water regressions fixed

- `scripts/src/lib/ops/generate_emberwatch_maps.ts:266-276` now applies outdoor semantic mappings only when the builder actually has a grass base. `inn` and `merchant_shop` therefore emit no terrain channel and retain their baked C-552 indoor floor/wall materials; no grass can leak around walls or thresholds.
- `scripts/src/lib/ops/generate_emberwatch_terrain_frames.ts:275-288` removes isolated random bright pixels from water. The water frame now uses a continuous base plus low-contrast ripple marks; `scripts/src/lib/ops/emberwatch_terrain_pass.test.ts:640-650` rejects bright polka-dot pixels.
- `scripts/src/lib/ops/emberwatch_map_village.ts:356-366,610-635` authors a tapered landing silhouette and assigns its edge/interior cells to the dedicated `landing` family. `scripts/src/lib/ops/generate_emberwatch_corner_painters.ts:59-67` and `generate_emberwatch_terrain_frames.ts:44-51` use a seam-safe dirt material.

### Semantic channel and layer ownership

- `scripts/src/lib/ops/generate_emberwatch_maps.ts:38-59` defines semantic mappings and bridge visual retention.
- `scripts/src/lib/ops/generate_emberwatch_maps.ts:205-234` resolves ground/decor/overhead ownership without changing collision or object layers. Detailed bridge frames remain visible in decor while their semantic terrain supplies the boundary mask.
- `content/packs/emberwatch/manifest.json:71-77,935-1250` declares `path` and `landing` plus append-only frames GIDs 177–208.
- `scripts/src/lib/ops/generate_emberwatch_tables.ts:28-59,349-395` grows atlas capacity and verifies pinned append-only frame cells. `scripts/src/lib/ops/generate_emberwatch_corner_painters.ts:59-67` routes both families to seam-safe materials.

### Organic authored geometry

- `scripts/src/lib/ops/emberwatch_map_village.ts:356-366` keeps the three-cell landing contract and authors a tapered lower silhouette.
- `scripts/src/lib/ops/emberwatch_map_village.ts:418-446` uses asymmetric square spans and small edge spurs.
- `scripts/src/lib/ops/generate_emberwatch_terrain_frames.ts:44-51,331-337` adds seam-safe landing material and path/landing phase seeds.

### Regression and evidence tooling

- `scripts/src/lib/ops/emberwatch_terrain_pass.test.ts:300-338,660-750` adds rendered axis-aligned boundary measurement, water polka-dot rejection, interior-channel assertions, and ward/landing placed-composite assertions.
- `apps/e2e/scripts/capture_c559_semantic_terrain.ts:1-280` provides the reproducible WebGL capture lane, candidate-root pinning, visible-entity guard, pair `+append` images, per-pair index summaries, and `magick montage -label '%t'` sheet.
- `apps/e2e/src/pom/emberwatch_house_page.ts:15-21` extends the existing Emberwatch POM map ID type to the two additional map IDs used by the evidence lane.
- `packages/shared/constants/src/lib/media_preparation.ts:217-222` keeps the shared atlas capacity in sync with the generated 13-row atlas.
- `content/packs/asset_hashes.json` is regenerated by `scan_assets.ts`; map JSON is regenerated by `generate_emberwatch_maps.ts`.

## Collision proof

`collision-proof.json` compares the serialized `collision` layer from each `origin/main` map with the regenerated map. Results:

| Map | Collision-layer SHA-256 | Data bytes | Data identical | Layer JSON identical |
|---|---|---:|---|---|
| `village` | `09d2397f021163a6e6dac712d9d732489452848865ae0c18ca90cddfde209ffc` | 6145 | yes | yes |
| `inn` | `e0334e3d214c755173a637245b00ee037e186b559c8726029af7b86b4817260d` | 1121 | yes | yes |
| `merchant_shop` | `11d9b9b16de7ac3cd6cf83edd16258131e75efc94b96dcef69ac8218337c91a6` | 865 | yes | yes |
| `old_road` | `83bb92ecf8def467fc1271b61f7f7f3d4a15bc2620ae2f972b20065399b97db9` | 5185 | yes | yes |
| `ruined_shrine` | `16b8b021c07f0c91abe7dc2dd4bd95d499d88aa343d74d9c3ab686a2fffc5a7f` | 2881 | yes | yes |

All five `dataIdentical` and `collisionLayerIdentical` values are `true`. No collision builder or collision array was changed.

## Perceptual metric

The rendered-composite metric records exact axis-aligned runs. At the primary landing window `36,9`, the run drops from `96 px` before to `32 px` after; the neighboring landing windows drop from `64 px` to `0/32 px`. The two ward windows rise from `4 px` to `11 px`, remaining below the fixed `32 px` regression bound. The global outdoor targeted sweep is `1045/1045` transitioned cells (`100%`); interiors are explicitly exempt because they intentionally retain baked indoor materials.

| Composite | Axis-aligned run before → after | Near-linear run before → after | Lag correlation before → after |
|---|---:|---:|---:|
| crossing `36,9` | `96 → 32` | `14 → 0` | `0.839 → 0` |
| crossing `37,9` | `64 → 0` | `14 → 0` | `0.328 → 0` |
| crossing `38,9` | `64 → 32` | `14 → 1` | `0.414 → 0` |
| ward `27,22` | `4 → 11` | `1 → 3` | `0.286 → 0.293` |
| ward `37,22` | `4 → 11` | `2 → 3` | `0.499 → 0.310` |

The test locks `≤32 px` axis-aligned runs, `≤8` near-linear run, and `≤0.99` correlation. Full records are in `/tmp/opencode/c559-evidence/metric-placed-composites.json`.

## Locked IDs and validation output

```text
$ bun run emberwatch:locked-ids
✅ emberwatch locked identities unchanged

$ bun run emberwatch:validate
Emberwatch map validation — 5 maps
...
✅ map validation passed — 0 warning(s), 0 blocker(s)
```

## Evidence

- Index and capture metadata: `/tmp/opencode/c559-evidence/index.md`
- Labeled contact sheet: `/tmp/opencode/c559-evidence/sheet.png`
- Full-size before/after pair images: `/tmp/opencode/c559-evidence/pair-ward-square.png`, `pair-crossing-landing.png`, `pair-inn-floor.png`, `pair-merchant-floor.png`, `pair-old-road.png`, `pair-ruined-shrine.png`
- Per-pair change list: `index.md` under “Pair review”
- Before lane: `/tmp/opencode/c559-evidence/before/`
- After lane: `/tmp/opencode/c559-evidence/after/`
- Capture manifests: `/tmp/opencode/c559-evidence/before/capture_manifest.json` and `/tmp/opencode/c559-evidence/after/capture_manifest.json`
- Collision proof: `/tmp/opencode/c559-evidence/collision-proof.json`
- Global metrics: `/tmp/opencode/c559-evidence/metric-baseline.json` and `/tmp/opencode/c559-evidence/metric-after.json`
- Named placed-composite metrics: `/tmp/opencode/c559-evidence/metric-placed-composites.json`

The before lane used `/tmp/opencode/c552-baseline` and the authorized read-only catalog snapshot. The after lane used this worktree and a local candidate origin at a separate port. All pairs report the same player cell, camera cell, world camera coordinates, viewport, and noon hour. The final sheet and each full-size pair image were inspected side-by-side: interiors preserve baked indoor materials without grass/outdoor-cobble leakage; water frames contain continuous ripple texture without isolated bright polka dots; LPC actors, buildings, props, bridge, and water render. The landing silhouette is tapered/stepped rather than notched, and the rendered-composite axis-run metric records no run over 32 px in the asserted windows. Green/blue/red square marks observed in interiors are interaction/HUD overlays, not world placeholder textures. This remains technical evidence, not human aesthetic acceptance.

## Verification

| Check | Result |
|---|---|
| `env -u CI bun moon run scripts:typecheck` | pass |
| `env -u CI bun moon run scripts:lint` | pass |
| `env -u CI bun moon run scripts:test -- --timeout 30000 --force` | pass — 2196 tests, 0 failures (default 5s catalog stress tests time out on loaded host) |
| `env -u CI bun moon run frontend-engine:typecheck` | pass |
| `env -u CI bun moon run frontend-engine:lint` | pass |
| `env -u CI bun moon run frontend-engine:test` | pass — 1859 tests, 0 failures |
| `env -u CI bun moon run constants:typecheck` | pass |
| `env -u CI bun moon run constants:lint` | pass |
| `env -u CI bun moon run constants:test` | pass — 206 tests, 0 failures |
| `validate` | pass — constants, e2e, frontend-engine, scripts fix/typecheck/guards |
| `env -u CI bun moon ci --base=origin/main` | pass — 65 completed, 12 cached, 2 skipped |
| `bun run --cwd scripts lint-contracts` | exit 0; C-559 absent from diagnostics (repository-wide legacy audit still reports 932 pre-existing errors) |
| `emberwatch:locked-ids` | pass |
| `emberwatch:validate` | pass — 0 warnings, 0 blockers |

## Files

### Created

- `docs/contracts/C-559-semantic-terrain-edges.md`
- `apps/e2e/scripts/capture_c559_semantic_terrain.ts`

### Modified

- `apps/e2e/src/pom/emberwatch_house_page.ts`
- `packages/frontend/engine/src/__tests__/emberwatch_content_audit.test.ts`
- `content/packs/asset_hashes.json`
- `content/packs/emberwatch/manifest.json` (path and landing terrain declarations)
- `content/packs/emberwatch/maps/inn.json`
- `content/packs/emberwatch/maps/merchant_shop.json`
- `content/packs/emberwatch/maps/old_road.json`
- `content/packs/emberwatch/maps/ruined_shrine.json`
- `content/packs/emberwatch/maps/village.json`
- `packages/shared/constants/src/lib/media_preparation.ts`
- `scripts/src/lib/ops/emberwatch_map_village.ts`
- `scripts/src/lib/ops/emberwatch_terrain_pass.test.ts`
- `scripts/src/lib/ops/generate_emberwatch_atlas.test.ts`
- `scripts/src/lib/ops/generate_emberwatch_corner_painters.ts`
- `scripts/src/lib/ops/generate_emberwatch_maps.ts`
- `scripts/src/lib/ops/generate_emberwatch_tables.ts`
- `scripts/src/lib/ops/generate_emberwatch_terrain_frames.ts`
- `scripts/src/lib/ops/guard_cognitive_complexity_baseline.json` (sanctioned reduction-only contraction)

## Follow-ups / risks

- Local candidate evidence uses a local origin and read-only catalog snapshot; no release was published.
- Human review remains required for art-direction acceptance and for deciding whether the repurposed `earth`/`gravel` corner families should receive separate material identities later.
- Runtime capture is intentionally evidence-only; it does not claim that the broader polish plan is complete.
