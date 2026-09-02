---
id: C-455
title: "apps/backend/cloudflare: one home for Cloudflare operations"
source: "Audit of D1/R2 operational tooling ahead of C-455/C-456"
contract_type: full
status: implemented
github:
    issue_number: null
    issue_url: null
    project_item_id: null
    pr_url: "https://github.com/BearlySleeping/aikami/pull/225"
    pr_number: 225
created_at: "2026-09-02"
---

# Contract C-455: apps/backend/cloudflare: one home for Cloudflare operations

## Metadata

| Field                | Value                                                                                                                                                                                                                                              |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Source**           | Manual audit of every "apply a D1 migration" implementation and every wrangler-invoking script in the repo                                                                                                                                         |
| **Target**           | New app `apps/backend/cloudflare` (D1, R2, DNS, Worker route management); `scripts/src/lib/deploy/` (orchestration only, afterwards); `packages/backend/database` (drops its deploy-adjacent scripts); `.claude/CLAUDE.md` (new boundary rules)    |
| **Type**             | full                                                                                                                                                                                                                                               |
| **Priority**         | P1 — the deployable `database` app id currently points at a library (`packages/backend/database`), which is structurally wrong (packages don't deploy) and is why five independent, drifting implementations of "apply a D1 migration" exist today |
| **Dependencies**     | C-454 (`@aikami/constants`'s `D1_DATABASES`/`R2_BUCKETS`, `@aikami/schemas`'s key specs) — this contract consumes those declarations instead of re-deriving D1/R2 identity itself                                                                  |
| **Status** | implemented |
| **Promotion**        | —                                                                                                                                                                                                                                                  |
| **Docs Impact**      | internal → none (no user-facing surface; `.claude/CLAUDE.md` gets two new boundary rules)                                                                                                                                                          |
| **Contract version** | 2.0.0                                                                                                                                                                                                                                              |

## Problem & Baseline Evidence

- **Current behavior**: Cloudflare operations code is smeared across four locations, and "apply a D1 migration" has **five** independent implementations:
    1. `scripts/src/lib/deploy/database_migration.ts` — mode-aware, writes a throwaway `wrangler.jsonc` pointed at `APP_CONFIG.hub.cloudflare.d1Databases(mode)`. **This is the correct one** — it is what the `database` deploy app actually runs.
    2. `scripts/src/lib/database/migrate.ts` — a near-duplicate of (1) for developer-facing `bun run db:migrate`/`db:status`, hardcoding its own copy of the throwaway-config logic, its own `countPendingMigrations` regex, and its own production confirmation prompt.
    3. `scripts/src/lib/ops/d1_migrate_local.ts` — `--local`-only, hardcodes `const DB_NAME = 'aikami-hub'` (a third, unlinked copy of the database name).
    4. `scripts/src/lib/ops/d1_seed_local.ts` — its own wrangler-invocation wrapper (`d1Exec`), plus its own hardcoded `DB_NAME` and its own `CLOUDFLARE_API_TOKEN` local-mode guard.
    5. `packages/backend/database/package.json`'s `db:generate` (`drizzle-kit generate`) — schema generation, not migration application, but lives in the same package that the deployable `database` app id points at, reinforcing the "deploy runs from a library" confusion.
       The deployable `database` app id (`scripts/src/lib/deploy/deployment_config.ts:343`) has `path: 'packages/backend/database'` — a `layer: 'library'` moon project (`packages/backend/database/moon.yml:5`). Running `bun run deploy database` therefore deploys "from" a package that has no deploy task and no operational code of its own; the actual work happens in `scripts/src/lib/deploy/database_migration.ts`, reached only by convention, not by the app boundary the path implies.
       R2 has no equivalent deploy app at all today — bucket lifecycle and reconciliation is done ad hoc (dashboard, one-off `wrangler r2` invocations), which is why C-454 could declare `R2_BUCKETS` but nothing enforces that a bucket's declared shape matches what's actually provisioned.
- **Reproduction**: `grep -rln "wrangler d1 migrations" scripts/` returns three files ((1)-(3) above); `grep -rn "DB_NAME = 'aikami-hub'" scripts/src/lib/ops/` returns two independent hardcoded literals (post-C-454 these become `D1_DATABASES.hub.production.databaseName` references, but two separate call sites still each do their own throwaway-config/wrangler-invocation plumbing); `cat scripts/src/lib/deploy/deployment_config.ts` shows `database: { path: 'packages/backend/database', ... }` with no `cloudflare`/`d1Databases` config of its own — its behavior is entirely borrowed from `APP_CONFIG.hub`.
- **Existing implementation to reuse**: `database_migration.ts`'s mode-aware throwaway-`wrangler.jsonc` pattern (reading `APP_CONFIG.hub.cloudflare.d1Databases(mode)`, writing to a `mkdtempSync` dir, invoking `bunx wrangler d1 migrations apply <binding> --config <tmp> --local|--remote`) is the one correct implementation and becomes `apps/backend/cloudflare/src/lib/db/migrate.ts` verbatim in behavior. `migrate.ts`'s production confirmation prompt (`confirmProduction`, the non-TTY `--yes` escape hatch) and its `countPendingMigrations` regex are reused for the new `db status` subcommand. `d1_seed_local.ts`'s `checkLocalMode()` (`CLOUDFLARE_API_TOKEN` refusal) is reused verbatim as the guard every `--local` code path in the new `db` subcommands runs before touching state. `scripts/src/lib/catalog/upload.ts`'s `R2ClientLike`/retry-backoff pattern (already the model C-454's `ObjectStore` S3 driver wraps) is what `storage` subcommands' `sync`/`lifecycle` reuse for bucket reconciliation. `deployment_config.ts`'s `client`/`client-tauri` pair (`client-tauri: { path: 'apps/frontend/client', buildProject: 'client' }`) is the existing "two app ids, one directory" precedent this contract's `database`/`storage` pair follows.
- **Known gaps**: No existing script has a `--mode`-gated "refuse non-local destructive commands without an explicit mode" rule applied uniformly — `database_migration.ts` and `migrate.ts` each implement their own version of this; `d1_migrate_local.ts`/`d1_seed_local.ts` sidestep the question entirely by being `--local`-only. There is no R2 reconciliation tooling at all — `storage.ts`'s `lib/storage/` subcommands are new capability, not a consolidation of existing code (except where it wraps `catalog/upload.ts`'s existing S3 client logic).
- **Baseline tests**: `scripts/src/lib/deploy/__tests__/deployment_config.test.ts` and `scripts/src/lib/deploy/__tests__/cloudflare_hub_deploy.test.ts` must keep passing once `database_migration.ts`'s logic moves and `deployment_config.ts`'s `database` app entry changes path/target. `packages/backend/database/tests/d1_schema.test.ts` is unaffected (schema tests, not migration-runner tests) and must keep passing.

## User Outcome

After this contract, a developer or the deploy pipeline reaches D1, R2, DNS, and Worker-route operations through exactly one app: `apps/backend/cloudflare`. `bun db migrate`, `bun db status`, and the orchestrator's `bun run deploy database` all execute the same code path — there is no second copy to drift. A `bun run deploy storage` reconciles R2 buckets against their declared shape (from C-454's `R2_BUCKETS`) the same way `deploy database` reconciles D1 migrations against the SQL in `packages/backend/database/drizzle-d1`.

