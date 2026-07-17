# Contract C-321: Migrate Local Persistence to Turso as the Source of Truth

## Metadata

| Field | Value |
|---|---|
| **Source** | TODO.md § C-321 — Phase 1 — Playable, Polished, Offline-Capable Vertical Slice |
| **Target** | `packages/frontend/repositories` (`storage_adapter.ts`, `turso_storage_adapter.ts`, `AIKAMI_SCHEMA_DDL`, new browser WASM/OPFS adapter) + client repositories `campaign_repository.svelte.ts`, `game_save_service.svelte.ts`, `conversation_repository.svelte.ts` |
| **Priority** | P0 — "local-first on Turso" is a Non-Negotiable Directive; campaign/save/chat truth currently lives in ad hoc IndexedDB stores while the completed C-203 Turso adapter is not called from any production path |
| **Dependencies** | C-203 (completed — adapter + schema to build on), C-313 (implemented, promotion `sandbox` — Campaign aggregate; see risk note), packages: `@tursodatabase/database` (already a dependency), a libSQL/Turso WASM build for the browser (new dependency) |
| **Status** | verification_failed |
| **Promotion** | `integrated` |
| **Docs Impact** | internal → none |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: The C-203 storage layer (`LocalDatabaseInterface`, `TursoStorageAdapter`, `AIKAMI_SCHEMA_DDL`, `OpfsAssetCache` in `packages/frontend/repositories/src/lib/`) exists and is exported from the package root, but **zero production code paths call it**. All campaign-runtime truth is written to raw IndexedDB:
  - `apps/frontend/client/src/lib/services/campaign/campaign_repository.svelte.ts` — Campaign aggregate in IndexedDB DB `aikami_saves` v2, store `campaigns` (C-313).
  - `apps/frontend/client/src/lib/services/game/game_save_service.svelte.ts` — ECS snapshot `SaveDocument`s in IndexedDB DB `aikami_saves` v1, store `saves` (C-132).
  - `apps/frontend/client/src/lib/services/chat/conversation_repository.svelte.ts` — only a **type-level contract** (`ConversationRepositoryInterface.saveDialogueTurn()`); no durable local implementation exists, so NPC dialogue turns have no authoritative local store.
- **Reproduction**: Create a campaign in the client (emulator mode), open browser DevTools → Application → IndexedDB → `aikami_saves`. Campaign and save documents are there. No `aikami.db` SQLite/OPFS file exists; `grep -r "TursoStorageAdapter" apps/` returns no production call sites.
- **Existing implementation to reuse**:
  - `packages/frontend/repositories/src/lib/storage_adapter.ts` — `LocalDatabaseInterface`, `SqlQuery`, `QueryResult`, `AIKAMI_SCHEMA_DDL` (tables: `saves`, `characters`, `chat_history`, `string_registry`), `LOCAL_DB_FILE`.
  - `packages/frontend/repositories/src/lib/turso_storage_adapter.ts` — `TursoStorageAdapter` + `createTursoStorageAdapter()` (native `@tursodatabase/database`, Tauri/Node).
  - `packages/frontend/repositories/src/lib/opfs_asset_cache.ts` — OPFS access + `navigator.storage.persist()` pattern to copy for the browser adapter.
  - RisuAI OPFS storage patterns (`examples/web/Risuai/src/ts/storage/opfsStorage.ts`, `persistant.ts`) as design reference for the browser adapter.
- **Known gaps**:
  - No browser adapter — `TursoStorageAdapter` dynamic-imports a Node-native module that cannot run in a webview/browser.
  - `AIKAMI_SCHEMA_DDL` has no `campaigns` or `capability_profile` tables, and its `saves` table columns (`character_id`, `name`, `snapshot_json`) do not match the actual `SaveDocument` shape (`slotId`, `timestamp`, `mapName`, `payload`).
  - No IndexedDB → Turso import path for existing installs.
  - No platform selection logic (native vs WASM) at app boot.
