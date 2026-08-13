---
id: C-387
title: "Local PostgreSQL Development Environment (replaces the Data Connect emulator)"
source: "user request — 'Can we setup local emulator for psql?'"
status: implemented
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: "https://github.com/BearlySleeping/aikami/pull/137"
  pr_number: 137
created_at: "2026-08-12"
---

# Contract C-387: Local PostgreSQL Development Environment

> ✅ **Approved 2026-08-13.** The sole Open Question is resolved (pin
> PostgreSQL 17; production provider stays undecided and out of scope — that's
> a future contract for when the hub has a real consumer). No application
> code, no schema, no consumers — pure dev tooling, safe to land any time.

## Metadata

| Field | Value |
|---|---|
| **Source** | User request during the data-layer review: "Can we setup local emulator for psql?" Architecture: `docs/architecture/data-layer-target-architecture.md` (D-6, D-8). |
| **Target** | `flake.nix`, `scripts/src/lib/herdr/session.ts`, `packages/shared/constants/src/lib/development_ports.ts`, plus new database lifecycle scripts |
| **Priority** | P2 — no consumer exists until the community catalog is built. Land this immediately before that work, not before. |
| **Dependencies** | C-385 (Data Connect removed — it currently owns the local Postgres and port 5432). |
| **Status** | approved |
| **Promotion** | — |
| **Docs Impact** | internal → developer setup notes in the repo README |
| **Contract version** | 2.1.0 |

## Problem & Baseline Evidence

- **Current behavior (historical)**: Before C-385, the only local Postgres in the project was the one the Data Connect emulator provided — `packages/shared/constants/src/lib/emulator.ts` hardcoded `postgresql://postgres@localhost:5432/dataconnect_emulator?sslmode=disable`, while `apps/backend/firebase/scripts/on_emulate.ts` defaulted `PGDATABASE` to `fdcdb`, disagreeing about the database name. **Verified 2026-08-13: both are gone.** C-385's merge already removed the Data Connect references from `emulator.ts` and the `PGDATABASE`/`fdcdb` default from `on_emulate.ts`. This bullet is kept only as the "why" — the disagreement is evidence nobody owned this surface, which is why it's worth owning properly now.
- **The engine is pglite**, not real PostgreSQL. C-374 records a concrete failure caused by that difference: *"raw-SQL `_executeReturning` fails against the pinned pglite emulator (pq: unexpected message 'E')"*. Divergence between the local engine and the production engine is a bug source, not a convenience.
- **After C-385 there is no local Postgres at all**, because it disappears with the Data Connect emulator.
- **Existing implementation to reuse**:
  - `flake.nix` already provisions the full dev toolchain via a Nix devShell and already includes `google-cloud-sql-proxy` — so connecting to a real Cloud SQL instance from a developer machine is already possible.
  - `scripts/src/lib/herdr/session.ts` → `SERVICE_DEFS` is a declarative map of dev services, each with a `command`, `cwd`, and optional `readyPort`. Adding a service is a single entry.
  - `packages/shared/constants/src/lib/development_ports.ts` is the single source of truth for port allocation and documents the Nordclaw/Aikami split convention in a comment table.
  - `on_emulate.ts` → `seedAudioTracks` (deleted by C-385) is a working reference for connecting to Postgres with `pg`, waiting for readiness with a retry loop, and seeding rows.
- **Known gaps**: No Postgres binary in the devShell, no data directory convention, no lifecycle scripts, no port allocation, no herdr service, no seeding entry point.
- **Baseline tests**: `nix develop -c bun --version` must succeed before starting.

## User Outcome

After this contract, a **developer** can run `bun herdr:start postgres` and get
a real PostgreSQL matching the production engine, with the same lifecycle
ergonomics as every other Aikami dev service, and no Docker requirement.

## Success Measures

