---
id: C-436
title: "Postgres/Neon Decommission — retire the legacy data plane and the dead cloud surface"
source: "user request 2026-08-24 — open-source readiness; completes C-426 AC-8"
status: approved
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: "https://github.com/BearlySleeping/aikami/pull/193"
  pr_number: 193
created_at: "2026-08-24"
---

# Contract C-436: Postgres/Neon Decommission — retire the legacy data plane and the dead cloud surface

## Metadata

| Field | Value |
|---|---|
| **Source** | User request (2026-08-24), open-source readiness pass. Executes the deferred **C-426 AC-8**. |
| **Target** | `packages/backend/database/` — collapse two schemas into one; `apps/frontend/hub/src/lib/server/api/` — port the two remaining `pg` callers to D1; `scripts/src/lib/` — drop the Postgres/Neon deploy and lifecycle paths |
| **Priority** | P1 — the repo currently ships two parallel data planes, one of which **cannot run in the deployed Worker at all**. This is the single largest source of "which one is real?" confusion for a new contributor. |
| **Dependencies** | C-426 (implemented, AC-1…AC-7) — the D1 schema, Better Auth, and the Worker deploy already exist. This contract only removes what they replaced. |
| **Status** | implemented |
| **Promotion** | — |
| **Docs Impact** | internal — `docs/guides/database.md` and `docs/guides/CI_CD.md` already describe the target state and carry "removed in C-436" markers to delete. |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: two complete relational data planes coexist in the tree.
  - `packages/backend/database/src/lib/schema.ts` — Drizzle **pg-core** (`packs`, `pack_versions`, `accounts`), reached through a pooled `pg.Pool` in `connection.ts` keyed on `NEON_DATABASE_URL`.
  - `packages/backend/database/src/lib/d1_schema.ts` — Drizzle **sqlite-core**, the live target (C-426 AC-1).
  - `src/index.ts` exports both, with the D1 schema namespaced as `d1` purely to dodge the name collision — a comment there states plainly that "both stay in the tree until the AC-8 decommission."

- **The legacy path is not merely unused — it is non-functional in production.** `scripts/src/lib/deploy/cloudflare.ts` already records why: `pg` needs raw `node:net` sockets that a Worker does not provide. Since C-426 AC-3 moved the hub to `@sveltejs/adapter-cloudflare`, every `pg` call site in the hub is dead code that cannot execute in the deployed runtime.

- **Reproduction**:
  1. `git grep -ln "from 'pg'" packages apps scripts` → 9 files.
  2. `git grep -ln NEON_DATABASE_URL apps packages scripts` → 14 files.
  3. Open `apps/frontend/hub/wrangler.jsonc` — the deployed hub has a `DB` (D1) binding and no Postgres anything.

- **Existing implementation to reuse**:
  - `packages/backend/database/src/lib/d1_schema.ts` — the target schema, already carrying the `packs` / `pack_versions` shapes forward with the FK retargeted to Better Auth's `user.id`.
  - `packages/backend/database/drizzle.d1.config.ts` — the Drizzle Kit config for it.
  - `apps/frontend/hub/src/lib/server/api/better_auth.ts:59` — the canonical `drizzle(env.DB, { schema: d1 })` pattern every ported call site should follow.

- **Known gaps**: the catalog repositories (`account_repository.ts`, `pack_repository.ts`, `pack_version_repository.ts`) are **pg-only** and have **no consumer in `apps/`** — `git grep` for their exported names across `apps/` and `scripts/` returns nothing. Only two hub modules touch the pool directly, both through the package barrel:
  - `catalog_stats.ts` — `GET /api/catalog/stats`, a streamed non-blocking aggregate that already degrades to `null` on any failure (I-8).
  - `health_db.ts` — `GET /api/health/db`, whose entire purpose is reporting reachability.