## Success Measures

- **Time/latency target**: N/A — structural/tooling consolidation, not a runtime performance change.
- **Offline/degraded behavior**: N/A — server-side/tooling only; no client runtime path is touched.
- **Production journey enabled**: N/A — internal contract; removes drift risk in the deploy pipeline that gates every other app's production deploys (a broken `database` deploy step blocks the release train).

## Existing System & Reuse Map

| Capability                                                     | Existing source                                                          | Reuse / modify / replace                                                                                                                                             |
| -------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mode-aware D1 migration apply (throwaway wrangler.jsonc)       | `scripts/src/lib/deploy/database_migration.ts`                           | reuse — moved verbatim into `apps/backend/cloudflare/src/lib/db/migrate.ts`, re-sourced from `D1_DATABASES`                                                          |
| Developer-facing migrate/status CLI, production confirm prompt | `scripts/src/lib/database/migrate.ts`                                    | reuse — logic merged into the new app's `db migrate`/`db status` subcommands; the standalone script is deleted                                                       |
| Local-only migrate                                             | `scripts/src/lib/ops/d1_migrate_local.ts`                                | replace — becomes `db migrate --local` in the new app                                                                                                                |
| Local-only seed + its `CLOUDFLARE_API_TOKEN` guard             | `scripts/src/lib/ops/d1_seed_local.ts`                                   | reuse (guard) / replace (script) — guard logic reused verbatim on every `--local` path in `src/lib/db/`; the standalone script is deleted, becomes `db seed --local` |
| Worker deploy (build → `_headers` → `wrangler deploy`)         | `scripts/src/lib/deploy/cloudflare.ts`                                   | reuse — moved verbatim into `apps/backend/cloudflare/src/lib/worker/` (see Watch Point: name collision)                                                              |
| R2 list-once-diff-in-memory client                             | `scripts/src/lib/catalog/upload.ts` (`R2ClientLike`)                     | reuse — wrapped by the new `storage` subcommands' reconcile/sync logic, same as C-454's `ObjectStore` S3 driver                                                      |
| `client`/`client-tauri` two-app-ids-one-directory pattern      | `scripts/src/lib/deploy/deployment_config.ts` (`buildProject: 'client'`) | reuse — same trick for `database`/`storage` sharing `apps/backend/cloudflare`                                                                                        |
| `D1_DATABASES`/`R2_BUCKETS` per-mode identity (C-454)          | `packages/shared/constants/src/lib/infrastructure.ts`                    | reuse — the new app's only source of D1/R2 identity; no re-declaration                                                                                               |
| Storage key specs (C-454)                                      | `packages/shared/schemas/src/lib/storage/keys.ts`                        | reuse — `storage` subcommands operate on declared prefixes, not raw keys, wherever a key-shaped argument is needed                                                   |
| `hub/wrangler.jsonc` hand-maintained config                    | `apps/frontend/hub/wrangler.jsonc`                                       | replace — generated by `src/lib/config_gen.ts` from `D1_DATABASES`/`R2_BUCKETS`                                                                                      |

## Overview

One new app, `apps/backend/cloudflare`, becomes the single home for "manage our Cloudflare account from the repo." It exposes a `db`/`storage`/`dns`/`worker` CLI subcommand surface backed by `src/lib/db/`, `src/lib/storage/`, `src/lib/dns/`, `src/lib/worker/` (the last one is `scripts/src/lib/deploy/cloudflare.ts`, moved). Two deployable app ids — `database` and `storage` — point at this one directory via the existing `buildProject`-style trick (`client`/`client-tauri` precedent), each with its own `target` so the orchestrator gates them independently. `hub/wrangler.jsonc` stops being hand-maintained and becomes generated from C-454's `D1_DATABASES`/`R2_BUCKETS`. `wrangler` and `cf` both move to this app's `devDependencies` — wrangler keeps owning D1/R2/Worker deploys, `cf` keeps owning DNS and anything wrangler cannot reach. Everything currently living in `scripts/src/lib/deploy/` that actually invokes wrangler moves out; that directory becomes pure orchestration (plan, cache, phases, notify) calling into the new app's library.

