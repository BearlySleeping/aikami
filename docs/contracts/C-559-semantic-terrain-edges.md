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
- C-559 adds append-only path transition GIDs 177–192 and grows the atlas capacity from 11 to 13 rows. Existing GIDs do not move.
- Collision layers are not authored by this contract and are proven byte-identical to `origin/main`.
- No catalog sync/apply, publish, upload, deploy, or promotion was performed. The evidence plane used the authorized read-only snapshot plus a local origin serving local candidate files.
- Technical WebGL/entity evidence is not a human visual acceptance decision.

## Acceptance criteria

### AC-1 — Semantic corner16 ownership for baked materials

**Pass.** `path_tough` and its variant map to the new `path` corner16 terrain; `stone_floor`, its indoor variant, and `flagstone` map to `earth`; `sand` maps to `gravel`; bridge and bridge-assembly frames retain their detailed decor visual while receiving `earth` terrain semantics. The renderer therefore receives a terrain channel and corner masks rather than empty IDs for these materials.

### AC-2 — Organic ward and landing boundaries

**Pass.** The ward square spans and spurs are asymmetric, and the crossing landing keeps its required three-cell row while adding a staggered lower approach. No broad hard rectangle is left as an untransitioned material island.

### AC-3 — Collision identity

**Pass.** Serialized collision-layer JSON and data arrays are byte-identical to `origin/main` for all five maps. Proof is recorded in `/tmp/opencode/c559-evidence/collision-proof.json` and summarized below.

### AC-4 — Perceptual placed-composite regression

**Pass.** The C-552 3×3 placed-cell method now reads the production semantic channel. A regression test requires every targeted material cell to have its expected terrain and requires landing/ward composites to remain within near-linear run `≤8` and lag correlation `≤0.99`. Results are recorded in `/tmp/opencode/c559-evidence/metric-placed-composites.json` and `/tmp/opencode/c559-evidence/metric-baseline.json` / `metric-after.json`.

### AC-5 — Locked identity and Emberwatch validation

**Pass.** `emberwatch:locked-ids` reports locked identities unchanged. `emberwatch:validate` reports five maps, zero warnings, and zero blockers.

### AC-6 — WebGL evidence

**Pass.** Six same-camera before/after pairs cover ward square, crossing landing, inn, merchant, old road, and ruined shrine. Every capture is WebGL and passes `visible-entity-textures-v2`. Evidence is under `/tmp/opencode/c559-evidence/`, including `index.md`, `sheet.png`, before/after PNGs, manifests, collision proof, and metrics.

## Implementation

### Semantic channel and layer ownership

- `scripts/src/lib/ops/generate_emberwatch_maps.ts:38-59` defines semantic mappings and bridge visual retention.
- `scripts/src/lib/ops/generate_emberwatch_maps.ts:205-234` resolves ground/decor/overhead ownership without changing collision or object layers. Detailed bridge frames remain visible in decor while their semantic terrain supplies the boundary mask.
- `content/packs/emberwatch/manifest.json:71-77,935-1070` declares the `path` terrain and append-only path frames GIDs 177–192.
- `scripts/src/lib/ops/generate_emberwatch_tables.ts:28-59,349-395` grows atlas capacity and verifies pinned append-only path frame cells. `scripts/src/lib/ops/generate_emberwatch_corner_painters.ts:59-65` routes the new family to the path material painter.

### Organic authored geometry

- `scripts/src/lib/ops/emberwatch_map_village.ts:356-364` keeps the three-cell landing contract and adds staggered lower dirt cells.
- `scripts/src/lib/ops/emberwatch_map_village.ts:418-446` uses asymmetric square spans and small edge spurs.
- `scripts/src/lib/ops/generate_emberwatch_terrain_frames.ts:331` adds the path transition phase; the adjacent/diagonal contour fields add a higher-frequency signed perturbation so repeated masks do not form a smooth ramp.

### Regression and evidence tooling