- **Baseline tests** (run before starting):
  - `apps/frontend/client/src/lib/services/campaign/campaign_service.test.ts` — mocks IndexedDB in-memory; will need its mock swapped for a `LocalDatabaseInterface` fake.
  - `apps/frontend/client/src/lib/views/start/start_view_model.test.ts` — exercises `getSavePayload` error paths ("IndexedDB not available", "handles empty IndexedDB gracefully").
  - `apps/frontend/client/src/lib/services/game/session_service.test.ts` — IndexedDB persistence (out of scope to migrate, must not regress).
  - `apps/frontend/client/src/lib/test_preload.ts` — global IndexedDB polyfill for the test env.

## User Outcome

After this contract, a player can create a campaign, play, save, and chat with NPCs fully offline (browser or Tauri), fully restart the app, and have the campaign, its save envelope, and its chat history read back from the local Turso/libSQL database. A developer can rely on one `LocalDatabaseInterface` for all campaign-runtime persistence, and C-357 (cloud sync) has a single layer to attach to.

## Success Measures

- **Time/latency target**: Adapter open + DDL init adds < 500 ms to app boot; single-row campaign/save reads < 50 ms after open. No perceptible regression vs IndexedDB on the start-menu save list.
- **Offline/degraded behavior**: All reads/writes are local-only; `sync()` remains a no-op (no sync URL configured until C-357). If OPFS persistence is denied by the browser, the app still works but logs a warning (storage may be evicted).
- **Production journey enabled**: "Create campaign → play → save → restart app → Continue" works with zero network in both browser and Tauri, backed by SQLite, unblocking C-334 (reliable save/continue) and C-357 (Turso cloud sync).

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| `LocalDatabaseInterface` + `SqlQuery`/`QueryResult` | `packages/frontend/repositories/src/lib/storage_adapter.ts` | reuse |
| `AIKAMI_SCHEMA_DDL` | `packages/frontend/repositories/src/lib/storage_adapter.ts` | modify — add `campaigns`, `capability_profile`, `meta` tables; align `saves` columns with `SaveDocument` |
| Native Tauri adapter | `packages/frontend/repositories/src/lib/turso_storage_adapter.ts` | reuse |
| Browser WASM/OPFS adapter | — (does not exist) | new — same `LocalDatabaseInterface` |
| OPFS + `navigator.storage.persist()` handling | `packages/frontend/repositories/src/lib/opfs_asset_cache.ts` | reuse pattern |
| Campaign persistence | `apps/frontend/client/src/lib/services/campaign/campaign_repository.svelte.ts` | modify — same `CampaignRepositoryInterface`, Turso-backed internals |
| ECS save persistence | `apps/frontend/client/src/lib/services/game/game_save_service.svelte.ts` | modify — same `GameSaveServiceInterface`, Turso-backed internals |
| Dialogue turn persistence contract | `apps/frontend/client/src/lib/services/chat/conversation_repository.svelte.ts` | modify — add a concrete Turso-backed implementation of `ConversationRepositoryInterface` writing to `chat_history` |
| UI preference storage (idb-keyval) | `packages/frontend/services/src/lib/base/preference/indexed_db.ts` | reuse untouched — stays IndexedDB (non-authoritative) |
| Campaign schema/types | `packages/shared/schemas/src/lib/game/campaign.ts` (`CampaignSchema`, `CapabilityProfileSchema`), re-exported via `@aikami/types` | reuse |

## Overview

Finish what C-203 started: make the Turso/libSQL storage layer the single local source of truth for campaign-runtime data. Implement the missing browser WASM/OPFS adapter behind the existing `LocalDatabaseInterface`, extend `AIKAMI_SCHEMA_DDL` with the tables the Campaign aggregate needs, migrate the three authoritative client repositories (campaigns, game saves, dialogue turns) onto the adapter behind their unchanged public interfaces, and run a one-time IndexedDB → Turso import so upgrading users keep their campaigns. IndexedDB survives only for small, non-authoritative UI state.