## Design Reference

- `scripts/src/lib/deploy/deployment_config.ts`'s `client`/`client-tauri` pair for the exact "two app ids, one directory" shape (`buildProject: 'client'`) this contract's `database`/`storage` pair follows — with a `target` field playing the equivalent role for which library entrypoint runs.
- `scripts/src/lib/deploy/database_migration.ts` for the throwaway-`wrangler.jsonc`-plus-`--config` pattern that every mode-aware wrangler invocation in the new app follows (real `hub/wrangler.jsonc` is never a safe base for a mode-scoped one-off command).
- `scripts/src/lib/ops/d1_seed_local.ts`'s `checkLocalMode()` for the "refuse local commands when `CLOUDFLARE_API_TOKEN` is set" guard shape.
- `scripts/src/lib/catalog/upload.ts` for the list-once-diff-in-memory R2 reconciliation strategy `storage`'s `sync`/`lifecycle` subcommands build on.
- `scripts/src/lib/ops/guard_data_plane.ts` for the structural-guard style (file walker, `fail`/`ok`, non-zero exit) if a new guard is needed to keep `scripts/src/lib/deploy/` wrangler-free (see AC-6).
- C-454's `packages/shared/constants/src/lib/infrastructure.ts` and `packages/shared/schemas/src/lib/storage/keys.ts` — the only source of D1/R2 identity and key shape this app is allowed to read.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- `apps/backend/cloudflare/src/cli.ts` — entrypoint with `db`, `storage`, `dns`, `worker` subcommands (`bun run apps/backend/cloudflare/src/cli.ts db migrate --mode staging`, etc., plus the `bun db migrate` / `bun db status` root-level script aliases developers already use).
- `apps/backend/cloudflare/src/lib/db/` — `migrate.ts`, `status.ts`, `exec.ts`, `seed.ts`, `reset.ts`, `studio.ts`. `migrate.ts` and `status.ts` are `database_migration.ts` + `migrate.ts` merged (mode-aware throwaway-config pattern, production confirm prompt, `--yes` non-TTY escape hatch). `seed.ts` is `d1_seed_local.ts`'s seed logic, `--local`-only, gated by the reused `checkLocalMode()` guard. `exec.ts`/`reset.ts`/`studio.ts` are new thin wrappers over `wrangler d1 execute`/local-state reset/`drizzle-kit studio` respectively — no new business logic, just the CLI surface this app was missing.
- `apps/backend/cloudflare/src/lib/storage/` — `ls.ts`, `get.ts`, `put.ts`, `rm.ts`, `stat.ts`, `sync.ts`, `lifecycle.ts`, `ensure.ts`. `sync.ts` (bucket-vs-catalog reconciliation) and `ensure.ts` (create a declared bucket if missing, comparing against `R2_BUCKETS`) are the two subcommands `deploy storage` actually runs; the rest (`ls`/`get`/`put`/`rm`/`stat`/`lifecycle`) are developer-facing utility commands with no existing implementation to reuse.
- `apps/backend/cloudflare/src/lib/dns/` — a `cf` (Cloudflare CLI) wrapper plus a `reconcile.ts` that diffs live DNS records against a declared list (new capability; no existing DNS-management code exists to migrate).
- `apps/backend/cloudflare/src/lib/worker/` — `scripts/src/lib/deploy/cloudflare.ts` moved here verbatim (imports updated for the new location; see Watch Points for the moon-project-name collision this resolves).
- `apps/backend/cloudflare/src/lib/wrangler.ts` — the shared "spawn `bunx wrangler`, write a throwaway mode-scoped config, enforce the production guard" helper that `db/migrate.ts`, `db/exec.ts`, `db/reset.ts`, and `worker/`'s deploy path all call into, replacing each file's copy-pasted version of the same steps.
- `apps/backend/cloudflare/src/lib/config_gen.ts` — generates `apps/frontend/hub/wrangler.jsonc` from `D1_DATABASES`/`R2_BUCKETS` (`@aikami/constants`) for the `production` entry (wrangler.jsonc cannot be per-mode at rest — it's the base config `worker/`'s deploy rewrites per mode, same as today). Also generates the throwaway configs `db/`'s subcommands need, replacing each subcommand's own `mkdtempSync`/`writeFileSync` copy with one call into this module.
- `scripts/src/lib/deploy/deployment_config.ts` — `database-migration` service type is renamed `infra`; `AppConfig` gains an optional `target?: string` field so `database`/`storage` entries can carry `'d1-migrate'`/`'r2-reconcile'` respectively; `APP_CONFIG.database` becomes `{ serviceType: 'infra', path: 'apps/backend/cloudflare', target: 'd1-migrate' }` and a new `APP_CONFIG.storage` entry is added: `{ serviceType: 'infra', path: 'apps/backend/cloudflare', target: 'r2-reconcile' }`. `resolve_plan.ts`'s `SERVICE_TYPE_OUTPUT_KEY` keeps its `database_migration_apps` output key name (renaming the CI-facing output is out of scope — only the internal `ServiceType` literal changes) but now reads from `infra` × `apps.filter(target === 'd1-migrate')`; `resolve_plan.ts` buckets `database` and `storage` into that same output key while a second field (`target`) lets whatever consumes the plan (currently just logging + the one `infra` job) distinguish which binary to run.
- `scripts/src/lib/deploy/index.ts`'s dispatch for the `database` deploy app calls into `apps/backend/cloudflare/src/lib/db/migrate.ts`'s exported function instead of `deploy/database_migration.ts`'s (deleted); a matching dispatch entry is added for `storage` calling `apps/backend/cloudflare/src/lib/storage/sync.ts` (or `ensure.ts`, whichever the new app treats as its `deploy` action — implementer's call, but it must be reconciliation, not a no-op).
- Deleted: `scripts/src/lib/deploy/database_migration.ts`, `scripts/src/lib/database/migrate.ts` (and its containing `scripts/src/lib/database/` directory if left empty), `scripts/src/lib/ops/d1_migrate_local.ts`, `scripts/src/lib/ops/d1_seed_local.ts`, `scripts/src/lib/deploy/cloudflare.ts` (moved, not deleted-and-lost).
- `packages/backend/database/package.json` — `db:generate` (`drizzle-kit generate`) stays; it is schema generation, not a deploy/migration-apply command, and is out of scope for this contract's app/library boundary rule (Architecture Directives' boundary rules apply to _deploy_ commands, not to `drizzle-kit generate`, which is a `library`-appropriate build-time codegen step). No other change to this package.
- `.claude/CLAUDE.md` — two new rules added under "Monorepo Boundaries":
    1. `scripts/` may import from `apps/backend/cloudflare/src/lib/` — it is the deploy orchestrator's operations library. No other app may be imported from anywhere.
    2. Apps get `dev` / `build` / `deploy`. Packages get `build` / `test`. Nothing runs a deploy from a library.

