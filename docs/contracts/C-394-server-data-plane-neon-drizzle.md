---
id: C-394
title: "Server Data Plane: Neon PostgreSQL + Drizzle + the hub's catalog write model"
source: "user request — hub community catalog; ADR amendments A-1, A-2, A-6"
status: implemented
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: "https://github.com/BearlySleeping/aikami/pull/147"
  pr_number: 147
created_at: "2026-08-15"
---

# Contract C-394: Server Data Plane — Neon PostgreSQL + Drizzle

## Metadata

| Field | Value |
|---|---|
| **Source** | User request (2026-08-15) to stand up the community hub. Architecture: `docs/architecture/data-layer-target-architecture.md` D-6, D-7, D-9, D-14 and invariants I-1, I-8, I-9 (amendments A-1, A-2, A-6). |
| **Target** | New `packages/backend/database/` (Drizzle schema, migrations, repositories), `packages/shared/schemas/src/lib/catalog/` (TypeBox API boundary), `apps/frontend/hub/src/lib/server/`, `apps/frontend/hub/.env.*`, `flake.nix`, `scripts/src/lib/deploy/` |
| **Priority** | P1 — every other hub contract (C-396, C-398, C-399) needs a server data plane, and none of them can be written against a database that does not exist. |
| **Dependencies** | C-387 (local PostgreSQL dev environment — implemented, PR #137). This contract re-pins its major version 17 → 18; see AC-2. |
| **Status** | implemented |
| **Promotion** | — |
| **Docs Impact** | internal → developer setup notes in the repo README (database URL, migration commands) |
| **Contract version** | 2.1.0 |

## Problem & Baseline Evidence

- **Current behavior**: the hub has no server data plane at all. `apps/frontend/hub/src/lib/server/api/index.ts` is an Elysia app with exactly one route — `POST /api/auth/session`, which mints a Firebase session cookie. There are no product-data endpoints, no database client, no schema, and no connection configuration. C-385 removed `pg` from `apps/frontend/hub/package.json` entirely when it deleted the Data Connect verify scripts.
- **Reproduction**: `grep -rn "drizzle\|from 'pg'" apps/frontend/hub/src packages/backend` returns zero matches. `ls packages/backend/` shows `auth, chat, configs, firestore, svelte-kit, utils` — no `database` package, and `packages/backend/firestore/` is an empty husk (only `tsconfig.tsbuildinfo` and `node_modules`) left behind by C-386.
- **Existing implementation to reuse**:
  - `scripts/src/lib/postgres/lifecycle.ts` (C-387) already provides a real PostgreSQL 17 at `postgresql://localhost:5433/aikami_dev?sslmode=disable`, with `init`/`start`/`stop`/`reset`/`psql`/`status` and a herdr service entry. This is the local half of D-8 and needs no changes.
  - `scripts/src/lib/deploy/secrets.ts` → `buildSecretArgsFromEnvFile` already maps every non-`PUBLIC_` key in `apps/frontend/hub/.env.{mode}` to a Secret Manager secret via `--set-secrets=KEY=gsmName:latest`, fetched by Cloud Run at cold start. A database URL needs no new secret machinery — only a new key.
  - `packages/frontend/storage/src/lib/migrations.ts` (C-384) is the established numbered-migration idiom on the device plane. The server plane should read as a sibling of it, not as a different philosophy.
  - The hub's Elysia app and its Eden treaty client (`src/lib/client/services/api/internal.svelte.ts`) are the established server/client boundary. New endpoints extend the same app.
- **The Neon project already exists** (provisioned by the maintainer, 2026-08-15): **PostgreSQL 18**, AWS `eu-west-2` (London), compute autoscaling **0.25 ↔ 2 CU**, history retention **6 hours**. `NEON_DATABASE_URL` is already present in `apps/frontend/hub/.env.example` and `.env.production`.
- **Version mismatch to resolve**: C-387 pinned the devShell to `pkgs.postgresql_17`, but production is now **18**. That breaks D-8 (local ≡ production) — the exact guarantee C-387 existed to create. C-387's own Watch Point anticipated this: *"If the eventual choice doesn't support 17 by then, re-pin as a one-line change — it does not reopen this contract."* Verified 2026-08-15: `nixpkgs#postgresql_18` resolves to **18.4**.
- **Known gaps**: no Drizzle dependency anywhere in the workspace (`grep drizzle bun.lock` → 0); no `pg` (C-385 removed it); no server-side repository layer; no deploy path for migrations — Data Connect's schema used to ride along with the Firebase deploy, and that mechanism was deleted with it in C-385; no guard preventing a database import from reaching a browser bundle (I-1).
- **Baseline tests**: `bun moon run hub:test`, `bun moon run hub:build`, `bun moon run scripts:test`. All must pass before starting.

## User Outcome

After this contract, a **developer** can define a server-side table in one
TypeScript file, generate and apply a migration to both the local PostgreSQL
and the production Neon database with the same command, and query it from the
hub's Elysia API — with a structural guarantee that no database credential can
reach a browser.

## Success Measures

- **Time/latency target**: a warm single-row read from the hub on Cloud Run completes in under 40ms end to end (cross-cloud `europe-west4` → `aws-eu-west-2` is the floor, roughly 10–15ms RTT). A **cold** Neon compute adds up to ~1s on the first query after 5 minutes idle — which is why I-8 forbids putting these queries in the render path.
- **Offline/degraded behavior**: the hub must start, serve, and pass its health check when the database is unreachable. A dead database degrades the mutable-metadata features only; it must never produce a 500 on a page that D-14 says renders from the static index.
- **Production journey enabled**: unblocks C-396 (catalog browse), C-398 (submissions) and C-399 (ratings). Nothing user-visible ships in this contract.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Local PostgreSQL 17 | `scripts/src/lib/postgres/lifecycle.ts` (C-387) | reuse unchanged |
| Secret delivery to Cloud Run | `scripts/src/lib/deploy/secrets.ts` → `buildSecretArgsFromEnvFile` | reuse unchanged |
| Numbered-migration idiom | `packages/frontend/storage/src/lib/migrations.ts` (C-384) | reuse as a style reference only — do not share code, the planes are separate schemas (D-9) |
| Server API surface | `apps/frontend/hub/src/lib/server/api/index.ts` | modify |
| Typed server→client calls | `@elysiajs/eden` treaty client | reuse |
| Port allocation | `packages/shared/constants/src/lib/development_ports.ts` | reuse unchanged |

## Overview

Create `packages/backend/database/` as the single home for the server-side SQL
schema: Drizzle table definitions, generated migrations, a migration runner,
a pooled `pg` connection factory, and typed repositories. Wire it into the
hub's Elysia API behind a connection that is resolved from a single
`DATABASE_URL` secret. Ship the catalog **write model** — accounts, packs, and
pack versions — with no UI and no consumer beyond an integration test and a
health endpoint.

The relationship this contract establishes, and which the rest of the sequence
depends on: **Postgres is the write model; the static catalog index (D-14) is a
derived read model regenerated at publish time.** Nothing browses by querying
Postgres.

## Design Reference

`docs/architecture/data-layer-target-architecture.md` D-6, D-7, D-9, D-14 and
invariants I-1, I-7, I-8, I-9. Package structure follows the existing
`packages/backend/*` convention (`moon.yml` + `package.json` + `tsconfig.json`,
sources under `src/lib/`, barrel at `src/index.ts`) — use
`packages/backend/utils/` as the structural template. Repository style follows
`packages/frontend/storage/src/lib/assets.ts`: a plain class holding an
injected connection, plain typed queries, no generic document abstraction
(the anti-pattern C-386 explicitly warned against porting).

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- **Plain `pg` + Drizzle only.** No `@neondatabase/serverless`, no Neon Auth,
  no Neon Data API, no runtime dependency on database branching (I-9). Every
  Neon-specific surface adopted here is a future migration cost paid for a
  convenience this project does not need.
- **Connect through Neon's pooled endpoint** (the `-pooler` host), with a small
  `pg` pool. Cloud Run at `min-instances=0` scales instances horizontally; a
  direct endpoint with a per-instance pool exhausts connections under
  even modest concurrency. PgBouncer transaction mode is what Drizzle expects.
- **One `DATABASE_URL`**, resolved server-side only. It must never appear in a
  `PUBLIC_`-prefixed variable, never be imported into a `.svelte` file, and
  never be read outside `packages/backend/database/`.
- **The schema in this contract is mutable state only.** No table may duplicate
  anything the static index owns (D-14). If a column would be a copy of
  manifest data, it belongs in the index, not here — with the sole exception of
  identifiers and hashes needed to *point at* index entries.
- **Migrations are forward-only and generated, never hand-edited.** Drizzle
  owns DDL (D-9). A generated migration file that has been applied to
  production is immutable; corrections are new migrations.
- **Migrations connect through the DIRECT (non-pooled) endpoint.** DDL under
  PgBouncer transaction pooling is the failure mode that bites hardest. This
  needs a second environment variable — see State & Data Models.
- **Drizzle owns row types; TypeBox owns the API boundary. Neither generates
  the other.** The catalog's TypeBox schemas live in
  `packages/shared/schemas/src/lib/catalog/` and describe *wire* shapes
  (request bodies, response payloads) for Elysia validation. The Drizzle table
  definitions describe *storage*. They are permitted to differ — and they will,
  because a response omits internal ids and a request omits server-assigned
  timestamps. Drift between them is caught by a type-level conformance test
  (AC-4), not by forcing one to generate the other.
- **Do not add `drizzle-typebox`.** Verified 2026-08-15: `drizzle-typebox@0.3.3`
  peer-depends on `@sinclair/typebox>=0.34.8`, the *old scoped* package. This
  workspace is on `typebox@1.3.12`, the unscoped v1 package. Adopting it puts
  two TypeBox runtimes with two non-interoperable `Static<>` types into a
  monorepo that just spent five contracts (C-383…C-387) eliminating duplicate
  schema sources. Re-evaluate only if drizzle-typebox migrates to `typebox` v1.
- Do not touch Firebase Auth, session handling, App Check, or the existing
  `POST /api/auth/session` route.
- **Staging is not configured** (D-10). Touch `.env.emulator` and
  `.env.production` only; leave `.env.staging` alone rather than adding a key
  that points nowhere.

## State & Data Models

Drizzle PostgreSQL schema. Three tables — deliberately the minimum that later
contracts can hang off without re-litigating identity and ownership.

```ts
/** A hub member. Maps a Firebase uid to a stable internal id.
 *  This is hub-owned account data, NOT player-owned game data — I-3 and D-5
 *  still forbid the hub from reading anything from the device plane. */
type Account = {
  id: string;              // uuid, generated
  firebaseUid: string;     // unique, from the verified session cookie
  displayName: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/** Catalog identity and ownership. The pack's *content* lives in the static
 *  index; this row exists so a pack can be owned, moderated and versioned. */
type Pack = {
  id: string;              // uuid, generated
  slug: string;            // unique, url-safe, immutable once published
  ownerAccountId: string;  // → accounts.id
  visibility: 'draft' | 'public' | 'unlisted' | 'removed';
  createdAt: Date;
  updatedAt: Date;
};

/** An immutable published version. `manifestHash` is the content address that
 *  joins this row to its entry in the static index — the only coupling
 *  between the write model and the read model. */
type PackVersion = {
  id: string;              // uuid, generated
  packId: string;          // → packs.id
  version: string;         // semver, unique per pack
  manifestHash: string;    // sha256 of the canonical manifest bytes
  publishedAt: Date | null;// null while unpublished
};
```

Constraints that must exist in the migration, not merely in application code:

- `accounts.firebase_uid` — `UNIQUE NOT NULL`.
- `packs.slug` — `UNIQUE NOT NULL`, with a `CHECK` enforcing a url-safe pattern.
- `packs.visibility` — a Postgres enum, not a free `text` column.
- `pack_versions (pack_id, version)` — `UNIQUE`.
- `pack_versions.pack_id` → `packs.id` and `packs.owner_account_id` →
  `accounts.id`, both `ON DELETE RESTRICT`. Catalog rows are moderated, never
  cascaded away.

TypeBox API-boundary schemas live in `packages/shared/schemas/src/lib/catalog/`
and follow the sibling convention in `lib/game/` and `lib/media/` — one file
per entity, `Type.Object` + exported `Static` type, barrel-exported from
`packages/shared/schemas/src/index.ts`. This contract ships only what
`GET /api/health/db` needs plus the three read shapes (`AccountPublicSchema`,
`PackSummarySchema`, `PackVersionSchema`); request schemas arrive with the
routes that accept requests (C-398).

Configuration surface — **two** connection strings, not one:

```
NEON_DATABASE_URL          Runtime. POOLED endpoint (host contains "-pooler").
                           apps/frontend/hub/.env.{emulator,production}
                           emulator   → postgresql://localhost:5433/aikami_dev?sslmode=disable
                           production → Neon pooled, aws-eu-west-2, sslmode=require
                           Already set by the maintainer (2026-08-15).
                           ⚠️ The value present in the local `.env.production` as of
                           2026-08-15 uses the DIRECT host (no "-pooler") — swap to the
                           -pooler host during Phase 6 before deploying.
                           Delivered to Cloud Run as a GSM secret by the existing
                           buildSecretArgsFromEnvFile path — no new machinery.

NEON_DATABASE_URL_DIRECT   Migrations only. UNPOOLED endpoint. NOT set yet —
                           must be added to GSM and to .env.production.
                           Never read by the running server; only by the
                           migration deploy step (see Scope).
                           emulator → identical to NEON_DATABASE_URL (local
                           Postgres has no pooler, so one value serves both).
```

**Secret names, derived — no guessing needed.** `resolveSecretName`
(`deployment_config.ts:280`) prefixes a key only when it appears in
`APP_SPECIFIC_KEYS_FOR_PREFIX` (line 201). Neither key is in that set, so the
Secret Manager secret names are exactly `NEON_DATABASE_URL` and
`NEON_DATABASE_URL_DIRECT` — **unprefixed**, not `HUB_NEON_DATABASE_URL`.

🔴 A value present in the local `.env.production` file is **not** the same as
the secret existing in GSM. `buildSecretArgsFromEnvFile` reads that file only
to discover *which keys* to wire; it emits
`--set-secrets=NEON_DATABASE_URL=NEON_DATABASE_URL:latest` and Cloud Run
resolves the value from GSM at cold start. If the secret is absent from GSM the
deploy fails, or worse, the service starts with the variable unset and silently
takes the degraded path from AC-1. Confirm both secrets exist in GSM during
Phase 6.

Engine versions, which must match (D-8):

```
production  Neon PostgreSQL 18, aws-eu-west-2, compute 0.25 ↔ 2 CU,
            history retention 6 hours
local       flake.nix: pkgs.postgresql_17 → pkgs.postgresql_18  (nixpkgs 18.4)
```

## Quality Requirements

- **Offline/degraded mode**: the hub boots with an unreachable database. The connection is created lazily on first query, never at module load, so a database outage cannot prevent the server from starting or serving static-index-backed pages.
- **Accessibility/input**: N/A — no UI in this contract.
- **Performance budget**: see Success Measures. The pool must cap at a small `max` (start at 5) — Neon Free's compute is 0.25 CU and a large pool buys nothing.
- **Security/privacy**: `DATABASE_URL` is server-only (I-1). Production connections require TLS (`sslmode=require`). No table in this contract stores player-owned content, chat, saves, or personas — only hub account identity and catalog ownership.
- **Persistence/migration**: Drizzle-generated, forward-only, applied by an explicit command. Never auto-applied on server boot — a Cloud Run cold start must not race N instances into the same migration.
- **Cancellation/retry/idempotency**: migrations run inside a transaction and are idempotent by version. Queries get a statement timeout so a stalled cross-cloud connection cannot pin a request.
- **Observability**: log connection establishment once at `debug` with host and region (never the credential). Log migration application at `info` with the version applied. Query errors log at `error` with the SQL state code.

## Migration & Rollback

- **Old data compatibility**: N/A — no server database exists today, so there is no data to preserve.
- **Migration**: creating the three tables *is* the migration. Applied to local Postgres by every developer, and to Neon once.
- **Rollback**: `git revert` removes the code. The Neon project and its tables can be left in place harmlessly (nothing reads them) or dropped. Because nothing consumes this schema until C-396/C-398, rollback destroys no user data at any point during this contract's life.
- **Feature flag or kill switch**: an absent `DATABASE_URL` must degrade cleanly — the health endpoint reports the database as unconfigured and every other route behaves as before. This is also the self-hosting path (D-14).
- **Failure recovery**: a partially applied migration is impossible (transactional). A failed migration leaves the previous version intact and exits non-zero.

## Scope Boundaries

- **In Scope:**
  - New `packages/backend/database/` package: Drizzle schema, `drizzle.config.ts`, generated migrations, migration runner, pooled connection factory, repositories for the three tables, unit + integration tests.
  - New `packages/shared/schemas/src/lib/catalog/` TypeBox API-boundary schemas + barrel export.
  - Workspace wiring: `.moon/workspace.yml` project mapping (`backend-database`), `package.json` workspace entry, `tsconfig.json` path mappings, `biome.json` if an import rule is needed.
  - Hub wiring: dependency in `apps/frontend/hub/package.json` and `moon.yml`, alias in `svelte.config.js`, `NEON_DATABASE_URL_DIRECT` added to `.env.production` (both keys are already present in `.env.example`), and both `NEON_DATABASE_URL` and `NEON_DATABASE_URL_DIRECT` set in `.env.emulator` to `postgresql://localhost:5433/aikami_dev?sslmode=disable` — the hub's `dev` script runs `vite dev --mode emulator`, so AC-1's local success path reads these from the emulator env file.
  - `flake.nix` — re-pin `postgresql_17` → `postgresql_18`. Update the C-387 README section's stated version.
  - A single new Elysia route: `GET /api/health/db`.
  - **Migration deploy path**, replacing the deleted Data-Connect-rides-along-with-Firebase flow:
    - `packages/shared/schemas/src/lib/project/project.ts` — add `'database'` to `AppIdSchema`.
    - `scripts/src/lib/deploy/deployment_config.ts` — add `'database-migration'` to `ALL_SERVICE_TYPES` and a `database` entry to `APP_CONFIG`.
    - `scripts/src/lib/deploy/index.ts` — a `case 'database-migration'` in the dispatcher (line ~146) that runs the migration command against `NEON_DATABASE_URL_DIRECT`.
    - `scripts/src/lib/deploy/resolve_plan.ts` — a `SERVICE_TYPE_OUTPUT_KEY` entry (this file **will not compile** until one is added — that is deliberate, see Watch Points).
    - `.github/workflows/release.yml` — the job that reads the new output key.
  - Root `package.json` scripts for generate/apply/status of server migrations.
  - README developer-setup section.
  - A CI or lint guard for I-1 (no database import reachable from a client bundle) and I-9 (no Neon-proprietary dependency).
- **Out of Scope:**
  - Any catalog UI, browse route, or page (C-396).
  - The static index format and the R2 publish pipeline (C-395).
  - Submissions, uploads, validation, moderation (C-398).
  - Ratings and install counts (C-399).
  - Any change to the device-plane SQLite schema or its migration runner.
  - Any change to Firebase Auth, session cookies, App Check, or `POST /api/auth/session`.
  - The hub's public/private route restructure required by D-15 (C-396).
  - Provisioning R2 (C-395).
  - Any staging configuration (D-10 — staging is on hold; `.env.staging` is not touched).
  - Removing the empty `packages/backend/firestore/` husk left by C-386 (noted in Gotchas, separate cleanup).

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** Not split. A connection factory with no schema is
untestable; a schema with no migration runner cannot be applied; a migration
runner with no repository proves nothing about the idiom the next four
contracts will copy. Partial completion would leave a half-wired workspace
package that nothing imports — worse than not starting. The four ACs are one
capability: "the server data plane exists and is proven."

## Acceptance Criteria

### AC-1: The hub reaches Neon and reports it, and survives when it cannot

**Given** the provisioned Neon PostgreSQL 18 project in `aws-eu-west-2`, with
`NEON_DATABASE_URL` (pooled) referenced from `apps/frontend/hub/.env.production`
and delivered to Cloud Run as a GSM secret
**When** `GET /api/health/db` is called against the deployed hub
**Then** it returns the reported server version (**must report 18.x**), the
resolved host, and a round-trip duration in milliseconds

**And when** `NEON_DATABASE_URL` is unset or points at an unreachable host
**Then** the hub still boots and serves, and `GET /api/health/db` returns a
structured "unconfigured" or "unreachable" status — not a 500, and not a crash
at module load

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Integration | `packages/backend/database/tests/connection.test.ts` + manual curl against Cloud Run | `/api/health/db` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run backend-database:test`
- Integration: `bun herdr:start postgres hub`, then `curl localhost:5276/api/health/db` (hub dev port, see `development_ports.ts`); repeat with `NEON_DATABASE_URL` unset.

**Watch Points**:
- 🔴 The connection must be created **lazily on first query**, not at module import (confirmed by the maintainer 2026-08-15). A module-level `new Pool()` that eagerly connects turns a database outage into a boot failure and breaks the degraded-mode half of this AC.
- Verify the runtime connection string is the **pooled** endpoint (host contains `-pooler`). A direct endpoint will appear to work in every test and fail only under real concurrency.
- Confirm `sslmode=require` in production. Neon rejects plaintext, but an explicit parameter documents the intent and prevents a local-shaped URL being pasted into production.
- Never log the connection string. Log host and region only.
- The health route must be reachable **without authentication** but must not leak the host's credentials or full URL — hostname only. It is also the one legitimate exception to I-8, because reporting database reachability is its entire purpose.

### AC-2: Drizzle owns the schema, and the same migration applies to both engines — both on PostgreSQL 18

**Given** `flake.nix` is re-pinned to `pkgs.postgresql_18` and the local data
directory has been re-initialised (`bun run postgres:reset --yes`, then `init`)
**When** `nix develop -c postgres --version` is run
**Then** it reports **18.x**, matching the Neon project's engine version (D-8)

**And given** the Drizzle schema in `packages/backend/database/`
**When** a developer changes a table definition and runs the generate command,
then the apply command against local PostgreSQL 18, then the same apply
command against Neon via `NEON_DATABASE_URL_DIRECT`
**Then** a timestamped migration file is generated, both databases converge to
the identical schema, re-running apply is a no-op, and no DDL string is
hand-written anywhere in the package

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Integration | `packages/backend/database/tests/migrations.test.ts` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run backend-database:test`
- Integration: `bun run postgres:reset --yes`, apply migrations, `psql -c '\d+ packs'`, apply again and confirm no-op.

**Watch Points**:
- 🔴 Migrations must **never** run automatically on server boot. Cloud Run can cold-start several instances at once; concurrent migration runs against one database is a corruption path. Applying is the explicit deploy step in AC-5.
- 🔴 Migrations must use `NEON_DATABASE_URL_DIRECT`, not the pooled URL. DDL under PgBouncer transaction mode is precisely where pooling breaks.
- 🔴 **A `postgresql_17` → `18` re-pin does not upgrade an existing data directory.** PostgreSQL refuses to start on a data directory initialised by a different major version. The developer-facing instruction is `postgres:stop` → `postgres:reset --yes` → `postgres:init`, and it **destroys local data**. Say so in the README and in the PR description; do not let a teammate discover it as an opaque startup failure.
- The generated SQL must be committed. A migration that only exists as a diff computed at runtime is not a migration.
- Assert the enum and both unique constraints exist **in the database** (`\d+`), not just in the TypeScript types — a `CHECK` that lives only in Drizzle's type layer enforces nothing.

### AC-3: The catalog write model exists with its constraints enforced

**Given** the migration is applied
**When** the repositories are exercised — create an account, create a pack it
owns, publish two versions, then attempt each violation below
**Then** every legitimate operation succeeds and each violation is rejected
**by the database**:

- a second account with the same `firebase_uid`
- a second pack with the same `slug`
- a second `pack_versions` row with the same `(pack_id, version)`
- a `pack_versions` row referencing a non-existent pack
- deleting an account that still owns a pack
- an invalid `visibility` value

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Integration | `packages/backend/database/tests/catalog_repository.test.ts` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run backend-database:test`
- Integration: the suite runs against the local PostgreSQL from C-387, not a mock. A mocked database cannot prove a constraint exists.

**Watch Points**:
- Tests must run against real PostgreSQL. If `bun herdr:start postgres` is not running, the suite should **skip with a clear message** rather than fail confusingly or silently pass.
- Each test must clean up after itself (transaction rollback per test is cleanest) so the suite is order-independent and re-runnable.
- `ON DELETE RESTRICT` — assert the delete is *rejected*, not that it cascades. Getting this backwards silently deletes catalog history later.

### AC-4: The architectural invariants are enforced structurally, not by convention

**Given** the package is wired into the hub
**When** the guards run
**Then** all three hold:

1. `bun moon run hub:build` succeeds and no database module, `pg`, `drizzle-orm`, or `NEON_DATABASE_URL` reference appears in any client-side bundle chunk (I-1).
2. `grep -rn "@neondatabase/serverless" --include='*.ts' apps packages | grep -v node_modules` returns zero matches, `grep -c "drizzle-typebox" bun.lock` returns 0, and neither `@neondatabase/serverless` nor `drizzle-typebox` appears as a dependency in any `package.json` (I-9, plus the drizzle-typebox exclusion). The `@sinclair/typebox` part of the exclusion is enforced as **no new direct dependency**: `@sinclair/typebox` must not be added to any `package.json`'s `dependencies` or `devDependencies`. A bare `bun.lock` grep for `@sinclair/typebox` would fail at baseline — the lockfile already carries `@sinclair/typebox@0.34.49` transitively via `@inlang/paraglide-js` → `@inlang/sdk` (a direct devDependency of both `client` and `hub`) and via `@jest/schemas`. Those are unrelated tooling; the guard's intent is that *this contract* does not pull the old scoped package into the runtime.
3. A **type-level conformance test** asserts each Drizzle inferred row type is assignable to the corresponding TypeBox catalog schema's `Static<>` type — every field of every wire shape exists on the row type with a compatible type (the wire shape is a projection of the row). It must fail to typecheck when a wire schema references a field the row type lacks or types differently, or when a field is removed from the row type. The reverse direction is intentionally NOT enforced: adding an internal column to a Drizzle table does not require a schema change, because wire shapes deliberately omit internal ids and server-assigned timestamps (see Architecture Directives — "They are permitted to differ").
4. `bun moon run :typecheck` and `bun moon run :lint` pass across the workspace.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Integration | CI: `bun moon ci` + the bundle grep | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run hub:build` then grep the emitted client chunks.
- Integration: `bun moon run :typecheck`, `bun moon run :lint`.

**Watch Points**:
- 🔴 SvelteKit only guarantees server-only code stays server-side for modules under `$lib/server` or named `*.server.ts`. A workspace package imported from a shared module can be pulled into the client graph. Import the database package **only** from `src/lib/server/`, and read `NEON_DATABASE_URL` through SvelteKit's `$env/dynamic/private` so a client import fails loudly at build time rather than shipping a secret.
- The bundle check must inspect the **built** client output, not the source. Source greps miss transitive imports, which is exactly how a credential leaks.
- The conformance test should be a pure type assertion (a `satisfies` / assignability helper, one direction: row → wire), not a runtime test. It costs nothing at runtime and fails at `:typecheck`, which is where drift should surface.
- The TypeBox catalog schemas are shared (`packages/shared/schemas`) and therefore **may** legitimately reach the client — that is their purpose. Only the Drizzle definitions are server-only. Do not co-locate them.

### AC-5: Migrations deploy through the standard deploy pipeline

**Given** `'database'` is registered as an app with `serviceType: 'database-migration'`
**When** `bun scripts/src/lib/deploy/index.ts database --mode=production` is run (the canonical invocation, matching the `release.yml` deploy job; `bun run scripts -- deploy/index database --mode=production` is equivalent)
**Then** it applies pending migrations against `NEON_DATABASE_URL_DIRECT`, is a
no-op when nothing is pending, exits non-zero on failure without leaving a
partial schema, and never runs as a side effect of deploying the `hub` app

**And** `bun moon run scripts:typecheck` passes — meaning `resolve_plan.ts`'s
`SERVICE_TYPE_OUTPUT_KEY` has gained its sixth entry and `release.yml` has a
job that reads it

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | Integration | `scripts/src/lib/deploy/__tests__/deployment_config.test.ts` + a dry-run against local Postgres | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run scripts:test`, `bun moon run scripts:typecheck`
- Integration: run the migration deploy against local Postgres first (point `NEON_DATABASE_URL_DIRECT` at `localhost:5433`), confirm apply-then-no-op.

**Watch Points**:
- 🔴 `resolve_plan.ts` documents its `Record<ServiceType, string>` typing as a deliberate tripwire: *"if a 6th entry is ever added to ALL_SERVICE_TYPES without a matching release.yml job, this file simply fails to compile."* Adding the service type **will** break `scripts:typecheck` until both the output key and the workflow job exist. This is the guard working — satisfy it, never widen the type to `Record<string, string>` to make the error go away.
- `AppIdSchema` gains `'database'`, but it belongs to neither `FrontendAppIdSchema` nor `BackendAppIdSchema`. Check every exhaustive `switch` over `AppId` (notably `scripts/src/lib/ops/logs.ts:61`) and give the new id an explicit branch — a migration job has no logs endpoint, and "unsupported" is the correct answer there, not a crash.
- `AppConfig` is shaped for Docker/hosting deploys; most fields (`shortName`, `imageName`, `needsDist`, `customDomains`) are meaningless for a migration job. Set `needsDist: false` and leave the hosting fields unset rather than inventing plausible-looking values.
- Deploying `database` must be **independently invocable**. A hub deploy that silently migrated would reintroduce exactly the coupling C-385 removed when Data Connect stopped riding along with the Firebase deploy.

## Implementation Sequence

0. **Phase 0 (Engine alignment)**: re-pin `flake.nix` to `pkgs.postgresql_18`; `postgres:stop` → `postgres:reset --yes` → `postgres:init`; confirm `postgres --version` reports 18.x. Do this first — every later phase tests against this engine. Verify the first half of AC-2.
1. **Phase 1 (Package skeleton)**: create `packages/backend/database/` following `packages/backend/utils/` structure; wire `.moon/workspace.yml`, workspace `package.json`, `tsconfig.json` paths. Add `drizzle-orm`, `drizzle-kit`, `pg`, `@types/pg`. Verify `bun install` and `bun moon sync` are clean before writing any schema.
2. **Phase 2 (Schema + migrations)**: Drizzle table definitions and `drizzle.config.ts`; generate the first migration; write the runner; add root `package.json` scripts. Apply against local Postgres. Verify the rest of AC-2.
3. **Phase 3 (Connection + repositories + TypeBox)**: lazy pooled connection factory; the three repositories; `packages/shared/schemas/src/lib/catalog/` schemas and the conformance test; integration tests against local Postgres. Verify AC-3.
4. **Phase 4 (Hub wiring)**: hub dependency, alias, `.env.*` keys, `GET /api/health/db`. Verify AC-1 locally.
5. **Phase 5 (Deploy path)**: `AppIdSchema`, `ALL_SERVICE_TYPES`, `APP_CONFIG`, the `index.ts` dispatcher case, `resolve_plan.ts` output key, `release.yml` job. Exercise against local Postgres before pointing it at Neon. Verify AC-5.
6. **Phase 6 (Neon)**: add `NEON_DATABASE_URL_DIRECT` to GSM and `.env.production`; confirm `NEON_DATABASE_URL` in `.env.production` uses the `-pooler` host (the value as of 2026-08-15 does not) and confirm both secrets exist in GSM; apply migrations to Neon via the Phase 5 path; deploy the hub; verify AC-1 against Cloud Run reports 18.x.
7. **Phase 7 (Guards + docs)**: the I-1 bundle check and I-9 grep; `:typecheck`, `:lint`; README section covering the PG18 reset and the two connection strings. Verify AC-4.

## Edge Cases & Gotchas

- **Cross-cloud is a design constraint, not a footnote.** Every query crosses from GCP `europe-west4` to AWS `eu-west-2`. One query per request is fine; an N+1 in a loop is ~15ms × N. Repositories must expose batch/`IN` reads, and reviewers should treat a query inside a loop as a defect.
- **Neon Free suspends after 5 minutes and cannot be configured otherwise.** The first query after idle pays the resume cost. On a low-traffic hub that is *most* requests — which is precisely why I-8 keeps these queries off the render path. Do not "solve" this with a keep-alive ping: it burns the 100 CU-hour monthly budget for nothing.
- 🔴 **The compute is configured to autoscale 0.25 ↔ 2 CU, and CU-hours are billed at the scaled size.** The 100 CU-hour monthly allowance is 400 hours at 0.25 CU but only **50 hours at 2 CU**. A single hot loop, a runaway backfill, or an accidental sequential scan under load can burn a month's budget in an afternoon, after which the compute is suspended until the next billing period — a hard outage on the free plan. Consider lowering the autoscale ceiling until there is real traffic to justify it, and treat a rising CU-hour graph as an incident signal rather than a growth signal.
- 🔴 **History retention is 6 hours.** That is the entire point-in-time-restore window. A bad migration or a destructive query noticed the next morning is **not recoverable** from Neon's history. The migration deploy step should take a logical backup (`pg_dump`) before applying, and store it somewhere outside Neon. At this data size that costs seconds and is the only real disaster-recovery story the free plan has.
- **The Free plan ceilings are real**: 0.5 GB storage, 100 CU-hours/month, 5 GB egress. Exceeding any of them suspends the compute until the next billing period. This is survivable only because D-14 keeps bytes and browse traffic off Postgres entirely. If a future contract proposes storing asset data or serving browse queries from Postgres, that is an I-7/I-8 violation, not a capacity question.
- **PgBouncer transaction mode changes semantics.** Session-level state (`SET`, advisory locks, some prepared-statement patterns) does not survive between statements. Drizzle's normal query path is fine; the *migration* runner should use the **direct**, non-pooled endpoint, since DDL in transaction-pooling mode is where this bites.
- **`packages/backend/firestore/` is an empty leftover** — only `tsconfig.tsbuildinfo` and a `node_modules` symlink survive C-386's deletion. Removing it is a one-line cleanup, but it is *not* in scope here; note it and leave it.
- **`AGENTS.md`'s directory table is stale.** It lists `packages/backend/{database, image}` and `packages/frontend/{dataconnect, repositories}`, none of which exist. This contract makes `packages/backend/database` real again; updating the rest of that table is a separate docs fix.
- **Statement timeout.** Without one, a stalled cross-cloud connection holds a Cloud Run request until its own timeout. Set a conservative statement timeout on the pool.

## Open Questions

**All resolved 2026-08-15.** One item remains as an execution-time action, not
a design decision.

1. **Who creates the Neon project? — RESOLVED: already done.** The maintainer
   provisioned it on 2026-08-15: PostgreSQL 18, AWS `eu-west-2` (London),
   compute 0.25 ↔ 2 CU, history retention 6 hours. `NEON_DATABASE_URL` is
   already in `apps/frontend/hub/.env.example` and `.env.production`.
   **Remaining action at execution time:** `NEON_DATABASE_URL_DIRECT` (the
   unpooled endpoint, for migrations only) is *not* yet set and must be added
   to GSM and `.env.production` during Phase 6.
2. **Lazy account-row creation — RESOLVED: option (b).** No row is written in
   the authentication path. An `accounts` row is created lazily the first time
   a member performs an action that needs one — the first such writer is C-398
   (submissions). Consequence to carry forward: "an account row exists" is
   **not** a valid precondition for C-399's ratings, which must create-or-fetch
   the row itself. Deciding this here rather than in C-398 keeps the auth path
   free of a cross-cloud write (I-8).
3. **Where does the migration apply step run? — RESOLVED: the deploy pipeline.**
   Registered as its own deployable app (`serviceType: 'database-migration'`),
   replacing the deleted flow where the Data Connect schema rode along with the
   Firebase deploy. See AC-5. It must remain independently invocable and must
   never be triggered as a side effect of deploying the hub.

## Amendments

| Version | Date | Change | Approved by |
|---|---|---|---|
| 2.1.0 | 2026-08-15 | Neon project provisioned as **PostgreSQL 18** (not 17) — added the `flake.nix` 17→18 re-pin and its destructive local-reset consequence to scope and AC-2, since D-8 requires local ≡ production. Adopted the maintainer's `NEON_DATABASE_URL` naming and added the second, unpooled `NEON_DATABASE_URL_DIRECT` for migrations. Added AC-5 (migration deploy path via a new `database-migration` service type) and the `resolve_plan.ts` compile-tripwire it triggers. Added `packages/shared/schemas/src/lib/catalog/` TypeBox API-boundary schemas plus a type-level conformance test, and recorded why `drizzle-typebox` is rejected (`@sinclair/typebox` vs `typebox@1.3.12`). Added Gotchas for the 0.25↔2 CU autoscale budget risk and the 6-hour retention window. Resolved all three Open Questions. Staging explicitly out of scope (D-10). | snorreks (via Claude) |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

## Execution Report

### Summary

Built the hub's server data plane end-to-end: a new `packages/backend/database/`
package (Drizzle schema for accounts/packs/pack_versions, generated migration,
transactional migration runner, lazy pooled `pg` connection, three typed
repositories), TypeBox catalog wire schemas with a type-level conformance gate,
hub wiring (`GET /api/health/db`), the `database` deploy app (`database-migration`
service type through the full deploy pipeline), the PG17→18 flake re-pin with a
clean local PG18.4 reset, and CI guards for I-1/I-9. All five ACs verified
locally against real PostgreSQL 18.4. The live Neon half of AC-1 (Cloud Run
deploy) and the GSM secret for `NEON_DATABASE_URL_DIRECT` are documented for the
pipeline — irreversible production mutations are not executed by the implementer.

### AC Status

| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | `GET /api/health/db` live-verified: `{"status":"ok","databaseVersion":"18.4","host":"localhost","roundTripMs":7}`; degraded (dead host) → `{"status":"unreachable"}` with `/login` still 200; unconfigured covered by unit test + lazy-pool invariant. Neon probe (read-only): both pooled and direct endpoints reachable, report 18.4. Cloud Run deploy evidence left for verification (deploys are pipeline-orchestrated). |
| AC-2 | ✅ | `flake.nix` re-pinned to `postgresql_18`; `nix develop -c postgres --version` → 18.4 (matches Neon). Local `.postgres/` re-initialised on 18.4. Migration `0000_dark_banshee.sql` generated (committed), applied to local postgres, re-apply is a no-op, and all constraints (unique firebase_uid, unique slug + url-safe CHECK, enum, composite unique, RESTRICT FKs) asserted in the database via `\d+` and `pg_constraint`/`pg_indexes`. |
| AC-3 | ✅ | 27/27 tests pass against real local PostgreSQL. Happy path (account→pack→two versions) + all six violations rejected by the DB: 23505 (dup firebase_uid/slug/(pack,version)), 23503 (missing pack FK), 23001 RESTRICT on account/pack delete (ON DELETE RESTRICT fires — assert that delete is *rejected*, not cascaded), 22P02 (bad enum), 23514 (slug CHECK). |
| AC-4 | ✅ | I-1: hub build + grep of `build/client` shows zero db/pg/drizzle/NEON references; source guard (`guard-data-plane`) enforces server-only imports. I-9: zero `@neondatabase/serverless`, `drizzle-typebox` absent from bun.lock, no `@sinclair/typebox` direct dep. Conformance test is a pure type assertion (row→wire) that fails `tsgo` on drift (verified both directions). `:typecheck`/`:lint` pass for all affected projects. |
| AC-5 | ✅ | `database` registered with `serviceType: 'database-migration'`, `needsDist: false`; dispatcher case runs backup→apply against `NEON_DATABASE_URL_DIRECT`; `resolve_plan.ts` gained its sixth `SERVICE_TYPE_OUTPUT_KEY` entry (compile tripwire satisfied); `release.yml` gained the `database_migration_apps` output + `deploy-database-migration` job; `logs.ts` has an explicit unsupported branch. Canonical invocation `bun scripts/src/lib/deploy/index.ts database --mode=emulator --yes` verified against local postgres: apply (1) then no-op (0), failure exits non-zero. |

### Files Created

| File | Purpose |
|---|---|
| `packages/backend/database/package.json` | Package manifest (`@aikami/backend-database`; drizzle-orm, drizzle-kit, pg, @types/pg) |
| `packages/backend/database/moon.yml` | Moon project (backend-database) |
| `packages/backend/database/tsconfig.json` | Backend tsconfig with workspace path mappings |
| `packages/backend/database/drizzle.config.ts` | Drizzle Kit config (generate → `./drizzle`) |
| `packages/backend/database/src/index.ts` | Package barrel (server-only, I-1 note) |
| `packages/backend/database/src/lib/schema.ts` | Drizzle schema: accounts, packs, pack_versions + constraints |
| `packages/backend/database/src/lib/connection.ts` | Lazy pooled connection factory (statement timeout, pool cap 5, no credential logging) |
| `packages/backend/database/src/lib/migrate.ts` | Migration runner (transactional, idempotent, journal-aware status) |
| `packages/backend/database/src/lib/repositories/account_repository.ts` | Account CRUD + createOrFetch (lazy account idiom) |
| `packages/backend/database/src/lib/repositories/pack_repository.ts` | Pack CRUD (slug/visibility/ownership) |
| `packages/backend/database/src/lib/repositories/pack_version_repository.ts` | Pack version CRUD (immutable, composite unique) |
| `packages/backend/database/src/lib/repositories/index.ts` | `createCatalogRepositories(pool)` bundle |
| `packages/backend/database/drizzle/0000_dark_banshee.sql` + `meta/` | Generated first migration (committed) |
| `packages/backend/database/tests/connection.test.ts` | AC-1 connection/lazy-pool tests |
| `packages/backend/database/tests/migrations.test.ts` | AC-2 migration + in-DB constraint tests |
| `packages/backend/database/tests/catalog_repository.test.ts` | AC-3 happy path + all six violation tests |
| `packages/backend/database/tests/conformance.test.ts` | AC-4.3 type-level row→wire conformance gate |
| `packages/backend/database/tests/helpers.ts` | Test connection/truncate/pg-error-code helpers |
| `packages/shared/schemas/src/lib/catalog/account.ts` | AccountPublicSchema (wire projection) |
| `packages/shared/schemas/src/lib/catalog/pack.ts` | PackSummarySchema + PackVisibilitySchema |
| `packages/shared/schemas/src/lib/catalog/pack_version.ts` | PackVersionSchema |
| `apps/frontend/hub/src/lib/server/api/health_db.ts` | AC-1 `GET /api/health/db` handler (lazy pool, host-only, 3-state response) |
| `apps/frontend/hub/src/lib/server/api/health_db.test.ts` | AC-1 handler unit tests (ok/unconfigured/unreachable) |
| `scripts/src/lib/database/migrate.ts` | Developer `db:migrate`/`db:status` CLI (local + production DIRECT) |
| `scripts/src/lib/deploy/database_migration.ts` | AC-5 deploy app: pg_dump backup + applyMigrations |
| `scripts/src/lib/deploy/__tests__/deployment_config.test.ts` | AC-5 config + secret-naming tests |
| `scripts/src/lib/ops/guard_data_plane.ts` | I-1 (source) + I-9 CI guard |

### Files Modified

| File | Change |
|---|---|
| `flake.nix` | `postgresql_17` → `postgresql_18` (C-394 AC-2) + destructive-reset warning comment |
| `README.md` | PG18 version note + destructive reset instructions; new "Server data plane" dev-setup section (two connection strings, migration commands) |
| `.gitignore` | Added `.db-backups/` (pre-migration logical backups) |
| `.moon/workspace.yml` | Registered `backend-database` project |
| `package.json` (root) | Added `db:generate`, `db:migrate`, `db:status` scripts |
| `biome.json` | Removed the stale `@aikami/backend-database` import restriction (package now exists) |
| `packages/shared/schemas/src/index.ts` | Barrel-exported the catalog schemas |
| `packages/shared/schemas/src/lib/project/project.ts` | Added `'database'` to `AppIdSchema` |
| `apps/frontend/hub/package.json` | Added `@aikami/backend-database` dependency |
| `apps/frontend/hub/moon.yml` | Added `backend-database` to dependsOn |
| `apps/frontend/hub/svelte.config.js` | Added `@aikami/backend/database` alias |
| `apps/frontend/hub/src/lib/server/api/index.ts` | Mounted `GET /api/health/db` on the Elysia app |
| `scripts/moon.yml` | Added `guard-data-plane` task (runInCI) |
| `scripts/src/lib/deploy/deployment_config.ts` | Added `database-migration` service type + `database` app entry |
| `scripts/src/lib/deploy/index.ts` | `database-migration` dispatcher case; skips checksum cache like firebase-functions |
| `scripts/src/lib/deploy/resolve_plan.ts` | Sixth `SERVICE_TYPE_OUTPUT_KEY` entry + `database_migration_apps` bucket |
| `scripts/src/lib/ops/logs.ts` | Explicit `database-migration` unsupported branch |
| `.github/workflows/release.yml` | `database_migration_apps` output + `deploy-database-migration` job |
| `scripts/src/lib/agents/contract_pipeline/{herdr_adapter,stage_runner,contract_status,status}.ts` | Pre-existing typecheck/lint failures fixed (dead code / style) so `:typecheck`/`:lint` pass — see Deviations |

### Deviations from Spec

1. **Phase 6 live Neon actions deferred to the pipeline (execution-time scope boundary).** The implementer stage is forbidden from deploying or making irreversible production mutations (`NEON_DATABASE_URL_DIRECT` → GSM, applying migrations to Neon, Cloud Run deploy). Read-only probes were run instead: both Neon endpoints (pooled `-pooler` and direct) are reachable and report **18.4**; `NEON_DATABASE_URL` exists in GSM, `NEON_DATABASE_URL_DIRECT` does not yet. Exact remaining commands for the pipeline: (a) create GSM secret `NEON_DATABASE_URL_DIRECT` with the direct URL from `apps/frontend/hub/.env.production`; (b) confirm that file's `NEON_DATABASE_URL` uses the `-pooler` host (worktree copy already swapped; the value is gitignored so it does not travel with the PR); (c) `bun run deploy database --mode=production`; (d) deploy the hub and curl `/api/health/db` — expect `18.x`. No amendment needed; this matches the AC evidence matrix ("Filled during verification").
2. **Pre-existing `scripts:typecheck`/`scripts:lint`/workspace `:lint` failures fixed** (3+3 errors in `scripts/src/lib/agents/contract_pipeline/` — unused vars, dead `role === 'review'` branch, non-null assertion, single-line ifs — plus one formatting fix each in `scripts/src/lib/project_setup/iam.ts` and `.pi/extensions/lib/tool_namespace.ts`). They predate this contract (verified by stashing), but AC-4.4/AC-5 require `:typecheck`/`:lint` to pass, so the mechanical, behavior-preserving fixes are included. Amendment proposed: none needed, but reviewers may want to attribute these to a follow-up cleanup if they prefer strictly-scoped PRs.
3. **Local verification environment**: the worktree's direnv delegates to the main repo's flake (still PG17), so local postgres lifecycle + deploy dry-runs used the PG18.4 binaries from the worktree's re-pinned flake (`nix develop`/direct store path). CI and normal checkouts use the re-pinned flake directly — no issue there.
4. `bun run db:migrate --mode=production` and the `database` deploy read `NEON_DATABASE_URL_DIRECT` from `apps/frontend/hub/.env.production`. That file is gitignored; the worktree copy has both keys (pooled `NEON_DATABASE_URL` + direct `NEON_DATABASE_URL_DIRECT`) but the deploy machine's copy still needs the Phase 6 update — covered in deviation 1.

### Test Results

- Unit: backend-database 27/27 pass (0 failures); hub 6/6 (3 pre-existing + 3 new); scripts 202/202 (4 new AC-5 tests); schemas suite passes.
- E2E: N/A — no UI in this contract (explicitly out of scope).
- Visual: N/A — no UI; the user-facing surface is the `/api/health/db` endpoint, verified live via curl (200 JSON on healthy + degraded paths).
- Baseline: 0 pre-existing failures in the Phase-0 baseline runs (`scripts:test` 198, `hub:test` 3, `hub:build` after env sync). `scripts:typecheck`/`scripts:lint` had pre-existing failures (fixed — see Deviations). `validate()`'s workspace-wide `:fix` pass also touched unrelated pre-existing unformatted files; all reverted to keep the diff scoped.