- **Time/latency target**: Cold start (first `initdb` + boot) under 15s. Warm start under 2s.
- **Offline/degraded behavior**: Fully offline. Nix provides the binary; no image pull, no network.
- **Production journey enabled**: Unblocks the community catalog contract, which is the hub's actual reason to exist.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Dev toolchain provisioning | `flake.nix` → `devShells.default.packages` | modify |
| Dev service lifecycle | `scripts/src/lib/herdr/session.ts` → `SERVICE_DEFS` | modify |
| Port allocation | `packages/shared/constants/src/lib/development_ports.ts` | modify |
| Postgres connection + readiness retry | `on_emulate.ts` → `seedAudioTracks` (pre-C-385) | reuse as reference |
| Cloud SQL access from local | `flake.nix` → `google-cloud-sql-proxy` | reuse unchanged |

## Overview

Add real PostgreSQL to the Nix devShell, give it a data directory under a
gitignored path, expose lifecycle scripts (`init`, `start`, `stop`, `reset`,
`psql`), register it as a herdr service so it behaves like every other dev
service, and allocate it a dedicated Aikami port that does not collide with a
system Postgres or with the Nordclaw project.

## Design Reference

Follow the existing `SERVICE_DEFS` entry shape in `session.ts` exactly — the
`firebase` entry is the closest analogue (a long-running server with a
`readyPort`). Follow the port-allocation comment convention in
`development_ports.ts`: Nordclaw takes the conventional port, Aikami takes a
neighbouring one. Nix-provided PostgreSQL runs as the invoking user with no
system service and no `sudo`.

Architecture: `docs/architecture/data-layer-target-architecture.md` D-8 —
local must equal production. The production Postgres provider is not yet
decided (Cloud SQL, Neon, and Supabase are all live options — see
`docs/research/database-architecture-recommendation.md` §2); pin to
PostgreSQL 17, the latest stable major, which every candidate provider
supports identically over the wire protocol. Re-pin only if the eventual
provider choice turns out not to offer it (resolved — see Open Questions).

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- **No Docker.** The project is Nix-based; adding a container runtime to the
  required toolchain is a regression in setup cost.
- The data directory lives under a gitignored path inside the repo (alongside
  other local state) so `reset` is a directory delete and nothing escapes into
  the developer's home directory or system Postgres.
- Trust authentication on localhost only. No password, no TLS, no role
  management locally — production auth is IAM database authentication and is
  configured separately.
- The service must be **independently startable**. `bun herdr:start postgres`
  must work without the Firebase emulator running, and vice versa.

## State & Data Models

No application data models. Configuration surface:

```ts
/** Added to EMULATOR_PORTS in development_ports.ts. */
postgres: 5433,   // 5432 left free for a developer's system Postgres
```

```
Data directory:  .postgres/data/     (gitignored)
Socket dir:      .postgres/run/      (gitignored — avoids /tmp collisions
                                      between concurrent projects)
Database name:   aikami_dev
Role:            the invoking OS user (initdb default)
Connection URL:  postgresql://localhost:5433/aikami_dev?sslmode=disable
```

## Quality Requirements

- **Offline/degraded mode**: Must work with no network. Nix supplies the binary.
- **Accessibility/input**: N/A — no UI.
- **Performance budget**: See Success Measures.
- **Security/privacy**: Bind to `127.0.0.1` only — never `0.0.0.0`. Trust auth is acceptable *only* because the socket and TCP listener are loopback-scoped. State this in a comment where the listener is configured.
- **Persistence/migration**: The data directory survives `stop`/`start` and is destroyed only by an explicit `reset`. Schema migrations are out of scope — no schema exists yet.
- **Cancellation/retry/idempotency**: `init` must be idempotent (no-op if the data directory is already initialised). `start` must be idempotent (no-op if already running). `stop` must succeed if already stopped.
- **Observability**: Postgres logs to a file inside the data directory and to the herdr pane. A failed start must print the log tail, not just a non-zero exit code.

## Migration & Rollback

- **Old data compatibility**: N/A — no local Postgres data exists after C-385.
- **Migration**: N/A.
- **Rollback**: `git revert`, then delete the `.postgres/` directory. Nothing outside the repo is touched.
- **Feature flag or kill switch**: The service is opt-in by construction — it starts only when requested and is not part of `herdr:start all` unless explicitly added.
- **Failure recovery**: `reset` (delete data directory, re-`init`) is always a valid recovery. Document it.