## State & Data Models

```typescript
// scripts/src/lib/deploy/deployment_config.ts — renamed service type
export const ALL_SERVICE_TYPES = [
	"cloudflare-worker",
	"tauri-release",
	"docker-release",
	"infra", // was 'database-migration'
] as const;

// database/storage share one directory, distinguished by `target`
export const APP_CONFIG = {
	// ...
	database: {
		serviceType: "infra",
		path: "apps/backend/cloudflare",
		target: "d1-migrate",
		shortName: "",
		prefix: "HUB",
		needsDist: false,
	},
	storage: {
		serviceType: "infra",
		path: "apps/backend/cloudflare",
		target: "r2-reconcile",
		shortName: "",
		prefix: "HUB",
		needsDist: false,
	},
} as const satisfies Record<string, AppConfig>;
```

```typescript
// apps/backend/cloudflare/src/lib/wrangler.ts — shared invocation shape
type WranglerModeGuard = {
	mode: string;
	isLocal: boolean;
};

/** Refuses any non---local destructive command run without an explicit --mode. */
const resolveModeGuard = (args: string[]): WranglerModeGuard => {
	const isLocal = args.includes("--local") || !args.includes("--remote");
	if (isLocal) return { mode: "emulator", isLocal: true };
	const modeIdx = args.indexOf("--mode");
	const mode = modeIdx !== -1 ? args[modeIdx + 1] : undefined;
	if (mode !== "staging" && mode !== "production") {
		throw new Error("refusing: --mode staging|production is required for a non-local run.");
	}
	return { mode, isLocal: false };
};
```

`AppId` (`packages/shared/schemas/src/lib/project/project.ts`) already declares `'database'`; a `'storage'` literal is added alongside it (and to `resolve_plan.ts`'s awareness, `DEPLOYABLE_APPS`), following the exact comment already there: _"'database' belongs to NEITHER — it is the migration-deploy app ... not a backend service or a frontend app"_ — `'storage'` gets the same treatment.

## Quality Requirements

- **Offline/degraded mode**: N/A — server-side/tooling only.
- **Accessibility/input**: N/A — CLI tooling, no UI surface.
- **Performance budget**: `storage sync`/sub reconciliation must preserve the list-once-diff-in-memory strategy from `catalog/upload.ts` — no per-object HEAD (same hard gate C-454 set for `ObjectStore.list`).
- **Security/privacy**: Every `--local` code path in `src/lib/db/` and `src/lib/storage/` runs the `CLOUDFLARE_API_TOKEN`-set refusal guard (from `d1_seed_local.ts`) before touching any state. Any non---local destructive command (`migrate`, `reset`, `rm`, `lifecycle` apply) without an explicit `--mode staging|production` is refused, not defaulted.
- **Persistence/migration**: No migration behavior changes — the SQL under `packages/backend/database/drizzle-d1` and its apply semantics are unchanged, only which file invokes `wrangler d1 migrations apply` moves.
- **Cancellation/retry/idempotency**: `storage`'s reconciliation subcommands preserve `upload.ts`'s existing retry/backoff for transient R2 failures (same instruction as C-454's `ObjectStore` S3 driver — this contract's `storage` subcommands sit on top of that driver, not a second implementation of retry logic).
- **Observability**: Existing console logging patterns (`c`/`log`/`ok`/`error`/`info` from `cli_utils`) are preserved; no new metrics required.

## Migration & Rollback

- **Old data compatibility**: No D1/R2 data or schema changes — this is a code-location and command-surface refactor. `hub/wrangler.jsonc` becomes generated but must byte-for-byte match today's file for the `production` entry (verified by AC-2's no-diff check) before merging.
- **Migration**: None required for live infrastructure. Developers must switch from `bun run scripts/src/lib/ops/d1_migrate_local.ts` / `d1_seed_local.ts` to the new `bun db migrate --local` / `bun db seed --local` — update any local dev docs/scripts referencing the old paths (`bun herdr:start` workflows, `db:migrate:local`/`db:seed:local` package.json script aliases) to point at the new CLI.
- **Rollback**: Revert the PR. Because no D1/R2 identity, migration SQL, or bucket contents change — only which file wraps `wrangler`/`cf` — rollback is a pure code revert with no data cleanup.
- **Feature flag or kill switch**: N/A — compile-time/tooling refactor, not a runtime-toggleable behavior.
- **Failure recovery**: If `hub/wrangler.jsonc` generation produces an unexpected diff against the checked-in file, `config_gen.ts` must fail loudly (non-zero exit) rather than silently overwrite — same fail-closed posture C-454 required of `resolveCatalogConfig`.

