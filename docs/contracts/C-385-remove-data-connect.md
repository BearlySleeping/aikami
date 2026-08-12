---
id: C-385
title: "Remove Firebase Data Connect and rehome its three consumers"
source: "external data-layer review (docs/research/database-architecture-recommendation.md §2)"
status: draft
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-08-12"
---

# Contract C-385: Remove Firebase Data Connect

## Metadata

| Field | Value |
|---|---|
| **Source** | External data-layer review — `docs/research/database-architecture-recommendation.md` §2. Architecture: `docs/architecture/data-layer-target-architecture.md` (D-1, D-5). |
| **Target** | `apps/backend/firebase/dataconnect/` (deleted), `packages/frontend/dataconnect/` (deleted), `packages/shared/schemas/src/lib/generated-dataconnect/` (deleted), plus the three consumers and all config referencing them |
| **Priority** | P1 — Data Connect is excluded from every non-emulator mode, so its one product feature is silently broken in production. It is the largest single source of schema duplication and it blocks C-386. |
| **Dependencies** | C-383 (ships first — do not delete the connector before its auth directives are corrected, so the two changes are independently revertable). |
| **Status** | draft |
| **Promotion** | — |
| **Docs Impact** | internal → none |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: Firebase Data Connect defines 9 SQL tables mirroring Firestore collections, generates a TypeScript SDK and a set of TypeBox row schemas, and is consumed in exactly three places. `apps/backend/firebase/firestack.config.ts:21` sets `dataconnectDirectory: '_EXCLUDE_'` for every mode except `emulator`, so none of it is deployed.
- **Reproduction**:
  1. Build and deploy the hub to production. Sign in. Open `/personas`.
  2. The page renders an empty list. The `+page.server.ts` load function catches the Data Connect failure and returns `{ personas: [] }`, so the failure is invisible to the user and appears only in logs.
- **Existing implementation to reuse**:
  - Local save persistence already exists: the `saves` table in the local SQLite schema (`slot_id`, `campaign_id`, `timestamp`, `map_name`, `payload`) plus `apps/frontend/client/src/lib/services/campaign_storage.svelte.ts` patterns.
  - The C-373 asset registry (`packages/frontend/storage/src/lib/assets.ts`, tables `assets` / `asset_sources` / `install_state`) already models a catalog of static media with multiple backends — this is the right home for audio tracks.
  - Firebase Storage save blobs (`saves/{uid}/slot_{n}.json`) already work and are owner-scoped in `storage.rules`. Keep them.
- **Known gaps**: There is no server-side Postgres and none is provisioned (see `docs/architecture/data-layer-target-architecture.md` D-7). Consumers must therefore be rehomed to the device plane or to static assets — **not** to a new cloud database.
- **Baseline tests**: `bun moon run firebase:test`, `bun moon run hub:test`, `bun moon run client:test-unit`, `bun moon run frontend-storage:test`. All must pass before starting.

## User Outcome

After this contract, a **developer** can read the data layer without
encountering a third store that mirrors the other two, and the hub no longer
ships a route that is broken in production.

## Success Measures

- **Time/latency target**: Client boot and combat-music selection must not regress. Audio track lookup becomes a local map read (from a network round trip), so it should improve.
- **Offline/degraded behavior**: Improves — audio track resolution and save-slot listing become fully local and no longer require network.
- **Production journey enabled**: Removes a production-broken route and unblocks C-386.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Save blob storage | Firebase Storage `saves/{uid}/slot_{n}.json` | reuse unchanged |
| Save slot metadata | `SaveSlot` DC table via `game_state_sync.svelte.ts` | replace → local `saves` table |
| Audio track catalog | `AudioTrack` DC table via `GetTracksByMood` | replace → static JSON catalog |
| Hub persona feature | `apps/frontend/hub/src/routes/(authenticated)/personas/` | delete (D-5 — hub is public/community only) |
| Local SQLite `saves` table | `packages/frontend/storage/src/lib/storage_adapter.ts` | reuse |

## Overview

Delete Firebase Data Connect in its entirety — schema, connector, generated
SDK, generated row schemas, codegen scripts, config, ports, and the
server-side service wrapper — and rehome its three consumers. Save-slot
metadata moves to the local `saves` table (the blob path in Firebase Storage
is unchanged). Audio tracks move to a static JSON catalog. The hub's persona
feature is deleted outright, per the decision that the hub is public and
community-facing only.

## Design Reference

`docs/architecture/data-layer-target-architecture.md` — D-1 (removal), D-5
(hub scope), D-7 (no Postgres yet). Follow existing local-storage service
patterns in `apps/frontend/client/src/lib/services/` for the save-slot
rehoming, and `packages/shared/schemas/src/lib/game/` for the audio catalog
TypeBox schema.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- **Do not introduce a new cloud datastore.** No Postgres, no new Firestore
  collection, no Turso cloud. Consumers move to the device plane or to static
  assets. Anything that cannot move to one of those two homes is out of scope
  and must be recorded under Open Questions instead of improvised.
