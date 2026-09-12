---
id: C-507
title: "Map studio Phase 2 — native scene visual editor and export"
source: direct
contract_type: full
status: implemented
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-09-12T00:00:00Z"
---

# Contract C-507: Map studio Phase 2 — native scene visual editor and export

## Metadata

| Field | Value |
|---|---|
| **Source** | `docs/guides/map_studio.md` "later phases" + `docs/plans/emberwatch_rebuild.md` remaining work, 2026-09-12 |
| **Target** | `packages/frontend/engine/src/assets/scene/` (editor core), `apps/frontend/hub/src/lib/views/map_studio/` (editor MVP) |
| **Type** | full |
| **Priority** | P1 — Phase 1 preview is stable; editing is the next gate before a map-editor contract can exist |
| **Dependencies** | C-505 (canonical scene format, strict validation, native import/export) |
| **Status** | implemented |
| **Promotion** | `sandbox` |
| **Docs Impact** | user-facing — extend `docs/guides/map_studio.md` and the scene-format guide |
| **Contract version** | 2.0.0 |
| **Production Surface** | `/map-studio` (public hub route) |

## Problem & Baseline Evidence

- **Current behavior**: Phase 1 of the hub map studio is preview-only. `map_studio_view_model.svelte.ts` owns manifest text, a CDN resolver and a `MapPreviewViewModelInterface`; there is no way to mutate a scene. The guide states plainly: "**Not yet:** editing the map visually, saving or publishing a manifest, per-user drafts."
- **Reproduction**: open `/map-studio`, paste a manifest, and note there is no tool palette, no click-to-edit, no undo, and no export. The only output is re-rendered pixels.
- **Existing implementation to reuse**: C-505 already ships the canonical `SceneDocument` (`packages/shared/schemas/src/lib/game/scene.ts`), strict validation (`scene_validator.ts`), the compiler (`scene_compiler.ts`), native parse/serialize/hash (`native_scene.ts` — `parseNativeScene`, `serializeScene`) and the unified loader (`scene_loader.ts`). The preview renders compiled scenes through the same loader. None of that needs replacing; this contract adds a mutation layer above it.
- **Known gaps**: no editor document model, no selection, no tool/undo semantics, no write path back to a valid `aikami.scene`, and the hub canvas has no interaction handling. There is no map-editor contract yet.
- **Baseline tests**: `packages/frontend/engine/src/assets/scene/*.test.ts` (41 scene tests), `apps/frontend/hub/src/lib/views/map_studio/__tests__/sample_manifest.test.ts`, `apps/frontend/hub/src/lib/constants/routes.test.ts`.

## User Outcome

After this contract, a creator can open a manifest at `/map-studio`, turn on editing, select a tool, paint ground and collision, place/move/delete props and transitions, undo/redo every change, and export a valid native `aikami.scene` that the game and the studio both load again.

## Success Measures

- **Time/latency target**: each edit re-compiles and re-renders through the existing preview in under one animation frame for the 12×9 sample; edits are never compiled per idle frame (C-505 AC-6 preserved).
- **Offline/degraded behavior**: editing, undo/redo and export work with no network. An invalid manifest surfaces the loader's real error verbatim and does not enter edit mode; the studio never crashes.
- **Production journey enabled**: `/map-studio` → edit → export produces a document that re-imports through `loadScene`/`parseNativeScene` without errors.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Canonical scene shape | `packages/shared/schemas/src/lib/game/scene.ts` | reuse |
| Strict validation | `packages/frontend/engine/src/assets/scene/scene_validator.ts` | reuse |
| Compile to render layers | `packages/frontend/engine/src/assets/scene/scene_compiler.ts` | reuse |
| Native parse/serialize/hash | `packages/frontend/engine/src/assets/scene/native_scene.ts` | reuse |
| Unified loader / adapters | `packages/frontend/engine/src/assets/scene/scene_loader.ts`, `tiled_adapter.ts` | reuse |
| Live preview render | `packages/frontend/preview/src/lib/map/map_preview_view_model.svelte.ts` | reuse |
| Studio VM + view | `apps/frontend/hub/src/lib/views/map_studio/` | modify |
| Scene module barrel | `packages/frontend/engine/src/assets/scene/scene_index.ts`, `src/sim.ts` | modify (export editor core) |

## Overview