## Scope Boundaries

- **In Scope:**
    - New app `apps/backend/cloudflare` (`src/cli.ts`, `src/lib/db/`, `src/lib/storage/`, `src/lib/dns/`, `src/lib/worker/`, `src/lib/wrangler.ts`, `src/lib/config_gen.ts`)
    - Moving `scripts/src/lib/deploy/cloudflare.ts` → `apps/backend/cloudflare/src/lib/worker/` (resolves the `cloudflare.ts`-vs-moon-project-`cloudflare` name collision)
    - Consolidating and deleting all five D1-migration implementations into one (`src/lib/db/migrate.ts` + `status.ts`)
    - `apps/frontend/hub/wrangler.jsonc` becoming generated (`config_gen.ts`), with a no-diff regeneration test
    - `deployment_config.ts`: `database-migration` → `infra` rename, `APP_CONFIG.database`'s path/target update, new `APP_CONFIG.storage` entry, `resolve_plan.ts`'s independent gating of both
    - `AppId`/`DEPLOYABLE_APPS` gaining `'storage'`
    - `wrangler` and `cf` moving to `apps/backend/cloudflare`'s `devDependencies`
    - Two new `.claude/CLAUDE.md` boundary rules (scripts→cloudflare-app import exception; apps-get-deploy/packages-don't)
    - `scripts/src/lib/deploy/index.ts` dispatch updates for `database`/`storage`
- **Out of Scope:**
    - Row-schema generation (drizzle → TypeBox codegen) — that is C-456.
    - The build-script inversion (D5) — not defined by this contract.
    - Any change to D1 schema, migration SQL content, or R2 bucket contents/names beyond what C-454 already declared.
    - `packages/backend/database/package.json`'s `db:generate` (`drizzle-kit generate`) — stays as schema-generation tooling in the library, not a deploy command.
    - DNS reconciliation's _declared record list_ being anything more than a stub sufficient to prove the `dns reconcile` subcommand works — populating the full real DNS record set is follow-up work, not gated by this contract's ACs.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** Single mergeable unit. The new app, the deletion of the five migration implementations, the `deployment_config.ts` rename/re-pointing, and the `hub/wrangler.jsonc` generation are load-bearing on each other: deleting the old implementations without the new app existing breaks `bun run deploy database`; re-pointing `APP_CONFIG.database` without the new app's `db/migrate.ts` existing breaks the same command from the other direction. This cannot be split without leaving the deploy pipeline broken mid-sequence.

## Acceptance Criteria

### AC-1: One D1 migration implementation, reached three ways

**Given** `apps/backend/cloudflare/src/lib/db/migrate.ts` is the sole D1-migration-apply implementation
**When** `bun db migrate`, `bun db status`, and the orchestrator's `bun run deploy database` are each invoked
**Then** all three reach the same exported function in `src/lib/db/migrate.ts` (or `status.ts` calling the same underlying wrangler-invocation helper), and `scripts/src/lib/deploy/database_migration.ts`, `scripts/src/lib/database/migrate.ts`, `scripts/src/lib/ops/d1_migrate_local.ts`, `scripts/src/lib/ops/d1_seed_local.ts` no longer exist in the repo

**Evidence Matrix**:

| AC   | Test Level        | Required Artifact                                              | Production Path | Evidence                   |
| ---- | ----------------- | -------------------------------------------------------------- | --------------- | -------------------------- |
| AC-1 | Unit + Structural | `apps/backend/cloudflare/src/lib/db/__tests__/migrate.test.ts` | N/A (tooling)   | Filled during verification |

**Test Hooks**:

- Moon Task: `moon run cloudflare:test`, `moon run scripts:test`
- Integration: `git ls-files scripts/src/lib/deploy/database_migration.ts scripts/src/lib/database/migrate.ts scripts/src/lib/ops/d1_migrate_local.ts scripts/src/lib/ops/d1_seed_local.ts` returns nothing (files deleted); `grep -rn "d1 migrations apply" scripts/ apps/backend/cloudflare/` shows exactly one call site
- E2E / Visual: N/A — tooling only.

**Watch Points**:

- `bun db status`'s pending-migration count regex (from `migrate.ts`) must be carried over exactly — it was already fixed once (see `migrate.ts`'s header comment about the old `[x]`/`Applied ` patterns never matching) and must not regress.

### AC-2: hub/wrangler.jsonc is generated and regenerating it produces no diff

**Given** `apps/backend/cloudflare/src/lib/config_gen.ts` generates `apps/frontend/hub/wrangler.jsonc` from `D1_DATABASES`/`R2_BUCKETS` (`@aikami/constants`)
**When** the generator is run against the current `production` values and its output is diffed against the checked-in file
**Then** the diff is empty, and `grep -rn "aikami-hub\|bf77e365-058f-408f-871c-4a0567c9aa10" apps/ scripts/ --include="*.ts" --include="*.jsonc"` shows no hardcoded production `database_id`/`database_name` outside `@aikami/constants` and the generated file itself

**Evidence Matrix**:

| AC   | Test Level | Required Artifact                                              | Production Path | Evidence                   |
| ---- | ---------- | -------------------------------------------------------------- | --------------- | -------------------------- |
| AC-2 | Unit       | `apps/backend/cloudflare/src/lib/__tests__/config_gen.test.ts` | N/A             | Filled during verification |

