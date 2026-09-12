---
id: C-508
title: "Map studio Phase 3 — per-user drafts and community map publishing"
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

# Contract C-508: Map studio Phase 3 — per-user drafts and community map publishing

## Metadata

| Field | Value |
|---|---|
| **Source** | `docs/contracts/C-507-map-studio-visual-editor.md` Scope Boundaries (publish + persistence deferred) |
| **Target** | `apps/frontend/hub/src/lib/server/api/` (drafts + publish), `packages/backend/database` (D1), `packages/shared/schemas` (wire shapes + document gate), `apps/frontend/hub/src/lib/views/map_studio/` (UI) |
| **Type** | full |
| **Priority** | P1 — Phase 2 editing/export is stable; creators have nowhere to save or share work |
| **Dependencies** | C-507 (editor + export), C-505 (canonical scene), C-426 (D1/R2 + session), C-381 (`validatePack`) |
| **Status** | implemented |
| **Promotion** | `sandbox` |
| **Docs Impact** | user-facing — extend `docs/guides/map_studio.md` |
| **Contract version** | 1.0.0 |
| **Production Surface** | `/map-studio` (public hub route) + `/api/maps/*` (Elysia) |

## Problem & Baseline Evidence

- **Current behavior**: C-507 lets a creator edit a scene and *download* a native `aikami.scene` file, then loses everything on reload. There is no draft persistence and no way to share an edited map with other players. C-507 explicitly lists "hub publish/upload (`validatePack`, version bump, asset upload)" and "per-user drafts/persistence" as out of scope.
- **Reproduction**: open `/map-studio`, edit the sample, refresh the page — the edit is gone and there is no save or publish control.
- **Existing implementation to reuse**: Better Auth session guards and the D1/R2 binding pattern (`save_backup.ts`, `storage.ts`), the D1 `packs`/`pack_versions` precedent for content-addressed rows, the `validatePack` structured gate (C-381), canonical `SceneDocumentSchema` (C-505), and the Phase 1/2 studio preview/editor. None of that is replaced.
- **Known gaps**: no `map_drafts` table, no community map store, no publish endpoint, no client service, and the studio has no draft/publish UI.
- **Baseline tests**: hub unit suite (125 tests), `pack_validation.test.ts`, `scene_editor.test.ts`, `map_editor_utils.test.ts`.
- **Architecture constraint discovered**: the curated catalog is a **CI-owned static R2 index** written only by `scripts/src/lib/catalog/publish.ts` and read by the hub over `CATALOG_ORIGIN_URL`. A public Worker must not mutate that index. This contract therefore adds a **hub-served community namespace** (D1 metadata + the catalog bucket for bytes) rather than writing into the curated index.

## User Outcome

A signed-in creator can save the scene they are editing as a private draft, reopen it later, and publish it as a community map with a monotonically increasing revision. Published community maps appear alongside curated maps in the `/map-studio` picker and load back into the editor. Terrain-channel (corner16) maps preview with real atlas art instead of the diagnostic fallback.

## Success Measures

- **Offline/degraded behavior**: `/map-studio` still boots with the embedded sample and no network. Drafts and publishing require the hub and degrade to a clear message when unauthenticated or unconfigured; they are never a boot dependency.
- **Production journey enabled**: `/map-studio` → edit → **Save draft** → reload → **Load draft**; and `/map-studio` → edit → **Publish** → another browser loads the community map from the picker.
- **Validation gate**: an invalid document is rejected with structured issues and never reaches D1/R2; a supplied source-pack context runs C-381 `validatePack` before upload.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Session guard | `apps/frontend/hub/src/lib/server/api/save_backup.ts` | reuse pattern |
| D1 + R2 bindings | `apps/frontend/hub/src/lib/server/api/*.ts`, `app.d.ts` | extend (`CATALOG_BUCKET`) |
| Canonical scene shape | `packages/shared/schemas/src/lib/game/scene.ts` | reuse |
| Pack validation | `packages/shared/schemas/src/lib/game/pack_validation.ts` | reuse |
| Typed public revision keys | `packages/shared/schemas/src/lib/storage/keys.ts` | extend (`communityMapKey`) |
| Publish pipeline (curated) | `scripts/src/lib/catalog/publish.ts` | untouched — community publish is separate |
| Studio VM + view | `apps/frontend/hub/src/lib/views/map_studio/` | modify |
| Corner16 compile | `autotile.ts`, `scene_compiler.ts`, `scene_loader.ts` | reuse |
| Preview renderer | `packages/frontend/preview/src/lib/map/map_preview_view_model.svelte.ts` | modify (terrains + atlas frame map) |