## Design Reference

- `packages/frontend/repositories/src/lib/turso_storage_adapter.ts` — adapter class shape, `open()/close()` lifecycle, `create*` factory, `$logger` usage in module-level code, `_`-prefixed privates.
- `packages/frontend/repositories/src/lib/opfs_asset_cache.ts` — OPFS handle acquisition and persistent-storage request.
- `examples/web/Risuai/src/ts/storage/opfsStorage.ts` and `persistant.ts` — browser OPFS storage patterns.
- `apps/frontend/client/src/lib/services/campaign/campaign_repository.svelte.ts` — `BaseFrontendClass` repository pattern with interface + singleton export; keep this exact public surface.
- Contract C-203 (`docs/contracts/C-203-local-first-turso-sync.md`) — execution report documents the `@libsql/client` → `@tursodatabase/database` switch and the intended separate web WASM path.
- Contract C-313 — Campaign aggregate ownership; `CampaignSchema` in `packages/shared/schemas/src/lib/game/campaign.ts`.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

1. **Browser adapter** — new `packages/frontend/repositories/src/lib/wasm_storage_adapter.ts` (name indicative): a class implementing `LocalDatabaseInterface` backed by a libSQL/SQLite WASM build persisted to OPFS. Dynamic import of the WASM package is justified (massive library + platform-specific). Request `navigator.storage.persist()` on open; warn (never fail) when denied. Export from the package root `src/index.ts`.
2. **Platform selection / composition** — a single factory (e.g. `createLocalDatabase()` in `packages/frontend/repositories`) that picks the native `TursoStorageAdapter` when the Tauri runtime (and its Node/Rust binding path) is available and the WASM/OPFS adapter otherwise, then applies `AIKAMI_SCHEMA_DDL` idempotently (`CREATE TABLE IF NOT EXISTS`). The client owns one shared connection for the app session (opened lazily on first repository use, closed on app teardown) — repositories must not each open their own database file.
3. **Schema extension** — extend `AIKAMI_SCHEMA_DDL` in `storage_adapter.ts` with:
   - `campaigns` table matching the existing `Campaign` schema (id PK + full JSON payload + `updated_at` for sorting — mirror the current `CampaignDocument` shape),
   - `capability_profile` table keyed by campaign id (text/image/voice booleans, per TODO scope),
   - alignment of the `saves` table with the real `SaveDocument` shape (`slot_id`, `timestamp`, `map_name`, `payload`, plus `campaign_id` nullable for forward-compat with C-334),
   - a `meta` key/value table used for the one-time-import marker.
   No shared-schema package changes are required: `CampaignSchema`/`CapabilityProfileSchema` already exist in `packages/shared/schemas` and remain the source of truth for the JSON payloads.
4. **Repository migration** — rewrite the internals of `CampaignRepository`, `GameSaveService`, and a new concrete `ConversationRepository` (implementing the existing `ConversationRepositoryInterface` and writing player/NPC turns to `chat_history`) to call `LocalDatabaseInterface` via the shared factory. **Public interfaces (`CampaignRepositoryInterface`, `GameSaveServiceInterface`, `ConversationRepositoryInterface`) and singleton export names must not change** — no ViewModel or call-site edits beyond wiring the concrete conversation repository where dialogue turns complete (stream orchestrator in `apps/frontend/client/src/lib/services/ai/`).
5. **One-time import** — a module-level import routine (client, e.g. `apps/frontend/client/src/lib/services/persistence/indexeddb_import.ts`) that runs at app boot before the first repository read: if `meta.indexeddb_import_completed` is unset, read all documents from IndexedDB `aikami_saves` (`campaigns` + `saves` stores), insert-or-ignore them into Turso inside one `transaction()`, then set the marker. IndexedDB source data is left in place (rollback safety); the import is idempotent (marker + `INSERT OR IGNORE`).
6. **Boundaries** — no `+server.ts`/server routes (Pillar 1); no new types/schemas defined in `apps/` (Pillar 2); adapter code lives in `packages/frontend/repositories`; client-only wiring lives in `apps/frontend/client`. Classes extend `BaseFrontendClass`, instantiated via `.create()`; module functions log via `$logger`.