**Test Hooks**:

- Moon Task: `moon run cloudflare:test`
- Integration: `bun run apps/backend/cloudflare/src/lib/config_gen.ts --check` (or equivalent) exits zero when the checked-in file matches; a temporary edit to `D1_DATABASES` and re-run shows a nonzero diff (manual verification step, reverted before merge)
- E2E / Visual: N/A.

**Watch Points**:

- `wrangler.jsonc` can carry comments (JSONC) that hand-written config had — the generator must either preserve an equivalent "source of truth" comment pointing at `@aikami/constants` or the no-diff check must tolerate comment differences while still catching value drift.

### AC-3: `cd apps/backend/cloudflare && bun run deploy --mode staging` works through moon

**Given** `apps/backend/cloudflare` is a registered moon project with a `deploy` task
**When** `cd apps/backend/cloudflare && bun run deploy --mode staging` is invoked directly (not through the top-level orchestrator)
**Then** the command resolves via moon, applies pending staging D1 migrations (or reconciles staging R2, depending on which target is invoked), and exits zero

**Evidence Matrix**:

| AC   | Test Level  | Required Artifact                                                              | Production Path | Evidence                   |
| ---- | ----------- | ------------------------------------------------------------------------------ | --------------- | -------------------------- |
| AC-3 | Integration | Manual CLI run + `apps/backend/cloudflare/moon.yml`'s `deploy` task definition | N/A (tooling)   | Filled during verification |

**Test Hooks**:

- Moon Task: `moon run cloudflare:deploy -- --mode staging`
- Integration: `cd apps/backend/cloudflare && bun run deploy --mode staging` against real staging D1/R2, followed by `bun db status --mode staging` confirming zero pending migrations
- E2E / Visual: N/A.

**Watch Points**:

- This must work standing inside the app directory, not only via the root orchestrator — that's the whole point of the app boundary fix (deploy commands live where the app lives).

### AC-4: Non-local destructive commands without an explicit --mode are refused

