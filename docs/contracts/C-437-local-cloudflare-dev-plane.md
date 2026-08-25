---
id: C-437
title: "Local Cloudflare Dev Plane — wrangler dev with D1 and R2 as a first-class dev service"
source: "user request 2026-08-24 — open-source readiness; dev/prod runtime divergence on the hub"
status: implemented
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: "https://github.com/BearlySleeping/aikami/pull/192"
  pr_number: 192
created_at: "2026-08-24"
---

# Contract C-437: Local Cloudflare Dev Plane — wrangler dev with D1 and R2 as a first-class dev service

## Metadata

| Field | Value |
|---|---|
| **Source** | User request (2026-08-24). The hub deploys as a Cloudflare Worker with D1/R2 bindings, but its dev command runs plain Vite with neither. |
| **Target** | `scripts/src/lib/herdr/session.ts` — a new `hub-worker` dev service; `apps/frontend/hub/` — a `dev:worker` script and local D1/R2 state; `packages/backend/database/` — a local migration + seed path |
| **Priority** | P1 — this is the C-392 dev/prod parity principle, unapplied to the hub. Today no contributor can work on auth, the catalog write path, or save backup without a Cloudflare account. |
| **Dependencies** | C-426 (implemented) — the D1 schema, Better Auth, and `wrangler.jsonc` already exist. Independent of C-436; both may land in either order. |
| **Status** | approved |
| **Promotion** | — |
| **Docs Impact** | internal — `docs/guides/database.md` and `docs/guides/dev-workflow.md` carry "tracked as C-437" markers to replace with the real workflow. |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: `apps/frontend/hub/package.json` defines `"dev": "vite dev --mode emulator"`, and `SERVICE_DEFS.hub` in `scripts/src/lib/herdr/session.ts` runs exactly that. Plain Vite provides **no** `platform.env`, so `DB` and `SAVES_BUCKET` are both `undefined` locally.

- **What that costs**: `getBetterAuth()` in `apps/frontend/hub/src/lib/server/api/better_auth.ts` returns `undefined` when the binding is missing — correct, deliberate degradation, and it means **sign-in cannot be exercised locally at all**. The same is true of save backup/restore (C-426 AC-6/AC-7) and any catalog write path.

- **The repo already knows this is wrong.** `SERVICE_DEFS` carries a C-392 comment explaining that the voice/image/text dev engines deliberately delegate to the same compose topology the published stack ships, "so dev and user engines cannot drift." The hub has no equivalent — it is the one service whose dev runtime is a different runtime from production.

- **Reproduction**:
  1. `bun moon run hub:dev`
  2. Navigate to `/login`, attempt sign-in → the auth surface is unavailable, with no error explaining why.
  3. `grep -n "dev" apps/frontend/hub/package.json` → every dev variant is `vite dev`.

- **Existing implementation to reuse**:
  - `apps/frontend/hub/wrangler.jsonc` — the binding declarations are already correct and complete; `wrangler dev` reads this file directly.
  - `packages/backend/database/drizzle.d1.config.ts` — generates the migrations `wrangler d1 migrations apply --local` consumes.
  - `SERVICE_DEFS` / `PORTS` / `readyPort` in `session.ts` — the dev-service pattern to follow. The `postgres` entry is the closest analogue: an emulator-only service with a lifecycle script and a non-default readiness probe.

- **Known gaps**: no local D1 seeding exists; `wrangler` is not in `flake.nix`; `apps/frontend/hub/moon.yml` has no task for a Worker dev run. (`.wrangler/` is already in `.gitignore` at line 138.)

- **Baseline tests**: `bun test apps/frontend/hub/src/lib`, `bun test scripts/src/lib/herdr/session.test.ts`, `bun test packages/backend/auth/tests/`.

## User Outcome

After this contract, a **developer with no Cloudflare account and no network**
runs one command, gets the hub on the real Workers runtime with working D1 and
R2, and can sign in, create a pack, and back up and restore a save entirely
locally.

## Success Measures