## State & Data Models

No new cross-boundary TypeScript types are introduced — `Campaign`, `CapabilityProfile` (from `@aikami/schemas`/`@aikami/types`), `SaveDocument`, and `ConversationMessage` already exist. New SQL shapes (conceptual DDL additions to `AIKAMI_SCHEMA_DDL`):

```sql
CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,            -- full Campaign JSON (validated by CampaignSchema)
  updated_at TEXT NOT NULL       -- ISO timestamp, mirrors Campaign.updatedAt for sorting
);

CREATE TABLE IF NOT EXISTS capability_profile (
  campaign_id TEXT PRIMARY KEY REFERENCES campaigns(id),
  text_provider INTEGER NOT NULL,
  image_provider INTEGER NOT NULL,
  voice_provider INTEGER NOT NULL
);

-- saves table realigned to SaveDocument
CREATE TABLE IF NOT EXISTS saves (
  id TEXT PRIMARY KEY,           -- KEY_PREFIX + slotId
  slot_id TEXT NOT NULL,
  campaign_id TEXT,              -- nullable; wired fully by C-334
  timestamp INTEGER NOT NULL,
  map_name TEXT NOT NULL,
  payload TEXT NOT NULL          -- serialized ECS snapshot JSON
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL            -- e.g. key 'indexeddb_import_completed' = '1'
);
```

`chat_history` (session_id, role, content, created_at) already exists in `AIKAMI_SCHEMA_DDL` and is reused as-is for dialogue turns. Conceptual adapter factory type (package-local, `type` alias):

```typescript
type LocalDatabaseFactoryOptions = {
  /** Overrides the default 'file:aikami.db' path (tests). */
  databasePath?: string;
  /** Forces a platform adapter instead of auto-detection (tests). */
  platform?: 'native' | 'wasm';
};
```

## Quality Requirements

- **Offline/degraded mode**: All operations are local; zero network required. `sync()` stays a configured no-op. OPFS persistence denial degrades to non-persistent storage with a logged warning, never a crash.
- **Accessibility/input**: N/A — no UI surface changes; existing start-menu/save UI is untouched.
- **Performance budget**: DB open + DDL ≤ 500 ms on boot; repository operations must not block the render loop (all async); WASM bundle loaded via dynamic import so it never inflates the initial chunk.
- **Security/privacy**: Local-only data, no new network egress. No secrets in the database. SQL uses bound parameters (`?` placeholders) exclusively — no string-interpolated SQL.
- **Persistence/migration**: Campaign/save/chat survive full app restart in browser and Tauri. One-time IndexedDB import is idempotent and non-destructive (source stores untouched).
- **Cancellation/retry/idempotency**: DDL is `IF NOT EXISTS`-idempotent; import uses `INSERT OR IGNORE` + marker inside a transaction — a crash mid-import re-runs cleanly on next boot; repository upserts are idempotent by primary key.
- **Observability**: Adapter open/close, platform selection, DDL application, and import (counts of imported campaigns/saves, skips, failures) logged via `$logger`/`this.debug()`; import failure logs `error` and leaves IndexedDB untouched.

## Migration & Rollback