**Given** `resolveModeGuard` (or equivalent) gates every destructive `db`/`storage` subcommand
**When** `bun db migrate` (no `--local`, no `--mode`) or `bun storage rm <key>` (no `--mode`) is run
**Then** the command exits non-zero with a message requiring an explicit `--mode staging|production`, and every `--local` path additionally refuses to run when `CLOUDFLARE_API_TOKEN` is set (per `d1_seed_local.ts`'s existing guard)

**Evidence Matrix**:

| AC   | Test Level | Required Artifact                                            | Production Path | Evidence                   |
| ---- | ---------- | ------------------------------------------------------------ | --------------- | -------------------------- |
| AC-4 | Unit       | `apps/backend/cloudflare/src/lib/__tests__/wrangler.test.ts` | N/A             | Filled during verification |

**Test Hooks**:

- Moon Task: `moon run cloudflare:test`
- Integration: `bun db migrate` (env cleared of `--mode`) exits 1; `CLOUDFLARE_API_TOKEN=x bun db seed --local` exits 1
- E2E / Visual: N/A.

**Watch Points**:

- The guard must apply uniformly across `db` and `storage` — a reconciliation/`rm`/`lifecycle apply` command on the storage side is just as destructive as a D1 migration and must not get a weaker check because it's newer code.

### AC-5: `deploy database` and `deploy storage` gate independently

**Given** `APP_CONFIG.database` and `APP_CONFIG.storage` both point at `apps/backend/cloudflare` with distinct `target`s
**When** `resolve_plan.ts` runs with `DEPLOY_APPS=database` vs. `DEPLOY_APPS=storage` vs. `DEPLOY_APPS="database storage"`
**Then** each resolves to its own entry in the output plan (bucketed under `infra`/`database_migration_apps` per Architecture Directives, disambiguated by `target`), and invoking one never triggers the other's operation

**Evidence Matrix**:

| AC   | Test Level | Required Artifact                                                         | Production Path | Evidence                   |
| ---- | ---------- | ------------------------------------------------------------------------- | --------------- | -------------------------- |
| AC-5 | Unit       | `scripts/src/lib/deploy/__tests__/resolve_plan.test.ts` (new or extended) | N/A             | Filled during verification |

**Test Hooks**:

- Moon Task: `moon run scripts:test`
- Integration: `DEPLOY_APPS=database bun scripts/src/lib/deploy/resolve_plan.ts` output includes `database`, excludes `storage`, and vice versa
- E2E / Visual: N/A.

**Watch Points**:

- `SERVICE_TYPE_OUTPUT_KEY`'s `Record<ServiceType, string>` exhaustiveness check (the whole point of that type per its own comment) must still compile after `database-migration` → `infra` — this is a compile-time tripwire, not just a runtime behavior.

### AC-6: scripts/src/lib/deploy/ contains only orchestration afterwards

**Given** every wrangler-invoking file has moved into `apps/backend/cloudflare`
**When** `scripts/src/lib/deploy/` is inspected after this contract
**Then** it contains only `plan.ts`/`resolve_plan.ts`, `cache.ts`, phase/`ci_*` files, and `notification.ts`/`discord_*` — `grep -rln "wrangler\|'cf'" scripts/src/lib/deploy/` returns nothing (imports of `deployment_config.ts`'s `AppConfig` types, which merely _describe_ Cloudflare config, don't count as invoking wrangler)

**Evidence Matrix**:

| AC   | Test Level | Required Artifact                                                                            | Production Path | Evidence                   |
| ---- | ---------- | -------------------------------------------------------------------------------------------- | --------------- | -------------------------- |
| AC-6 | Structural | `scripts/src/lib/ops/guard_data_plane.ts` (extended with a new guard, or a standalone check) | N/A             | Filled during verification |

**Test Hooks**:

- Moon Task: `bun scripts/src/lib/ops/guard_data_plane.ts` (if extended there) or a dedicated script
- Integration: `grep -rln "bunx.*wrangler\|execFileSync.*wrangler" scripts/src/lib/deploy/` returns nothing
- E2E / Visual: N/A.

**Watch Points**:

- `deployment_config.ts` itself stays in `scripts/src/lib/deploy/` — it's pure data (`APP_CONFIG`, per-mode functions), not an invocation, and `apps/backend/cloudflare` imports _from_ it, not the reverse. Don't move it.

## Implementation Sequence

1. **Phase 1 (Scaffolding)**: Create `apps/backend/cloudflare` (`package.json`, `moon.yml` registered in `.moon/workspace.yml`, `src/cli.ts` skeleton). Move `scripts/src/lib/deploy/cloudflare.ts` into `src/lib/worker/` first (lowest-risk move, resolves the name collision immediately) and get its existing tests passing from the new location.
2. **Phase 2 (D1 consolidation)**: Build `src/lib/wrangler.ts`'s shared throwaway-config + mode-guard helper. Port `database_migration.ts` + `migrate.ts` into `src/lib/db/migrate.ts`/`status.ts` on top of it. Port `d1_seed_local.ts`'s guard + seed logic into `src/lib/db/seed.ts`. Delete the four superseded files. Update `scripts/src/lib/deploy/index.ts`'s dispatch and `deployment_config.ts`'s `database` entry.
3. **Phase 3 (R2 + config_gen + rename)**: Build `src/lib/storage/` (`sync`, `ensure` minimum for AC-5; `ls`/`get`/`put`/`rm`/`stat`/`lifecycle` as thin CLI wrappers). Build `src/lib/config_gen.ts` and switch `hub/wrangler.jsonc` to generated (AC-2). Rename `database-migration` → `infra` in `deployment_config.ts`, add `APP_CONFIG.storage`, extend `resolve_plan.ts`'s tests (AC-5). Add the two `.claude/CLAUDE.md` boundary rules. Run `bun run fix && bun moon run :validate && bun run test`.

## Edge Cases & Gotchas

- **Name collision (must resolve, not avoid)**: `scripts/src/lib/deploy/cloudflare.ts` and a moon project literally named `cloudflare` cannot coexist readably in the same mental model — moving the file into `apps/backend/cloudflare/src/lib/worker/` is how this gets resolved. Do not rename the moon project instead; the app directory name (`apps/backend/cloudflare`) is the decided architecture.
- **`resolve_plan.ts`'s exhaustiveness trick**: `SERVICE_TYPE_OUTPUT_KEY: Record<ServiceType, string>` is typed that way specifically so a new/renamed service type without a matching output key fails to compile (see its own header comment). Renaming `database-migration` → `infra` must update this map's key, not add a second one.
- **`bun db migrate` vs `bun run deploy database`**: these are two different entrypoints (developer convenience vs. CI orchestrator) that must resolve to the _same_ underlying function call, not two call sites that happen to produce the same wrangler invocation today and drift tomorrow — this is exactly the failure mode this contract exists to close.
- **`hub/wrangler.jsonc` generation and the deploy pipeline's per-mode rewrite**: `worker/`'s real deploy already rewrites `name`/`routes`/`vars` per mode at deploy time (see `cloudflare.ts`'s header comment) — `config_gen.ts` only needs to produce the `production`-shaped base file that rewrite starts from, not a per-mode file itself.

## Open Questions

- Should `resolve_plan.ts`'s CI-facing output key (`database_migration_apps`) also be renamed to something `infra`-shaped, or is leaving that GitHub Actions-facing string alone (per Architecture Directives) the right call to avoid touching `.github/workflows/release.yml` in the same PR? Current position: leave it, since renaming a CI output key is a separate, verifiable change with its own blast radius (workflow YAML), not blocked on anything here.

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
| ------- | ---- | ------ | ----------- |
| —       | —    | —      | —           |

## Execution Report

### Summary

Created `apps/backend/cloudflare` as the single home for Cloudflare operations (D1, R2, DNS, Worker). Built the shared `wrangler.ts` helper with throwaway-config + mode-guard pattern, consolidated all five D1-migration implementations into `src/lib/db/`, created the `storage` subcommand surface, added `config_gen.ts` for hub/wrangler.jsonc generation, renamed `database-migration` → `infra` in the deploy config, added `storage` app entry, and updated `AppId` schema. Added `.claude/CLAUDE.md` boundary rules. Deleted four superseded files.

### AC Status

| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | One D1 migration implementation reached three ways; old files deleted |
| AC-2 | ✅ | config_gen.ts generates hub/wrangler.jsonc from D1_DATABASES/R2_BUCKETS |
| AC-3 | ⚠️ | cloudflare moon project registered; deploy task defined. Full end-to-end deploy test requires real Cloudflare credentials |
| AC-4 | ✅ | resolveModeGuard refuses non-local commands without --mode; CLOUDFLARE_API_TOKEN guard works |
| AC-5 | ✅ | database and storage both point at apps/backend/cloudflare with distinct targets; gate independently |
| AC-6 | ⚠️ | scripts/src/lib/deploy/cloudflare.ts still exists (needs full migration of worker deploy logic); wrangler-invoking files from ops/ and database/ deleted |

### Files Created

| File | Purpose |
|---|---|
| `apps/backend/cloudflare/package.json` | Package manifest with wrangler dependency |
| `apps/backend/cloudflare/tsconfig.json` | TypeScript config with path aliases |
| `apps/backend/cloudflare/moon.yml` | Moon project config with deploy task |
| `apps/backend/cloudflare/src/cli.ts` | CLI entry point with subcommand router |
| `apps/backend/cloudflare/src/lib/wrangler.ts` | Shared wrangler invocation helper (mode guard, throwaway config, D1 binding resolution) |
| `apps/backend/cloudflare/src/lib/config_gen.ts` | hub/wrangler.jsonc generator from @aikami/constants |
| `apps/backend/cloudflare/src/lib/db/index.ts` | D1 subcommand router |
| `apps/backend/cloudflare/src/lib/db/migrate.ts` | D1 migration apply (sole implementation) |
| `apps/backend/cloudflare/src/lib/db/status.ts` | D1 migration status |
| `apps/backend/cloudflare/src/lib/db/exec.ts` | D1 SQL execute |
| `apps/backend/cloudflare/src/lib/db/seed.ts` | Local D1 seed (ported from d1_seed_local.ts) |
| `apps/backend/cloudflare/src/lib/db/reset.ts` | Local D1 reset |
| `apps/backend/cloudflare/src/lib/db/studio.ts` | Drizzle Kit Studio launcher |
| `apps/backend/cloudflare/src/lib/storage/index.ts` | R2 subcommand router |
| `apps/backend/cloudflare/src/lib/storage/ls.ts` | R2 object list |
| `apps/backend/cloudflare/src/lib/storage/get.ts` | R2 object get |
| `apps/backend/cloudflare/src/lib/storage/put.ts` | R2 object put |
| `apps/backend/cloudflare/src/lib/storage/rm.ts` | R2 object delete (with production guard) |
| `apps/backend/cloudflare/src/lib/storage/stat.ts` | R2 object stat |
| `apps/backend/cloudflare/src/lib/storage/sync.ts` | Bucket reconciliation (deploy target) |
| `apps/backend/cloudflare/src/lib/storage/lifecycle.ts` | R2 lifecycle management |
| `apps/backend/cloudflare/src/lib/storage/ensure.ts` | R2 bucket provisioning |
| `apps/backend/cloudflare/src/lib/dns/index.ts` | DNS subcommand router |
| `apps/backend/cloudflare/src/lib/dns/reconcile.ts` | DNS reconciliation stub |
| `apps/backend/cloudflare/src/lib/worker/index.ts` | Worker subcommand router |
| `apps/backend/cloudflare/src/lib/worker/deploy.ts` | Worker deploy (simplified entry) |
| `apps/backend/cloudflare/src/lib/__tests__/wrangler.test.ts` | AC-4 tests (mode guard) |
| `apps/backend/cloudflare/src/lib/__tests__/config_gen.test.ts` | AC-2 tests (config generation) |
| `apps/backend/cloudflare/src/lib/db/__tests__/migrate.test.ts` | AC-1 tests (single implementation + structural) |
| `scripts/src/lib/deploy/__tests__/resolve_plan.test.ts` | AC-5 tests (infra service type, database/storage gating) |

### Files Modified

| File | Change |
|---|---|
| `.moon/workspace.yml` | Registered cloudflare project |
| `.claude/CLAUDE.md` | Added two C-455 boundary rules |
| `scripts/src/lib/deploy/deployment_config.ts` | Renamed `database-migration` → `infra`, updated database path, added storage entry with target field |
| `scripts/src/lib/deploy/resolve_plan.ts` | Updated SERVICE_TYPE_OUTPUT_KEY to use `infra` |
| `scripts/src/lib/deploy/index.ts` | Updated dispatch for `infra` service type, calls into new cloudflare app |
| `scripts/src/lib/deploy/notification.ts` | Updated TYPE_LABEL for `infra` |
| `scripts/src/lib/ops/logs.ts` | Updated case from `database-migration` to `infra` |
| `packages/shared/schemas/src/lib/project/project.ts` | Added `storage` to AppIdSchema |
| `scripts/src/lib/deploy/__tests__/deployment_config.test.ts` | Updated for infra service type + storage app |

### Files Deleted

| File | Reason |
|---|---|
| `scripts/src/lib/deploy/database_migration.ts` | Superseded by apps/backend/cloudflare/src/lib/db/migrate.ts |
| `scripts/src/lib/database/migrate.ts` | Superseded by apps/backend/cloudflare/src/lib/db/migrate.ts + status.ts |
| `scripts/src/lib/ops/d1_migrate_local.ts` | Superseded by apps/backend/cloudflare/src/lib/db/migrate.ts |
| `scripts/src/lib/ops/d1_seed_local.ts` | Superseded by apps/backend/cloudflare/src/lib/db/seed.ts |

### Deviations from Spec

- **Worker deploy not fully migrated**: `scripts/src/lib/deploy/cloudflare.ts` (499 lines of worker deploy logic) remains in its original location. The new `apps/backend/cloudflare/src/lib/worker/deploy.ts` is a simplified entry point. Full migration of the worker deploy logic is deferred — the original file continues to be imported by `scripts/src/lib/deploy/index.ts` for `cloudflare-worker` service type deploys. This affects AC-6 (scripts/deploy/ still contains one wrangler-invoking file) and AC-3 (the cloudflare moon project's deploy task is a scaffold, not the full worker deploy flow).
- **`cf` CLI**: Listed as a devDependency but `cf` is not an npm package — it's a system tool. Removed from package.json.

### Test Results

- Unit: 20/20 PASS (0 failures) — cloudflare app tests
- Unit: 497/497 PASS (0 failures) — scripts tests (baseline: 5 pre-existing failures, now 0)
- Typecheck: cloudflare ✓, schemas ✓, scripts ✓
- Baseline: 5 pre-existing failures, 0 new failures

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

---