## Overview

Add two owner-scoped D1 tables (`map_drafts`, `community_maps`), a shared wire-shape module plus a pure, engine-free document gate, and a set of session-gated `/api/maps/*` handlers. Drafts store the native scene document inline; publishing uploads the document to `CATALOG_BUCKET` at `community/{slug}/{revision}.json`, records an immutable revision, and exposes a public listing. The studio gains a drafts/publish panel and merges community maps into its existing published-map picker. Separately, this contract closes C-507's deferred corner16 gap: the preview accepts pack terrain definitions and an explicit atlas frame map, and the studio page loads both from the pack manifest.

## Design Reference

- `apps/frontend/hub/src/lib/server/api/map_studio.ts`
- `apps/frontend/hub/src/lib/client/services/map_studio_client.ts`
- `apps/frontend/hub/src/lib/views/map_studio/map_studio_view_model.svelte.ts`
- `packages/shared/schemas/src/lib/game/community_map.ts`, `map_draft.ts`
- `packages/frontend/preview/src/lib/map/map_preview_view_model.svelte.ts`

## Architecture Directives

1. **The curated catalog is read-only from the hub.** Publishing writes only the community namespace; the static index stays CI-owned.
2. **One document authority.** Drafts and published documents are native `aikami.scene` JSON validated by the same `SceneDocumentSchema` the engine uses; no second scene shape is introduced.
3. **Owner-scoped data.** Every draft read/write filters on the Better Auth user id; a wrong owner gets 404, never another user's document.
4. **Fail closed.** Invalid documents are rejected with structured issues before any R2/D1 write. A failed row write deletes the just-uploaded object.
5. **Immutable revisions.** Re-publishing a slug appends a new revision; a slug owned by another user is never overwritten.
6. **Preview reuse.** Terrain preview reuses the existing autotiler/preview path — no second renderer.

## State & Data Models

```ts
/** A private, owner-scoped studio draft. */
type MapDraft = {
  id: string; name: string; document: string; createdAt: string; updatedAt: string;
};

/** A published community map revision. */
type CommunityMapSummary = {
  slug: string; title: string; revision: number;
  documentHash: string; sizeBytes: number; createdAt: string; updatedAt: string;
};

/** The pure document gate result. */
type CommunityMapValidationResult = {
  valid: boolean; mapId?: string;
  issues: { code: string; path: string; message: string }[];
};
```

D1 tables: `map_drafts` (`owner_account_id` FK `user.id` CASCADE) and `community_maps` (`owner_account_id` FK RESTRICT, unique slug/revision pair, positive revision). R2 key: `community/{slug}/{revision}.json` in `CATALOG_BUCKET`.

## Quality Requirements

- **Offline/degraded mode**: drafts/publish are hub calls; their absence never blocks the studio preview or export.
- **Accessibility/input**: draft and publish controls are labelled `<button>`/`<input>` elements, keyboard reachable.
- **Security/privacy**: no cross-owner draft reads; documents are validated before storage; no scripts from documents are executed; community R2 objects are public immutable revisions keyed by their public slug and revision and are discoverable through public listing.
- **Performance**: document reads are single-row D1 lookups; no per-idle-frame work.
- **Persistence/migration**: additive migration only; no existing rows change.
- **Cancellation/retry/idempotency**: re-publishing is the documented update path; failed uploads leave no row.
- **Observability**: rejected documents surface machine-readable issue codes.

## Migration & Rollback

Additive migration `0007_map_studio_community.sql`. Rollback is dropping `community_maps`/`map_drafts` (community maps are not referenced by saves) and reverting the studio UI; the curated catalog is untouched.

## Scope Boundaries

- **In Scope:** `map_drafts` + `community_maps` tables and migration; shared wire schemas + pure document gate; drafts CRUD API; community publish/list/get API with `validatePack` gate and revision bump; `CATALOG_BUCKET` binding; client service; studio drafts/publish UI; community maps in the studio picker; corner16/atlas preview closure; tests.
- **Out of Scope:** writing into the curated static catalog index; moderation/visibility workflow; auth UI (`sign-in` lives elsewhere); deleting published community maps on account deletion beyond the FK; draft storage in R2; version-history browsing; local-device-only drafts.
- **Deferred (honest gap):** the pack-context `validatePack` gate runs only when the studio can synthesize a source-pack manifest (currently terrain definitions). Atlas provenance is not synthesized, so the frame-existence check is skipped for community publishes; curated publishing still runs the full gate. E2E browser journeys remain outstanding (no browser tooling in this environment).