- `scripts/src/lib/ops/emberwatch_terrain_pass.test.ts:660-738` adds all-material semantic coverage and ward-square placed-composite assertions.
- `scripts/src/lib/ops/emberwatch_terrain_pass.test.ts:592-631` updates the landing metric to consume the actual generated semantic channel.
- `apps/e2e/scripts/capture_c559_semantic_terrain.ts:1-260` provides the reproducible WebGL capture lane, candidate-root pinning, visible-entity guard, hashes, index, and `magick montage -label '%t'` sheet.
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

The global placed-cell sweep covers all targeted material boundary cells across the five builders. Semantic transition coverage improves from `44.759%` (`521/1164`) to `100%` (`1170/1170`). Mean boundary luma decreases from `31.904` to `25.597`; maximum short-period lag correlation decreases from `1.000` to `0.816`.

Named C-552 3×3 composites show the landing correction directly:

| Composite | Near-linear run before → after | Max lag correlation before → after | Mean boundary luma before → after |
|---|---:|---:|---:|
| crossing `36,9` | `15 → 2` | `0.994 → 0.464` | `24.276 → 9.162` |
| crossing `37,9` | `14 → 2` | `0.834 → 0.378` | `23.481 → 7.629` |
| crossing `38,9` | `14 → 2` | `0.906 → 0.378` | `23.655 → 7.629` |
| ward `27,22` | `1 → 3` | `0.361 → 0.624` | `13.422 → 11.926` |
| ward `37,22` | `1 → 2` | `0.275 → 0.439` | `11.368 → 11.802` |

The regression test locks the meaningful upper bounds (`≤8`, `≤0.99`) rather than assuming every local profile must improve monotonically; global transition coverage and landing sharpness both improve substantially. Full records are in `/tmp/opencode/c559-evidence/metric-placed-composites.json`.

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
- Before lane: `/tmp/opencode/c559-evidence/before/`
- After lane: `/tmp/opencode/c559-evidence/after/`
- Capture manifests: `/tmp/opencode/c559-evidence/before/capture_manifest.json` and `/tmp/opencode/c559-evidence/after/capture_manifest.json`
- Collision proof: `/tmp/opencode/c559-evidence/collision-proof.json`
- Global metrics: `/tmp/opencode/c559-evidence/metric-baseline.json` and `/tmp/opencode/c559-evidence/metric-after.json`
- Named placed-composite metrics: `/tmp/opencode/c559-evidence/metric-placed-composites.json`

The before lane used `/tmp/opencode/c552-baseline` and the authorized read-only catalog snapshot. The after lane used this worktree and a local candidate origin at a separate port. All pairs report the same player cell, camera cell, world camera coordinates, viewport, and noon hour. The final sheet was inspected: textured terrain, LPC actors, buildings, props, bridge, and water render; no void, missing texture, or flat placeholder terrain is visible. Green/blue/red square marks observed in the inn/shrine frames are interaction/HUD overlays, not world placeholder textures. This remains technical evidence, not human aesthetic acceptance.

## Verification

| Check | Result |
|---|---|
| `env -u CI bun moon run scripts:typecheck` | pass |
| `env -u CI bun moon run scripts:lint` | pass |
| `env -u CI bun moon run scripts:test` | pass — 2192 tests, 0 failures |
| `env -u CI bun moon run frontend-engine:typecheck` | pass |
| `env -u CI bun moon run frontend-engine:lint` | pass |
| `env -u CI bun moon run frontend-engine:test` | pass — 1859 tests, 0 failures |
| `env -u CI bun moon run constants:typecheck` | pass |
| `env -u CI bun moon run constants:lint` | pass |
| `env -u CI bun moon run constants:test` | pass |
| `validate` | pass — constants, e2e, scripts fix/typecheck/guards |
| `env -u CI bun moon ci --base=origin/main` | pass — 65 completed, 15 cached, 2 skipped |
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
- `content/packs/emberwatch/manifest.json`
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
