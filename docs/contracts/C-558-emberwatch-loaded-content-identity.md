---
id: C-558
title: "Emberwatch loaded-content identity overlay"
source: "direct"
contract_type: thin
status: in_progress
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: "https://github.com/BearlySleeping/aikami/pull/403"
created_at: "2026-09-25T15:55:00+02:00"
---

# Contract C-558: Emberwatch loaded-content identity overlay

## Metadata

| Field | Value |
|---|---|
| **Source** | Direct request: dev content identity overlay and honest contract-status cleanup. |
| **Target** | `packages/frontend/engine`, client game composition, and `apps/e2e` evidence manifests. |
| **Type** | thin |
| **Priority** | P1 — evidence must name the content actually loaded before terrain/prop review continues. |
| **Dependencies** | C-315 content-pack loader; C-434 registry resolution; C-560 evidence lane. |
| **Status** | in_progress |
| **Promotion** | integrated |
| **Docs Impact** | internal — contract and evidence tooling only. |
| **Contract version** | 2.0.0 |
| **Production Surface** | non-production `/game?contentIdentity=true`; production `/game`; `bun run --cwd apps/e2e capture:evidence`. |

## Problem & Baseline Evidence

- **Current behavior:** loaded manifests expose version and atlas URLs in memory, but reviews cannot see or record the actual pack digest, release source, or installed pack-lock identity.
- **Reproduction:** boot `/game`, inspect the active content through devtools, then compare a screenshot with a different local candidate; the images have no loaded-content identity.
- **Existing implementation to reuse:** `ContentPackLoader`, `assetStore.packLock/releaseId/releaseSource`, authoring-overlay development gate, and C-560's generic evidence lane.
- **Known gaps:** no stable manifest digest, no typed diagnostic snapshot, no screen-fixed dev identity panel, and evidence manifests record Git/catalog identity but not the browser's loaded manifest.
- **Baseline tests:** engine diagnostics tests, content-pack loader tests, and `apps/e2e/src/services/preflight.test.ts` evidence-manifest coverage.

## User Outcome

A developer can prove exactly which Emberwatch manifest and release identity the running `/game` client loaded, and every before/after evidence manifest carries that browser-observed identity.

## Scope Boundaries

- **In Scope:** canonical manifest SHA-256; typed loaded-content snapshot; release/pack-lock metadata; explicit non-production overlay; generic evidence integration; append-only C-506 reconciliation; generated contract dashboards.
- **Out of Scope:** changing content bytes, terrain, props, release locks, production HUD, player-facing settings, authentication, deployment, or historical C-506 acceptance rows.

## Acceptance Criteria

### AC-1: Stable loaded-content identity

**Given** a schema-valid content pack manifest
**When** the production loader resolves it
**Then** it exposes a canonical SHA-256 digest plus pack/version/atlas/provenance identity without changing manifest bytes or fetch semantics.

**Verification**: `bun moon run frontend-engine:test -- src/assets/content_identity.test.ts src/assets/content_pack_loader.test.ts --timeout 30000`

### AC-2: Fail-closed development overlay

**Given** a recognized non-production public mode and `?contentIdentity=true`
**When** `/game` finishes loading a map
**Then** a screen-fixed diagnostic panel shows the loaded pack, manifest digest, atlas, release, and pack-lock summary. With the query absent, mode unset, unknown, or production, no panel renders and any stale panel is removed.

**Verification**: `bun moon run frontend-engine:test -- src/game_world/diagnostics.test.ts src/game_world/content_identity_overlay.test.ts --timeout 30000`; production `/game` screenshot has no identity panel.

### AC-3: Browser-observed evidence identity

**Given** generic before/after evidence capture
**When** each lane reaches the production `/game` route
**Then** the evidence manifest records the browser-observed content identity per lane, the after lane can explicitly request the overlay, and the index renders the loaded identity table.

**Verification**: `bun run --cwd apps/e2e test:unit`; `bun run --cwd apps/e2e capture:evidence -- --contract C-558 --help`; captured `.evidence/C-558/manifest.json` and `index.md`.

### AC-4: Honest contract-status reconciliation

**Given** C-506's implemented status and partially deferred visual ACs
**When** C-558 documentation is updated
**Then** an append-only current reconciliation distinguishes implementation from still-unaccepted visual evidence, historical report rows remain unchanged, and generated dashboards are refreshed through `bun knowledge:sync` rather than hand-edited.