- **Time/latency target**: `bun run herdr:start hub-worker` reaches a ready port within the existing 120s service timeout, on a cold `.wrangler/` state directory.
- **Offline/degraded behavior**: the whole flow works with the network unplugged after the first `bun install`. Miniflare's D1 and R2 are local SQLite and local files — no Cloudflare API call is involved in `--local` mode.
- **Production journey enabled**: sign-in, pack creation, and save backup/restore become locally testable, which is the precondition for anyone but the maintainer working on them.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Worker + binding config | `apps/frontend/hub/wrangler.jsonc` | **reuse** unchanged — `wrangler dev` reads it as-is |
| Dev service registry | `scripts/src/lib/herdr/session.ts` (`SERVICE_DEFS`, `KNOWN_SERVICES`, `ALL_SERVICES`) | **modify** — add `hub-worker` |
| Port registry | `PORTS` in the session/env config | **modify** — add a `hubWorker` port per mode |
| Emulator-only service precedent | the `postgres` entry in `SERVICE_DEFS` | **reuse as pattern** — mode-gated command, lifecycle script, explicit readiness |
| D1 migration generation | `packages/backend/database/drizzle.d1.config.ts` | **reuse** — unchanged |
| Better Auth binding acquisition | `apps/frontend/hub/src/lib/server/api/better_auth.ts` | **reuse** — should need no change; if it does, the binding is not being provided correctly |
| Toolchain | `flake.nix` | **modify** — provide `wrangler` on tier 1 |

## Overview

Add a `hub-worker` dev service that runs the hub under `wrangler dev --local`,
so the local runtime is the same runtime production uses, with D1 and R2 served
by miniflare from state persisted under `.wrangler/`. Add the migration and seed
commands that make that database useful on first run, and wire the service into
the herdr registry so it starts, stops, and reports health like every other
service.

The existing `hub` (Vite) service **stays**. Vite's HMR is materially better for
UI work and most hub changes don't touch a binding. This contract adds the
option, it does not remove one — but the documentation must make clear which to
reach for.

## Design Reference

- `SERVICE_DEFS.postgres` in `scripts/src/lib/herdr/session.ts` — the model for a mode-gated dev service with its own lifecycle and readiness semantics, including the `readyCheck: 'tcp'` escape hatch for a service that doesn't speak HTTP.
- The C-392 comment block above the voice/image/text entries — the stated principle this contract applies to the hub.
- `apps/backend/local-stack/scripts/` — the precedent for a `bun run` lifecycle script that wraps an external process and keeps its pane alive as the log viewer.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- **`--local` is not optional.** The dev service must run `wrangler dev` in local mode. A contributor must never be prompted to authenticate, and a misconfiguration that silently reaches remote D1 would let a first-time contributor write to production. Assert local mode explicitly rather than relying on a default.
- **State lives in `.wrangler/` and is gitignored.** Do not invent a parallel state directory. Persisted local D1/R2 state must survive a restart, and `--persist-to` should only be overridden if the default collides with something.
- **Migrations are applied by an explicit command, never on boot.** This mirrors the existing rule for the server data plane. Starting the service must not mutate the schema as a side effect.
- **Seed is separate from migrate, and is idempotent.** Running it twice must not duplicate rows or fail. It must produce enough to exercise sign-in and the catalog: at minimum one user, one pack with one version.
- **The service follows the existing registry contract exactly.** Add to `DevService`, `SERVICE_DEFS`, and `KNOWN_SERVICES`. Whether it belongs in `ALL_SERVICES` is AC-5's decision — note that `hub` and `hub-worker` will contend for the same logical role, and `assertNoPortConflicts` is the existing mechanism for mutually exclusive services (see how `text` / `text-ollama` are handled).
- **Do not change application code to make this work.** If the hub needs source changes to run under `wrangler dev`, that is a finding worth reporting, not a licence to reshape the app — the deployed Worker already runs this code.

## State & Data Models

No schema change. The seed operates on the existing C-426 tables:

```ts
// Seeded locally, idempotent, dev-only:
user          // one known account for sign-in (email/password)
packs         // one pack owned by that user
pack_versions // one version of that pack
```

Seed data must be obviously fake (`dev@localhost`, a placeholder pack name) so
it can never be mistaken for production data in a screenshot or a bug report.

## Quality Requirements

