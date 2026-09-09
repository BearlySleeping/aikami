---
id: C-496
title: "Shared visual assets, atlas import and playback"
source: direct
contract_type: full
status: draft
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-09-09T00:00:00Z"
---

# Contract C-496: Shared visual assets, atlas import and playback

## Metadata

| Field | Value |
|---|---|
| **Source** | Formalizes the C-496 seed in `BACKLOG_C485_PLUS.md`; maintainer asset review, 2026-09-09 |
| **Target** | `packages/shared/schemas/`, `packages/shared/lpc/`, `packages/frontend/engine/`, `packages/frontend/preview/`, client/Hub consumers and `scripts/src/lib/catalog/` |
| **Type** | full |
| **Priority** | P1 — replace inferred geometry and divergent asset interpretations |
| **Dependencies** | C-504; increment B also consumes the normalized scene adapter from C-505 |
| **Status** | draft |
| **Promotion** | — |
| **Docs Impact** | user-facing — visual asset authoring reference in `apps/frontend/docs/src/content/docs/` |
| **Contract version** | 2.0.0 |
| **Production Surface** | `/game` and Hub `/catalog/[category]/[tag]` asset previews |

## Problem & Baseline Evidence

Audit baseline (re-check before implementation):

- `packages/frontend/engine/src/game_world.ts:3532` loads only `walk`; `packages/shared/lpc/src/lib/sheet_geometry.ts` guesses 64/128px layout from image dimensions.
- `packages/frontend/preview/src/lib/lpc/lpc_renderer.ts` silently substitutes other animation sheets. Preview ViewModels recreate sprites/textures while playing and maintain additional interpretations of frames and colors.
- `build_catalog.ts` derives rear passes from `bg_`, while the collector also produces `/behind` and published data includes `_bg`. `appearance.ts` discards variant roles when projecting the catalog.
- Upstream `examples/Universal-LPC-Spritesheet-Character-Generator/sheet_definitions/` carries body mappings, layer ordering, animation availability and palette information; filenames alone are not a sufficient compatibility contract.
- Catalog entries carry identity/hash/credits but no complete visual description. The index upload loop can continue to publish the root after a shard failure; seed publication failure does not affect its final success decision.
- Baselines: existing LPC, prop texture resolver, texture manager, catalog publication and preview lifecycle tests. Capture the current normal game and Hub preview before replacing either path.

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
| Hosts | `packages/frontend/preview/`, `game_world.ts` | thin UI/camera hosts over shared render logic |
| Publishing | `scripts/src/lib/catalog/` | retain content-addressed R2 objects and credits |
| Scene normalization | C-505 | consume in increment B; do not duplicate map parsing |

## Overview

Introduce a small versioned visual definition and compile supported inputs into it. Separate common image/frame primitives from actor, component and tileset-specific rules. The renderer consumes validated data, never provider prompts or generator-specific conventions.

## Design Reference