Add a pure, testable editor core next to the C-505 scene module and wire a visual-editing MVP into the existing hub studio. The editor core owns a validated `SceneDocument`, exposes stable edit operations with snapshot-based undo/redo, and serializes back through `serializeScene`. The hub reuses the Phase 1 preview as the renderer: after every edit the VM feeds the serialized document to the same `setManifestText` path, so preview and game still share one interpretation. Publishing and per-user persistence are deliberately out of scope.

## Design Reference

- `packages/frontend/engine/src/assets/scene/scene_index.ts` — module boundary for the new `scene_editor.ts`.
- `packages/frontend/preview/src/lib/map/map_preview_view_model.svelte.ts` — the renderer the editor drives; `setManifestText` is the edit→preview bridge.
- `apps/frontend/hub/src/lib/views/map_studio/map_studio_view_model.svelte.ts` — MVVM shape, dynamic `@aikami/frontend-preview` import, `registerEffectRoot` lifecycle.
- `.pi/skills/svelte-conventions/SKILL.md` — zero-logic views, ViewModel factories.

## Architecture Directives

1. **One document authority.** The editor mutates a `SceneDocument`; export goes through `serializeScene`. The editor never invents a second grid, palette or collision model.
2. **Pure core, engine-hosted.** Editor logic lives beside the scene module as framework-free TypeScript (no PixiJS, no Svelte), reachable via `@aikami/frontend-engine/sim`. Views keep zero logic per the MVVM rules.
3. **Preview is the renderer.** No second render path. Every committed edit produces native scene text and is handed to the existing preview loader.
4. **Stable identity.** Placements/transitions keep stable string ids; ids are never derived from array order or pixel position (C-505 AC-3). New ids are deterministic and collision-free within the document.
5. **Fail closed.** An edit that would produce an invalid document (e.g. palette index out of range, duplicate id) is rejected and leaves the previous document intact; export re-validates before serializing.

## State & Data Models

```ts
/** Discriminated editor tool selection. */
export type SceneEditorTool =
  | { kind: 'select' }
  | { kind: 'paint-ground'; frame: string }
  | { kind: 'erase-ground' }
  | { kind: 'toggle-collision'; blocked: boolean }
  | { kind: 'place'; component: string; frame: string }
  | { kind: 'delete' };

/** A placement/transition selection. */
export type SceneEditorSelection =
  | { kind: 'placement'; id: string }
  | { kind: 'transition'; id: string }
  | undefined;

/** Snapshot pair used for undo/redo (structured clones of the doc). */
export type SceneEditorSnapshot = { doc: SceneDocument; selection: SceneEditorSelection };
```

The concrete public surface (`SceneEditorInterface`) exposes: `document`, `selection`, `tool`, `canUndo`, `canRedo`, `dirty`; `setTool`, `select`, `paintGround`, `toggleCollision`, `addPlacement`, `movePlacement`, `removePlacement`, `addTransition`, `removeTransition`, `undo`, `redo`, `serialize`, `validate`. The hub holds a `SceneEditorInterface` built from the loaded manifest.

## Quality Requirements

- **Offline/degraded mode**: the editor core is synchronous and network-free; a manifest load failure keeps edit mode disabled and shows the loader error.
- **Accessibility/input**: tools and undo/redo are real `<button>`s with labels and `aria-pressed`; the canvas is not the only input surface (keyboard reachable toolbar).
- **Performance budget**: snapshot undo is bounded (max 50 entries); no compilation on idle frames.
- **Security/privacy**: no user data leaves the browser; no scripts from manifests are executed.
- **Persistence/migration**: no server persistence. Export is a local file download; no save format changes.
- **Cancellation/retry/idempotency**: loading a new manifest resets edit history deterministically.
- **Observability**: rejected edits surface a human-readable reason; export errors are not silent.

## Migration & Rollback

N/A — no persistent state changes. The editor only produces a new exported document; nothing is written to D1/R2 or to saves. Rolling back is deleting the feature and keeping Phase 1 preview behavior.

## Scope Boundaries

