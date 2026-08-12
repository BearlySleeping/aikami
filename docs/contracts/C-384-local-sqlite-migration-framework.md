---
id: C-384
title: "Local SQLite Migration Framework (PRAGMA user_version)"
source: "external data-layer review (docs/research/database-architecture-recommendation.md §5)"
status: implemented
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-08-12"
---

# Contract C-384: Local SQLite Migration Framework

## Metadata

| Field | Value |
|---|---|
| **Source** | External data-layer review — `docs/research/database-architecture-recommendation.md` §5. Architecture: `docs/architecture/data-layer-target-architecture.md` (I-4, D-9). |
| **Target** | `packages/frontend/storage/src/lib/` — new `migrations.ts`, modified `storage_adapter.ts` and `local_database_factory.ts`, plus tests |
| **Priority** | P0 — the local database is the source of truth for all player data and currently has no mechanism to evolve its schema. The next column added to a shipped table silently breaks every existing install. |
| **Dependencies** | None. Ships independently of every other contract in the sequence. |
| **Status** | implemented |
| **Promotion** | — |
| **Docs Impact** | internal → none |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: `local_database_factory.ts` → `_applySchema()` iterates `AIKAMI_SCHEMA_DDL` (a `readonly string[]` of `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` statements in `storage_adapter.ts:94`) on every database open. There is no `PRAGMA user_version`, no version table, and no `ALTER TABLE` anywhere in `packages/frontend/storage/src`.
- **The defect**: `CREATE TABLE IF NOT EXISTS` against a table that already exists is a **no-op**. It does not reconcile columns.
  - Adding a new *table* works — this is the C-373 asset-registry case and the only case currently tested.
  - Adding a *column* to an existing table does nothing on any pre-existing install. The next query referencing that column throws `no such column` at runtime, on the user's machine, against their only copy of their save data.
- **Reproduction**:
  1. Open a local database (any adapter) so the current schema is applied.
  2. Append `updated_at TEXT` to the `characters` table definition inside `AIKAMI_SCHEMA_DDL`.
  3. Re-open the same database file. Run `PRAGMA table_info(characters)`. The new column is absent.
  4. `SELECT updated_at FROM characters` → `no such column: updated_at`.