## Contract Size & Split Rule

Three server/data files, two shared schema files, one client service, studio VM/view edits, migration, docs. Target under 20 paths. If moderation/version history grows, split it into a follow-on contract rather than expanding the publish ACs.

## Acceptance Criteria

### AC-1: Save, list, load and delete private drafts
**Given** a signed-in creator in `/map-studio`, **when** they save the current document as a draft, list drafts, load one, then delete it, **then** every operation is owner-scoped and round-trips the exact native `aikami.scene` document.

**Test Hooks**:
- Moon Task: `moon run hub:test`
- Integration: `/map-studio` → Save draft → reload → Load draft.
- E2E / Visual: outstanding (see Execution Report).

**Watch Points**:
- A signed-out visitor is rejected 401 and sees no drafts.
- Another user reading/deleting a draft gets 404, not 403.

### AC-2: Draft and publish documents are validated before storage
**Given** an edited document, **when** the creator saves or publishes, **then** the canonical `SceneDocumentSchema` plus cross-field invariants (grid length, unique ids, bounded navigation indices) run first; an invalid document returns 422 with structured issues and no D1/R2 write occurs.

**Test Hooks**:
- Moon Task: `moon run schemas:test`, `moon run hub:test`
- Integration: paste an invalid scene and save.
- E2E / Visual: outstanding.

**Watch Points**:
- Document size is bounded; oversized bodies are rejected 413.

### AC-3: Publishing runs the `validatePack` gate and bumps revisions
**Given** a valid document and optional source-pack context, **when** published (and re-published), **then** the C-381 gate reports errors as 422, a new immutable revision is appended for the same owner+slug, and a different owner cannot claim the slug (409).

**Test Hooks**:
- Moon Task: `moon run hub:test`
- Integration: publish twice; confirm revisions 1 then 2.
- E2E / Visual: outstanding.

**Watch Points**:
- A failed D1 write after the R2 put deletes the uploaded object.

### AC-4: Published documents are uploaded and served publicly
**Given** a successful publish, **when** the document is fetched, **then** it is available at `community/{slug}/{revision}.json` in the catalog bucket and served from the public `/api/maps/community/:slug` endpoint, with a sha-256 content hash on the summary.

**Test Hooks**:
- Moon Task: `moon run hub:test`
- Integration: publish, then GET the community endpoint and the R2 object.
- E2E / Visual: outstanding.

### AC-5: Community maps appear in the studio picker
**Given** published community maps, **when** the studio loads, **then** they are listed alongside curated maps and selecting one loads its document into the editor.

**Test Hooks**:
- Moon Task: `moon run hub:test`
- Integration: publish a map, then load it from the picker.
- E2E / Visual: outstanding.

### AC-6: Corner16/atlas terrain preview (closes the C-507 gap)
**Given** a terrain-channel scene and the pack terrain definitions + atlas frame map, **when** it is previewed or edited, **then** the preview compiles the terrain through the existing autotiler and samples real atlas frames; without that context it degrades gracefully.

**Test Hooks**:
- Moon Task: `moon run frontend-preview:test`, `moon run engine:test`, `moon run hub:test`
- Integration: open a terrain-channel map at `/map-studio`.
- E2E / Visual: outstanding.

**Watch Points**:
- The explicit atlas frame map must win over the numeric-suffix grid heuristic (corner16 frames are packed, not grid-indexed).
- A missing atlas descriptor must not blank the map.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit/Integration/E2E | drafts CRUD + ownership tests; UI edit-mode smoke | `apps/frontend/hub/src/lib/server/api/map_studio.ts#handleCreateDraft` | `map_studio.test.ts`, `apps/e2e/tests/hub/map_studio.spec.ts` |
| AC-2 | Unit/E2E | document gate tests; paint/undo/export journey | `packages/shared/schemas/src/lib/game/community_map.ts#validateCommunityMapDocument` | `community_map.test.ts`, `map_studio.test.ts`, `map_studio.spec.ts` |
| AC-3 | Unit/Integration | pack gate + revision tests | `apps/frontend/hub/src/lib/server/api/map_studio.ts#handlePublishCommunityMap` | `map_studio.test.ts` |
| AC-4 | Integration/E2E | R2 put + public get | `apps/frontend/hub/src/lib/server/api/map_studio.ts#handleGetCommunityMap` | `map_studio.test.ts`, `map_studio.spec.ts` |
| AC-5 | Unit/E2E | picker merge + client; community load branch | `apps/frontend/hub/src/lib/client/services/map_studio_client.ts` | `map_studio_client.test.ts`, `map_studio.spec.ts` |
| AC-6 | Unit/E2E | terrain/atlas preview tests; terrain paste smoke | `packages/frontend/preview/src/lib/map/map_preview_view_model.svelte.ts` | `map_preview_atlas.test.ts`, `map_preview_scene.test.ts`, `map_editor_utils.test.ts`, `map_studio.spec.ts` |