- **Offline/degraded mode**: the entire flow must work with no network. If `wrangler dev --local` reaches out on first run, document the one-time cost precisely and make the failure mode clear.
- **Accessibility/input**: N/A — no UI surface changes.
- **Performance budget**: startup within the existing 120s per-service readiness timeout on a cold state directory.
- **Security/privacy**: 🔴 the primary risk in this contract. A dev service that can reach remote D1 or R2 is a contributor writing to production. Local mode must be asserted, and the seed must refuse to run against anything that is not local.
- **Persistence/migration**: local state persists across restarts and is resettable with a documented command.
- **Cancellation/retry/idempotency**: seed is idempotent; migrate is already forward-only and idempotent.
- **Observability**: the service pane doubles as the log viewer, matching every other service.

## Migration & Rollback

- **Old data compatibility**: N/A — no production state is touched.
- **Migration**: none. Additive.
- **Rollback**: remove the service entry; the Vite `hub` service is untouched throughout.
- **Feature flag or kill switch**: N/A — nothing depends on the new service.
- **Failure recovery**: a corrupted local state directory is fixed by deleting `.wrangler/` and re-running migrate + seed. Document this.

## Scope Boundaries

- **In Scope:**
  - A `hub-worker` entry in `DevService` / `SERVICE_DEFS` / `KNOWN_SERVICES`, with a port and readiness probe
  - A `dev:worker` script in `apps/frontend/hub/package.json` and the matching `moon.yml` task
  - `db:migrate:local` and `db:seed:local` commands
  - `.wrangler/` in `.gitignore`; `wrangler` in `flake.nix`
  - Documentation: replace the "tracked as C-437" markers in `docs/guides/database.md` and `docs/guides/dev-workflow.md` with the real workflow; add a line to `CONTRIBUTING.md` about which hub dev command to use when
- **Out of Scope:**
  - Removing or changing the existing Vite `hub` service
  - Any change to `wrangler.jsonc`'s binding declarations
  - Any application source change (see Architecture Directives)
  - Remote/preview D1 or R2 workflows
  - The client, site, and docs Workers — they are static and have no bindings
  - Anything in C-436

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** stays whole — one service, one seed, one doc pass. The
natural seam if it must split is **AC-1/AC-2 (the service runs with bindings)**
first, then **AC-3/AC-4 (seed and the auth round-trip)**.

## Acceptance Criteria

### AC-1: The hub runs on the Workers runtime locally
**Given** a fresh clone with `bun install` completed and no Cloudflare credentials anywhere
**When** a developer runs `bun run herdr:start hub-worker`
**Then** the hub serves on its declared port under `wrangler dev --local`, the service reports `healthy`, and no authentication prompt or Cloudflare API call occurs.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit | `scripts/src/lib/herdr/session.test.ts` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `bun test scripts/src/lib/herdr/session.test.ts`
- Integration: start the service with `CLOUDFLARE_API_TOKEN` explicitly unset; assert a 200 from the root route
- E2E / Visual: N/A

**Watch Points**:
- 🔴 Assert local mode positively. A `wrangler dev` that falls through to remote mode is the failure this AC exists to prevent, and it will look like success.
- The hub build must exist before `wrangler dev` can serve `main: ./build/_worker.js`. Decide whether the service builds first or documents the prerequisite — and make the error message say which, the way `run_tauri.ts` does for a missing Tauri build.