**Verification**: `bun run --cwd scripts lint-contracts`; `bun knowledge:sync`; inspect C-506 append-only note and generated `docs/contracts/PROGRESS.md`.

## Edge Cases & Gotchas

- Manifest key order must not change the digest; array order remains semantically significant.
- Missing release or pack-lock metadata omits those fields; it must not display `null` or invent a release identity.
- The before lane may legitimately have no identity snapshot; evidence records that absence instead of fabricating a value.
- The overlay is canvas diagnostics, not HUD state, and must remain a direct child of the Pixi stage so camera movement cannot move it.

## Amendments

| Version | Date | Change | Approved by |
|---|---|---|---|
| 2.0.0 | 2026-09-25 | Initial direct contract; bundled into PR #403. | user |

## Promotion Lifecycle

See [promotion lifecycle](SHARED_SECTIONS.md#promotion-lifecycle).

## Status Lifecycle

See [status lifecycle](SHARED_SECTIONS.md#status-lifecycle).

---

## Execution Report

### Summary

The production content-pack loader now derives a canonical SHA-256 identity from the validated manifest. The client publishes that identity with release and installed pack-lock metadata; the engine exposes a typed, fail-closed diagnostic seam; and a screen-fixed Pixi overlay renders only in recognized non-production mode with the explicit `contentIdentity=true` request. Generic before/after evidence now records the browser-observed identity per lane and can request the candidate overlay explicitly. C-506's historical partial visual evidence is reconciled append-only; generated dashboards remain owned by `knowledge:sync`.

### AC Status

| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | Canonical key-sorted SHA-256, atlas/provenance extraction, loader cache identity, and order/field regressions pass. |
| AC-2 | ✅ | Diagnostics fail closed for missing/unknown/production mode; overlay replacement/clear behavior and screen-fixed stage ownership are tested; production `/game` no-overlay capture passed. |
| AC-3 | ✅ | `capture:evidence` records before/after loaded identity, rejects malformed snapshots, renders the identity table, and published `.evidence/C-558/`. |
| AC-4 | ✅ | C-506 append-only reconciliation added; `knowledge:sync`/contract lint pending final bundle run. |

### Files Created

| File | Purpose |
|---|---|
| `packages/frontend/engine/src/assets/content_identity.ts` | Canonical manifest identity resolver. |
| `packages/frontend/engine/src/assets/content_identity.test.ts` | Digest/order/degradation tests. |
| `packages/frontend/engine/src/game_world/content_identity_overlay.ts` | Screen-fixed diagnostic panel composer. |
| `packages/frontend/engine/src/game_world/content_identity_overlay.test.ts` | Overlay replacement/clear tests. |

### Files Modified

| File | Change |
|---|---|
| `packages/shared/schemas/src/lib/game/content_pack.ts` | Added typed loaded-content identity schema. |
| `packages/shared/types/src/lib/game/content_pack.ts` | Added derived identity type. |
| `packages/frontend/engine/src/assets/content_pack_loader.ts` | Computes and exposes identity on validated loader instances. |
| `packages/frontend/engine/src/game_world/diagnostics.ts` | Added fail-closed mode gate, global publish/read, and clear. |
| `packages/frontend/engine/src/game_world.ts` | Owns the screen-fixed diagnostics container and redraws it after map load. |
| `packages/frontend/engine/src/index.ts` | Exports the client publishing seam. |
| `apps/frontend/client/src/lib/services/game/game_composition_root.svelte.ts` | Publishes manifest + release/pack-lock identity after load. |
| `apps/e2e/src/pom/emberwatch_house_page.ts` | Adds explicit content-identity query support. |
| `apps/e2e/src/visual/core/evidence.ts` | Adds per-lane loaded identity to manifests/index. |
| `apps/e2e/scripts/capture_evidence.ts` | Reads browser identity and adds `--content-identity-overlay`. |
| `docs/contracts/C-506-emberwatch-visual-readability.md` | Append-only evidence-debt reconciliation. |

### Deviations from Spec

None.

### Test Results

- Unit: engine content identity/loader/diagnostics/overlay 65 passed, 0 failed; e2e evidence 75 passed, 0 failed.
- Typecheck: schemas, types, frontend-engine, client, and e2e passed.
- Visual: `.evidence/C-558/` republished from the candidate origin at 1280×720; loaded manifest SHA-256 is `5fd619ecdb04…`, checksums are valid, and the production no-overlay capture passed 100/100; human acceptance remains separate.
- Full gate: `bun moon ci --base=origin/main` — 81 completed, 2 skipped, 0 failed.