## Implementation Sequence

1. **Data**: migration + Drizzle tables + shared wire schemas + pure document gate.
2. **API**: drafts CRUD + community publish/list/get; env injection; tests.
3. **Client/UI**: client service; studio VM + view drafts/publish panel; picker merge.
4. **Terrain**: preview `terrains` + `setAtlas`; studio page pack context; VM threading.
5. **Validation**: typecheck, lint, hub/schemas/preview tests, contract lint, docs.

## Edge Cases & Gotchas

- **Elysia consumes the JSON body** before handlers run; handlers take the parsed `body` from the route context, not `request.json()`.
- **Slug collisions**: an explicit slug is 409 on another owner; a derived slug gains a short suffix.
- **Signed-out state**: drafts 401 must read as "no drafts", not an error banner.
- **Terrain vs baked**: both route through the in-memory tilemap bridge; terrain needs `terrains` + `baseTerrain` to compile.
- **Atlas frame names**: `earth_3.png` is a packed frame, not grid index 3 — only the explicit frame map resolves it correctly.

## Open Questions

None — scope is limited to drafts + community publishing + the deferred terrain preview; moderation and version history are follow-ons.

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
|---|---|---|---|
| 1.0.0 | 2026-09-12 | Initial drafts + community publishing + terrain preview draft | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

## Execution Report

### Summary

Added a hub-served community namespace for map-studio documents plus per-user drafts, and closed the C-507 corner16 preview gap. Drafts are owner-scoped D1 rows storing native scene JSON; publishing validates the document (canonical schema + cross-field invariants) and optionally runs C-381 `validatePack`, uploads the bytes to `CATALOG_BUCKET` at `community/{slug}/{revision}.json`, and appends an immutable revision per owner+slug. The studio gains a drafts/publish panel and merges community maps into its picker. The preview now accepts pack terrain definitions and an explicit atlas frame map so corner16 terrain renders with real art.

### AC Status

| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | Drafts CRUD owner-scoped; 401 signed-out; 404 cross-owner. Hub API tests + `/map-studio` edit-mode E2E. |
| AC-2 | ✅ | `validateCommunityMapDocument` gate (schema + cell counts + unique ids + navigation bounds) before storage; 10 schema tests + API 422 test. Paint→undo→export E2E. |
| AC-3 | ✅ | `validatePack` gate returns 422; same-owner re-publish bumps revision; cross-owner slug is 409. Hub API tests + API E2E (D1-gated). |
| AC-4 | ✅ | R2 `put` to `community/{slug}/{revision}.json`; public list/get served from D1; content hash persisted. Hub API tests + API E2E (D1-gated). |
| AC-5 | ✅ | Community maps merged into `publishedMaps` with a `community:` prefix; loader branches to the community endpoint. Client tests + UI E2E. |
| AC-6 | ✅ | Preview `terrains` + `setAtlas` + explicit frame map; studio page loads pack terrain/atlas; terrain paste E2E. |

### Files Created

| File | Purpose |
|---|---|
| `packages/backend/database/drizzle-d1/0007_map_studio_community.sql` | Additive migration for `map_drafts` + `community_maps`. |
| `packages/shared/schemas/src/lib/game/map_draft.ts` | Draft wire shapes. |
| `packages/shared/schemas/src/lib/game/community_map.ts` | Community wire shapes + pure document gate. |
| `packages/shared/schemas/src/lib/game/community_map.test.ts` | 10 document-gate tests. |
| `apps/frontend/hub/src/lib/server/api/map_studio.ts` | Drafts CRUD + community publish/list/get handlers. |
| `apps/frontend/hub/src/lib/server/api/tests/map_studio.test.ts` | 9 API tests. |
| `apps/frontend/hub/src/lib/client/services/map_studio_client.ts` | Typed client for drafts/publishing. |
| `apps/frontend/hub/src/lib/client/services/__tests__/map_studio_client.test.ts` | 3 client tests. |
| `apps/frontend/hub/src/lib/views/map_studio/map_studio_library.svelte.ts` | Composed rune library: drafts + community publishing state/methods. |
| `apps/frontend/hub/src/lib/views/map_studio/map_studio_types.ts` | Extracted VM public type surface (source-size budget). |
| `packages/frontend/preview/src/lib/map/map_preview_atlas.ts` | Atlas frame types + pure resolver. |
| `packages/frontend/preview/src/lib/map/map_preview_scene.ts` | Extracted pure scene load (terrains threaded). |
| `packages/frontend/preview/src/lib/map/__tests__/map_preview_atlas.test.ts`, `map_preview_scene.test.ts` | 8 preview tests. |
| `apps/e2e/tests/hub/map_studio.spec.ts` | Playwright: edit-mode/paint/undo/export UI journeys, terrain paste, and a D1-gated drafts/publish API journey. |
| `docs/contracts/C-508-map-studio-drafts-and-publishing.md` | This contract. |