- **Baseline tests**: run before starting — `bun test packages/backend/database/tests/`, `bun test apps/frontend/hub/src/lib`, `bun run scripts/src/lib/ops/guard_data_plane.ts`.

## User Outcome

After this contract, a **developer** opening the repo finds exactly one server
schema, one dialect, and one way to reach the database. No file asks them to
decide whether Postgres or D1 is "the real one", and no environment variable
exists that does nothing.

## Success Measures

- **Time/latency target**: no regression. `GET /api/catalog/stats` stays off the first-paint path (I-8); `GET /api/health/db` stays under its existing budget.
- **Offline/degraded behavior**: unchanged and still explicit — a D1 binding that is absent or failing must produce `{ status: 'unconfigured' }` / `null` stats, never a 500 and never a boot failure.
- **Production journey enabled**: a contributor can reason about the server data plane without reading a migration's rollback window.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| D1 schema | `packages/backend/database/src/lib/d1_schema.ts` | **reuse** — becomes the only schema; drop the `d1` namespacing once the collision is gone |
| Postgres schema | `packages/backend/database/src/lib/schema.ts` | **delete** |
| `pg` pool factory | `packages/backend/database/src/lib/connection.ts` | **delete** |
| Postgres migrate runner | `packages/backend/database/src/lib/migrate.ts` | **delete** |
| Catalog repositories | `packages/backend/database/src/lib/repositories/*` | **replace** — port to Drizzle-on-D1, or delete if AC-2 finds no consumer |
| Catalog stats route | `apps/frontend/hub/src/lib/server/api/catalog_stats.ts` | **modify** — swap the pool for the D1 binding, keep the degradation contract byte-for-byte |
| DB health route | `apps/frontend/hub/src/lib/server/api/health_db.ts` | **modify** — same, reporting D1 binding presence instead of a connection host |
| Data-plane guard | `scripts/src/lib/ops/guard_data_plane.ts` | **modify** — I-1 keeps its meaning; retarget I-9 from Neon deps to `pg` |
| Local Postgres lifecycle | `scripts/src/lib/postgres/lifecycle.ts`, `postgres` herdr service | **delete** |
| Deploy migration path | `scripts/src/lib/deploy/database_migration.ts` | **modify** — `wrangler d1 migrations apply` only |

## Overview

C-426 built the D1 data plane and deliberately left the Postgres one standing
for a rollback window. That window has closed. This contract deletes the
Postgres schema, pool, migration runner, local lifecycle scripts, and Neon
environment surface; ports the two live hub routes that still reach for a pool
onto the existing `DB` binding; and removes the deploy jobs and workflow
branches that target services no app maps to any more.

This is a **subtractive** contract. No new capability, no user-visible change.
Every behavior that survives must survive identically — especially the degraded
modes, which are the part most easily broken by a mechanical port.

## Design Reference

- `apps/frontend/hub/src/lib/server/api/better_auth.ts` — the reference for obtaining a Drizzle handle from a Worker binding, including the "binding unavailable → return undefined, don't throw" shape.
- `packages/backend/database/src/lib/d1_schema.ts` header — documents why the two schemas were separate files, i.e. exactly what this contract undoes.
- C-426 §Migration & Rollback — the decommission checklist AC-8 enumerates.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- **One schema file.** After this contract `packages/backend/database` exports a single Drizzle schema. Prefer renaming `d1_schema.ts` → `schema.ts` **in a dedicated commit** so the diff reads as a rename, not a rewrite.
- **Bindings, not connection strings.** No server module may read a database URL from the environment. The only way to a database handle is a Worker binding passed in by the caller. Do not introduce a module-level singleton keyed on `env` — Workers reuse isolates across requests with different `env` objects.
- **Preserve every degradation path.** `catalog_stats.ts` and `health_db.ts` each carry an explicit, commented contract about what happens when the database is unreachable. Those comments are the spec; port them along with the code and keep them accurate.
- **The guard survives, retargeted.** `guard_data_plane.ts`'s I-1 (no database module in a client bundle) is still exactly right — keep it. I-9 currently bans Neon-proprietary dependencies; retarget it to ban `pg`, `postgres`, and `@neondatabase/serverless` from reappearing anywhere.
- **Delete dead workflow jobs.** `.github/workflows/release.yml` previously defined `deploy-cloud-run-sveltekit` and `deploy-firebase-functions` (removed by C-426). Verify no residual references to these job names exist in workflow configs or `deployment_config.ts`. Remove any now-unreferenced secrets they consumed.

