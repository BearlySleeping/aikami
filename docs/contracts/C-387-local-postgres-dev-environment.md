---
id: C-387
title: "Local PostgreSQL Development Environment (replaces the Data Connect emulator)"
source: "user request — 'Can we setup local emulator for psql?'"
status: draft
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-08-12"
---

# Contract C-387: Local PostgreSQL Development Environment

## Metadata

| Field | Value |
|---|---|
| **Source** | User request during the data-layer review: "Can we setup local emulator for psql?" Architecture: `docs/architecture/data-layer-target-architecture.md` (D-6, D-8). |
| **Target** | `flake.nix`, `scripts/src/lib/herdr/session.ts`, `packages/shared/constants/src/lib/development_ports.ts`, plus new database lifecycle scripts |
| **Priority** | P2 — no consumer exists until the community catalog is built. Land this immediately before that work, not before. |
| **Dependencies** | C-385 (Data Connect removed — it currently owns the local Postgres and port 5432). |
| **Status** | draft |
| **Promotion** | — |
| **Docs Impact** | internal → developer setup notes in the repo README |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: The only local Postgres in the project is the one the Data Connect emulator provides. `packages/shared/constants/src/lib/emulator.ts` hardcodes `postgresql://postgres@localhost:5432/dataconnect_emulator?sslmode=disable`, while `apps/backend/firebase/scripts/on_emulate.ts` defaults `PGDATABASE` to `fdcdb` — the two disagree about the database name, which is itself evidence that nobody owns this surface.
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
local must equal production. Use the same major PostgreSQL version that the
Cloud SQL instance will run.

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
  - Provisioning the production Cloud SQL instance.
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
- Confirm the chosen major version is offered by Cloud SQL before pinning.

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
- **`initdb` locale**: pass an explicit locale/encoding (`--encoding=UTF8 --locale=C`) so the local collation matches Cloud SQL's default and text ordering does not differ between environments.
- **Nix store binaries are read-only**: the data directory must be outside the store. The repo-local `.postgres/` path handles this.
- **Stale postmaster PID after an unclean shutdown**: `start` should detect a stale `postmaster.pid` whose process no longer exists and clear it rather than failing with an opaque message.
- **Do not seed anything.** There is no schema. A seeding entry point belongs to the catalog contract.

## Open Questions

Must be resolved before status becomes `approved`:

- Which PostgreSQL major version will the production Cloud SQL instance run? The devShell pin must match it (AC-1).

## Amendments

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

---