- **Old data compatibility**: Existing IndexedDB `aikami_saves` data (`campaigns` v2 store, `saves` v1 store) is read by the one-time importer and copied into Turso. IndexedDB source data is not deleted in this contract.
- **Migration**: On boot, before first repository read: open Turso → apply DDL → if `meta.indexeddb_import_completed` unset, transactionally import campaigns + saves → set marker. Chat history has no prior authoritative IndexedDB store, so nothing to import for `chat_history`.
- **Rollback**: Revert the repository internals to the IndexedDB implementations (git revert) — all original data is still present in IndexedDB because the import is copy-only. Turso data written after the switch is lost on rollback; acceptable pre-release, noted for C-334.
- **Feature flag or kill switch**: The `createLocalDatabase()` factory reads an override (env/`import.meta.env` or a constant in `@aikami/constants`) allowing a build-time fallback to the legacy IndexedDB path during the rollout window; removed by C-324/C-334 once stable.
- **Failure recovery**: If adapter open or DDL fails, repositories surface the error to their existing error paths (start menu already handles `getSavePayload` failures); the import marker is only set after a fully committed transaction, so partial imports re-run.

## Scope Boundaries

- **In Scope:**
  - Browser WASM/OPFS adapter implementing `LocalDatabaseInterface` + platform-selecting factory in `packages/frontend/repositories`.
  - `AIKAMI_SCHEMA_DDL` extension: `campaigns`, `capability_profile`, `meta`, realigned `saves`.
  - Migrating `CampaignRepository` and `GameSaveService` internals to Turso behind unchanged public interfaces.
  - Concrete Turso-backed `ConversationRepositoryInterface` implementation writing dialogue turns to `chat_history`, wired where turns complete.
  - One-time, idempotent IndexedDB → Turso import with `meta` marker.
  - Unit/integration test updates replacing IndexedDB mocks with a `LocalDatabaseInterface` fake; new offline persistence E2E spec.