Use C-504 named identities and existing resolver injection. See [execution guide](../plans/visual_asset_foundation.md) and [shared testing conventions](SHARED_SECTIONS.md#testing-conventions). This supersedes the C-496 backlog seed as the executable specification; it does not make LPC the permanent required player art style.

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

Read legacy LPC and atlas inputs through adapters, then use the same validated definition. Preserve old published assets/releases and aliases. Gate new formats by schema/capability version; old clients retain their compatible release. Never publish a definition that references unavailable bytes. Cache keys include immutable revision. A conversion failure leaves the previous valid installation selected, not a partially rewritten pack. Publishing requires separate explicit authorization; normal tests use local/pinned fixtures.

## Scope Boundaries

- **In Scope:** shared visual schema/adapters, metadata fidelity, validated publication, deterministic playback/layer composition, frame/color inspection, faithful preview integration and lifecycle cleanup.
- **Out of Scope:** biome scattering, generative houses, generation-provider integration, arbitrary custom-node execution, new gameplay equipment slots, skeletal animation, advanced lighting, indexed/material dye shaders, wholesale replacement of LPC art, a global renderer rewrite.

## Contract Size & Split Rule

One cross-host interpretation invariant, delivered in two compatible increments:

- **A / PR 2:** AC-1–AC-4. Publishable definition/import boundary and a real `/game` consumer for both legacy and generic assets. Keep other hosts on compatible adapters. Target 40–65 files.
- **B / PR 4:** AC-5–AC-7 after C-505. Shared steady-state playback and all preview consumers; remove superseded interpretations. Target 45–70 files.

C-505 may use increment A's merged, tested schema/API without claiming all C-496 criteria have passed. C-496 remains `in_progress` after A; only all mandatory ACs permit `implemented`, then independent verification. At 75 changed paths reassess; at 85 stop for a split plan. No PR reaches 100 files.

## Acceptance Criteria

### AC-1: Validated format supports non-LPC frames
**Given** legacy LPC, a generic atlas with unequal trimmed frames, and a static prop, **when** imported, **then** definitions preserve origins, timing, alpha and logical identities. Invalid bounds, duplicate IDs, unresolved references, cyclic fallbacks and unsupported modes fail before publication/allocation.

### AC-2: Modular metadata survives the entire path
**Given** a component with rear/front parts and declared rig/pose compatibility, **when** selected and normalized, **then** all required parts render once in deterministic order. Invalid combinations are rejected with actionable diagnostics. Tests cover `/behind`, prefix/suffix legacy conventions and equal-depth ties independent of async load order.

### AC-3: Mixed assets render in the real game
**Given** one LPC actor, one generic animated actor and a prop, **when** the scene requests available and missing clips, **then** they render together with stable origins and declared fallbacks. Visual bounds do not change authoritative collision or hit timing.

### AC-4: Publication is revision-consistent
**Given** a new release and injected failure at each required object/shard/seed/pointer step, **when** publishing or retrying, **then** readers see the old complete release or the new complete release, never mixed revisions. Duplicate uploads are safe and attribution gates remain intact. Test offline install from a pinned release.

### AC-5: Animation and appearance lifecycle are shared
**Given** variable frame rates, rapid equipment changes, delayed loads and disposal, **when** playing, **then** elapsed-time animation, roles and fallback policy agree across hosts. Stale loads cannot clear newer sprites, recolor/tint has consistent semantics, and steady frames allocate no new render objects.

### AC-6: Previews show actual production assets
**Given** actor/prop/tileset assets and a C-505 scene, **when** opened in Hub/client previews and `/game`, **then** frame selection, alpha, origin, ordering and supported color operations agree. Map preview uses the normalized scene and real tiles, not placeholder rectangles. Isolation does not secretly add fallback body layers.

### AC-7: Resource usage and regressions are demonstrated
**Given** repeated preview mount/unmount, scene transitions, cache reuse and offline reload, **when** measured, **then** owned resources return to the established baseline, shared textures survive while referenced, and missing/retried loads remain diagnosable. Record the normal game and preview screenshots plus allocation/memory observations.

**Evidence Matrix**:

| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit + import integration | real small atlas/LPC fixtures and invalid inputs | `scripts/src/lib/catalog/pipeline.ts#runCatalogPublish` | Required for A |
| AC-2 | Integration + visual | compatibility and multi-pass matrix | `/game` | Required for A |
| AC-3 | E2E + visual | mixed-asset scene at gameplay scale | `/game` | Required for A |
| AC-4 | Integration | failure-injection release tests and offline install | `scripts/src/lib/catalog/pipeline.ts#runCatalogPublish` | Required for A |
| AC-5 | Unit + compiled lifecycle | timing, race and ownership regressions | `/game` | Required for B |
| AC-6 | E2E + visual | matching host captures with resolved IDs | `packages/frontend/preview/src/lib/map/map_preview.svelte` | Required for B |
| AC-7 | E2E + performance | repeated lifecycle/resource report | `/game` | Required for B |

**Test Hooks**: existing engine/preview/LPC/catalog test lanes; production Playwright journeys under `apps/e2e/tests/client/` and `apps/e2e/tests/hub/`; visual suites under `apps/e2e/src/visual/suites/`. Use compiled Svelte testing for reactive behavior. Run affected-project validation at each increment boundary.

**Watch Points**: source alpha versus decoder premultiplication; atlas padding; origin versus anchor; per-layer fallback desynchronization; shared texture destruction; failure cached as permanent absence; lossy images cannot be reliable palette masks; stage mutations before stale-revision checks.

## Implementation Sequence

1. Approve the format and compatibility fixtures; implement increment A with the actual game consumer and publication failure tests.
2. Let C-505 normalize scenes against that merged boundary.
3. Implement increment B, verify all consumers, then remove redundant frame/timing parsers and record evidence.

## Edge Cases & Gotchas

An atlas frame can legitimately alias another rectangle; that is not permission to emit a component twice. A known component without an attack clip is different from a failed network load. Texture byte compression does not measure decoded GPU memory. Do not unconditionally preserve every speculative upstream animation as a supported gameplay capability.

## Open Questions

- None. V1 color support and rotated-frame policy are deliberately bounded; future biome generation and advanced dyes are excluded.

## Amendments

| Version | Date | Change | Approved by |
|---|---|---|---|
| 2.0.0 | 2026-09-09 | Formal draft replaces backlog seed; adds shared visual/import/preview boundary | — |

## Promotion Lifecycle

See [promotion lifecycle](SHARED_SECTIONS.md#promotion-lifecycle).

## Status Lifecycle

See [status lifecycle](SHARED_SECTIONS.md#status-lifecycle). This draft claims no implementation or verification.