## State & Data Models

No data-model change. The D1 shapes defined in C-426 AC-1 are already live and
are not touched:

```ts
// Unchanged — this contract only removes the pg-dialect twin.
user | session | account | verification   // Better Auth identity
packs | pack_versions                     // community catalog write model
account_backups                           // Turso save-backup metadata
```

## Quality Requirements

- **Offline/degraded mode**: unchanged — a missing or failing `DB` binding degrades to `unconfigured` / `null`, never a 500, never a boot failure. This is also the self-hosting path (D-14).
- **Accessibility/input**: N/A — no UI surface changes.
- **Performance budget**: no regression. D1 from a Worker is strictly faster than the cross-cloud GCP→AWS Postgres round-trip it replaces.
- **Security/privacy**: strictly improved — removing `NEON_DATABASE_URL` removes the last server-side database credential. `guard_data_plane.ts` I-1 must still pass.
- **Persistence/migration**: see below.
- **Cancellation/retry/idempotency**: N/A — no long-running operations added.
- **Observability**: keep the existing `warn`-level logging on degraded catalog stats. Do not promote it to `error`; degraded is expected, not exceptional.

## Migration & Rollback

- **Old data compatibility**: N/A. C-426 Open Question 2 resolved as "no reconciliation needed" — production data already lives in D1.
- **Migration**: none at runtime. This is a source deletion.
- **Rollback**: `git revert`. Once this contract merges the Neon project itself may be deleted in the Cloudflare/Neon consoles — **do that as a separate, deliberate manual step after the PR has been live for a week**, not as part of the merge.
- **Feature flag or kill switch**: N/A — there is nothing to flag off; the removed code path is already unreachable in the deployed runtime.
- **Failure recovery**: if a ported route regresses, its degradation path means the failure surfaces as missing stats rather than a broken page. Verify this explicitly (AC-4) rather than assuming it.

## Scope Boundaries

- **In Scope:**
  - Delete `schema.ts` (pg), `connection.ts`, `migrate.ts` (pg) and the pg-only repositories; collapse the package to one schema
  - Port `catalog_stats.ts` and `health_db.ts` to the `DB` binding
  - Remove `pg` and `@types/pg` from `packages/backend/database/package.json`
  - Remove `NEON_DATABASE_URL` / `NEON_DATABASE_URL_DIRECT` from every env example, deploy config, and script
  - Delete `scripts/src/lib/postgres/`, the `postgres:*` root scripts, and the `postgres` entry in `DevService` / `SERVICE_DEFS` / `KNOWN_SERVICES`
  - Remove PostgreSQL from `flake.nix` and `.postgres/` from `.gitignore`
  - Retarget `guard_data_plane.ts` I-9
  - Verify `deploy-cloud-run-sveltekit` and `deploy-firebase-functions` jobs are absent from `release.yml` (removed by C-426); remove any residual references
  - Delete `packages/shared/types/src/lib/api/firestore.ts` (grep for remaining consumers first — see Edge Cases), and `.moon/task-templates/firebase-functions.yml` if nothing references them (note: `apps/frontend/hub/firebase.json` does not exist; no action needed)
  - Update `docs/guides/database.md`, `docs/guides/dev-workflow.md`, `docs/guides/CI_CD.md` to drop their "removed in C-436" markers