- **In Scope:** pure editor core (selection, tools, snapshot undo/redo, edit ops, serialize/validate); hub edit-mode toggle; baked-ground paint/erase and collision toggle; placement place/move/delete; transition add/remove; selection; undo/redo controls; native `aikami.scene` export/download; tests.
- **Out of Scope:** hub publish/upload (`validatePack`, version bump, asset upload); per-user drafts/persistence (D1/R2 or local drafts); auth; Tiled/JTON export; a separate map-editor contract; multi-cell brushes/stamps; new visual layer creation UI; region/biome compiler; changing the engine format or validator.
- **Deferred (honest gap):** the editor *core* supports terrain surfaces, but the hub preview does not yet resolve corner16 terrain frames — that needs the pack terrain + frame-map context loaded into the public studio. Editing a terrain-channel map in the hub therefore falls back to the native preview path (diagnostic fills) rather than real corner16 art. Baked surfaces (Tiled-derived maps, the studio sample) preview with real textures.

## Contract Size & Split Rule

Editor core (~1 file + tests), barrel/export edits, studio VM + view + tests, docs. Target under 15 files. If it grows beyond ~25 paths, split publish/persistence into a follow-on contract rather than shrinking the editor ACs. Never leave two scene authorities active.

## Acceptance Criteria

### AC-1: Enter edit mode on a loaded scene
**Given** a manifest loaded through Phase 1 (sample, paste, upload or published), **when** the creator enables edit mode, **then** the editor exposes a validated `SceneDocument` and the current tool, and no edit is possible until a scene is loaded. An invalid manifest keeps edit mode disabled and shows the loader's real error.

**Test Hooks**:
- Moon Task: `moon run engine:test`, `moon run hub:test`
- Integration: open `/map-studio`, paste the sample, toggle edit mode.
- E2E / Visual: outstanding — the hub browser/catalog tooling was not available in the implementation environment (see Execution Report). The `/map-studio` production route is the verifier's target.

**Watch Points**:
- Native-vs-legacy detection must reuse the loader, not a local `kind ===` check that drifts.
- Edit mode must reset when the manifest text changes underneath it.

### AC-2: Paint ground and collision
**Given** a loaded scene in edit mode, **when** the creator paints or erases a ground cell or toggles collision on a cell, **then** the document updates exactly one cell and the live preview re-renders through the real engine compile. Baked and terrain surfaces both reject an out-of-range cell without mutating the document.

**Test Hooks**:
- Moon Task: `moon run engine:test`
- Integration: paint a cell at `/map-studio` and confirm the preview changes and collision overlay reflects the toggle.
- E2E / Visual: outstanding (see Execution Report).

**Watch Points**:
- Baked palette index 0 is reserved empty; clearing a cell must not append a palette entry.
- Collision overrides are `{index, blocked}` pairs; writing the same index twice must not duplicate entries.
- Baked surfaces preview with real textures via the in-memory frames tilemap; terrain surfaces fall back to the diagnostic native path (corner16 preview is deferred — see Scope Boundaries).

### AC-3: Place, move and delete placements and transitions
**Given** a scene in edit mode, **when** the creator places a placement, moves an existing placement, deletes a placement, adds a transition, or removes a transition, **then** stable ids are assigned/preserved and the document contains no duplicate id. Selection identifies the affected placement/transition by id, not array index.

**Test Hooks**:
- Moon Task: `moon run engine:test`
- Integration: place a prop, move it, delete it at `/map-studio`.
- E2E / Visual: outstanding (see Execution Report).

**Watch Points**:
- Moving must not change the placement id (C-505 AC-3 — saves attach to id).
- Auto-generated ids must not collide with an existing `id` after a delete/re-add.

### AC-4: Undo and redo every edit
**Given** any sequence of edit operations, **when** the creator triggers undo then redo, **then** the document and selection return to identical states, `canUndo`/`canRedo` report correctly, and loading a new manifest clears history.

**Test Hooks**:
- Moon Task: `moon run engine:test`
- Integration: perform edits, undo them all, redo them all at `/map-studio`.
- E2E / Visual: outstanding (see Execution Report).

**Watch Points**:
- Snapshots must deep-clone; a shallow copy shares grid arrays and corrupts history.
- The undo cap must drop the oldest entry, never the newest.

### AC-5: Export a valid native scene that round-trips
**Given** edited content, **when** the creator exports, **then** the studio produces a native `aikami.scene` document that passes `parseNativeScene`/`validateScene` and re-imports through the loader with identical extent, surface, layers, placements and navigation. Export is disabled when the document is invalid.

**Test Hooks**:
- Moon Task: `moon run engine:test`
- Integration: export at `/map-studio`, re-upload the file, confirm it renders.
- E2E / Visual: outstanding (see Execution Report).