- Delete rather than deprecate. No compatibility shims, no re-export stubs,
  no `@deprecated` wrappers. There are no external consumers of these modules.
- The hub keeps its Elysia API and session-cookie auth exactly as they are.
  This contract removes a route; it does not restructure the hub.

## State & Data Models

Audio track catalog — a new static JSON file plus its TypeBox schema:

```ts
/** One playable track in the static audio catalog. */
export type AudioTrackEntry = {
  id: string;
  title: string;
  /** Free-form mood tag. Multiple entries may share a mood. */
  mood: string;
  /** Path relative to the game-data root, resolved by the asset registry. */
  assetPath: string;
};

/** The catalog file shape: static/game-data/audio_tracks.json */
export type AudioTrackCatalog = {
  version: number;
  tracks: readonly AudioTrackEntry[];
};
```

Save-slot metadata moves onto the existing `saves` table. No new columns are
required: `slot_id`, `campaign_id`, `timestamp`, `map_name` already cover
`slotNumber`, `lastLocationName` and `updatedAt`. `playedTimeSeconds` and
`storageRef` are carried inside the existing `payload` JSON column.

> If a new column is genuinely required, it MUST be added as a new numbered
> migration per C-384 — never by editing migration 1.

## Quality Requirements

- **Offline/degraded mode**: Both rehomed consumers become fully offline-capable. The dev save/load view lists slots from the local database; only blob upload/download still needs network, and must fail gracefully with the existing error surface.
- **Accessibility/input**: N/A — no new UI. The deleted hub route removes UI only.
- **Performance budget**: Audio track lookup must be a synchronous in-memory map read after first load. No per-combat network request.
- **Security/privacy**: Deleting the connector removes the `PUBLIC` operation surface entirely. Verify no Data Connect credential or emulator host remains in any config after deletion.
- **Persistence/migration**: No user data exists in Data Connect — it was never deployed. Nothing to migrate. Local `saves` rows are untouched.
- **Cancellation/retry/idempotency**: Unchanged — save/load retry behavior is inherited from the existing Storage paths.
- **Observability**: Removing `seedAudioTracks` removes its log lines. The new static catalog load should log once at `debug` with the track count.

## Migration & Rollback

- **Old data compatibility**: N/A — Data Connect holds no production data (never deployed) and no emulator data worth preserving (reseeded on every `bun run emulate`).
- **Migration**: None required.
- **Rollback**: `git revert` the merge commit. Because the change is a deletion plus two self-contained rehomings, revert restores the previous state exactly. No data is destroyed by either direction.
- **Feature flag or kill switch**: N/A — no runtime toggle. The change is compile-time.
- **Failure recovery**: N/A — no migration step can fail partway.

## Scope Boundaries

- **In Scope — delete these paths entirely:**
  - `apps/backend/firebase/dataconnect/` (all 7 files: `dataconnect.yaml`, `schema/schema.gql`, `schema/schema-refactor-decisions.md`, `schema/firestore-vs-dataconnect.md`, `connector/queries.gql`, `connector/connector.yaml`, `migrations/persona_one_active.sql`)
  - `packages/frontend/dataconnect/` (whole package, including `src/lib/generated/`)
  - `packages/shared/schemas/src/lib/generated-dataconnect/`
  - `apps/backend/firebase/scripts/generate_dataconnect_schemas.ts`
  - `packages/backend/firestore/src/lib/firebase_data_connect_service.ts`
  - `packages/frontend/engine/src/sync/firebase_sql_connect_sync.ts` (already stale — references a `string_registry` table that does not exist in `schema.gql`)
  - `packages/frontend/configs/src/lib/data_connect.ts`
  - `apps/frontend/hub/src/routes/(authenticated)/personas/` (whole route)
  - `apps/frontend/hub/src/lib/client/services/dataconnect/` (whole directory)
  - `apps/frontend/hub/scripts/verify_persona_dataconnect.ts`
  - `apps/frontend/hub/scripts/browser_verify_personas.ts`
