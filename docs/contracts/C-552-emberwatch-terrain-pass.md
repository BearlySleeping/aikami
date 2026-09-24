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
| **Target** | `scripts/src/lib/ops/` terrain/stone/grass/sand painters and focused tests; generated Emberwatch atlas/maps/hashes/reports; C-548 evidence capture output under `/tmp/opencode/c552-evidence/`; this contract |
| **Type** | thin |
| **Priority** | P2 — bridge and house assemblies are accepted; terrain transitions and floor value now dominate the remaining environment defects |
| **Dependencies** | C-545 (ambient parity), C-546 (append-only atlas/GID pinning), C-548 (candidate/evidence/entity-texture lane), C-549 (grass metrics and seeded patches), C-550 (merged baseline / #392) |
| **Status** | implemented |
| **Promotion** | — |
| **Docs Impact** | internal → contract and evidence index only; no player-facing docs page |
| **Contract version** | 1.0.0 |
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

- **Transition quality:** each of the 16 corner16 cases has no uninterrupted 45-degree boundary run longer than 4 px, and edge-row/column boundary signatures meet their matching neighbour cases without a seam.
- **Stone restraint:** measured stone luminance sits close to the dirt/path family, local mortar-to-stone contrast is bounded, and every map using `stone_floor` resolves the same corrected frame.
- **Grass restraint:** every grass variant mean remains within ±4% of base; edge continuity remains within 1.5 luminance; explicit tuft occupancy is at most 3% of eligible grass cells and preserves paths/banks.
- **Geometry identity:** all five regenerated collision layers are byte-identical to `origin/main`; object identities and map extents remain unchanged.
- **Production evidence:** same-camera 1920×1080 DPR1 noon before/after captures cover the named crossing, square, old-road and remaining-map views, plus square dawn/night; WebGL and visible-entity texture guards pass; montage and index live under `/tmp/opencode/c552-evidence/`.
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

C-552 is a painter-and-evidence pass, not a map redesign. It replaces geometric corner16 diagonals with deterministic dithered/noise-shaped boundaries, calms the shared stone-floor material, and adds a very sparse tuft layer to the existing restrained grass family. The same fixed terrain GIDs feed all five regenerated maps. Sand receives only a base-palette correction if the dawn tint analysis proves the authored base is responsible.

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
**Then** each boundary is dithered/noise-shaped with consistent material width, no uninterrupted 45-degree boundary run exceeds 4 px, and matching edge-row/column signatures tile continuously across all 16 cases. Existing GID-to-frame mappings remain byte-for-byte stable.

**Verification**: `tooling: bun moon run scripts:test` — focused C-552 pixel/mask tests against `packAtlas()` output; terrain GID table test; `tooling: bun run emberwatch:validate`; `tooling: bun moon run scripts:validate`.

### AC-2: Stone is irregular, low-contrast, and actor-subordinate on every map

**Given** the one shared `stone_floor` frame used by village, inn, merchant, old road, and shrine
**When** the atlas is regenerated
**Then** the material uses larger irregular stones/cobble, bounded mortar contrast, and a luminance close to the authored dirt/path family. Pixel metrics assert explicit upper/lower luminance and contrast bounds against grass/dirt means on all five maps, and the same corrected frame resolves wherever `stone_floor` is used.

**Verification**: `tooling: bun moon run scripts:test` — C-552 stone pixel/metric tests and five-map frame-use assertions; visual evidence for every map.

### AC-3: Grass keeps broad restraint and gains only sparse irregular tufts

**Given** C-549's shared grass base, dark patch and variant material
**When** grass variants and map placement are regenerated
**Then** broad seeded value patches remain, every grass variant mean stays within ±4% of base, edge means remain within 1.5 of base, and explicit small tufts occupy at most 3% of eligible grass cells with irregular connected components. No tuft is placed on paths, water, sand, stone, building pads, banks or other non-grass cells; no old full-cell square pattern returns.

**Verification**: `tooling: bun moon run scripts:test` — C-549 metrics retained plus C-552 tuft occupancy/component/exclusion assertions on all five maps.

### AC-4: Dawn sand diagnosis is explicit and ambient remains unchanged

**Given** the authored sand palette and C-545 ambient multiplier at dawn
**When** source colours and the same candidate are inspected at noon and dawn
**Then** the report states whether the mauve cast originates in the warm low-saturation sand base or solely in the ambient multiplier. If the base is causal, only the sand palette is adjusted slightly; C-545 ambient code/curves and actor/prop parity remain byte-identical.

**Verification**: focused C-552 palette/ambient diagnostic test and same-camera noon/dawn evidence; `git diff` proves no ambient-policy/environment-curve edit.

### AC-5: Painter-only regeneration preserves all collision and object identity

**Given** the five `origin/main` C-550 maps
**When** the existing map generator runs after painter changes
**Then** each regenerated map's collision layer is byte-identical to its baseline counterpart; extents, object layers, locked IDs, and authored map geometry are unchanged. Repeating generation is byte-deterministic. Generated files are changed only through their producers.

**Verification**: C-552 regression test compares parsed collision-layer bytes/JSON for all five maps against pinned baseline fixtures or `origin/main` content; two generator runs produce no diff; `tooling: bun run emberwatch:validate`; `tooling: bun run emberwatch:locked-ids`; `tooling: bun run emberwatch:audit`.

### AC-6: Reproducible same-camera evidence passes C-548 guards

**Given** the read-only production catalog snapshot and before/after candidate planes
**When** captures run at 1920×1080 DPR1, default world zoom, overlays off
**Then** before/after pairs cover village crossing, village square, old-road crossing, and one named view for each remaining map, with additional square dawn/night pairs. WebGL is asserted; visible entity textures are real and fingerprint-covered; requested camera cells match actual cells. `magick montage` produces `/tmp/opencode/c552-evidence/sheet.png`; individual PNGs and `index.md` record identity, camera, game hour, hashes and observations.

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

## Promotion Lifecycle

> Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)