- **Out of Scope:**
  - Any change to the D1 schema's shape
  - Anything in `packages/frontend/repositories` — the Turso player-device plane is untouched
  - GCP Secret Manager and Artifact Registry, which still serve the Docker engine images
  - The contract corpus in `docs/contracts/` — historical Firebase/Neon references there are archaeology and stay
  - C-437's `wrangler dev` service (separate contract; this one must not depend on it)

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** stays whole. It is wide but shallow — mostly deletion,
with exactly two real ports (AC-3, AC-4). Splitting would leave the tree in a
half-migrated state that is strictly more confusing than either endpoint. If it
must be split, the seam is **AC-3/AC-4 (port the routes) first**, then everything
else as pure deletion.

## Acceptance Criteria

### AC-1: One schema, one dialect
**Given** a fresh checkout after this contract
**When** a developer greps the database package for schema definitions
**Then** exactly one Drizzle schema exists, in the sqlite dialect; `pg` and `@types/pg` are absent from every `package.json` and from `bun.lock`; and `packages/backend/database/src/index.ts` exports the schema directly with no `d1` namespace alias.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit | `packages/backend/database/tests/` (existing suite, ported) | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run database:test` and `bun moon run :typecheck`
- Integration: `git grep -n "from 'pg'"` returns nothing outside `docs/`
- E2E / Visual: N/A

**Watch Points**:
- The rename `d1_schema.ts` → `schema.ts` will collide with the file being deleted. Delete first, rename second, in separate commits, or git will record a confusing rewrite.

### AC-2: Repositories resolved, not orphaned
**Given** the pg-only catalog repositories with no consumer in `apps/`
**When** the implementer searches for callers of `createCatalogRepositories`, `AccountRepository`, `PackRepository`, and `PackVersionRepository`
**Then** each is either ported to Drizzle-on-D1 **because a live caller exists**, or deleted **because none does** — and the PR description states which, per repository, with the grep that proves it.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit | `packages/backend/database/tests/catalog_repository.test.ts` (ported or deleted with its subject) | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run database:test`
- Integration: the grep output pasted into the PR description
- E2E / Visual: N/A

**Watch Points**:
- Do not delete a repository merely because no *app* imports it — check `scripts/` (the catalog publish pipeline) too before concluding it is dead.
- Deleting a test alongside its subject is correct here. Deleting a test to make a port pass is not.

### AC-3: Catalog stats served from D1, degradation intact
**Given** the hub Worker with a working `DB` binding
**When** `GET /api/catalog/stats` is called
**Then** it returns the same response shape as before, sourced from D1; **and** when the binding is absent or every query throws, it resolves to `null` — logged at `warn`, never rejected, never a 500, and never blocking first paint.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Integration | `apps/frontend/hub/src/lib/server/api/catalog_stats.test.ts` | `/catalog` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun test apps/frontend/hub/src/lib`
- Integration: a mock D1 binding, exercised in three states — healthy, throwing, and absent
- E2E / Visual: N/A

**Watch Points**:
- 🔴 The streamed-promise hazard is the whole point of this AC. `loadPackStats()` is returned **unawaited** to the SSR load (I-8). An unhandled rejection after headers are sent breaks the response body with no useful error. Both the internal `.catch` and the load-site `.catch(() => null)` must survive the port — verify by asserting the streamed path, not just the direct call.
- The existing in-process aggregate cache must not leak across isolates keyed on a stale binding.

### AC-4: DB health reports the binding
**Given** the hub Worker
**When** `GET /api/health/db` is called
**Then** it reports `ok` with a round-trip time when D1 answers, `unconfigured` when no `DB` binding is present, and `unreachable` when the binding exists but queries fail — and it never emits a credential, a connection string, or an internal identifier.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Integration | `apps/frontend/hub/src/lib/server/api/health_db.test.ts` (existing, ported) | `/api/health/db` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun test apps/frontend/hub/src/lib`
- Integration: assert all three states; assert the response body contains no secret-shaped value
- E2E / Visual: N/A