- **In Scope — edit these:**
  - `apps/backend/firebase/firestack.config.ts` — remove the `dataconnectDirectory` line and its comment.
  - `apps/backend/firebase/moon.yml` — remove the `generate` and `generate-dataconnect-schemas` tasks.
  - `apps/backend/firebase/package.json` — remove the `generate` and `generate:dataconnect-schemas` scripts.
  - `apps/backend/firebase/scripts/on_emulate.ts` — delete `seedAudioTracks` and its call; keep `uploadAudioAssets` only if the static catalog references Storage URLs, otherwise delete it too (see AC-3).
  - `packages/shared/constants/src/lib/development_ports.ts` — remove the `dataconnect: 9398` entry and its line in the port-allocation comment block.
  - `packages/shared/constants/src/lib/emulator.ts` — remove `EMULATOR_DATACONNECT_URL` and `getAuditLogsQueryUrl` if unused.
  - `apps/frontend/hub/moon.yml` — remove `frontend-dataconnect` from `dependsOn`.
  - `apps/frontend/hub/package.json` — remove `pg` and `@types/pg` (the only consumers were the two deleted verify scripts).
  - `packages/frontend/services/src/lib/services/game_state_sync.svelte.ts` — rehome per AC-2.
  - `apps/frontend/client/src/lib/views/combat/combat_view_model.svelte.ts` — rehome per AC-3.
  - Any navigation entry linking to the deleted `/personas` hub route.
- **Out of Scope:**
  - Provisioning Cloud SQL or writing any Postgres code (D-7 — a later contract).
  - The local Postgres dev environment (C-387).
  - Removing Firestore (C-386).
  - Changing the hub's Elysia API, session handling, or auth.
  - Building the community catalog feature.
  - Any change to the local SQLite schema beyond what AC-2 strictly requires.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** Not split, despite the file count. Deleting Data
Connect while leaving a consumer pointed at it does not compile; rehoming a
consumer while leaving Data Connect in place leaves two competing code paths
live — the exact condition the split rule says to avoid. The three ACs must
land together.

## Acceptance Criteria

### AC-1: No Data Connect reference remains anywhere in the repository

**Given** the deletions and edits in Scope are complete
**When** the repository is searched
**Then** each of the following returns **zero** matches outside `node_modules`, `bun.lock`, `docs/research/`, `docs/architecture/`, and `docs/contracts/`:

```bash
grep -rn "data-connect\|dataconnect\|dataConnect\|DataConnect" \
  --include='*.ts' --include='*.svelte' --include='*.json' \
  --include='*.yml' --include='*.gql' \
  apps packages scripts | grep -v node_modules
```

