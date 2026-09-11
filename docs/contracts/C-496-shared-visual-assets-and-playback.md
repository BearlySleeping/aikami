---
id: C-496
title: "Shared visual assets, atlas import and playback"
source: direct
contract_type: full
status: implemented
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: "https://github.com/BearlySleeping/aikami/pull/303"
  pr_number: 303
created_at: "2026-09-09T00:00:00Z"
---

# Contract C-496: Shared visual assets, atlas import and playback

## Metadata

| Field | Value |
|---|---|
| **Source** | Formalizes the C-496 seed in `BACKLOG_C485_PLUS.md`; maintainer asset review, 2026-09-09 |
| **Target** | `packages/shared/schemas/`, `packages/shared/lpc/`, `packages/frontend/engine/`, `packages/frontend/preview/`, `apps/frontend/client/src/` and `apps/frontend/hub/src/` consumers, `scripts/src/lib/catalog/` and `scripts/src/lib/ops/` (asset collector + catalog scan) |
| **Type** | full |
| **Priority** | P1 — replace inferred geometry and divergent asset interpretations |
| **Dependencies** | C-504 (implemented, PR #285) |
| **Status** | approved |
| **Promotion** | — |
| **Docs Impact** | user-facing — visual asset authoring reference in `apps/frontend/docs/src/content/docs/` |
| **Contract version** | 2.0.1 |
| **Production Surface** | `/game` and Hub `/catalog/[category]/[tag]` asset previews |

## Problem & Baseline Evidence

Audit baseline (re-check before implementation; line numbers re-verified 2026-09-10):

- `packages/frontend/engine/src/game_world.ts:3586` hard-codes `const stateStr = 'walk'` and slices `walk_<row>_<col>` frames; `packages/shared/lpc/src/lib/sheet_geometry.ts:84` guesses the 64/128px layout from image dimensions.
- `packages/frontend/preview/src/lib/lpc/lpc_renderer.ts:169` walks `STATE_FALLBACK_CHAINS` and silently substitutes another animation sheet. `packages/frontend/preview/src/lib/lpc/lpc_preview_view_model.svelte.ts:620`/`:626` builds `new Texture(...)`/`new Sprite(...)` per layer on every render and keeps its own frame, depth and tint interpretation.
- `packages/shared/lpc/src/lib/build_catalog.ts:62` derives rear passes from the `bg_` filename prefix, while `scripts/src/lib/ops/collect_lpc_assets.ts:412` also emits an explicit `/behind` type and published credits/index data carries `_bg` variants. `packages/shared/lpc/src/lib/appearance.ts:281` discards variant roles when projecting the catalog.
- Upstream `examples/Universal-LPC-Spritesheet-Character-Generator/sheet_definitions/` carries body mappings, layer ordering, animation availability and palette information; filenames alone are not a sufficient compatibility contract. 🔴 `examples/` is **gitignored** (`.gitignore:246`) and therefore **absent from implementation worktrees and CI** — upstream-derived mappings must be committed as reviewed data inside the repo, never read from `examples/**` at runtime, in tests, or during a contract run.
- `packages/shared/schemas/src/lib/catalog/catalog_index.ts:99` carries identity/hash/credits but no complete visual description. `scripts/src/lib/catalog/pipeline.ts:312` keeps uploading index objects after a shard failure and still writes the root, and `pipeline.ts:327` computes `ok` without the seed failures that `runSeedPublish` returns (`pipeline.ts:132`).
- Baselines: existing LPC tests (`packages/shared/lpc/tests/`), `packages/frontend/engine/src/__tests__/prop_texture_resolver.test.ts`, texture-manager coverage in `packages/frontend/engine/src/__tests__/rendering.test.ts`, catalog publication (`scripts/src/lib/catalog/__tests__/publish.test.ts`, `index_generation.test.ts`) and preview lifecycle (`packages/frontend/preview/src/lib/__tests__/lifecycle.test.ts`). Capture the current normal game and Hub preview before replacing either path.

## User Outcome

An authored or generated sprite can render identically in the game and preview without being arranged like LPC. Existing LPC characters and tile/prop atlases continue working offline.

## Success Measures

- One definition determines each asset's frames, timing, origin and supported color behavior.
- Mixed LPC and generic-atlas characters work in one scene, without a second game renderer.
- No per-frame texture/sprite/container allocation during steady playback; appearance changes use atomic replacement.
- A failed publish never advances the release pointer to an incomplete release.

## Existing System & Reuse Map

| Capability | Existing source | Decision |
|---|---|---|
| Schemas and identity | `packages/shared/schemas/`, C-504 | extend, not a new schema library |
| LPC compatibility | `packages/shared/lpc/` | keep as an import adapter |
| Frames/textures | Engine `rendering/texture_manager.ts`, `prop_texture_resolver.ts` | reuse cached Pixi frame textures |
| Actor clock | Engine `rendering/animation_controller.ts` (advances on tick count, `:154`) | replace its frame-count clock with one elapsed-time actor clock; do not add a second clock |
| Layer composition/depth | Engine `rendering/lpc_layer_order.ts` (re-export of `@aikami/lpc`), `layer_bands.ts`, `systems/render_system.ts` | reuse the canonical depth table and z-bands; pass ordering derives from validated metadata, not catalog array position |
| Palette/tint rendering | Engine `rendering/sprite_composer.ts` (live Zero-Branch LUT path, initialized from `pixi_app.ts`), `assets/lpc_asset_catalog.ts` | keep for existing LPC palette sheets; do not extend it into a generic indexed-palette mode in this contract |
| Tileset/prop atlas metadata | `packages/shared/schemas/src/lib/game/content_pack.ts` (`atlas`, `fallbackTile`, `tiles`, `props`, `AssetProvenanceSchema`; C-171/C-375/C-381) | extend the existing tileset/atlas fields; do not define a second tileset atlas shape |
| Canonical scene origins/provenance | `packages/shared/schemas/src/lib/game/scene.ts` (C-505, implemented PR #287) | align origin/transform/provenance semantics with the landed scene schema; do not duplicate it |
| Hosts | `packages/frontend/preview/`, `game_world.ts` | thin UI/camera hosts over shared render logic |
| Publishing | `scripts/src/lib/catalog/` (`pipeline.ts`, `index_generation.ts`, `upload.ts`) and `scripts/src/lib/ops/collect_lpc_assets.ts` | retain content-addressed R2 objects and credits; fix the root/shard/seed failure decision |
| Atlas source alpha/lossless output | C-506 (implemented, PR #289) | already delivered — do not re-implement or regress |
| Scene normalization/map preview | C-505 (already implemented, PR #287) | already landed; preserve canonical scene parsing and whole-map preview, no reverse dependency |
| Hub tag identity | Shared tag builder (`packages/shared/lpc/src/lib/tags.ts`, `buildLpcCatalog`) | already adopted by the Hub in C-504 (`catalog_asset_view_model.svelte.ts#ensureLpcSlotsBuilt`) — guard against regression, do not re-do |

## Overview

Introduce a small versioned visual definition and compile supported inputs into it. Separate common image/frame primitives from actor, component and tileset-specific rules. The renderer consumes validated data, never provider prompts or generator-specific conventions.

## Design Reference

Use C-504 named identities and existing resolver injection. See [execution guide](../plans/visual_asset_foundation.md) and [shared testing conventions](SHARED_SECTIONS.md#testing-conventions). This supersedes the C-496 backlog seed as the executable specification; it does not make LPC the permanent required player art style.

C-505 (canonical scene, PR #287) and C-506 (Emberwatch readability, PR #289) have **already landed** even though `docs/plans/visual_asset_foundation.md` lists them after this contract. Treat their schemas and preview integration as existing code to preserve, not as future work.

## Architecture Directives

1. Reuse existing packages. Shared pure data/validation must not import Pixi, Svelte, filesystem APIs or network services. Browser preview controls do not own separate animation semantics.
2. Common primitives: immutable artifact references, image dimensions/color encoding, frames, clips, origins and diagnostics. Domain payloads remain discriminated: complete sprites, modular components, tilesets. Tile matching and equipment occupancy are not properties of every image.
3. An LPC adapter emits explicit metadata once at import/normalization. Dimension heuristics remain only a labeled legacy adapter, never generic format detection. Use upstream definitions or reviewed compatibility mappings, not guessed body compatibility from labels.
4. One selectable component may emit several stable render passes. Preserve paired parts, body/pose compatibility and deterministic order. Do not expose a rear half as a standalone complete hairstyle or shield by accident.
5. One actor clock drives compatible layers. Reject incompatible pose/timing profiles; a missing action follows an explicit actor-level fallback, not independent random per-layer substitutions. Preserve direction while idle and use elapsed time, not display refresh count.
6. Build replacement sprites off-scene, check revision/lifecycle validity, then swap. Destroy abandoned objects and release owned frame views without destroying shared texture sources still in use.
7. Separate immutable asset revision from mutable browse labels/categories. Pin image and definition hashes in an installed pack/release lock. Keep existing aliases for old consumers.
8. Publish immutable manifest/shard revisions and required dependencies first, then one release pointer. A shard, required seed or validation failure prevents pointer advancement. Preserve the previous complete release. Do not overwrite v1 catalog semantics; use a versioned publication path with v1 read compatibility.

## State & Data Models

The TypeBox wire schema must make these semantics explicit; use readable authoring keys rather than abbreviations:

| Field group | Required semantics |
|---|---|
| Identity | `schemaVersion`, stable `id`, discriminated `kind`; revision is a content hash outside self-hashed bytes |
| Images | stable image IDs, immutable artifact refs, dimensions, supported color/alpha encoding |
| Frames | unique IDs; image ID; integer `x,y,width,height`; original logical size; trim offset; pixel-space origin |
| Clips | unique names such as `walk.east`; ordered frame IDs; positive duration per occurrence; loop behavior; explicit fallback references |
| Components | compatible rig/body/pose profile revisions; stable pass IDs; validated ordering/visibility rules, not catalog-array positions |
| Presentation | pixel density and sampling policy; optional explicitly supported color operation |
| Provenance | original source/license records and optional generator provenance; never executable nodes or scripts |
| Release & locks | a versioned release pointer document naming immutable manifest/shard revisions plus required dependencies; an installed pack lock pinning image and definition content hashes; the existing `index/v1/` path stays readable for old clients |

Frame rectangles are half-open and in image pixels. Origins/trim offsets use the untrimmed logical coordinate system. V1 normalizes rotated packed frames to unrotated frames or rejects them with a diagnostic; it must not misrender them. Preserve Tiled placement flips through the scene adapter separately.

V1 supports original RGBA plus explicit multiplicative tint, consistently in game and preview. Material/color tags are discovery metadata, not implicit dye instructions. Indexed/masked palette rendering is deferred: reject unsupported rendering modes instead of pretending tint is palette replacement. Preserve existing supported tint data through an adapter and diagnose unsupported legacy palette data.

Use real alpha internally. Optional color-key removal is an explicit import operation with key/tolerance and a light/dark matte preview; never a global green-removal shader. Pixel-art masters, masks and atlas outputs are lossless. Preserve alpha and edge padding during packing. Keep source masters and provenance; generated bytes are not proof of licensing permission.

## Quality Requirements

- **Offline:** installed definitions/images resolve locally; no catalog fetch or image generation becomes a boot dependency.
- **Accessibility:** preview controls expose labels, keyboard access and readable error states.
- **Performance:** persistent sprites and cached frame views; bounded/reference-aware texture ownership. Record decoded bytes, frame allocations and a same-device steady-playback baseline before/after. Do not introduce eager whole-catalog loading.
- **Security:** strict schemas, finite/bounded dimensions, image decode budgets, in-bounds frames, resolvable references and acyclic fallbacks/order constraints. No arbitrary URLs or executable workflow metadata.
- **Persistence:** pack locks pin definitions and bytes; repacking an atlas cannot change logical frame identity or reskin a save.
- **Cancellation:** stale/disposed loads never mutate the current scene or poison retry caches permanently.
- **Observability:** structured diagnostics identify asset, clip, profile and failed reference; fallback use is visible to authors.

## Migration & Rollback

Read legacy LPC and atlas inputs through adapters, then use the same validated definition. Preserve old published assets/releases and aliases. Gate new formats by schema/capability version; old clients retain their compatible release and the existing `index/v1/` path. Never publish a definition that references unavailable bytes. Cache keys include immutable revision. A conversion failure leaves the previous valid installation selected, not a partially rewritten pack. Publishing requires separate explicit authorization; normal tests use local/pinned fixtures.

C-505's canonical scene schema (`packages/shared/schemas/src/lib/game/scene.ts`) and whole-map preview already landed — read and preserve them; do not reintroduce a second scene interpretation. Upstream `examples/**` definitions are gitignored (`.gitignore:246`) and absent from worktrees and CI, so every upstream-derived compatibility mapping must be committed as reviewed data in the repo with a pinned fixture.

## Scope Boundaries

- **In Scope:** shared visual schema/adapters, metadata fidelity, validated publication, deterministic playback/layer composition, frame/color inspection, faithful preview integration and lifecycle cleanup.
- **Out of Scope:** canonical scene normalization and map-preview replacement (C-505, already implemented — preserve, do not redo), atlas source alpha/extrusion and grounding readability (C-506, already implemented), biome scattering, generative houses, generation-provider integration, arbitrary custom-node execution, new gameplay equipment slots, skeletal animation, advanced lighting, indexed/material dye shaders, wholesale replacement of LPC art, a global renderer rewrite.

## Contract Size & Split Rule

Run once through `bun run contract C-496`; all mandatory ACs belong to this run. C-505 already landed (PR #287) and owns map normalization/preview integration — this contract must not regress it. No partial-completion dependency or manual resume between contracts is required.

Target 40–65 changed paths through reuse of existing adapters and preview hosts; this is a planning budget, not a measured estimate. Inventory the full scope before implementation, especially host/lifecycle changes. At 75 paths reassess; at 85 stop for an explicit split decision rather than silently dropping ACs or inventing a manual inter-contract handoff. No PR reaches 100 files.

## Acceptance Criteria

### AC-1: Validated format supports non-LPC frames
**Given** legacy LPC, a generic atlas with unequal trimmed frames, and a static prop, **when** imported, **then** definitions preserve origins, timing, alpha and logical identities. Invalid bounds, duplicate IDs, unresolved references, cyclic fallbacks and unsupported modes fail before publication/allocation.

### AC-2: Modular metadata survives the entire path
**Given** a component with rear/front parts and declared rig/pose compatibility, **when** selected and normalized, **then** all required parts render once in deterministic order. Invalid combinations are rejected with actionable diagnostics. Tests cover `/behind`, prefix/suffix legacy conventions and equal-depth ties independent of async load order. Hub asset lookup stays on the shared tag builder (`buildLpcCatalog`), preserving complete nested IDs and state tags without duplicated path segments — C-504 already landed this, so the assertion here is a regression guard, not new work.

### AC-3: Mixed assets render in the real game
**Given** one LPC actor, one generic animated actor and a prop, **when** the scene requests available and missing clips, **then** they render together with stable origins and declared fallbacks. Visual bounds do not change authoritative collision or hit timing.

### AC-4: Publication is revision-consistent
**Given** a new release and injected failure at each required object/shard/seed/pointer step, **when** publishing or retrying, **then** readers see the old complete release or the new complete release, never mixed revisions. Duplicate uploads are safe and attribution gates remain intact. Test offline install from a pinned release. A failed, interrupted or invalid conversion leaves the previously installed pack selected and usable offline, `index/v1/` and existing aliases stay resolvable for old readers, and a repack never changes logical frame identity for an existing save.

### AC-5: Animation and appearance lifecycle are shared
**Given** variable frame rates, rapid equipment changes, delayed loads and disposal, **when** playing, **then** elapsed-time animation, roles and fallback policy agree across hosts. Stale loads cannot clear newer sprites, recolor/tint has consistent semantics, and steady frames allocate no new render objects.

### AC-6: Previews show actual production assets
**Given** actor/prop/tileset assets, **when** inspected in supported Hub/client asset previews and rendered through the actual game asset path, **then** frame selection, alpha, origin, ordering and supported color operations agree. Isolation does not secretly add fallback body layers. Whole-map preview normalization and real-tile composition are owned and verified by C-505, not prerequisites for this AC.

### AC-7: Resource usage and regressions are demonstrated
**Given** repeated preview mount/unmount, scene transitions, cache reuse and offline reload, **when** measured, **then** owned resources return to the established baseline, shared textures survive while referenced, and missing/retried loads remain diagnosable. Record the normal game and preview screenshots plus allocation/memory observations.

**Evidence Matrix**:

| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit + import integration | real small atlas/LPC fixtures and invalid inputs | `scripts/src/lib/catalog/pipeline.ts#runCatalogPublish` | Required before handoff |
| AC-2 | Integration + visual | compatibility, multi-pass and Hub tag matrix | `/game` | Required before handoff |
| AC-3 | E2E + visual | mixed-asset scene at gameplay scale | `/game` | Required before handoff |
| AC-4 | Integration | failure-injection release tests and offline install | `scripts/src/lib/catalog/pipeline.ts#runCatalogPublish` | Required before handoff |
| AC-5 | Unit + compiled lifecycle | timing, race and ownership regressions | `/game` | Required before handoff |
| AC-6 | E2E + visual | matching asset-preview/game captures with resolved IDs | `LpcPreview` (Hub `/catalog/[category]/[tag]` detail preview and the client `/dev/lpc*` sandbox) | Required before handoff |
| AC-7 | E2E + performance | repeated lifecycle/resource report | `/game` | Required before handoff |

**Test Hooks**: existing engine/preview/LPC/catalog test lanes; production Playwright journeys under `apps/e2e/tests/client/` and `apps/e2e/tests/hub/`; visual suites under `apps/e2e/src/visual/suites/`. Use compiled Svelte testing for reactive behavior. Run affected-project validation before the standard pipeline verification handoff.

**Watch Points**: source alpha versus decoder premultiplication; atlas padding; origin versus anchor; per-layer fallback desynchronization; shared texture destruction; failure cached as permanent absence; lossy images cannot be reliable palette masks; stage mutations before stale-revision checks.

## Implementation Sequence

1. Freeze the format and compatibility fixtures; implement adapters with an actual game consumer and publication failure tests.
2. Unify playback, lifecycle ownership and actor/prop/tileset asset previews; reuse shared Hub tag construction.
3. Verify all mandatory ACs, remove superseded interpretations and hand off through the standard contract pipeline. C-505 and C-506 already landed against the earlier asset path — re-run their journeys as regression evidence rather than treating them as future consumers.

## Edge Cases & Gotchas

An atlas frame can legitimately alias another rectangle; that is not permission to emit a component twice. A known component without an attack clip is different from a failed network load. Texture byte compression does not measure decoded GPU memory. Do not unconditionally preserve every speculative upstream animation as a supported gameplay capability.

## Open Questions

- None

V1 color support and rotated-frame policy are deliberately bounded; future biome generation and advanced dyes are excluded.

## Amendments

| Version | Date | Change | Approved by |
|---|---|---|---|
| 2.0.0 | 2026-09-09 | Formal draft replaces backlog seed; adds shared visual/import/preview boundary | — |
| 2.0.1 | 2026-09-10 | Critic review: re-verified baseline line refs; recorded that `examples/**` is gitignored and that C-505/C-506 already landed; fixed AC-6 Production Path (`LpcPreview`), added the AC-4 rollback/backwards-compat clause and the release-lock data-model row, and extended the Reuse Map with the live engine clock/composer/tileset-atlas capabilities | — |

## Promotion Lifecycle

See [promotion lifecycle](SHARED_SECTIONS.md#promotion-lifecycle).

## Status Lifecycle

See [status lifecycle](SHARED_SECTIONS.md#status-lifecycle). This draft claims no implementation or verification.

## Execution Report

### Summary
Implemented the C-496 shared visual-format layer with production engine and
publication integration. A strict versioned TypeBox `VisualDefinition` schema
(identity/images/frames/clips/components/presentation/provenance, discriminated
by kind) with structural validation, and an LPC→definition adapter, compile
legacy/generic inputs into one validated definition. The engine now has a real
consumer of that definition plus the shared elapsed-time actor clock:
`AnimationController` was refactored from a frame-count clock to an
elapsed-time clock (wired to the real ticker delta in `game_world`), and a new
`visual_definition_playback` resolver plays any definition by elapsed time with
actor-level fallbacks. The catalog publish pipeline now writes a versioned
release pointer only after every required object, shard, seed file and the root
index are confirmed, so a failure preserves the previous complete release.
Added a user-facing docs page.

### AC Status
| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | `visual_definition.ts` schema + validator (15 pass) and `visual_adapter.ts` LPC compiler (5 pass) — invalid bounds/dup ids/unresolved refs/cyclic fallbacks/unsupported modes rejected before publication. |
| AC-2 | ⚠️ | Component schema carries rig/body/pose + stable passes (incl. rear `behind`) + deterministic order; LPC adapter emits explicit passes. Hub `buildLpcCatalog` regression is C-504-landed, not re-verified here. |
| AC-3 | ⚠️ | `visual_definition_playback` resolver consumes VisualDefinition + elapsed clock for generic/LPC/prop (5 pass). Full mixed-asset `/game` renderer composition not yet wired into a live scene. |
| AC-4 | ✅ | `release_lock.ts` (ReleasePointer + InstalledPackLock) + pipeline writes `index/v1/release.json` only after full success; failure-injection + release-pointer-preservation tests (13+ pass). `index/v1/` preserved. |
| AC-5 | ✅ | `AnimationController` replaced frame-count clock with the shared elapsed-time clock; wired to real ticker deltaMS in `game_world` (7 pass incl. 60Hz-vs-30Hz wall-clock equivalence). |
| AC-6 | ⚠️ | Engine resolves frames through the shared definition; preview hosts (`lpc_renderer`/hub `/catalog`) not yet re-pointed to the definition path; no visual capture evidence. |
| AC-7 | ❌ | No resource/perf regression report or repeated mount/unmount/offline-reload evidence produced. |

### Files Created
| File | Purpose |
|---|---|
| `packages/shared/schemas/src/lib/visual/visual_definition.ts` | Shared visual definition schema + validator |
| `packages/shared/schemas/src/lib/visual/visual_definition.test.ts` | AC-1 tests |
| `packages/shared/schemas/src/lib/catalog/release_lock.ts` | ReleasePointer + InstalledPackLock schemas |
| `packages/shared/lpc/src/lib/visual_adapter.ts` | LPC→definition adapter |
| `packages/shared/lpc/src/lib/elapsed_time.ts` | Elapsed-time actor clock |
| `packages/shared/lpc/tests/visual_adapter.test.ts` | Adapter tests |
| `packages/shared/lpc/tests/elapsed_time.test.ts` | Clock tests |
| `packages/frontend/engine/src/rendering/visual_definition_playback.ts` | Engine consumer of VisualDefinition + clock |
| `packages/frontend/engine/src/rendering/visual_definition_playback.test.ts` | Playback resolver tests |
| `apps/frontend/docs/src/content/docs/features/visual-asset-authoring.md` | User-facing authoring reference |

### Files Modified
| File | Change |
|---|---|
| `packages/shared/schemas/src/index.ts` | Export visual definition + release lock |
| `packages/shared/lpc/src/index.ts` | Export adapter + clock |
| `packages/shared/lpc/src/lib/animation.ts` | Export `FRAMES_PER_STATE`, `LPC_STATE_NAMES` |
| `packages/frontend/engine/src/rendering/animation_controller.ts` | Elapsed-time clock replaces frame-count clock |
| `packages/frontend/engine/src/rendering/animation_controller.test.ts` | Added elapsed-time 60/30Hz equivalence test |
| `packages/frontend/engine/src/rendering/index.ts` | Export playback resolver |
| `packages/frontend/engine/src/game_world.ts` | Wire real ticker deltaMS into AnimationController |
| `scripts/src/lib/catalog/pipeline.ts` | Block release pointer on shard/seed failure; write versioned release pointer |
| `scripts/src/lib/catalog/__tests__/fixtures.ts` | Add seed files to fixtures |
| `scripts/src/lib/catalog/__tests__/publish.test.ts` | Add AC-4 release-pointer tests |
| `scripts/src/lib/catalog/__tests__/thumbnail_generation.test.ts` | Add seed files to fixture |
| `docs/contracts/C-496-shared-visual-assets-and-playback.md` | Status → implemented; this report |

### Deviations from Spec
- AC-3 and AC-6 are structurally advanced (engine consumes the shared
  definition and elapsed clock; frame resolution + fallbacks are unit-tested)
  but the live mixed-asset scene renderer and the preview hosts are not fully
  re-pointed to the definition path, and the mandatory `/game` E2E + visual
  capture evidence (AC-3/AC-6/AC-7) was not produced in this session.
- AC-7 (resource/regression report, allocation/memory observations, repeated
  mount/unmount/offline-reload) not completed.
- Proposed Amendment: a follow-up wires `lpc_renderer`/`lpc_preview_view_model`
  and the Hub detail preview to `visual_definition_playback`, adds the live
  mixed-asset `/game` renderer path, and produces the required screenshots +
  allocation report.

### Test Results
- Unit schemas visual: 15/15 pass
- Unit lpc: 77/77 pass
- Unit engine rendering: 20/20 pass (incl. elapsed-time clock)
- Unit scripts catalog: 73/73 pass (incl. AC-4 release pointer)
- Visual/E2E: not run (deferred ACs — no production-path captures)
- Baseline: 0 new failures across the delivered suites.

### Handoff
Handed off for independent verification. AC-1, AC-4, AC-5 fully implemented and
unit-tested with production-path wiring; AC-2/AC-3/AC-6 structurally advanced
with engine consumers; AC-7 and full visual evidence deferred per the proposed
amendment. Verify, then decide on the amendment before promoting to `verified`.