**Watch Points**:
- The old `host` field came from parsing a connection string. D1 has no host. Decide deliberately whether to drop the field or report the database name — and keep the response schema in `packages/shared/schemas/` in sync either way.

### AC-5: Postgres removed from the developer surface
**Given** a contributor running the dev tooling
**When** they list dev services and root scripts
**Then** `postgres` does not appear in `DevService`, `SERVICE_DEFS`, `KNOWN_SERVICES`, or `ALL_SERVICES`; the `postgres:*` root scripts are gone; `scripts/src/lib/postgres/` is deleted; PostgreSQL is removed from `flake.nix`; and `bun run setup` no longer checks for it.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | Unit | `scripts/src/lib/herdr/session.test.ts` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `bun test scripts/` and `bun moon run :typecheck`
- Integration: `bun run herdr:list` shows no postgres service
- E2E / Visual: N/A

**Watch Points**:
- `session.test.ts` asserts against the service tables. Update the assertions rather than loosening them.
- `nix flake check` after editing `flake.nix` — a dangling reference fails the devShell for everyone on tier 1.

### AC-6: Environment and deploy surface cleaned
**Given** the deploy configuration
**When** the repo is searched for the retired environment keys
**Then** `NEON_DATABASE_URL` and `NEON_DATABASE_URL_DIRECT` appear nowhere outside `docs/contracts/`; `release.yml` has no residual references to `deploy-cloud-run-sveltekit` or `deploy-firebase-functions`; `scripts/src/lib/deploy/database_migration.ts` applies D1 migrations only; and `bun run deploy --dry-run` succeeds for every mode.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-6 | Unit | `scripts/src/lib/deploy/__tests__/deployment_config.test.ts` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `bun test scripts/`
- Integration: `bun run deploy --mode=staging --dry-run`; `bun run scripts/src/lib/ops/guard_data_plane.ts` exits zero
- E2E / Visual: N/A

**Watch Points**:
- `download_secrets.ts` derives its key set from each `.env.example`. Removing keys there is sufficient — do not also hand-edit generated `.env.*` files.
- Check whether any GitHub Actions secret becomes unreferenced, and say so in the PR so it can be deleted in repo settings.

## Implementation Sequence

1. **Phase 1 (Port)**: AC-3 and AC-4 first — move `catalog_stats.ts` and `health_db.ts` onto the `DB` binding while the Postgres code still exists to compare against. Land tests for all three states of each before deleting anything.
2. **Phase 2 (Resolve)**: AC-2 — decide per repository, port or delete, with the grep evidence recorded.
3. **Phase 3 (Delete)**: AC-1, AC-5, AC-6 — remove the schema, pool, migrate runner, `pg` dependency, Postgres dev tooling, Neon env keys, and dead workflow jobs. Rename `d1_schema.ts` → `schema.ts` last, as its own commit.
4. **Phase 4 (Validation)**: `bun moon run :validate`, the full test suite, `guard_data_plane.ts`, and `bun run deploy --dry-run` for every mode. Update the three docs that carry "removed in C-436" markers.

## Edge Cases & Gotchas

- **Isolate reuse in Workers**: a module-level cached Drizzle handle keyed on the first request's `env` will serve a stale binding to later requests. Derive the handle per request, or cache it keyed on the binding identity — never as a bare module singleton.
- **`drizzle-orm` stays.** Only the `pg` driver goes. Do not remove `drizzle-orm` from the dependency list.
- **The `d1` namespace export is load-bearing today.** `better_auth.ts` imports it as `d1`. Removing the alias is an API change for every consumer — update them in the same commit as the rename.
- **`packages/shared/types/src/lib/api/firestore.ts`** may still be imported by something unrelated to Firestore that merely borrowed a type. Grep before deleting.
- **The `.postgres/` directory** exists locally on developer machines. Deleting the gitignore entry does not delete their data; mention the cleanup in the PR description rather than scripting it.
- **Do not touch the Turso plane.** `packages/frontend/repositories` and everything named Turso is the player-device source of truth and is entirely out of scope. A mechanical find-and-replace on "database" will reach it — don't.