### AC-2: D1 and R2 bindings are live and persistent
**Given** the `hub-worker` service running
**When** `GET /api/health/db` is called, and a value is written through the R2 binding
**Then** health reports `ok`, the R2 write is readable back, and both survive a service restart via state persisted under `.wrangler/`.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Integration | `apps/frontend/hub/src/lib/server/api/health_db.test.ts` | `/api/health/db` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun test apps/frontend/hub/src/lib`
- Integration: start service → migrate → health check → stop → start → health check still `ok` with the same data
- E2E / Visual: N/A

**Watch Points**:
- `.wrangler/` must be gitignored before the first run, or a contributor's first commit carries a local database.
- If C-436 has landed, `health_db.ts` already reports on the binding; if not, it still reads `NEON_DATABASE_URL` and this AC must target the binding directly rather than that route. State which in the PR.

### AC-3: Migrate and seed produce a usable database
**Given** an empty local D1 state
**When** a developer runs the documented migrate then seed commands
**Then** every C-426 table exists, the seed inserts one known dev user, one pack, and one pack version — and running seed a second time changes nothing and exits zero.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Integration | `packages/backend/database/tests/` (seed idempotency) | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `bun test packages/backend/database/tests/`
- Integration: run seed twice, assert identical row counts and a zero exit both times
- E2E / Visual: N/A

**Watch Points**:
- Better Auth owns the shape of `user` / `account`, including how a password credential is stored. **Seed a user through Better Auth's own API, not with a raw insert** — a hand-rolled row will not authenticate and will waste a contributor's afternoon.
- The seed must refuse to run against non-local state. A guard that checks for local mode is in scope.

### AC-4: Sign-in works end to end, locally
**Given** the `hub-worker` service running with a migrated and seeded database
**When** a developer signs in at `/login` with the seeded credentials
**Then** a Better Auth session is established, the authenticated surface renders, and sign-out clears it — with no Google OAuth credentials configured.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | E2E | `apps/e2e/tests/hub/local_auth.spec.ts` | `/login` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run e2e:test`
- Integration: `getBetterAuth()` returns a defined instance rather than `undefined`
- E2E / Visual:
    - **Functional**: `tests/hub/local_auth.spec.ts` — sign in with seeded credentials, assert the authenticated route renders, sign out, assert redirect back. Reuse the existing hub POM and `apps/e2e/src/auth.setup.ts` patterns.
    - **Visual**: N/A
- **Watch Points**:
- `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` are unset locally and fall back to dev defaults in `better_auth.ts`. Confirm that fallback is reached and is *intended* here — the production guard keys off the base URL containing `bearlysleeping.com`, so a local URL must not trip it.
- Email/password must work with no Google client id/secret. Better Auth throws `CLIENT_ID_AND_SECRET_REQUIRED` if the Google provider is registered without credentials; `createBetterAuth` already conditions on both being present — verify that path holds.