- **Existing implementation to reuse**:
  - `LocalDatabaseInterface.transaction(queries)` (`storage_adapter.ts:70`) provides atomic multi-statement execution with rollback on the **WASM** adapter (`WasmStorageAdapter` wraps `sqlite-wasm`'s `db.transaction()`). ⚠️ **The `TursoStorageAdapter.transaction()` (`turso_storage_adapter.ts:110`) is NOT atomic today** — it runs each statement in autocommit mode with no `BEGIN`/`COMMIT`/`ROLLBACK`. A failure mid-batch leaves earlier statements committed. The migration runner's atomicity guarantees (AC-4, "Migration & Rollback → Failure recovery") are unattainable on the native adapter until this is fixed; see In Scope.
  - `local_database_factory.ts` → `_applySchema()` is the single call site where schema is applied. It is the only place that needs to change.
  - `AIKAMI_SCHEMA_DDL` is already an ordered, idempotent statement list — it becomes migration version 1 verbatim.
- **Known gaps**: No version tracking, no ordering guarantee across releases, no rollback story, and no way to express a destructive or transforming change (SQLite has no `DROP COLUMN` before 3.35 and no `ALTER COLUMN` at all — the 12-step table-rebuild dance must be expressible).
- **Baseline tests**: `bun moon run frontend-storage:test`. Must pass before starting. Note `storage_adapter.test.ts:325` carries a comment claiming "databases upgrade in place (additive migration, no data loss)" — that claim is true only for new tables and must be corrected as part of this contract.

## User Outcome

After this contract, a **developer** can add or change a local database table
and be certain the change reaches every existing install exactly once, in
order, atomically — and a **player** never loses save data to a schema change.

## Success Measures

- **Time/latency target**: Migration check on an already-current database adds one `PRAGMA user_version` read to app boot — under 1ms. No measurable change to `game_boot_service` boot time.
- **Offline/degraded behavior**: Migrations are entirely local. They run identically with no network.
- **Production journey enabled**: Unblocks every future local schema change, including the persona and chat tables that C-386 adds.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Atomic multi-statement execution | `storage_adapter.ts` → `LocalDatabaseInterface.transaction()` | modify — WASM adapter is atomic; `TursoStorageAdapter.transaction()` must be wrapped in `BEGIN`/`COMMIT`/`ROLLBACK` (currently autocommit per statement) |
| Schema application call site | `local_database_factory.ts` → `_applySchema()` | replace |
| Current schema statements | `storage_adapter.ts` → `AIKAMI_SCHEMA_DDL` | modify — becomes migration v1 |
| Test harness for both adapters | `packages/frontend/storage/src/lib/__tests__/storage_adapter.test.ts` | modify |
| Asset registry test setup | `packages/frontend/storage/src/lib/__tests__/assets_registry.test.ts` | modify (imports `AIKAMI_SCHEMA_DDL`) |

## Overview

Replace the unversioned "apply all DDL every boot" scheme with a numbered
migration list keyed on SQLite's `PRAGMA user_version`. Migration 1 is the
current schema verbatim, so existing installs converge on version 1 as a
no-op. Every subsequent schema change becomes a new numbered entry that runs
exactly once per database, in a transaction.

## Design Reference

`PRAGMA user_version` is a 32-bit signed integer stored in the SQLite file
header. It costs nothing to read, requires no table, and is the conventional
mechanism for versioning an embedded SQLite schema. Follow the existing
module conventions in `packages/frontend/storage/src/lib/` — `type` aliases
(never `interface`), named exports, `$logger` for logging, and a file-header
comment citing the contract ID.

Architecture: `docs/architecture/data-layer-target-architecture.md` I-4.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- The migration runner lives in a new module in the storage package, alongside
  the adapters. It depends only on `LocalDatabaseInterface` — never on a
  concrete adapter, on Tauri, or on any browser API.
- The migration list is data, not code. No conditional logic, no environment
  checks, no "detect whether this column exists" probing inside a migration.
- Migrations are **append-only**. Editing the statements of an already-released
  version is prohibited — it produces divergent schemas across installs with
  no way to detect the divergence.

## State & Data Models

```ts
/** A single, immutable, numbered schema revision. */
export type Migration = {
  /** 1-based, contiguous, strictly increasing. Never reused, never reordered. */
  version: number;
  /** Human-readable summary — appears in migration logs. */
  name: string;
  /** Statements applied atomically, in order, exactly once per database. */
  statements: readonly string[];
};
```

The runner's contract:

```ts
/**
 * Brings the database up to the latest migration version.
 * Reads PRAGMA user_version, applies every migration with a greater
 * version in ascending order, each inside a transaction that also
 * bumps user_version. Idempotent: a database already at the latest
 * version performs one PRAGMA read and returns.
 */
export const applyMigrations = async (
  db: LocalDatabaseInterface,
  migrations?: readonly Migration[],
): Promise<number>; // returns the resulting version
```

## Quality Requirements

- **Offline/degraded mode**: Fully local. No network dependency.
- **Accessibility/input**: N/A — no UI surface.
- **Performance budget**: Up-to-date database adds ≤1 `PRAGMA` read to boot. Migrating a database adds one transaction per pending version.
- **Security/privacy**: `PRAGMA user_version = N` cannot be parameterised and must be built by string interpolation. `N` MUST be validated as a non-negative safe integer before interpolation (`Number.isSafeInteger(n) && n >= 0`), and MUST come only from `Migration.version` — never from user input, file content, or a query result.
- **Persistence/migration**: This contract *is* the persistence-migration mechanism. See "Migration & Rollback".
- **Cancellation/retry/idempotency**: Each migration is atomic. A crash mid-run leaves the database at the last fully-applied version, and the next boot resumes from there.
- **Observability**: Log at `info` when any migration is applied (`from`, `to`, `name`); log at `debug` when already current. On failure, log the failing version and name, then rethrow — never swallow.

## Migration & Rollback

- **Old data compatibility**: Every existing install is at `user_version = 0` and already has the full current schema. Migration 1 consists solely of `IF NOT EXISTS` statements, so applying it to such a database is a no-op that lands it at version 1. A fresh database also lands at version 1 with the identical schema. **These two paths must produce byte-identical schemas** — AC-2 verifies this.
- **Migration**: Automatic on database open, before any repository is allowed to query.
- **Rollback**: Not supported, by design. Down-migrations on a shipped client are more dangerous than forward-fixes: an older app version reading a newer database is the real failure mode, and a down-migration cannot recover data the newer schema dropped. Instead, migrations must be additive wherever possible; a destructive change ships as a new table plus a copy-forward migration.
- **Feature flag or kill switch**: None. A partially-migrated database is worse than a migrated one. The runner must always run.
- **Failure recovery**: A failed migration rolls back its own transaction; the database stays at the previous version and the error propagates to the caller. `getLocalDatabase()` must reject rather than return a database whose migrations failed — a half-open database handed to repositories will corrupt data.

## Scope Boundaries

- **In Scope:**
  - New migration runner module and `Migration` type in `packages/frontend/storage/src/lib/`.
  - Converting `AIKAMI_SCHEMA_DDL` into migration version 1, then **deleting `AIKAMI_SCHEMA_DDL`** — keeping it alongside the migration list would leave a stale second application path that re-introduces the unversioned behavior.
  - Wiring the runner into `local_database_factory.ts` in place of `_applySchema()`.
  - Updating the three code importers of `AIKAMI_SCHEMA_DDL` (`local_database_factory.ts`, `storage_adapter.test.ts`, `assets_registry.test.ts`) plus the two doc-comment references (`assets.ts`, `game_boot_service.svelte.ts`).
  - Correcting the misleading comment at `storage_adapter.test.ts:328`.
  - Exporting the new migration module from `packages/frontend/storage/src/index.ts` (consistent with every other lib module, and required for C-386 to append migrations).
  - **Making `TursoStorageAdapter.transaction()` genuinely atomic** — wrap the batch in `BEGIN`/`COMMIT`, `ROLLBACK` on error, then rethrow. This is a correctness prerequisite for AC-4 and the "player never loses save data" outcome; today the native adapter commits each statement independently.
- **Out of Scope:**
  - Adding any new table, column, or index. Migration 1 must be the current schema **exactly** — no "while we're here" changes.
  - Adopting Drizzle. That is a later contract; this one establishes the versioning primitive Drizzle will generate into.
  - Any other change to the Turso/WASM adapters beyond the `transaction()` atomicity fix above (their storage backends, sync behavior, and open/close semantics stay untouched).
  - Any change to repositories, services, or client code.
  - Remote/cloud sync of any kind.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** Not split. One mechanism, one call site, one test
surface. Splitting the runner from its wiring would leave dead code.

## Acceptance Criteria

### AC-1: A fresh database migrates to the latest version

**Given** a new, empty database
**When** `getLocalDatabase()` opens it
**Then** every table and index from migration 1 exists, and `PRAGMA user_version` returns the highest migration version

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit | `packages/frontend/storage/src/lib/__tests__/migrations.test.ts` (new) | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run frontend-storage:test`

**Watch Points**:
- Assert the full table set explicitly against `sqlite_master`, not a count. A count passes when a table is renamed.

### AC-2: A legacy v0 database converges on the identical schema

**Given** a database created by applying the pre-contract `AIKAMI_SCHEMA_DDL` directly, with `user_version` still `0`, containing rows in `campaigns`, `sessions`, and `chat_history`
**When** the migration runner runs against it
**Then** `user_version` becomes the latest version, all pre-existing rows are intact, and the resulting schema is **identical** to a freshly-migrated database

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit | `packages/frontend/storage/src/lib/__tests__/migrations.test.ts` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run frontend-storage:test`

**Watch Points**:
- 🔴 This is the AC that protects existing installs. Compare schemas by querying `SELECT type, name, sql FROM sqlite_master ORDER BY type, name` on both databases and asserting deep equality of the results. Comparing only table *names* would pass while columns diverge — which is precisely the bug this contract exists to prevent.
- Row-count assertions on the seeded tables must run *after* migration to prove no data was dropped.

### AC-3: A column added in a new migration reaches an existing database

**Given** a database already migrated to version 1
**When** a version 2 migration containing `ALTER TABLE characters ADD COLUMN test_column TEXT` is appended and the runner runs again
**Then** `PRAGMA table_info(characters)` includes `test_column`, `user_version` is 2, and pre-existing `characters` rows are preserved with `NULL` in the new column

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Unit | `packages/frontend/storage/src/lib/__tests__/migrations.test.ts` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run frontend-storage:test`

**Watch Points**:
- 🔴 The version 2 migration in this test is a **test fixture only**. Pass it via the runner's optional `migrations` parameter. **DO NOT add a version 2 entry to the production migration list** — that would ship a junk column to real databases. This is the single most likely mistake in this contract.
- This AC is the direct regression test for the defect. It must fail against the pre-contract implementation.

### AC-4: Migrations run exactly once and are atomic

**Given** a database at the latest version
**When** the runner runs three more times
**Then** no statement is re-executed (verified by a version-2 fixture migration containing a non-idempotent statement such as `INSERT INTO meta (key, value) VALUES ('probe','1')`, which must produce exactly one row)

**And given** a fixture migration whose second statement is invalid SQL
**When** the runner runs
**Then** the call rejects, `user_version` is unchanged, and the first statement's effect is **not** present

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Unit | `packages/frontend/storage/src/lib/__tests__/migrations.test.ts` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run frontend-storage:test`

**Watch Points**:
- The version bump must be inside the same transaction as the migration statements. If the adapter's `transaction()` cannot execute `PRAGMA user_version = N` in a batch, verify this against **both** adapters before choosing a fallback, and if a fallback is genuinely required, document the crash window in the module header and keep every migration idempotent so a replay is harmless.
- SQLite DDL is transactional — `CREATE TABLE` and `ALTER TABLE` roll back correctly. Do not add manual cleanup logic.

### AC-5: The factory refuses to return a database whose migrations failed

**Given** a migration that throws
**When** `getLocalDatabase()` is called
**Then** the promise rejects, no database handle is cached in the module singleton, and a subsequent call retries rather than returning a broken handle

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | Unit | `packages/frontend/storage/src/lib/__tests__/local_database_factory.test.ts` (new) | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run frontend-storage:test`
- Integration: `bun herdr:start client` in emulator mode, boot into a game, confirm `game_boot_service` completes and the migration log line appears once.

**Watch Points**:
- `getLocalDatabase()` currently caches `_sharedDatabase` after `_applySchema()`. Ensure the failure path clears both `_sharedDatabase` and `_opening`, and closes the underlying handle so the file is not left locked.

## Implementation Sequence

1. **Phase 1 (Data)**: Create the migrations module. Define the `Migration` type. Move `AIKAMI_SCHEMA_DDL`'s contents verbatim into migration version 1 — no edits to any statement — then delete `AIKAMI_SCHEMA_DDL` and export the new module from `src/index.ts`.
2. **Phase 2 (Logic)**: Implement `applyMigrations()`: read `PRAGMA user_version`; for each pending migration in ascending order, run its statements plus the version bump in one `transaction()`; log; return the final version.
3. **Phase 2.5 (Adapter fix)**: Make `TursoStorageAdapter.transaction()` atomic (`BEGIN`/`COMMIT`/`ROLLBACK` + rethrow). Verify against both adapters that (a) a failed batch leaves no partial effects and (b) `PRAGMA user_version = N` executes inside the batch — see AC-4 watch points.
4. **Phase 3 (Integration)**: Replace `_applySchema()` in `local_database_factory.ts` with a call to `applyMigrations()`. Implement the AC-5 failure path. Update the three code importers and two doc-comment references of `AIKAMI_SCHEMA_DDL`, and fix the misleading comment at `storage_adapter.test.ts:328`.
5. **Phase 4 (Validation)**: `bun moon run frontend-storage:test`, then `bun moon run client:test-unit`, then boot the client in emulator mode and confirm a clean single migration log line.

## Edge Cases & Gotchas

- **`PRAGMA user_version` cannot be parameterised.** `PRAGMA user_version = ?` is a syntax error in SQLite. Interpolate the integer, after validating it with `Number.isSafeInteger(n) && n >= 0`.
- **Reading the pragma returns a column named `user_version`** — `SELECT * FROM pragma_user_version` is the portable form if `PRAGMA user_version` does not return rows through a given adapter's `query()`. Verify against both adapters.
- **`TursoStorageAdapter.transaction()` is not atomic until Phase 2.5 lands.** The migration runner must not rely on it for rollback guarantees before that fix; the WASM adapter is already atomic via `sqlite-wasm`'s `db.transaction()`.
- **Non-contiguous or duplicate versions**: validate the list at module load — versions must start at 1, be strictly increasing, and have no gaps. Throw at startup on violation; a silently skipped migration is unrecoverable in the field.
- **`AIKAMI_SCHEMA_DDL` has three code importers and two doc-comment references.** Code: `local_database_factory.ts`, `storage_adapter.test.ts`, `assets_registry.test.ts`. Doc comments: `assets.ts` (header) and `game_boot_service.svelte.ts:617`. Update all five — the const is deleted, so any missed importer is a compile error; any stale doc comment re-describes the removed unversioned behavior.
- **Do not use `PRAGMA foreign_keys` toggling inside migrations** unless a table rebuild demands it — and if it does, note that the pragma is a no-op inside a transaction in SQLite, so the toggle must wrap the transaction, not sit inside it.

## Open Questions

Must be resolved before status becomes `approved`:

- None. Every decision needed to implement this contract is specified above.

## Amendments

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

---

## Execution Report

### Summary

Implemented the local SQLite migration framework keyed on `PRAGMA user_version`.
Created `packages/frontend/storage/src/lib/migrations.ts` with the `Migration`
type, the production `AIKAMI_MIGRATIONS` list (migration v1 = former
`AIKAMI_SCHEMA_DDL` verbatim, with `AIKAMI_SCHEMA_DDL` deleted), load-time
list validation, and `applyMigrations()` which reads the pragma and applies
each pending migration in one transaction that also bumps `user_version`.
Made `TursoStorageAdapter.transaction()` genuinely atomic
(BEGIN/COMMIT/ROLLBACK + rethrow) — a correctness prerequisite for AC-4.
Wired the runner into `local_database_factory.ts` in place of `_applySchema()`
with the AC-5 failure path (reject, close handle, clear singleton, retry).
Updated all three code importers and two doc-comment references of
`AIKAMI_SCHEMA_DDL`, fixed the misleading comment at
`storage_adapter.test.ts:328`, and exported the module from `src/index.ts`.
Verified the migration runs on the production path: game boot completes with
`user_version = 1` on a fresh browser database.

### AC Status

| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | Fresh database migrates to latest version; full table+index set asserted explicitly against `sqlite_master` (both adapters). |
| AC-2 | ✅ | Legacy v0 database converges with rows intact; schema deep-equality (`type, name, sql` from `sqlite_master`) between legacy and fresh paths. |
| AC-3 | ✅ | v2 fixture `ALTER TABLE characters ADD COLUMN test_column TEXT` reaches a v1 database; rows preserved with NULL; fixture passed via optional `migrations` param only — production list has exactly one v1 entry. |
| AC-4 | ✅ | Exactly-once verified with a non-idempotent probe fixture (3 extra runs → exactly 1 row); atomicity verified with an invalid-statement fixture on both WASM and Turso (version unchanged, first statement rolled back); version bump confirmed inside the transaction. |
| AC-5 | ✅ | `getLocalDatabase()` rejects on migration failure via mocked `applyMigrations`, does not cache a broken handle, and a subsequent call retries successfully. |

### Files Created

| File | Purpose |
|---|---|
| `packages/frontend/storage/src/lib/migrations.ts` | `Migration` type, `AIKAMI_MIGRATIONS` (v1 = former DDL), `assertValidMigrations`, `applyMigrations()` runner. |
| `packages/frontend/storage/src/lib/__tests__/migrations.test.ts` | AC-1..AC-4 tests run against both WASM and Turso adapters (18 tests). |
| `packages/frontend/storage/src/lib/__tests__/local_database_factory.test.ts` | AC-5 factory failure/retry tests. |

### Files Modified

| File | Change |
|---|---|
| `packages/frontend/storage/src/lib/storage_adapter.ts` | Deleted `AIKAMI_SCHEMA_DDL`; kept `LOCAL_DB_FILE`. |
| `packages/frontend/storage/src/lib/local_database_factory.ts` | Replaced `_applySchema()` with `applyMigrations()`; AC-5 failure path clears singleton, closes handle, rethrows. |
| `packages/frontend/storage/src/lib/turso_storage_adapter.ts` | `transaction()` now wraps batch in BEGIN/COMMIT/ROLLBACK and rethrows (atomic). |
| `packages/frontend/storage/src/index.ts` | Exported `./lib/migrations.ts`. |
| `packages/frontend/storage/src/lib/__tests__/storage_adapter.test.ts` | Import schema from migration v1; corrected misleading C-373 comment. |
| `packages/frontend/storage/src/lib/__tests__/assets_registry.test.ts` | Import schema from migration v1. |
| `packages/frontend/storage/src/lib/assets.ts` | Doc comment updated (tables now "created by schema migration v1"). |
| `apps/frontend/client/src/lib/services/game/game_boot_service.svelte.ts` | Doc comment updated ("runs C-384 schema migrations"). |
| `docs/contracts/C-384-local-sqlite-migration-framework.md` | Status → implemented; this report appended. |

### Deviations from Spec

None. Scope held exactly to the contract: no new tables/columns/indexes were
added to migration v1 (it is the former `AIKAMI_SCHEMA_DDL` verbatim), no
Drizzle adoption, no adapter changes beyond the `transaction()` atomicity
fix, and no repository/service/client behavior changes.

One environment note: the Pi `moon_run_task` / `validate` / `herdr_session`
wrapper tools fail in this worktree with "Bun is not defined" (systemic
wrapper issue). All moon tasks were executed through the moon CLI
(`node node_modules/.bin/moon run …`) with explicit timeouts, and the client
dev server was restarted via `bun run scripts/src/lib/herdr/restart.ts client`
(failure output captured before the workaround). The Turso adapter was never
previously exercised under bun (storage tests used only the WASM adapter); its
parameterized `stmt.bind()` path is incompatible with the bun-loaded native
binding (`stmt.bindAt is not a function`), so migration test seeding uses
literal SQL — migration statements themselves are always parameterless by
design, and this pre-existing limitation is outside this contract's scope.

### Test Results

- Unit (frontend-storage): 48/48 PASS (0 failures) — 20 new tests (18 migrations + 2 factory) + 28 baseline.
- Client unit (client:test-unit): 1613 pass / 50 fail — the 50 failures are pre-existing (identical on the base commit without these changes; suites: PersonaCreateViewModel, ProvidersViewModel, ImageViewModel, GameBootService-related isolation). 0 new failures.
- Baseline: 28 pre-existing (all passing in storage), 0 new failures.
- Production path: `/game` boots to completion (`GameBootService boot:complete`, asset registry seeded); browser `PRAGMA user_version` returns 1 after a fresh DB open (page title instrumented to `UV=1`), proving `applyMigrations` ran the v0→v1 migration in the real app.