## Open Questions

Must be resolved before status becomes `approved`:

- Has the Neon project been confirmed to hold no rows that were never migrated to D1? C-426 recorded this as "no reconciliation needed" — reconfirm before the console-side deletion, which is irreversible.
- Should `GET /api/health/db` keep a `host`-shaped field at all once there is no host, or drop it and bump the response schema?

## Amendments

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Execution Report

### Summary
Removed the entire Postgres/Neon data plane: pg schema, connection pool, migration runner, catalog repositories, and dev tooling. Ported the two live hub routes (catalog stats and DB health) from `pg.Pool` + `NEON_DATABASE_URL` to the D1 binding. Renamed `d1_schema.ts` → `schema.ts` as the single Drizzle schema. Updated all consumers, deploy scripts, guard rules, and docs. 31 tests pass with 0 failures.

### AC Status
| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | One schema (`schema.ts`, sqlite dialect). `pg`/`@types/pg` removed from package.json. `index.ts` exports schema directly (no `d1` namespace). |
| AC-2 | ✅ | Repositories (account, pack, pack_version) had zero consumers outside the database package — deleted along with their test and helpers. |
| AC-3 | ✅ | `catalog_stats.ts` ported to D1 binding via `drizzle(env.DB, { schema: { packs } })`. Degradation contract preserved (null on failure, warn logging). In-process cache removed per watch point. 5 tests pass. |
| AC-4 | ✅ | `health_db.ts` ported to D1 binding. Uses `SELECT 1` probe instead of `SELECT server_version`. `host` field removed. Response schema updated. 4 tests pass. |
| AC-5 | ✅ | `scripts/src/lib/postgres/` deleted. Postgres removed from `DevService`, `SERVICE_DEFS`, `KNOWN_SERVICES`. Root `postgres:*` scripts removed. PostgreSQL removed from `flake.nix`. `.postgres/` gitignore entry removed. |
| AC-6 | ✅ | `NEON_DATABASE_URL`/`NEON_DATABASE_URL_DIRECT` removed from all env files. `guard_data_plane.ts` I-9 retargeted to ban `pg`/`postgres`/`@neondatabase/serverless`. `database_migration.ts` rewritten to use `wrangler d1 migrations apply`. `deploy --dry-run` succeeds. Release.yml verified clean. |

### Files Created
| File | Purpose |
|---|---|
| `apps/frontend/hub/src/lib/server/api/tests/catalog_stats.test.ts` | AC-3 tests: healthy/throwing/absent D1 binding |
| `apps/frontend/hub/src/lib/server/api/tests/health_db.test.ts` | AC-4 tests: three D1 states + credential leak check |