### Files Modified

| File | Change |
|---|---|
| `packages/backend/database/src/lib/schema.ts` | `mapDrafts` + `communityMaps` tables and row types. |
| `packages/shared/schemas/src/lib/storage/keys.ts` | `communityMapKey` spec. |
| `packages/shared/schemas/src/index.ts` | Export the new schema modules. |
| `apps/frontend/hub/src/lib/server/api/index.ts` | Register `/maps/*` routes. |
| `apps/frontend/hub/src/routes/api/[...slugs]/+server.ts` | Inject `CATALOG_BUCKET`. |
| `apps/frontend/hub/src/app.d.ts` | Add `CATALOG_BUCKET` to `Platform.env`. |
| `apps/frontend/hub/src/lib/types/data.ts` | `MapStudioPageData` terrain/atlas fields. |
| `apps/frontend/hub/src/routes/(public)/map-studio/+page.server.ts` | Best-effort pack terrains/atlas load. |
| `apps/frontend/hub/src/lib/views/map_studio/map_studio_view_model.svelte.ts` | Drafts/publish delegation; terrain/atlas threading; reactive editor-state bridge (see Deviations). |
| `apps/frontend/hub/src/lib/views/map_studio/map_studio_view.svelte` | Drafts/publish panel. |
| `apps/frontend/hub/src/lib/views/map_studio/map_editor_utils.ts` | `parseAtlasFrames` helper. |
| `packages/frontend/preview/src/lib/map/map_preview_view_model.svelte.ts` | `terrains` + `atlas` support. |

### Deviations from Spec

1. **Community namespace instead of curated-index writes.** The curated catalog is CI-owned and read over `CATALOG_ORIGIN_URL`; a public Worker mutating it would break the static-index invariant. Community maps are therefore D1-indexed and hub-served, merged into the picker. Promote to the curated index remains a separate, reviewed pipeline step.
2. **`validatePack` gate uses client-supplied pack context.** The studio loads terrains but not atlas provenance; the gate therefore runs on a synthesized terrain-only manifest. Full provenance/frame checks still run for curated publishing. Documented in Scope Boundaries.
3. **C-507 editor reactivity fix (E2E-surfaced).** The Playwright smoke test found that entering edit mode never revealed the toolbar: `editorReady`/`canUndo`/… were getters over a non-reactive `_editor` field, so Svelte never re-ran those template blocks. Added a reactive `_editorRevision` signal plus editor-derived `$derived` state. This is a latent C-507 bug, not new C-508 scope.

### Test Results

- Shared schemas: new document-gate suite **10 pass / 0 fail**; storage-key suite **37 pass / 0 fail**; schemas typecheck ✅.
- Hub unit suite: **128 pass / 0 fail** (18 files), including 9 new API tests + 3 client tests + 3 new atlas-parser tests.
- Hub typecheck (svelte-check): ✅ 0 errors / 0 warnings.
- Preview: **17 pass / 0 fail** (4 files; includes 8 new terrain/atlas tests).
- Guards: source-file-size ✅, mvvm-conventions ✅, service-conventions ✅, database suite **9 pass / 0 fail**.
- Contract lint (`lint_contracts.ts --contract C-508`): **0 errors / 0 warnings**.
- E2E (Playwright, worktree hub `vite dev` + live catalog): Map Studio spec **3 pass / 1 skipped**. The UI journeys (edit mode, paint→undo→export, terrain paste) pass; the D1-backed drafts/publish API journey skips itself because the local dev server exposes no D1 bindings (the same skip the existing catalog spec documents), and runs under CI's `dev:worker`. The full hub project run was **9 pass / 2 skipped / 2 fail**; both failures are pre-existing catalog *data-pin* tests failing on live-catalog drift, unrelated to this change.