## Scope Boundaries

- **In Scope:**
  - `flake.nix` — add the PostgreSQL package to the devShell.
  - `packages/shared/constants/src/lib/development_ports.ts` — add the port and its comment-table row.
  - `scripts/src/lib/herdr/session.ts` — add a `postgres` entry to `DevService` and `SERVICE_DEFS`.
  - New lifecycle script exposing `init`, `start`, `stop`, `reset`, `psql`, `status`.
  - `.gitignore` — add the data directory.
  - README developer-setup section.
- **Out of Scope:**
  - Any schema, table, migration, ORM, or Drizzle configuration.
  - Any application code connecting to this database.
  - Provisioning any production Postgres instance (provider not yet decided — future contract, when the hub actually needs it).
  - CI integration — no CI job needs Postgres until a consumer exists.
  - Adding `postgres` to the `all` service group.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** Not split. A devShell package without lifecycle scripts
is unusable; lifecycle scripts without the herdr entry diverge from every
other service's ergonomics. One cohesive capability.

## Acceptance Criteria

### AC-1: PostgreSQL is available in the devShell

**Given** a clean checkout
**When** `nix develop` is entered
**Then** `postgres --version` and `psql --version` both resolve to the Nix-provided binaries and report the intended major version

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Integration | Manual: `nix develop -c postgres --version` | N/A | Filled during verification |

**Watch Points**:
- Pin the major version explicitly (`pkgs.postgresql_17`, not `pkgs.postgresql`) so a nixpkgs bump cannot silently change the engine version and break the local≡production guarantee.
- 17 is offered by Cloud SQL, Neon, and Supabase alike (verified 2026-08-13), so the pin holds regardless of which one is chosen later. If the eventual choice doesn't support 17 by then, re-pin as a one-line change — it does not reopen this contract.

### AC-2: The lifecycle scripts are idempotent

**Given** a clean checkout with no `.postgres/` directory
**When** `init` then `start` then `start` then `stop` then `stop` are run in sequence
**Then** every command exits `0`, exactly one server process ends up running after the first `start`, and no error is printed for the repeated calls

**And when** `reset` is run
**Then** the data directory is removed, re-initialised, and the server is left stopped

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Integration | Manual sequence above | N/A | Filled during verification |

**Watch Points**:
- Detect "already running" via `pg_ctl status` against the data directory, not by probing the port — another process on the port must produce a clear error, not a silent no-op.
- `reset` deletes data. Require an explicit confirmation flag (e.g. `--yes`) or an interactive prompt.

### AC-3: `bun herdr:start postgres` behaves like every other service

**Given** the devShell is active
**When** `bun herdr:start postgres` is run
**Then** a `postgres` tab appears in the `aikami-emulator` workspace, the readiness wait succeeds on the allocated port, `bun herdr:list` reports it `healthy`, and `bun herdr:stop postgres` shuts it down cleanly

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Integration | `bun herdr:list` output | N/A | Filled during verification |

**Test Hooks**:
- Integration: `bun herdr:start postgres` → `bun herdr:list` → `bun herdr:stop postgres`.

**Watch Points**:
- `readyPort` in `SERVICE_DEFS` is a function of `mode`. Return the port for `emulator` and `undefined` for `staging`/`production` — there is no local Postgres in those modes.
- The `postgres` service must not be added to the `all` group in this contract (Out of Scope) — a developer with no catalog work in progress should not pay for it on every `herdr:start all`.

### AC-4: A client can connect and run SQL

**Given** the server is running
**When** `psql "postgresql://localhost:5433/aikami_dev?sslmode=disable" -c 'SELECT 1'` is executed
**Then** it returns `1`

**And when** the same URL is used from a Bun script via `pg`
**Then** the connection succeeds and `SELECT version()` reports the pinned major version

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Integration | Manual `psql` + a throwaway `pg` script | N/A | Filled during verification |

**Watch Points**:
- Verify the listener is bound to `127.0.0.1` only — `ss -ltnp | grep 5433` must not show `0.0.0.0`.
- The `aikami_dev` database must be created by `init` (initdb creates only `postgres`/`template*`), otherwise the connection URL in the docs is wrong on a fresh machine.