- **Out of Scope:**
  - Cloud sync, sync URLs, auth tokens, outbox, conflict policy (C-357).
  - `session_service.svelte.ts` session summaries, `draft_store.ts` drafts, `message_branch_store` alternatives, `choice_history_store` — remain IndexedDB (non-authoritative or migrated by C-334/C-344).
  - `idb-keyval` preference storage in `packages/frontend/services` (theme, volume, UI prefs) — explicitly stays.
  - Firestore-backed `npc_chat_repository.svelte.ts` cloud chat paths — untouched (retirement is C-324's concern).
  - Save/continue/autosave UX and campaign-scoped save wiring (C-334); deleting legacy IndexedDB data.
  - `OpfsAssetCache` binary asset caching — already built, unchanged.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** 5 ACs, 2 projects (`packages/frontend/repositories`, `apps/frontend/client`), one releasable system (local persistence layer). At the AC limit but a single coherent migration — the adapter, schema, repository switch, and import are not independently shippable (a browser adapter with no callers, or a repository switch without the import, would each strand users). No split.

## Acceptance Criteria

### AC-1: Browser WASM/OPFS Adapter Conforms to LocalDatabaseInterface
**Given** a browser environment (no Tauri, no Node-native modules)
**When** the WASM/OPFS adapter is created via the factory and `query`/`execute`/`transaction` are exercised against `AIKAMI_SCHEMA_DDL`-initialised tables
**Then** all operations succeed with parameter binding, `transaction()` rolls back atomically on statement failure, data persists across adapter close/reopen within the same OPFS origin, and `navigator.storage.persist()` has been requested (denial logged, not fatal).

### AC-2: Extended Schema Applies Identically on Both Adapters
**Given** a fresh database on either the native Tauri adapter or the WASM/OPFS adapter
**When** `AIKAMI_SCHEMA_DDL` is applied (twice, to prove idempotency)
**Then** `campaigns`, `capability_profile`, `meta`, `saves` (realigned columns), `characters`, `chat_history`, and `string_registry` tables exist with no errors on re-application, and a `Campaign` JSON payload round-trips through `campaigns` unchanged (validates against `CampaignSchema`).

### AC-3: Repositories Read/Write Through Turso Behind Unchanged Interfaces
**Given** a browser or Tauri session with no network
**When** a campaign is created (`CampaignRepository.create`), a game is saved (`GameSaveService.saveGame`), a dialogue turn is persisted (`ConversationRepository.saveDialogueTurn`), and the app is fully restarted
**Then** `CampaignRepository.getAll()`, `GameSaveService.fetchAvailableSaves()`/`getSavePayload()`, and the stored `chat_history` rows return the persisted data from the local Turso database — with no writes to the IndexedDB `aikami_saves` database — and no ViewModel/call-site type changes were required (`CampaignRepositoryInterface`, `GameSaveServiceInterface`, `ConversationRepositoryInterface` unchanged).

### AC-4: One-Time IndexedDB Import Preserves Existing Campaigns
**Given** an install with pre-existing campaigns and saves in IndexedDB `aikami_saves` and an empty Turso database
**When** the app boots after this contract
**Then** all campaigns and saves are imported into Turso exactly once (marker set in `meta`), subsequent boots skip the import, re-running after a simulated mid-import crash produces no duplicates, and the original IndexedDB stores are not deleted or modified.

### AC-5: IndexedDB Remains Only for Non-Authoritative State
**Given** the migrated client
**When** the codebase is inspected and a full play session runs
**Then** no campaign, save-envelope, or chat-history truth is written to IndexedDB — remaining IndexedDB users are only the out-of-scope non-authoritative stores (preferences via `idb-keyval`, drafts, branches, sessions per Scope Boundaries) — and the legacy IndexedDB code paths inside the three migrated repositories are removed (not dead-coded).

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit + Integration | `packages/frontend/repositories/src/lib/wasm_storage_adapter.test.ts` | N/A | Filled during verification |
| AC-2 | Unit | `packages/frontend/repositories/src/lib/storage_adapter.test.ts` (DDL idempotency + round-trip on both adapters, WASM path may run against in-memory SQLite in bun) | N/A | Filled during verification |
| AC-3 | Integration + E2E | `apps/frontend/client/src/lib/services/campaign/campaign_service.test.ts` (updated fake), `apps/e2e/tests/client/turso_persistence.spec.ts` | `/` start menu → `/game` | Filled during verification |
| AC-4 | Integration + E2E | `apps/frontend/client/src/lib/services/persistence/indexeddb_import.test.ts`, import scenario in `apps/e2e/tests/client/turso_persistence.spec.ts` | `/` boot path | Filled during verification |
| AC-5 | Integration (code-level check) | grep/lint assertion in verification report + updated `start_view_model.test.ts` | `/game` save/load | Filled during verification |

**Test Hooks**:
- Moon Task: `moon_run_task` → `frontend-repositories:test`, `frontend-repositories:typecheck`, `client:test`, `client:typecheck`; full `validate()` before handoff.
- Integration: Boot the client in emulator mode with DevTools network offline; create campaign → save → restart; verify OPFS `aikami.db` exists and IndexedDB `aikami_saves` receives no new writes. Seed IndexedDB manually and verify the one-time import.
- E2E / Visual:
    - **Functional**: `apps/e2e/tests/client/turso_persistence.spec.ts` — cases: (1) offline create/save/reload restores campaign + save from Turso; (2) seeded-IndexedDB upgrade imports campaigns exactly once (reload twice, assert no duplicates); (3) chat turn persists across reload. Reuse existing POMs under `apps/e2e/src/pom/` for start menu/game.
    - **Visual**: N/A — persistence layer, no visual surface.

**Watch Points**:
- AC-1: OPFS requires a worker or `createSyncAccessHandle` in some WASM builds; verify the chosen package works in the SvelteKit static SPA (no SSR) and in the Tauri webview.
- AC-3: `TursoStorageAdapter` dynamic-imports Node-native `@tursodatabase/database` — **inside the Tauri webview this module is not available**; the platform factory must detect this and fall back to the WASM/OPFS adapter rather than crash. Native adapter may effectively be exercised only in bun tests until a Tauri-side binding exists.
- AC-4: Import must run before the start menu's first `fetchAvailableSaves()`/`getAll()` read or users will see an empty list for one frame/boot.

## Implementation Sequence

1. **Phase 1 (Data/Logic)**: Add the WASM/libSQL browser dependency to `packages/frontend/repositories`; implement the WASM/OPFS adapter + `createLocalDatabase()` platform factory; extend `AIKAMI_SCHEMA_DDL` (campaigns, capability_profile, meta, saves realignment); unit tests for adapter + DDL idempotency.
2. **Phase 2 (Integration)**: Rewrite `CampaignRepository`, `GameSaveService` internals onto the shared `LocalDatabaseInterface`; implement + wire the concrete `ConversationRepository`; implement the one-time IndexedDB import at boot; update client unit tests (replace IndexedDB mocks with a `LocalDatabaseInterface` fake in `test_preload.ts`/per-suite).
3. **Phase 3 (Validation)**: New `apps/e2e/tests/client/turso_persistence.spec.ts`; run `frontend-repositories:test`, `client:test`, e2e suite, then full `validate()`; verify no remaining authoritative IndexedDB writes (AC-5 grep).

## Edge Cases & Gotchas

- **Tauri webview vs Node-native module**: `@tursodatabase/database` cannot load in a plain webview; the factory must never hard-require it. Fallback order: native (if loadable) → WASM/OPFS. Log which platform was selected.
- **Vite/Rollup externalization**: WASM/native bindings must be excluded from the initial bundle; use dynamic import and, if needed, Vite `optimizeDeps.exclude` — mirror the C-203 gotcha note.
- **OPFS eviction**: Browsers may evict OPFS under storage pressure; request `navigator.storage.persist()` at adapter open (pattern already in `opfs_asset_cache.ts`) and warn on denial.
- **Shared connection lifetime**: Repositories previously opened/closed IndexedDB per call; SQLite must use one long-lived connection — concurrent `transaction()` calls must be serialized by the adapter/factory to avoid `SQLITE_BUSY`-style failures.
- **`transaction()` atomicity gap**: The existing `TursoStorageAdapter.transaction()` runs statements sequentially without an explicit `BEGIN`/`COMMIT`; wrap in a real transaction (or document/fix) before the importer relies on rollback semantics.
- **Test environment**: bun tests have no OPFS; the WASM adapter tests need an in-memory/temp-file fallback path (constructor option), and client tests need a `LocalDatabaseInterface` fake replacing the `test_preload.ts` IndexedDB polyfill for migrated suites (polyfill stays for out-of-scope IndexedDB suites).
- **Import ordering**: `campaigns` store only exists at IndexedDB DB version 2; opening at the wrong version from the importer could trigger an unwanted upgrade — open with no explicit version and feature-detect the stores.
- **C-313 dependency risk**: C-313 is `implemented` / promotion `sandbox`, not `verified`. Its `Campaign` schema and `CampaignRepositoryInterface` are the surfaces this contract preserves; if C-313 verification changes those shapes, the `campaigns` DDL and repository internals here must follow. Coordinate sequencing.

## Open Questions

Must be resolved before status becomes `approved`:

- **Browser WASM package choice**: C-203's report deferred the web path to "`@libsql/client/web` (WASM) separately", but `@libsql/client/web` is a remote-HTTP client, not local WASM. Recommended default: [`@sqlite.org/sqlite-wasm`](https://www.npmjs.com/package/@sqlite.org/sqlite-wasm) (v3.48.0-build4, already in bun.lock as transitive dependency of `sqlite-wasm-kysely`) with OPFS VFS integration. If the libSQL team publishes a dedicated WASM package under `@libsql/*` before implementation, evaluate that first. Implementer must validate the pick against Vite static-SPA bundling before committing; contract text treats the package as an implementation detail behind `LocalDatabaseInterface`.

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

---