---

## Execution Report

### Summary

Completed the C-552 painter-and-evidence pass without changing map geometry,
ambient curves, buildings, props, UI, or the reserved terrain GID block. The
atlas painter now uses rounded, coherent-noise corner16 coverage; shared stone
and cobble use wrapped irregular stones with restrained mortar contrast; grass
keeps C-549's broad value patches and adds only a 1.8% sparse detail selection;
and sand is slightly warmer/yellower. All five maps regenerate deterministically
with byte-identical collision layers.

### AC Status

| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | All five corner16 families pass all-16 mask coverage, opacity, GID pinning, seam classification, and ≤4 px straight-run tests; max measured run is 4 px. |
| AC-2 | ✅ | Shared stone mean luminance `116.877`, p90–p10 `14.068`, p95 local contrast `12.068`; no 8 px bevel grid; all five builders place `stone_floor`. |
| AC-3 | ✅ | Real five-map autotiler occupancy is village `1.593%`, old road `1.788%`, shrine `2.599%`; interiors have no grass channel; non-grass contamination is `0`. C-549 mean/edge tests remain green. |
| AC-4 | ✅ | Dawn ambient remains `[0.45, 0.25, 0.15]`; only sand base changed to `[218, 198, 132]`. No ambient/environment curve file changed. |
| AC-5 | ✅ | All five serialized collision-layer SHA-256 digests match C-550; two generator runs produce no map diff. |
| AC-6 | ✅ | Eight same-camera 1920×1080 DPR1 before/after pairs plus square dawn/night; WebGL and visible-entity texture guards pass; montage and index are under `/tmp/opencode/c552-evidence/`. |

### Files Created