**Watch Points**:
- Frame names must stay logical names, never GIDs or global atlas positions.
- JSON key ordering must not change the canonical hash semantics (use `serializeScene`).

### AC-6: Editing is offline and never a boot dependency
**Given** no network, **when** the creator opens `/map-studio` and edits the sample, **then** all edit, undo/redo and export operations succeed; no network request is required for the editor itself.

**Test Hooks**:
- Moon Task: `moon run hub:test`
- Integration: block network in DevTools, edit the sample, export.
- E2E / Visual: outstanding (see Execution Report).

**Watch Points**:
- The editor must not call the catalog to enter edit mode.
- A missing catalog still leaves the embedded sample editable.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit | editor core load tests + hub VM tests | `apps/frontend/hub/src/lib/views/map_studio/map_studio_view_model.svelte.ts#HubMapStudioViewModel` | `scene_editor.test.ts`, `map_editor_utils.test.ts` |
| AC-2 | Unit | paint/collision + preview-bridge cases | `packages/frontend/engine/src/assets/scene/scene_editor.ts#SceneEditor` | `scene_editor.test.ts` |
| AC-3 | Unit | placement/transition edit cases | `packages/frontend/engine/src/assets/scene/scene_editor.ts#SceneEditor` | `scene_editor.test.ts` |
| AC-4 | Unit | undo/redo round-trip cases | `packages/frontend/engine/src/assets/scene/scene_editor.ts#SceneEditor` | `scene_editor.test.ts` |
| AC-5 | Unit | serialize→parse round-trip test | `apps/frontend/hub/src/lib/views/map_studio/map_studio_view_model.svelte.ts#HubMapStudioViewModel` | `scene_editor.test.ts` |
| AC-6 | Unit | offline sample edit journey | `apps/frontend/hub/src/lib/views/map_studio/map_studio_view_model.svelte.ts#HubMapStudioViewModel` | `map_editor_utils.test.ts` |

## Implementation Sequence

1. **Phase 1 (Core)**: add `scene_editor.ts` + barrel exports; unit tests for every operation, undo/redo and round-trip.
2. **Phase 2 (Integration)**: extend `HubMapStudioViewModel` with edit state/tools/export; add toolbar + palette + canvas pointer handling to `map_studio_view.svelte`; update `map_preview_view_model` clear behavior for variable canvas size.
3. **Phase 3 (Validation)**: `moon run engine:test`, `moon run hub:test`, `moon run engine:typecheck`, `moon run hub:typecheck`, lint; write the execution report.

## Edge Cases & Gotchas

- **Terrain vs baked**: a terrain surface cell holds a terrain id, a baked surface cell holds a palette index. The paint tool must branch on `surface.mode` and never cross-write.
- **Palette growth**: painting with a frame not present in the baked palette appends it; erasing never removes palette entries used elsewhere.
- **Empty scene**: a scene with zero placements can still be exported; the editor must not require a placement to exist.
- **Selection after delete**: deleting the selected item clears selection rather than dangling an id.
- **Undo across mode switches**: switching tools is not an edit and must not push history.

## Open Questions

None — the maintainer scoped this pass to visual editing + export, with publishing and persistence explicitly deferred to a later contract.

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
|---|---|---|---|
| 2.0.0 | 2026-09-12 | Initial visual-editor + export MVP draft | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

## Execution Report

### Summary

Added a pure, framework-free scene editor core (`scene_editor.ts`) beside the C-505 scene module and wired a visual-editing MVP into the hub's `/map-studio` route. The editor owns a validated `SceneDocument`, exposes paint/erase/collision/placement/transition tools with snapshot undo/redo, and exports native `aikami.scene` JSON. The hub reuses the Phase 1 preview as the single renderer: baked edits are handed to it as an in-memory frames tilemap (real catalog textures preserved) while the textarea reflects the serialized native document. Terrain-surface editing is supported by the core; its corner16 hub preview is explicitly deferred (needs pack terrain/frame context in the public studio).

### AC Status

| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | `createSceneEditor`/`createSceneEditorFromManifest` reject invalid docs and parse native + legacy manifests; hub `toggleEditing()` enters edit mode or surfaces the loader error. Engine + hub tests. |
| AC-2 | ✅ | Baked paint/erase appends/clears palette entries and rejects out-of-range cells; collision toggle is idempotent. `sceneDocumentToTilemap` feeds edits to the preview through the real `sceneFromTilemap` compile. Terrain cells are editable in the core; hub corner16 preview deferred. |
| AC-3 | ✅ | Placements/transitions get deterministic collision-free ids, survive moves, and are chosen by stable id. Selection clears on delete. |
| AC-4 | ✅ | Snapshot undo/redo round-trips every operation; 50-entry cap drops the oldest; `clearHistory` resets. |
| AC-5 | ✅ | `serialize()` validates then emits via `serializeScene`; export round-trips through `parseNativeScene` with identical extent/surface/placements/navigation/transitions. |
| AC-6 | ✅ | Editor core is synchronous and network-free; hub tests cover the embedded sample with no catalog. Full offline browser journey not run here. |

### Files Created

| File | Purpose |
|---|---|
| `packages/frontend/engine/src/assets/scene/scene_editor.ts` | Pure editor core: tools, selection, snapshot undo/redo, edit ops, preview tilemap bridge, native export. |
| `packages/frontend/engine/src/assets/scene/scene_editor.test.ts` | 20 tests: load, ground/collision, placements/transitions, undo/redo, round-trip, preview bridge. |
| `apps/frontend/hub/src/lib/views/map_studio/map_editor_utils.ts` | Pure hub helpers: canvas→cell, palette derivation, hit-testing. |
| `apps/frontend/hub/src/lib/views/map_studio/__tests__/map_editor_utils.test.ts` | 9 tests for the pure helpers. |
| `docs/contracts/C-507-map-studio-visual-editor.md` | This contract. |

### Files Modified

| File | Change |
|---|---|
| `packages/frontend/engine/src/assets/scene/scene_index.ts` | Export the editor core + factories + preview tilemap bridge. |
| `packages/frontend/preview/src/lib/map/map_preview_view_model.svelte.ts` | Added in-memory `tilemap` (outranks text), reactive `showCollision` setter, and full-canvas clear. |
| `packages/shared/schemas/src/lib/game/scene.ts` | Baked/visual palette entries may be the reserved empty string. |
| `apps/frontend/hub/src/lib/views/map_studio/map_studio_view_model.svelte.ts` | Edit-mode state, tool dispatch, undo/redo, export, preview sync. |
| `apps/frontend/hub/src/lib/views/map_studio/map_studio_view.svelte` | Edit toggle, tool palette, undo/redo/export controls, canvas pointer handling. |

### Deviations from Spec

1. **Hub terrain/corner16 preview deferred (scope, documented).** The core supports terrain surfaces, but the public studio has no pack terrain definitions or frame map, so a terrain-channel edit renders through the native diagnostic path instead of real corner16 art. Baked surfaces (Tiled-derived maps + the sample) preview with real textures. This is recorded in Scope Boundaries and the AC-2 Watch Points; a follow-up can load Emberwatch terrains into the studio page data.
2. **Regression fix required for AC-5 (C-505 boundary touch).** `SceneBakedSurfaceSchema.palette` and `SceneVisualLayerSchema.palette` required non-empty strings, but the C-505 adapter reserves palette index 0 as `''`. As a result `serializeScene` → `parseNativeScene` failed for *any* Tiled-derived baked scene, so native export could not round-trip without this change. Palette items are now `Type.String()`; every other non-empty-ID constraint is unchanged. Schemas suite (583) stays green.

### Test Results

- Engine full suite: **1254 pass / 3 fail / 1 error** — the 3 failures are the pre-existing environmental `emberwatch_content_audit` cases (missing `static/game-data` atlas/props artifacts in this worktree), documented in C-505. Scene module: **74 pass / 0 fail**, including 20 new editor tests.
- Shared schemas: **583 pass / 0 fail**; shared constants: **136 pass / 0 fail**.
- Preview suite: **9 pass / 0 fail**.
- Hub full unit suite: **113 pass / 0 fail** (16 files), including 9 new helper tests.
- Typecheck: engine ✅, preview ✅, schemas ✅, hub (svelte-check) ✅ — 0 errors.
- Lint (Biome): engine ✅, preview ✅, schemas ✅, hub ✅.
- Contract lint (`lint_contracts.ts --contract C-507`): **0 errors / 0 warnings**.
- E2E/Visual: not run — no hub catalog/browser tooling in this environment. The `/map-studio` production route and the named ViewModel/editor entry points are listed in the Evidence Matrix for the verifier.