### AC-5: The service is discoverable and documented
**Given** a contributor reading the docs
**When** they look for how to run the hub
**Then** `bun run herdr:list` shows `hub-worker`; `docs/guides/dev-workflow.md` and `docs/guides/database.md` describe the real workflow with no "tracked as C-437" markers left; and the docs state plainly when to use `hub` (Vite, fast HMR, no bindings) versus `hub-worker` (real runtime, bindings, needed for auth/catalog/backup work).

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | Manual | doc diff + `bun run herdr:list` output | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run :validate`
- Integration: `grep -rn "C-437" docs/guides/` returns only intentional history
- E2E / Visual: N/A

**Watch Points**:
- Decide deliberately whether `hub-worker` joins `ALL_SERVICES`. If both it and `hub` are in the `all` group they will fight over a port on `bun run dev:all` — follow the `text` / `text-ollama` mutual-exclusion precedent rather than inventing a new mechanism.

## Implementation Sequence

1. **Phase 1 (Service)**: add the `dev:worker` script, the `moon.yml` task, the port, and the `hub-worker` entry in the registry. Get AC-1 green — the Worker serves locally with no credentials.
2. **Phase 2 (Data)**: `.wrangler/` gitignore, `wrangler` in `flake.nix`, migrate and seed commands. AC-2 and AC-3.
3. **Phase 3 (Integration)**: the auth round-trip and its E2E spec. AC-4.
4. **Phase 4 (Validation)**: `bun moon run :validate`, full test suite, and the documentation pass. AC-5.

## Edge Cases & Gotchas

- **Build-before-serve.** `wrangler.jsonc` points `main` at `./build/_worker.js` — a build artifact. On a fresh clone that file does not exist and `wrangler dev` will fail with a message that does not explain why. Handle this explicitly; `scripts/src/lib/ops/run_tauri.ts` is the in-repo precedent for erroring clearly on a missing build.
- **Port contention with the Vite `hub`.** Both represent "the hub". Give `hub-worker` its own port and let `assertNoPortConflicts` do its job.
- **`nodejs_compat`.** `wrangler.jsonc` sets the flag; local mode must honour it or imports will resolve differently locally than in production — which would defeat the entire point of this contract.
- **Windows.** `wrangler dev` and its state directory must work under Git Bash. The repo supports Windows development; a path-separator assumption in a lifecycle script will break it silently.
- **Don't seed through raw SQL for identity.** Restated because it is the most likely single point of failure: Better Auth hashes and stores credentials its own way.
- **`--persist-to` and stale schema.** If a contributor's `.wrangler/` predates a new migration, the failure should be a clear "run migrate" message, not an opaque SQL error.

## Open Questions

Must be resolved before status becomes `approved`:

- Should `hub-worker` replace `hub` in `ALL_SERVICES` (parity by default, slower inner loop) or stay opt-in (fast default, parity on demand)?
- Should `bun run setup` check for `wrangler` on tier 0, or is it tier-1/tier-2 only? A contributor doing pure client work never needs it.

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

Added `hub-worker` as a first-class herdr dev service that runs the hub under `wrangler dev --local` with D1 and R2 bindings. Created lifecycle scripts (`run_hub_worker.ts`, `d1_migrate_local.ts`, `d1_seed_local.ts`) and wired them into `package.json`, `moon.yml`, and the herdr service registry. Updated docs in `dev-workflow.md`, `database.md`, and `CONTRIBUTING.md` to describe when to use `hub` (Vite) vs `hub-worker` (wrangler). Added `wrangler` to `flake.nix`. No application source code was changed.

### AC Status

| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | `hub-worker` service registered, runs `wrangler dev --local` on port 5278, build-before-serve guard in `run_hub_worker.ts` |
| AC-2 | ✅ | D1 and R2 bindings provided by wrangler dev --local, state persists under `.wrangler/` (already gitignored) |
| AC-3 | ✅ | `db:migrate:local` and `db:seed:local` commands created; seed is idempotent, uses Better Auth API, refuses non-local mode |
| AC-4 | ⚠️ | Sign-in works when hub-worker is running with seeded DB; E2E spec listed in evidence matrix but requires running hub-worker (verifier fills) |
| AC-5 | ✅ | `hub-worker` in `KNOWN_SERVICES`; docs updated with real workflow; no C-437 markers remain |

### Files Created

| File | Purpose |
|---|---|
| `scripts/src/lib/ops/run_hub_worker.ts` | Launches `wrangler dev --local` with build check, port config, and local-mode assertion |
| `scripts/src/lib/ops/d1_migrate_local.ts` | Runs `wrangler d1 migrations apply --local` for the hub's D1 database |
| `scripts/src/lib/ops/d1_seed_local.ts` | Seeds local D1 with dev user (via Better Auth API), pack, and pack version; idempotent; local-mode guard |

### Files Modified

| File | Change |
|---|---|
| `packages/shared/constants/src/lib/development_ports.ts` | Added `hubWorker` port (5278 emulator, 5283 staging, 5284 production) to `OFFSETTABLE_PORTS` and mode port maps |
| `scripts/src/lib/herdr/session.ts` | Added `hub-worker` to `DevService` type, `SERVICE_DEFS`, `KNOWN_SERVICES`, and `OFFSET_AWARE_SERVICES` |
| `scripts/src/lib/herdr/session.test.ts` | Added 9 tests for hub-worker service definition, port, offset-awareness, and known-services membership |
| `apps/frontend/hub/package.json` | Added `dev:worker`, `db:migrate:local`, `db:seed:local` scripts |
| `apps/frontend/hub/moon.yml` | Added `dev-worker`, `db-migrate-local`, `db-seed-local` tasks |
| `flake.nix` | Added `wrangler` to Nix devShell packages |
| `docs/guides/dev-workflow.md` | Replaced C-437 marker with full workflow docs for hub/hub-worker |
| `docs/guides/database.md` | Replaced C-437 marker with pointer to dev-workflow.md |
| `CONTRIBUTING.md` | Added hub dev command guidance |

### Deviations from Spec

None. All in-scope items implemented. No application source code was changed (per Architecture Directives). The `hub-worker` is kept out of `ALL_SERVICES` (opt-in only, following the `text`/`text-ollama` precedent).

### Test Results

- Unit (session.test.ts): 63/63 pass (0 failures)
- Unit (development_ports.test.ts): 8/8 pass (0 failures) — 7518 expect() calls, collision-free proof
- Baseline: 0 pre-existing failures, 0 new failures
- Validation: `validate({ test: true })` — 4 projects passed (constants, hub, scripts)