| File | Purpose |
|---|---|
| `scripts/src/lib/ops/generate_emberwatch_terrain_frames.ts` | Extracted terrain materials, irregular stone/cobble, warmer sand, and organic corner compositor. |
| `scripts/src/lib/ops/emberwatch_terrain_pass.test.ts` | Real packed-atlas metrics, all-mask/seam/GID checks, five-map grass exclusion/occupancy, sand, and collision identity. |
| `docs/contracts/C-552-emberwatch-terrain-pass.md` | Contract and execution report. |

### Files Modified

| File | Change |
|---|---|
| `scripts/src/lib/ops/generate_emberwatch_atlas.ts` | Delegates terrain materials/compositor to the extracted module; fixed terrain block and packer unchanged. |
| `scripts/src/lib/ops/generate_emberwatch_atlas.test.ts` | Updated painter dispatch/pixel expectations for extracted materials. |
| `scripts/src/lib/ops/generate_emberwatch_grass_frames.ts` | Fixed material phase and irregular low-contrast tuft details. |
| `packages/frontend/engine/src/assets/autotile.ts` | Coherent broad grass patches, 1.8% sparse detail selection, and base-frame fallback for non-grass/empty channels. |
| `packages/frontend/engine/src/assets/autotile.test.ts` | Variant distribution, determinism, base dominance, and non-grass coverage regression tests. |
| `scripts/src/lib/ops/guard_source_file_size_baseline.json` | Sanctioned reduction after atlas extraction. |
| `scripts/src/lib/ops/guard_cognitive_complexity_baseline.json` | Sanctioned reduction after test decomposition. |
| `docs/reference/emberwatch-visual-report.json` | Regenerated derived report; notice-board placement now matches the C-549 authored map. |

### Generated outputs and evidence

- `bun run emberwatch:studio --no-client --no-serve` completed the canonical
  portrait/audio/atlas/prop/map/scan/seed pipeline; the terrain atlas is
  `544×340`, 159 frames, and the derived seed has 81 rows.
- Tracked map JSON, manifest, and atlas JSON hashes are unchanged from the
  accepted baseline. The gitignored atlas WebP and derived seed are the only
  changed generated artifacts.
- Evidence index: `/tmp/opencode/c552-evidence/index.md`.
- Contact sheet: `/tmp/opencode/c552-evidence/sheet.png`.
- Collision proof: `/tmp/opencode/c552-evidence/collision-proof.json`.
- Metrics: `/tmp/opencode/c552-evidence/metrics.json`.
- Baseline/current capture manifests:
  `/tmp/opencode/c552-evidence/baseline/capture_manifest.json` and
  `/tmp/opencode/c552-evidence/current/capture_manifest.json`.

### Validation

- `bun moon ci --base=origin/main` — PASS (54 completed, 2 skipped).
- `bun moon run :validate` — PASS (174 tasks, 8 cached).
- `bun moon run scripts:test -- --timeout=30000` — 2,161 pass, 0 fail.
- `bun moon run frontend-engine:test` — 1,839 pass, 1 todo, 0 fail.
- Focused C-552 terrain suite — 17 pass; C-549 grass + atlas suite — 27 pass.
- `bun run scripts/src/lib/ops/run_guards.ts` — 10/10 structural guards pass.
- `emberwatch:validate`, `emberwatch:audit`, `emberwatch:locked-ids`,
  `emberwatch:visual-report`, and `emberwatch:visual-audit` — pass.
- The repository's default full `scripts:test` still exposes two known
  five-second `emberwatch:release --plan` subprocess timeouts under load; the
  complete 10-test release file passes with `--timeout=30000`. No C-552 test
  failed.

### Commits

- `b601db03f83b081b14ac086065028386fcc523c1` —
  `feat(emberwatch): C-552 terrain material pass`
- `83b4473` — `chore(emberwatch): regenerate C-552 reports`
- `docs(emberwatch): record C-552 terrain evidence` (current commit)

Pull request: https://github.com/BearlySleeping/aikami/pull/395