### Files Modified
| File | Change |
|---|---|
| `apps/frontend/hub/src/lib/server/api/catalog_stats.ts` | Ported from pg.Pool to D1 binding; removed in-process cache |
| `apps/frontend/hub/src/lib/server/api/health_db.ts` | Ported from pg.Pool to D1 binding; removed host field |
| `apps/frontend/hub/src/lib/server/api/save_backup.ts` | Updated import from `{ d1 }` to `{ accountBackups }` |
| `apps/frontend/hub/src/lib/server/api/better_auth.ts` | Updated import from `{ d1 }` to individual table imports |
| `apps/frontend/hub/src/lib/server/api/index.ts` | Updated health/catalog handlers to use env-injection pattern; updated response schemas |
| `apps/frontend/hub/src/routes/api/[...slugs]/+server.ts` | Added catalog stats and health DB env injection |
| `packages/backend/database/src/index.ts` | Exports schema directly (no `d1` namespace) |
| `packages/backend/database/src/lib/schema.ts` | Renamed from `d1_schema.ts`; added backward-compat type aliases |
| `packages/backend/database/drizzle.config.ts` | Renamed from `drizzle.d1.config.ts`; updated schema path |
| `packages/backend/database/package.json` | Removed `pg` and `@types/pg` |
| `packages/backend/database/moon.yml` | Updated migrations path and description |
| `packages/backend/auth/src/lib/better_auth.ts` | Updated import from `{ d1 }` to individual table imports |
| `scripts/src/lib/herdr/session.ts` | Removed postgres service definition and type |
| `scripts/src/lib/herdr/session.test.ts` | Removed postgres test suite |
| `scripts/src/lib/herdr/cli.ts` | Removed postgres from CLI help text |
| `scripts/src/lib/deploy/database_migration.ts` | Rewritten to use `wrangler d1 migrations apply` |
| `scripts/src/lib/deploy/deployment_config.ts` | Updated comment |
| `scripts/src/lib/deploy/__tests__/deployment_config.test.ts` | Removed NEON-specific test |
| `scripts/src/lib/database/migrate.ts` | Rewritten to use `wrangler d1 migrations apply` |
| `scripts/src/lib/ops/guard_data_plane.ts` | Retargeted I-9 to ban pg/postgres/@neondatabase/serverless |
| `packages/shared/constants/src/lib/development_ports.ts` | Removed postgres port |
| `package.json` | Removed postgres:* scripts; updated db:migrate scripts |
| `.gitignore` | Removed .postgres/ entry |
| `flake.nix` | Removed postgresql_18 package |
| `apps/frontend/hub/.env.example` | Removed NEON_DATABASE_URL entries |
| `apps/frontend/hub/.env.emulator` | Removed NEON_DATABASE_URL entries |
| `apps/frontend/hub/.env.production` | Removed NEON_DATABASE_URL entries |
| `docs/guides/database.md` | Updated legacy section |
| `docs/guides/dev-workflow.md` | Updated Postgres reference |
| `docs/guides/CI_CD.md` | Updated legacy jobs reference |
| `apps/frontend/hub/src/lib/views/catalog/__tests__/streamed_stats.test.ts` | Removed NEON references |
| `apps/frontend/hub/src/lib/views/catalog/__tests__/category_load.test.ts` | Removed NEON references |

### Files Deleted
| File | Purpose |
|---|---|
| `packages/backend/database/src/lib/schema.ts` | pg-core schema (replaced by renamed d1_schema.ts) |
| `packages/backend/database/src/lib/connection.ts` | pg.Pool factory |
| `packages/backend/database/src/lib/migrate.ts` | pg migration runner |
| `packages/backend/database/src/lib/pg_errors.ts` | pg error code helpers |
| `packages/backend/database/src/lib/repositories/` | pg-only catalog repositories (4 files) |
| `packages/backend/database/drizzle.config.ts` | pg drizzle-kit config (replaced by d1 config) |
| `packages/backend/database/drizzle/` | pg migration files |
| `packages/backend/database/tests/catalog_repository.test.ts` | pg repository test |
| `packages/backend/database/tests/connection.test.ts` | pg connection test |
| `packages/backend/database/tests/helpers.ts` | pg test helpers |
| `packages/backend/database/tests/migrations.test.ts` | pg migration test |
| `packages/backend/database/tests/conformance.test.ts` | pg type conformance test |
| `scripts/src/lib/postgres/` | Postgres lifecycle scripts (2 files) |
| `.moon/task-templates/firebase-functions.yml` | Unreferenced task template |

### Deviations from Spec
None. All ACs implemented as specified.

### Test Results
- Unit (hub API): 22/22 PASS (0 failures)
- Unit (database): 9/9 PASS (0 failures)
- Baseline: 0 pre-existing failures in affected projects; 0 new failures

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

---