## Implementation Sequence

1. **Phase 1 (Toolchain)**: Add the pinned PostgreSQL package to `flake.nix`. Verify AC-1.
2. **Phase 2 (Lifecycle)**: Write the lifecycle script — `init` (initdb + create database, idempotent), `start`, `stop`, `status`, `reset`, `psql`. Add `.postgres/` to `.gitignore`. Verify AC-2.
3. **Phase 3 (Integration)**: Add the port constant and comment-table row; add the `postgres` entry to `DevService` and `SERVICE_DEFS`. Verify AC-3 and AC-4.
4. **Phase 4 (Docs)**: Add a developer-setup section to the README covering start/stop/reset and the connection URL.

## Edge Cases & Gotchas

- **Unix socket directory**: PostgreSQL defaults its socket to `/tmp` or `/run/postgresql`, which collides across concurrent projects and can fail on a read-only `/run`. Set the socket directory explicitly to the repo-local path in the State section.
- **Port 5432 is deliberately not used.** Many developer machines run a system Postgres there. Binding 5433 avoids a confusing "connected to the wrong database" failure. Record this reasoning in the port-allocation comment block.
- **`initdb` locale**: pass an explicit locale/encoding (`--encoding=UTF8 --locale=C`) so the local collation is deterministic and matches common managed-provider defaults, regardless of which one is eventually chosen — text ordering should not differ between environments.
- **Nix store binaries are read-only**: the data directory must be outside the store. The repo-local `.postgres/` path handles this.
- **Stale postmaster PID after an unclean shutdown**: `start` should detect a stale `postmaster.pid` whose process no longer exists and clear it rather than failing with an opaque message.
- **Do not seed anything.** There is no schema. A seeding entry point belongs to the catalog contract.

## Open Questions

**Resolved 2026-08-13.** Which PostgreSQL major version should the devShell
pin to, given production Postgres provider and instance are not yet decided?
**Answer: pin to PostgreSQL 17** (latest stable major), rather than block on
an infra decision this contract doesn't need to make. Cloud SQL, Neon, and
Supabase all support 17 identically over the wire protocol, so the pin holds
under any eventual choice. Provisioning that production instance is out of
scope here (see Scope Boundaries) and lands as its own contract once the hub
has a real consumer for it — this contract only needs local≡production at the
engine-version level, not a committed hosting decision.

## Amendments

| Version | Date | Change | Approved by |
|---|---|---|---|
| 2.1.0 | 2026-08-13 | Resolved the sole Open Question (pin PostgreSQL 17 rather than block on an undecided production provider — Cloud SQL/Neon/Supabase all support it identically). Reworded Cloud-SQL-specific language to stay provider-neutral, since the production Postgres choice is deferred to a future contract when the hub has a real consumer. Corrected the stale "current behavior" bullet — verified C-385 already removed the Data Connect Postgres references it described. Status: draft → approved. | snorreks (via Claude) |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

---

## Execution Report

### Summary

Added a real, Nix-pinned PostgreSQL 17 dev environment: `postgresql_17` in the devShell (AC-1), a repo-local lifecycle script (`scripts/src/lib/postgres/lifecycle.ts`) exposing `init`/`start`/`stop`/`reset`/`psql`/`status` with idempotent commands, stale-`postmaster.pid` recovery, and destructive `reset --yes` guard (AC-2), a herdr `postgres` service with an emulator-only `readyPort` on 5433 — kept out of the `all` group — plus a new raw-TCP readiness probe so the generic HTTP fetch never polls a Postgres port (AC-3), and verified client connectivity via `psql` and a `pg` Bun script, with the listener bound to 127.0.0.1 only (AC-4). Port 5433 + rationale recorded in `development_ports.ts`; `.postgres/` gitignored; README developer-setup section added.

### AC Status

| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | `nix develop -c postgres --version` / `psql --version` → 17.10 (pinned `pkgs.postgresql_17`). |
| AC-2 | ✅ | init→start→start→stop→stop all exit 0, one postmaster after first start, repeats no-op; `reset` requires `--yes`, deletes, re-inits, leaves stopped; `kill -9` stale-pid recovery verified. Cold init 0.6s / warm start 0.15s (budget 15s/2s). |
| AC-3 | ✅ | `bun herdr:start postgres` → tab, readiness wait passes on :5433, `bun herdr:list` reports `:5433 ready`, `bun herdr:stop postgres` shuts down cleanly. Not added to `all` group (unit-tested). |
| AC-4 | ✅ | `psql ... -c 'SELECT 1'` → 1; Bun `pg` script connects and reports `PostgreSQL 17.10`; `ss -ltnp` shows `127.0.0.1:5433` only (never 0.0.0.0). |

### Files Created

| File | Purpose |
|---|---|
| `scripts/src/lib/postgres/lifecycle.ts` | PostgreSQL lifecycle script (`init`/`start`/`stop`/`reset`/`psql`/`status`, plus `start --foreground` for the herdr pane). |
| `scripts/src/lib/postgres/lifecycle.test.ts` | Unit tests: config constants, state helpers, stale-pid handling. |

### Files Modified

| File | Change |
|---|---|
| `flake.nix` | Added `postgresql_17` to the devShell packages (pinned major). |
| `packages/shared/constants/src/lib/development_ports.ts` | Added `postgres: 5433` to `EMULATOR_PORTS` + comment-table rows documenting why 5432 is left for a system Postgres. |
| `scripts/src/lib/herdr/session.ts` | Added `postgres` to `DevService`/`SERVICE_DEFS` (emulator-only `readyPort`, `readyCheck: 'tcp'`), introduced `KNOWN_SERVICES` (validation/listing superset; `ALL_SERVICES`/`all` group unchanged), made `isPortReady` protocol-aware (`http` default, `tcp` probe), threaded `readyCheck` through `waitForReady`/`assessServicePane`/`listServices`. |
| `scripts/src/lib/herdr/session.test.ts` | Added postgres registry tests + TCP-probe unit tests. |
| `.pi/extensions/herdr_orchestrator.ts` | Switched the `herdr_session` service enum/messages to `KNOWN_SERVICES` and passed `svc.readyCheck` to readiness probes. |
| `package.json` | Added `postgres:init/start/stop/reset/psql/status` scripts. |
| `.gitignore` | Ignored `.postgres/`. |
| `README.md` | Added “Local PostgreSQL (dev)” developer-setup section (start/stop/reset, connection URL, lifecycle notes). |

### Deviations from Spec

- **No deviations from the approved ACs.** The only scope note: `.pi/extensions/herdr_orchestrator.ts` was updated beyond the listed Target files so the pi `herdr_session` tool schema accepts `postgres` like every other service (the extension is the same herdr manager; without it the tool would reject the new service). This is consistent with “behaves like every other service” and the contract’s reuse map. No AC change, no Amendment needed.
- **Pre-existing baseline failure (not caused by C-387):** `pi:typecheck`/`pi:fix` fail on `.pi/extensions/direnv.ts:47` — unused `isEmulator` (TS6133). Proven pre-existing by stashing C-387 changes and reproducing at baseline. Left untouched (out of scope; biome’s auto-fix mangles the import block). `scripts` and `constants` projects are fully clean.
- **Worktree verification caveat:** the herdr pane runs `direnv exec .`, and worktree `.envrc` delegates to the main repo’s flake (which lacks `postgresql_17` until this PR merges). AC-3 was verified end-to-end by temporarily adding the worktree-pinned postgresql_17 bin dir to the worktree `.envrc` (reverted after). In a normal dev checkout, `direnv exec .` uses the repo’s own flake with `postgresql_17` — no issue.

### Test Results

- Unit: 25/25 PASS (lifecycle.test.ts + session.test.ts C-387 additions).
- Full scripts suite: 91/91 PASS (baseline 70 → +21 new).
- E2E: N/A (no UI; manual/integration ACs exercised live above).
- Visual: N/A (internal dev tooling, no UI).
- Baseline: 1 pre-existing failure (`pi` project `direnv.ts:47`, reproduced at baseline via stash), 0 new failures.