**And** `bun install` succeeds, `bun moon run :typecheck` passes across the workspace, and `bun moon run :lint` reports no unused-import or unresolved-import errors.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Integration | CI: `bun moon ci` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run :typecheck` then `bun moon run :lint`
- Integration: `bun install --frozen-lockfile` must succeed after the workspace package is removed. The lockfile will change — commit it.

**Watch Points**:
- 🔴 Removing the `packages/frontend/dataconnect` workspace package requires updating `bun.lock`. Run `bun install` (not `--frozen-lockfile`) once to regenerate, then commit the lockfile.
- The historical docs under `apps/backend/firebase/dataconnect/schema/*.md` are deleted with the directory. `docs/architecture/data-layer-target-architecture.md` already records that it supersedes `firestore-vs-dataconnect.md`, so the decision history is preserved — do not resurrect those files elsewhere.
- Check `.pi/`, `.github/workflows/`, `cloudbuild.yaml` and `apps/e2e/` for Data Connect references as well; the grep above covers them only if the paths are included, so run it from the repository root without a path filter as a final sweep.

### AC-2: Save slots list and persist without Data Connect

**Given** a signed-in user in the dev save/load view (`apps/frontend/client/src/lib/views/dev/save_load/`)
**When** they save to slot 1, reload the app, and list slots
**Then** slot 1 appears with its location name and timestamp, and loading it restores the ECS snapshot

**Constraints**:
- The ECS blob path (Firebase Storage `saves/{uid}/slot_{n}.json`) is **unchanged**.
- Slot metadata is read from and written to the local `saves` table.
- `game_state_sync.svelte.ts` keeps its public interface (`saveGame`, `loadGame`, `listSlots`, `deleteSlot`) so callers do not change.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit | `packages/frontend/services/src/lib/services/__tests__/game_state_sync.test.ts` | `/dev/save-load` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run frontend-services:test`
- Integration: `bun herdr:start client` in emulator mode, open the dev save/load view, save → reload → list → load.

**Watch Points**:
- `listSlots` previously took `{ uid }` because rows were multi-tenant in Postgres. The local database is single-tenant by construction (it is the user's own device — no table carries a `uid` column). Keep the `uid` parameter in the signature for the Storage path, but do **not** add a `uid` column to the local `saves` table.
- Do not add cloud slot listing "for later". If the user reinstalls, slots come back from Storage via a future restore feature, not from this contract.

### AC-3: Combat music resolves moods from a static catalog

**Given** the combat view model requests tracks for mood `"epic"`
**When** the catalog is queried
**Then** at least one track is returned without any network request, and combat music plays as before

**Constraints**:
- Catalog lives at `apps/frontend/client/static/game-data/audio_tracks.json`, validated by a TypeBox schema in `packages/shared/schemas/src/lib/media/`.
- It must cover every mood currently mapped in `on_emulate.ts` → `trackMappings`: `epic`, `tense`, `heroic`, `foreboding`, `triumph`, `sorrow`, `mysterious`, `peaceful`.
- Track files resolve through the existing C-373 asset registry where possible; a direct `static/game-data/` path is acceptable if registry integration proves larger than this contract.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Unit | `apps/frontend/client/src/lib/views/combat/__tests__/combat_view_model.test.ts` | `/game` combat encounter | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test-unit`
- Integration: Start a combat encounter in emulator mode and confirm music plays.

**Watch Points**:
- An unknown mood must degrade to a documented default rather than throwing or returning silence. Pick one track as the fallback and assert it in a test.
- After deleting `seedAudioTracks`, check whether `uploadAudioAssets` still has a consumer in `on_emulate.ts`. If the static catalog points at bundled files, delete `uploadAudioAssets` too and remove the now-unused `pg` dynamic import. Leaving a dead uploader that no longer feeds anything is a partial completion.

### AC-4: The hub builds, deploys, and serves without the personas route

**Given** the personas route, its services, and its verify scripts are deleted
**When** the hub is built and started
**Then** the build succeeds, `/dashboard` renders, `/personas` returns 404, and no navigation element links to it

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | E2E | `apps/e2e/tests/hub/*.spec.ts` | `/dashboard` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run hub:build` then `bun moon run hub:test`
- Integration: `bun herdr:start hub` in emulator mode; sign in; confirm `/dashboard` renders and no dead link to `/personas` exists.
- E2E / Visual:
    - **Functional**: Update any existing hub spec that navigates to `/personas`. If a spec exists solely to cover personas, delete it.
    - **Visual**: N/A — a route deletion has no visual surface to assess.

**Watch Points**:
- 🔴 `apps/frontend/hub/src/lib/client/services/api/auth.svelte.ts` and `hooks.server.ts` are **not** part of the personas feature. Do not delete them — the hub still needs session auth for `/dashboard`.
- Deleting `frontend-dataconnect` from the hub's `moon.yml` `dependsOn` is required, but leave the other entries alone; `frontend-storage` and `frontend-firestore` are addressed in C-386, not here.

## Implementation Sequence

1. **Phase 1 (Rehome consumers first)**: Implement AC-2 and AC-3 **while Data Connect still exists**, so each rehoming can be tested against a working baseline. Do not delete anything yet.
2. **Phase 2 (Delete hub feature)**: AC-4 — remove the personas route, services, and verify scripts.
3. **Phase 3 (Delete Data Connect)**: Remove the directories, packages, generated output, codegen scripts, and the server-side service wrapper.
4. **Phase 4 (Config sweep)**: `firestack.config.ts`, both `moon.yml` files, both `package.json` files, `development_ports.ts`, `emulator.ts`, `on_emulate.ts`. Run `bun install` and commit the lockfile.
5. **Phase 5 (Validation)**: The AC-1 grep from the repository root, then `bun moon run :typecheck`, `bun moon run :lint`, the four baseline test suites, and finally `bun run emulate` + `bun herdr:start client hub` to confirm both apps boot clean.

## Edge Cases & Gotchas

- **Phase ordering is load-bearing.** Deleting Data Connect first would leave the consumers uncompilable and make it impossible to test a rehoming against a working baseline. Follow the sequence.
- **`firestack generate` is entirely Data Connect.** `apps/backend/firebase/package.json` defines it as `firestack generate --dataconnectDirectory dataconnect`, so removing both generate tasks removes no other capability. Verify nothing else invokes `firebase:generate` — check `cloudbuild.yaml` and `.github/workflows/`.
- **Port 9398 appears in a comment table** in `development_ports.ts` as well as in the `FB_EMULATOR_PORTS` object. Remove both.
- **`getAuditLogsQueryUrl`** in `emulator.ts` references the Data Connect emulator's audit worker. Grep for callers before deleting; if it has none, delete it, and if it does, record it under Open Questions.
- **The `saves` table has no `uid` column and must not gain one.** The local database is the user's own device. Multi-tenancy there is a Data Connect concept that should not survive the migration.

## Open Questions

Must be resolved before status becomes `approved`:

- Does `getAuditLogsQueryUrl` (`packages/shared/constants/src/lib/emulator.ts`) have any caller? If yes, what depends on the Data Connect audit worker, and does that capability need to survive?
- Do the audio track files referenced by the new static catalog exist as bundled assets under `apps/frontend/client/static/game-data/`, or only as emulator Storage uploads from `apps/backend/firebase/assets/audio/`? If only the latter, the catalog must either reference Storage URLs or the files must be bundled — decide before implementing AC-3.

## Amendments

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

---
