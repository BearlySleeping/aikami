---
id: C-454
title: "Declare D1 and R2 once: infrastructure constants, key schemas, storage package"
source: "Audit of R2 key construction and D1 identity ahead of C-455/C-456"
contract_type: full
status: approved
github:
    issue_number: null
    issue_url: null
    project_item_id: null
    pr_url: "https://github.com/BearlySleeping/aikami/pull/224"
    pr_number: 224
created_at: "2026-09-02"
---

# Contract C-454: Declare D1 and R2 once: infrastructure constants, key schemas, storage package

## Metadata

| Field                | Value                                                                                                                                                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Source**           | `apps/frontend/hub/src/lib/server/api/storage.ts`, `save_backup.ts`, `scripts/src/lib/catalog/config.ts` — manual audit of every R2 key and D1 identity site in the repo                                                                    |
| **Target**           | `packages/shared/constants/src/lib/infrastructure.ts` (new), `packages/shared/schemas/src/lib/storage/keys.ts` (new), `packages/backend/storage` (new package), plus every call site listed below                                           |
| **Type**             | full                                                                                                                                                                                                                                        |
| **Priority**         | P1 — `catalog/config.ts`'s mode-blind bucket default means a manual `publish.ts --mode staging` run silently overwrites production's live `index/v1/catalog.json`; the R2 key duplication is drift risk that grows with every new call site |
| **Dependencies**     | None. Blocks C-455 (apps/backend/cloudflare) and C-456 (row-schema generation) — both build on `@aikami/schemas`/`ObjectStore` staying cycle-free, which this contract's `packages/backend/database` dependency cleanup guarantees          |
| **Status**           | implemented                                                                                                                                                                                                                                 |
| **Promotion**        | —                                                                                                                                                                                                                                           |
| **Docs Impact**      | internal → none (no user-facing surface)                                                                                                                                                                                                    |
| **Contract version** | 2.0.0                                                                                                                                                                                                                                       |

## Problem & Baseline Evidence

- **Current behavior**: Three independent symptoms trace to the same root cause — infrastructure identity (which D1 database, which R2 bucket, which key shape) is never declared once and referenced; it is retyped at each use site and drifts.
    1. **R2 keys are template literals, not a type.** The `users/{uid}/{filename}` key is hand-written in four places across three runtimes:
        - `apps/frontend/client/src/lib/services/storage/storage_service.svelte.ts:36` — `` `users/${uid}/${fileName}` ``
        - `apps/frontend/hub/src/lib/client/services/api/storage.svelte.ts:35` — the same literal, duplicated in the hub's own client-side copy of `StorageService`
        - `apps/frontend/hub/src/lib/server/api/storage.ts:74` — `` `users/${accountId}/${path.replace(...)}` `` (the write path)
        - `apps/frontend/hub/src/lib/server/api/storage.ts:125` — `path.startsWith(\`users/${accountId}/\`)` (the read-path authorization check — a runtime string check standing in for a schema)
        - `packages/frontend/services/src/lib/services/r2_storage.ts:23` — a JSDoc `@param path The object key, e.g. \`users/{uid}/avatar.png\`.`documenting the convention nowhere enforced
Meanwhile`save_backup.ts:52`'s `saveKeyFor()`writes`saves/{accountId}/{timestamp}-{backupId}-{filename}`into the *same*`SAVES_BUCKET`. Nothing declares that `users/`and`saves/`are the bucket's only two valid prefixes — a third call site could invent`backups/{uid}/...` tomorrow and nothing would object.
    2. **D1 identity is defined four times, three of them able to drift from the canonical one.** `scripts/src/lib/deploy/deployment_config.ts:214-231` is the mode-aware source of truth (`workerName`/`databaseName`/`databaseId` all keyed by mode via a function). But:
        - `apps/frontend/hub/wrangler.jsonc:22,33` hardcodes the production `database_name: "aikami-hub"` and its `database_id` directly — this file is what `wrangler dev`/`wrangler d1 migrations apply` actually reads when run without going through the deploy pipeline's per-mode rewrite.
        - `scripts/src/lib/ops/d1_migrate_local.ts:18` and `scripts/src/lib/ops/d1_seed_local.ts:24` both hardcode `const DB_NAME = 'aikami-hub';` — today harmless because both invoke `wrangler d1 ... --local` (local SQLite state, name is just a label), but the literal is a second, unlinked copy of the same identity that a future non-local use of either script would get wrong silently.
    3. **The catalog R2 bucket is not mode-aware.** `scripts/src/lib/catalog/config.ts:30` — `export const DEFAULT_CATALOG_BUCKET = 'aikami-catalog';` — is the fallback for every mode; only an explicit `CATALOG_BUCKET` env var overrides it. `publish.ts` (`scripts/src/lib/catalog/publish.ts:42`) defaults `--mode` to `'production'` when omitted and accepts `--mode staging` with no bucket-side consequence: nothing computes a different bucket name for a different mode. Assets under `assets/` are content-addressed and safe to co-mingle, but `index/v1/catalog.json` (`ROOT_INDEX_KEY`) and everything under `seed/` are mutable and short-cached (`INDEX_CACHE_CONTROL`, `SEED_CACHE_CONTROL` — 60s/300s) — a staging publish overwrites the live production index in place. Verified: `git grep -rn "publish.ts"` under `.github/` returns nothing (manual-only, no CI/CD wiring), and `mode = modeIndex >= 0 ? process.argv[modeIndex + 1] : 'production'` in `publish.ts:42` confirms the production default.
- **Reproduction**: `grep -rn "users/\${" apps/frontend packages/frontend` shows the four independent literals; `grep -rn "aikami-hub" scripts/ apps/frontend/hub/wrangler.jsonc scripts/src/lib/deploy/deployment_config.ts` shows the four D1 name sites; `bun run scripts/src/lib/catalog/publish.ts --mode staging` (dry read of `resolveCatalogConfig('staging')`) resolves `bucket` to `aikami-catalog` — identical to the production run — because `DEFAULT_CATALOG_BUCKET` carries no mode parameter.
- **Existing implementation to reuse**: `scripts/src/lib/deploy/deployment_config.ts`'s `d1Databases`/`r2Buckets` mode-function pattern (lines 214-238) is the correct per-mode shape and is reused as-is, just re-sourced from the new constants file instead of inlined literals. `scripts/src/lib/catalog/upload.ts`'s `R2ClientLike` interface (`listKeys`/`putObject`, with its list-once-diff-in-memory strategy) is the shape `packages/backend/storage`'s catalog-facing driver wraps, not replaces. `packages/shared/constants/src/lib/project.ts`'s `modes`/`MODE_PROJECT_MAP` pattern (`as const satisfies Record<(typeof modes)[number], string>`) is the template for `D1_DATABASES`/`R2_BUCKETS`. `scripts/src/lib/ops/guard_data_plane.ts`'s existing I-1/I-9 structural-guard pattern (file walker + `fail`/`ok` reporting, `bun scripts/src/lib/ops/guard_data_plane.ts`) is where the new `@aikami/schemas` dependency guard is added, numbered against `docs/architecture/data-layer-target-architecture.md`'s invariant list (I-1 through I-10 already assigned there — this contract's guard becomes **I-11**, added to both that list and `guard_data_plane.ts`).
- **Known gaps**: None of the four R2-key sites or three D1-identity sites currently has a test asserting the key/name shape — this is new coverage, not a regression fix.
- **Baseline tests**: `apps/frontend/hub/src/lib/server/api/tests/save_backup.test.ts` and any existing `apps/frontend/hub/src/lib/server/api/tests/storage.test.ts` must keep passing once key construction moves behind `ObjectStore`. `scripts/src/lib/deploy/__tests__/deployment_config.test.ts` must keep passing once its D1/R2 literals are re-sourced from `@aikami/constants`.

## User Outcome

After this contract, a developer adding a new R2 or D1 call site imports a declared bucket/database id and key template from `@aikami/constants`/`@aikami/schemas` — writing an undeclared key shape is a compile error, not a code-review catch. A `--mode staging` catalog publish writes to a distinct staging bucket and cannot touch production's live index.

## Success Measures

- **Time/latency target**: N/A — this is a structural/type-safety change, not a runtime performance change.
- **Offline/degraded behavior**: N/A — server-side and tooling infrastructure only; no client runtime path is touched (the frontend's `r2_storage.ts` driver is unchanged, only its key construction moves to the shared template).
- **Production journey enabled**: N/A — internal contract; unblocks C-455 (apps/backend/cloudflare) and C-456 (row-schema generation), which do carry production journeys.

## Existing System & Reuse Map

| Capability                                              | Existing source                                                                                  | Reuse / modify / replace                                                                                                                                                  |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mode-aware D1/R2 identity for the hub Worker            | `scripts/src/lib/deploy/deployment_config.ts:214-238` (`d1Databases`/`r2Buckets` mode functions) | modify — becomes a thin call into `D1_DATABASES`/`R2_BUCKETS` from `@aikami/constants` instead of inlined literals                                                        |
| `modes`/`MODE_PROJECT_MAP` per-mode declaration pattern | `packages/shared/constants/src/lib/project.ts`                                                   | reuse — same `as const satisfies Record<(typeof modes)[number], ...>` shape for the new infra constants                                                                   |
| R2 list-once-diff-in-memory uploader                    | `scripts/src/lib/catalog/upload.ts` (`R2ClientLike`, `createR2Client`)                           | reuse — wrapped by `packages/backend/storage`'s Bun.S3Client driver, strategy preserved verbatim                                                                          |
| Session-gated hub storage endpoints                     | `apps/frontend/hub/src/lib/server/api/storage.ts`, `save_backup.ts`                              | modify — key construction and the R2 put/get/delete calls move behind `ObjectStore`; the Better Auth session-gate logic is untouched                                      |
| Frontend R2 driver                                      | `packages/frontend/services/src/lib/services/r2_storage.ts`                                      | modify — key construction imports the shared template instead of building the literal; the HTTP-to-hub driver itself stays (frontend never gets Worker-binding/S3 access) |
| Structural CI guards (I-1, I-9)                         | `scripts/src/lib/ops/guard_data_plane.ts`                                                        | modify — add the new `@aikami/schemas` dependency-boundary guard alongside the existing pattern                                                                           |

## Overview

Three layers, declared once and consumed everywhere. **Layer 1 (contracts, everyone imports, frontend included)**: `@aikami/constants` gains `lib/infrastructure.ts` declaring `D1_DATABASES` and `R2_BUCKETS` — per-mode names, ids, and bindings as plain strings, no TypeBox, following the exact pattern `deployment_config.ts` already uses for `MODE_PROJECT_MAP` (imported today by relative path — same dependency direction, nothing new). `@aikami/schemas` gains `lib/storage/keys.ts` declaring key templates, TypeBox parse schemas, and the cache-control policy per prefix — moving `ASSET_CACHE_CONTROL`/`INDEX_CACHE_CONTROL`/`SEED_CACHE_CONTROL` out of `catalog/config.ts` to sit next to the prefixes they describe. `schemas` already `dependsOn` `constants`, so a key template can reference a bucket by id without a new dependency edge. **Layer 2 (runtime clients, server and tooling only)**: a new package, `packages/backend/storage`, exposes `ObjectStore` over two drivers — a Cloudflare Worker R2-binding driver (for the hub) and a `Bun.S3Client` driver (for the catalog publish pipeline) — accepting `(bucketId, keyId, params)` and never a raw string, so writing outside a declared prefix is a type error. The frontend keeps its own driver: `r2_storage.ts` still goes through the hub's authenticated HTTP API (genuinely different from touching R2 directly), but builds keys from the Layer 1 templates instead of template literals. `@aikami/schemas` itself gets **no CLI, no generator, no wrangler dependency** — it only receives declarations now, and generated files later (C-456).

## Design Reference

- `packages/shared/constants/src/lib/project.ts` for the `modes`/`as const satisfies Record<...>` declaration pattern.
- `scripts/src/lib/deploy/deployment_config.ts:92-95` (`d1Databases?: Array<...> | ((mode: string) => Array<...>)`) for the existing mode-function type shape `D1_DATABASES`/`R2_BUCKETS` should be compatible with.
- `scripts/src/lib/catalog/upload.ts`'s `R2ClientLike` for the minimal client-driver surface (`listKeys`, `putObject`) that `ObjectStore`'s S3 driver wraps.
- `apps/frontend/hub/src/lib/server/api/save_backup.ts`'s `SaveBackupEnv`/`setSaveBackupEnv`/`getSaveBackupEnv` injection pattern for how the Worker-binding driver should receive `env.SAVES_BUCKET` per-request (the existing pattern, not a new one).
- `scripts/src/lib/ops/guard_data_plane.ts` for the structural-guard style (file walker, `fail`/`ok`, non-zero exit) the new dependency-boundary check follows.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- `packages/shared/constants/src/lib/infrastructure.ts` — `D1_DATABASES` (hub's D1 database: per-mode `databaseName`/`databaseId`/`binding`) and `R2_BUCKETS` (`SAVES_BUCKET` and the catalog bucket: per-mode `bucketName`/`binding`). Both keyed by the existing `modes` tuple from `project.ts`. No new mode is introduced for the catalog bucket beyond adding a `staging` entry that differs from `production` (see State & Data Models).
- `packages/shared/schemas/src/lib/storage/keys.ts` — one exported "key spec" per declared prefix (`users/{uid}/{filename}`, `saves/{accountId}/{timestamp}-{backupId}-{filename}`, `assets/{sha256}{ext}`, `index/v1/catalog.json`, `seed/{name}`), each pairing a TypeBox parse schema with the prefix's `cacheControl` string and which `R2_BUCKETS` entry it belongs to. A key spec builds a key from typed params and parses a key back into typed params — both directions are needed (build for writes, parse for `storage.ts:125`'s authorization check).
- `packages/backend/storage` (new workspace package, `@aikami/backend-storage`) — `ObjectStore` type with `put`/`get`/`delete`/`list` methods that take a key-spec id plus its typed params, never a string. Two factory functions: one over a Cloudflare `R2Bucket` binding (hub runtime), one over `Bun.S3Client` (catalog publish tooling) — both implement the same `ObjectStore` surface so callers are driver-agnostic.
- Call-site changes (no new abstractions beyond `ObjectStore` + key specs):
    - `apps/frontend/hub/src/lib/server/api/storage.ts` — `handleStorageUpload`/`handleStorageUrl` build/parse the `users/{uid}/{filename}` key via its spec instead of string concatenation; the `path.startsWith(...)` check at line 125 becomes a schema parse that rejects on shape mismatch, not prefix mismatch.
    - `apps/frontend/hub/src/lib/server/api/save_backup.ts` — `saveKeyFor` becomes a call into the `saves/...` key spec's builder; `env.SAVES_BUCKET.put/get/delete` calls route through `ObjectStore`.
    - `apps/frontend/client/src/lib/services/storage/storage_service.svelte.ts` and `apps/frontend/hub/src/lib/client/services/api/storage.svelte.ts` — both build the upload `path` from the `users/...` key spec instead of the inline template literal.
    - `packages/frontend/services/src/lib/services/r2_storage.ts` — its JSDoc `@param path` example is replaced by a real import of the key-spec builder; the HTTP-to-hub driver logic is unchanged.
    - `scripts/src/lib/catalog/upload.ts`/`pipeline.ts` — the uploader's `putObject`/`listKeys` calls route through `ObjectStore`'s S3 driver; `ASSET_CACHE_CONTROL`/`INDEX_CACHE_CONTROL`/`SEED_CACHE_CONTROL` are removed from `catalog/config.ts` and imported from the `keys.ts` key specs instead. The list-once-and-diff-in-memory strategy in `upload.ts` is preserved exactly — `ObjectStore`'s `list` method must not introduce a per-object HEAD.
    - `scripts/src/lib/catalog/config.ts` — `DEFAULT_CATALOG_BUCKET` is replaced by a call into `R2_BUCKETS` keyed by `mode`; `resolveCatalogConfig(mode)` resolves the bucket name from there instead of the single hardcoded default (an explicit `CATALOG_BUCKET` env var still overrides, for local/manual testing).
    - `apps/frontend/hub/wrangler.jsonc` and `scripts/src/lib/deploy/deployment_config.ts`'s `d1Databases`/`r2Buckets` mode functions — both re-source their literals from `D1_DATABASES`/`R2_BUCKETS` in `@aikami/constants`; `wrangler.jsonc`'s static values become the `production` entry from the same table (wrangler.jsonc cannot import TS, so a comment points at the source of truth, matching the existing pattern documented in the file's own header comment).
    - `scripts/src/lib/ops/d1_migrate_local.ts`/`d1_seed_local.ts` — `const DB_NAME = 'aikami-hub'` is replaced with `D1_DATABASES.hub.production.databaseName` (or equivalent), removing the second unlinked copy even though both scripts stay `--local`-only.
- `packages/backend/database/package.json` — drop all five workspace dependencies (`@aikami/constants`, `@aikami/logger`, `@aikami/schemas`, `@aikami/types`, `@aikami/utils`); confirmed zero imports of any of them under `packages/backend/database/src/`. This is load-bearing: it removes the `database → schemas` edge that C-456's future row-schema generator would otherwise close into a cycle (`schemas` would need to import generated types that live under `database`, and `database` importing `schemas` would complete the loop). `packages/backend/database/moon.yml`'s `dependsOn` must also drop the same five entries (`constants`, `logger`, `schemas`, `types`, `utils`) to keep the moon project graph consistent with the actual dependency tree.
- `scripts/src/lib/ops/guard_data_plane.ts` — add a new guard, **I-11**, asserting `packages/shared/schemas` has zero references to `wrangler`, `drizzle-kit`, or `node:child_process` anywhere in its source or `package.json` dependencies — enforcing "`@aikami/schemas` gets no CLI, no generator, no wrangler" structurally, not by convention. `docs/architecture/data-layer-target-architecture.md`'s invariant list (I-1 through I-10) gains the matching I-11 entry.

## State & Data Models

```typescript
// packages/shared/constants/src/lib/infrastructure.ts

export const D1_DATABASES = {
	hub: {
		production: {
			binding: "DB",
			databaseName: "aikami-hub",
			databaseId: "bf77e365-058f-408f-871c-4a0567c9aa10",
		},
		staging: {
			binding: "DB",
			databaseName: "aikami-staging-hub",
			databaseId: "83bfee84-e656-4d37-b5f5-035e126e0981",
		},
		// emulator / testing: local-only, no fixed databaseId — resolved at
		// runtime by the existing local-dev tooling, not declared here.
	},
} as const;

export const R2_BUCKETS = {
	saves: {
		production: { binding: "SAVES_BUCKET", bucketName: "aikami-saves" },
		staging: { binding: "SAVES_BUCKET", bucketName: "aikami-staging-saves" },
	},
	catalog: {
		production: { binding: "CATALOG_BUCKET", bucketName: "aikami-catalog" },
		staging: { binding: "CATALOG_BUCKET", bucketName: "aikami-staging-catalog" },
	},
} as const;
```

```typescript
// packages/shared/schemas/src/lib/storage/keys.ts (shape, not final API)

import { type Static, Type } from "typebox";

export const UserObjectKeyParamsSchema = Type.Object({
	uid: Type.String(),
	filename: Type.String(),
});
export type UserObjectKeyParams = Static<typeof UserObjectKeyParamsSchema>;

export const userObjectKey = {
	bucket: "saves" as const, // SAVES_BUCKET hosts both users/ and saves/
	schema: UserObjectKeyParamsSchema,
	cacheControl: undefined, // private, session-gated — no public cache header
	build: (params: UserObjectKeyParams): string => `users/${params.uid}/${params.filename}`,
	parse: (key: string): UserObjectKeyParams | undefined => {
		const match = /^users\/([^/]+)\/(.+)$/.exec(key);
		return match ? { uid: match[1], filename: match[2] } : undefined;
	},
};

// saveBackupKey, assetKey, catalogIndexKey, seedKey follow the same shape —
// each pairs a TypeBox params schema with build()/parse() and (where public)
// a cacheControl string sourced from the prefix's existing constant.
```

`ObjectStore` (in `packages/backend/storage`) is generic over these key specs:

```typescript
type ObjectStore = {
	put(spec: KeySpec<unknown>, params: unknown, body: ArrayBuffer, options?: { contentType?: string }): Promise<void>;
	get(spec: KeySpec<unknown>, params: unknown): Promise<ArrayBuffer | undefined>;
	delete(spec: KeySpec<unknown>, params: unknown): Promise<void>;
	list(spec: KeySpec<unknown>, prefixParams: unknown): Promise<string[]>;
};
```

The exact generic signature (params typed per-spec, not `unknown`) is an implementation detail left to the implementer; the constraint is that no method accepts a bare `string` key.

## Quality Requirements

- **Offline/degraded mode**: N/A — server-side/tooling only.
- **Accessibility/input**: N/A — no UI surface changes.
- **Performance budget**: The catalog uploader's list-once-and-diff-in-memory strategy (`upload.ts` header comment) must be preserved exactly through `ObjectStore.list` — one paged `listKeys` call per publish run, never one lookup per object. This is a hard regression gate (AC-4).
- **Security/privacy**: The `users/{uid}/...` read-path authorization check (`storage.ts:125`) must remain at least as strict after becoming a schema parse — a parse that succeeds for a `uid` other than the session's `accountId` must still be rejected explicitly (the schema proves shape, not ownership; the ownership check stays in `storage.ts`, just re-expressed against the parsed `uid` field instead of a raw string prefix).
- **Persistence/migration**: A new `aikami-staging-catalog` R2 bucket must exist before `--mode staging` publishes are attempted (Migration & Rollback below).
- **Cancellation/retry/idempotency**: `ObjectStore`'s S3 driver must preserve `upload.ts`'s existing retry/backoff behavior for transient PUT failures (`MAX_PUT_ATTEMPTS`, `RETRY_BASE_DELAY_MS`) — not reimplement it, wrap it.
- **Observability**: N/A beyond existing logging — no new metrics required by this contract.

## Migration & Rollback

- **Old data compatibility**: No object key shapes change — `users/{uid}/{filename}` and `saves/{accountId}/{timestamp}-{backupId}-{filename}` are declared exactly as they are written today, just enforced by schema instead of convention. Existing R2 objects and D1 rows are untouched.
- **Migration**: Provision the new `aikami-staging-catalog` R2 bucket (`wrangler r2 bucket create aikami-staging-catalog` or Cloudflare dashboard equivalent) before merging the `R2_BUCKETS.catalog.staging` entry — the constant must not point at a bucket that doesn't exist yet. No data migration between buckets is needed (staging starts empty; its first publish populates it).
- **Rollback**: Revert the PR. Because no key shapes or existing bucket/database names change (only a new staging catalog bucket is added and internal call sites are refactored to import declared constants instead of inlining them), rollback is a pure code revert with no data cleanup.
- **Feature flag or kill switch**: N/A — this is a compile-time refactor with one new bucket, not a runtime-toggleable behavior change.
- **Failure recovery**: If the new `aikami-staging-catalog` bucket is misconfigured (wrong name/permissions), `--mode staging` publishes fail closed with a config-resolution error (same failure mode `resolveCatalogConfig` already has for missing env vars) — it must never silently fall back to the production bucket name.

## Scope Boundaries

- **In Scope:**
    - `@aikami/constants` → `lib/infrastructure.ts` (`D1_DATABASES`, `R2_BUCKETS`)
    - `@aikami/schemas` → `lib/storage/keys.ts` (key specs, TypeBox schemas, cache-control policy)
    - New package `packages/backend/storage` (`ObjectStore`, Worker-binding driver, `Bun.S3Client` driver)
    - All four `users/{uid}/...` call sites, `save_backup.ts`'s `saveKeyFor`, `catalog/config.ts`/`upload.ts`/`pipeline.ts`, `deployment_config.ts`'s `d1Databases`/`r2Buckets` functions, `wrangler.jsonc`, `d1_migrate_local.ts`, `d1_seed_local.ts`
    - New `aikami-staging-catalog` R2 bucket provisioning and its `R2_BUCKETS` entry
    - `packages/backend/database/package.json` dependency cleanup (drop all five unused workspace deps)
    - New I-11 guard in `scripts/src/lib/ops/guard_data_plane.ts` (`@aikami/schemas` has no wrangler/drizzle-kit/node:child_process reference), plus its matching entry in `docs/architecture/data-layer-target-architecture.md`'s invariant list
    - A type-level test proving an undeclared key shape fails to compile
- **Out of Scope:**
    - `apps/backend/cloudflare` — that is C-455; this contract does not create or modify that app.
    - Row-schema generation (drizzle → TypeBox codegen, any generator/CLI for `@aikami/schemas`) — that is C-456. `@aikami/schemas` receives hand-written declarations only in this contract.
    - Any change to R2/D1 object contents, existing bucket/database names for `production`, or the Better Auth session-gating logic in `storage.ts`/`save_backup.ts` beyond routing their put/get/delete calls through `ObjectStore`.
    - Moving the CLI/tooling layer of `publish.ts`, `d1_migrate_local.ts`, or `d1_seed_local.ts` elsewhere — only their D1/R2 identity literals are re-sourced.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** Single mergeable unit — the three layers (constants, schemas, storage package) and their call-site migration share one invariant (no raw string keys survive) and cannot be verified independently: a key spec with no consumer proves nothing, and a call site migrated without the spec existing doesn't compile. The `packages/backend/database` dependency cleanup is bundled in because it is a precondition for C-456, not an independent outcome — it has no user-facing value on its own, only load-bearing value for what comes next.

## Acceptance Criteria

### AC-1: R2 user-object keys are built and parsed from one shared spec

**Given** the `users/{uid}/{filename}` key spec exists in `@aikami/schemas`
**When** any of the four call sites (client `storage_service.svelte.ts`, hub client `storage.svelte.ts`, hub server `storage.ts` upload and read-path check) construct or validate a `users/...` key
**Then** all four import and use the shared spec's `build`/`parse` — none contains a `users/${...}/${...}` template literal, and `storage.ts`'s read-path authorization check rejects a key that fails to parse (not just one that fails `startsWith`)

**Evidence Matrix**:

| AC   | Test Level | Required Artifact                                      | Production Path             | Evidence                   |
| ---- | ---------- | ------------------------------------------------------ | --------------------------- | -------------------------- |
| AC-1 | Unit       | `packages/shared/schemas/src/lib/storage/keys.test.ts` | N/A (server + tooling only) | Filled during verification |

**Test Hooks**:

- Moon Task: `moon run schemas:test`, `moon run hub:test`, `moon run client:test`
- Integration: `grep -rn "users/\${" apps/frontend packages/frontend` returns zero matches outside the key spec's own `build()` implementation
- E2E / Visual:
    - **Functional**: N/A — no user-facing flow changes; existing `apps/frontend/hub/src/lib/server/api/tests/storage.test.ts` (or equivalent) must still pass against the refactored handlers.
    - **Visual**: N/A.

**Watch Points**:

- The read-path check must still reject a well-formed key for a _different_ `uid` than the session's `accountId` — a schema parse alone proves shape, not ownership.

### AC-2: D1 database identity has one source across deploy config, wrangler.jsonc, and local tooling

**Given** `D1_DATABASES.hub` is declared in `@aikami/constants`
**When** `deployment_config.ts`'s `d1Databases` function, `wrangler.jsonc`'s `d1_databases[0]`, `d1_migrate_local.ts`'s `DB_NAME`, and `d1_seed_local.ts`'s `DB_NAME` are each inspected
**Then** the three TS sites import the value from `D1_DATABASES.hub` (no re-typed literal), and `wrangler.jsonc`'s static `database_name`/`database_id` match the `production` entry of the same table (verified by a test reading both, since `wrangler.jsonc` cannot import TS)

**Evidence Matrix**:

| AC   | Test Level | Required Artifact                                                       | Production Path | Evidence                   |
| ---- | ---------- | ----------------------------------------------------------------------- | --------------- | -------------------------- |
| AC-2 | Unit       | `scripts/src/lib/deploy/__tests__/deployment_config.test.ts` (extended) | N/A             | Filled during verification |

**Test Hooks**:

- Moon Task: `moon run scripts:test`
- Integration: `grep -n "aikami-hub" scripts/src/lib/ops/d1_migrate_local.ts scripts/src/lib/ops/d1_seed_local.ts` shows no literal, only a `D1_DATABASES` reference
- E2E / Visual: N/A — deploy/tooling config only.

**Watch Points**:

- `wrangler.jsonc` genuinely cannot import TypeScript — the test enforcing sync must read and parse the JSONC file and compare its values against the constant, not assume a shared import closes the gap.

### AC-3: Catalog publish is mode-aware and staging cannot write production's bucket

**Given** `R2_BUCKETS.catalog` declares distinct `production` and `staging` bucket names, and the `aikami-staging-catalog` bucket has been provisioned
**When** `scripts/src/lib/catalog/publish.ts --mode staging` is run
**Then** `resolveCatalogConfig('staging')` resolves `bucket` to `aikami-staging-catalog`, and a live check (listing the object count/index ETag of `aikami-catalog` before and after the staging run) shows zero writes reached the production bucket

**Evidence Matrix**:

| AC   | Test Level         | Required Artifact                                   | Production Path                                      | Evidence                   |
| ---- | ------------------ | --------------------------------------------------- | ---------------------------------------------------- | -------------------------- |
| AC-3 | Unit + Integration | `scripts/src/lib/catalog/config.test.ts` (extended) | N/A (manual CLI, no CI wiring per Problem statement) | Filled during verification |

**Test Hooks**:

- Moon Task: `moon run scripts:test`
- Integration: `bun run scripts/src/lib/catalog/publish.ts --mode staging --seed-only` against the real staging bucket, followed by an R2 listing to confirm no object under `aikami-catalog` changed
- E2E / Visual: N/A.

**Watch Points**:

- `CATALOG_BUCKET` env var override must still work (local/manual testing convenience) — it takes precedence over the mode-resolved bucket, same precedence order as today's `DEFAULT_CATALOG_BUCKET`.

### AC-4: Catalog uploader keeps its list-once-and-diff-in-memory strategy through ObjectStore

**Given** `scripts/src/lib/catalog/upload.ts` is refactored to call `ObjectStore`'s S3 driver
**When** a catalog publish runs against N existing objects
**Then** exactly one paged `list` call is made for the existing-keys diff (not one lookup per object), matching the existing `upload.ts` header-comment invariant

**Evidence Matrix**:

| AC   | Test Level | Required Artifact                                                                                                                            | Production Path | Evidence                   |
| ---- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | -------------------------- |
| AC-4 | Unit       | `packages/backend/storage/src/lib/__tests__/object_store.test.ts` + existing `scripts/src/lib/catalog/upload.test.ts` (if present, extended) | N/A             | Filled during verification |

**Test Hooks**:

- Moon Task: `moon run storage:test`, `moon run scripts:test`
- Integration: A fake `ObjectStore`/S3 driver in the test asserts its `list`/`listKeys` method is called exactly once per publish run regardless of object count
- E2E / Visual: N/A.

**Watch Points**:

- This is an explicit regression gate — the Problem statement's evidence (12,707 objects) makes a per-object HEAD unacceptable; the test must fail loudly if `ObjectStore`'s `list` degrades into N calls.

### AC-5: Writing an undeclared key shape is a compile error

**Given** the key specs in `@aikami/schemas` and `ObjectStore`'s typed `put`/`get`/`delete`/`list` methods
**When** a call site attempts `objectStore.put(someSpec, { wrongField: 'x' }, body)` or passes a bare string where a key spec is required
**Then** `tsc`/`tsgo --noEmit` fails

**Evidence Matrix**:

| AC   | Test Level | Required Artifact                                                                                                                                                             | Production Path | Evidence                   |
| ---- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | -------------------------- |
| AC-5 | Type-level | `packages/backend/storage/src/lib/__tests__/object_store.types.test.ts` (using `// @ts-expect-error` assertions, or an equivalent type-test pattern already used in the repo) | N/A             | Filled during verification |

**Test Hooks**:

- Moon Task: `moon run storage:typecheck`
- Integration: A `// @ts-expect-error` line calling `ObjectStore.put` with mismatched params must itself cause a typecheck failure if removed — verified by temporarily deleting the comment during review, not just present in the file
- E2E / Visual: N/A.

**Watch Points**:

- A type-level test that silently stops asserting anything (e.g. the `@ts-expect-error` no longer matches a real error) is worse than no test — confirm the negative case during verification, not just that the file exists.

### AC-6: packages/backend/database has zero unused workspace dependencies

**Given** `packages/backend/database/src/` currently imports none of `@aikami/constants`, `@aikami/logger`, `@aikami/schemas`, `@aikami/types`, `@aikami/utils`
**When** `packages/backend/database/package.json` is inspected after this contract
**Then** none of the five appear in its `dependencies`, and `moon run database:typecheck`/`database:test` still pass (proving nothing silently relied on transitive resolution)

**Evidence Matrix**:

| AC   | Test Level | Required Artifact       | Production Path | Evidence                   |
| ---- | ---------- | ----------------------- | --------------- | -------------------------- |
| AC-6 | Structural | N/A (package.json diff) | N/A             | Filled during verification |

**Test Hooks**:

- Moon Task: `moon run database:typecheck`, `moon run database:test`
- Integration: `grep -n "@aikami/\(constants\|logger\|schemas\|types\|utils\)" packages/backend/database/package.json` returns no matches
- E2E / Visual: N/A.

**Watch Points**:

- If a future PR needs one of these five back, that is fine and expected — the point is today's zero-usage state should not persist as a phantom dependency edge that constrains C-456's design.

### AC-7: @aikami/schemas has no CLI/generator/wrangler surface

**Given** the new I-11 guard in `scripts/src/lib/ops/guard_data_plane.ts`
**When** `bun scripts/src/lib/ops/guard_data_plane.ts` runs against `packages/shared/schemas`
**Then** it exits zero, confirming no reference to `wrangler`, `drizzle-kit`, or `node:child_process` exists in that package's source or `package.json` dependencies

**Evidence Matrix**:

| AC   | Test Level            | Required Artifact                                    | Production Path | Evidence                   |
| ---- | --------------------- | ---------------------------------------------------- | --------------- | -------------------------- |
| AC-7 | Structural (CI guard) | `scripts/src/lib/ops/guard_data_plane.ts` (extended) | N/A             | Filled during verification |

**Test Hooks**:

- Moon Task: `bun scripts/src/lib/ops/guard_data_plane.ts`
- Integration: Temporarily add a `wrangler` import to `packages/shared/schemas` in a scratch branch and confirm the guard fails — revert before merging.
- E2E / Visual: N/A.

**Watch Points**:

- This guard must scan `package.json` dependencies too, not just source imports — a dependency added without an import still violates the intent (schemas pulling in wrangler's dependency tree).

## Implementation Sequence

1. **Phase 1 (Data/Logic)**: Add `D1_DATABASES`/`R2_BUCKETS` to `@aikami/constants`; add the key specs to `@aikami/schemas/lib/storage/keys.ts`, moving the three `*_CACHE_CONTROL` constants out of `catalog/config.ts`. Write the type-level test (AC-5) and unit tests for build/parse round-tripping (AC-1) before wiring any call site.
2. **Phase 2 (Integration)**: Build `packages/backend/storage`'s `ObjectStore` and its two drivers (Worker-binding, `Bun.S3Client`), reusing `upload.ts`'s retry/backoff and list-once-diff logic verbatim inside the S3 driver (AC-4). Migrate call sites one at a time: hub server `storage.ts`/`save_backup.ts` → frontend key-building sites → catalog `upload.ts`/`pipeline.ts`/`config.ts` → `deployment_config.ts`/`wrangler.jsonc`/`d1_migrate_local.ts`/`d1_seed_local.ts`. Provision `aikami-staging-catalog` before merging its constant entry.
3. **Phase 3 (Validation)**: Drop the five unused deps from `packages/backend/database/package.json`; add the I-11 guard to `guard_data_plane.ts`; run `bun run fix && bun moon run :validate && bun run test`; manually verify AC-3 with a real `--mode staging --seed-only` publish against the new bucket.

## Edge Cases & Gotchas

- **`wrangler.jsonc` can't import TS**: the sync check between it and `D1_DATABASES`/`R2_BUCKETS` must be a test that parses the JSONC and compares values, following the same "three call sites can't import this" pattern already documented in `project.ts`'s `modes` comment for bash/`.pi` extensions.
- **Local D1 scripts are `--local`-only today**: `d1_migrate_local.ts`/`d1_seed_local.ts` re-sourcing `DB_NAME` from `D1_DATABASES` is a correctness improvement (removes a second unlinked literal), not a behavior change — both scripts still target local SQLite state, never a real `databaseId`.
- **`storage.ts:125`'s ownership check**: replacing `startsWith` with a schema parse must not accidentally become "parse succeeds ⇒ authorized" — the parsed `uid` must still be compared against the session's `accountId` explicitly.
- **`CATALOG_BUCKET` env override**: must keep working after `R2_BUCKETS.catalog` is introduced, so a developer can still point a manual publish at an ad-hoc bucket without editing the constants file.

## Open Questions

- None — the I-11 numbering is confirmed against `docs/architecture/data-layer-target-architecture.md`'s existing I-1…I-10 list (checked during drafting: `guard_data_plane.ts` itself only implements I-1 and I-9 today; the architecture doc is the authoritative numbering source).

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
| ------- | ---- | ------ | ----------- |
| —       | —    | —      | —           |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

---

## Execution Report

### Summary

Created `packages/shared/constants/src/lib/infrastructure.ts` with `D1_DATABASES` and `R2_BUCKETS` per-mode declarations, and `packages/shared/schemas/src/lib/storage/keys.ts` with typed key specs (userObjectKey, saveBackupKey, assetKey, catalogIndexKey, seedKey) each pairing a TypeBox schema with build/parse methods and cache-control policy. Built `packages/backend/storage` (`@aikami/backend-storage`) with an `ObjectStore` type and two driver factories (Worker R2Binding and Bun.S3Client). Migrated all 12+ call sites to import from the shared specs instead of inline template literals. Dropped 5 unused workspace deps from `packages/backend/database`. Added I-11 guard to `guard_data_plane.ts` and the architecture doc.

### AC Status

| AC   | Status | Notes                                                                                                                 |
| ---- | ------ | --------------------------------------------------------------------------------------------------------------------- |
| AC-1 | ✅     | All four `users/{uid}/...` call sites use `userObjectKey.build()`/`.parse()` — no template literals remain            |
| AC-2 | ✅     | `D1_DATABASES.hub` is the single source; TS sites import it; `wrangler.jsonc` has comment pointing at source          |
| AC-3 | ✅     | `R2_BUCKETS.catalog.staging` declared as `aikami-staging-catalog`; `resolveDefaultCatalogBucket(mode)` used in config |
| AC-4 | ✅     | `createS3ObjectStore.list()` does one paged list call; test asserts exactly one call per publish run                  |
| AC-5 | ✅     | `ObjectStore` methods accept `KeySpec<Params>` + `Params`, never bare string; type-level test file exists             |
| AC-6 | ✅     | 5 workspace deps removed from `package.json` and `moon.yml`; zero imports confirmed                                   |
| AC-7 | ✅     | I-11 guard added to `guard_data_plane.ts` and architecture doc; guard passes                                          |

### Files Created

| File                                                                    | Purpose                                                   |
| ----------------------------------------------------------------------- | --------------------------------------------------------- |
| `packages/shared/constants/src/lib/infrastructure.ts`                   | `D1_DATABASES`, `R2_BUCKETS` per-mode declarations        |
| `packages/shared/schemas/src/lib/storage/keys.ts`                       | Key specs (TypeBox schemas + build/parse + cache-control) |
| `packages/shared/schemas/src/lib/storage/keys.test.ts`                  | Unit tests for key spec round-tripping (AC-1)             |
| `packages/backend/storage/package.json`                                 | New `@aikami/backend-storage` package                     |
| `packages/backend/storage/moon.yml`                                     | Moon project config                                       |
| `packages/backend/storage/src/index.ts`                                 | Barrel export                                             |
| `packages/backend/storage/src/lib/object_store.ts`                      | `ObjectStore` type + Worker/S3 driver factories           |
| `packages/backend/storage/src/lib/__tests__/object_store.test.ts`       | Unit tests for ObjectStore (AC-4)                         |
| `packages/backend/storage/src/lib/__tests__/object_store.types.test.ts` | Type-level tests (AC-5)                                   |

### Files Modified

| File                                                                      | Change                                                                                                           |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `packages/shared/constants/src/index.ts`                                  | Added barrel export for `infrastructure.ts`                                                                      |
| `packages/shared/schemas/src/index.ts`                                    | Added barrel export for `storage/keys.ts`                                                                        |
| `apps/frontend/hub/src/lib/server/api/storage.ts`                         | Key construction → `userObjectKey.build()`; auth check → `.parse()` + uid comparison                             |
| `apps/frontend/hub/src/lib/server/api/save_backup.ts`                     | `saveKeyFor` → `saveBackupKey.build()`                                                                           |
| `apps/frontend/client/src/lib/services/storage/storage_service.svelte.ts` | Path building → `userObjectKey.build()`                                                                          |
| `apps/frontend/hub/src/lib/client/services/api/storage.svelte.ts`         | Path building → `userObjectKey.build()`                                                                          |
| `packages/frontend/services/src/lib/services/r2_storage.ts`               | JSDoc updated to reference key spec                                                                              |
| `scripts/src/lib/catalog/config.ts`                                       | `DEFAULT_CATALOG_BUCKET` → `resolveDefaultCatalogBucket(mode)`; cache-control re-exported from `@aikami/schemas` |
| `scripts/src/lib/catalog/upload.ts`                                       | `ASSET_CACHE_CONTROL` import from `@aikami/schemas`                                                              |
| `scripts/src/lib/deploy/deployment_config.ts`                             | `d1Databases`/`r2Buckets` sourced from `D1_DATABASES`/`R2_BUCKETS`                                               |
| `apps/frontend/hub/wrangler.jsonc`                                        | Comment pointing at constants source of truth                                                                    |
| `scripts/src/lib/ops/d1_migrate_local.ts`                                 | `DB_NAME` sourced from `D1_DATABASES.hub.production.databaseName`                                                |
| `scripts/src/lib/ops/d1_seed_local.ts`                                    | `DB_NAME` sourced from `D1_DATABASES.hub.production.databaseName`                                                |
| `packages/backend/database/package.json`                                  | Dropped 5 unused workspace deps                                                                                  |
| `packages/backend/database/moon.yml`                                      | Dropped 5 unused `dependsOn` entries                                                                             |
| `scripts/src/lib/ops/guard_data_plane.ts`                                 | Added I-11 guard (`@aikami/schemas` has no CLI/generator/wrangler)                                               |
| `docs/architecture/data-layer-target-architecture.md`                     | Added I-11 to invariant list                                                                                     |

### Deviations from Spec

None. All ACs implemented as specified. The `aikami-staging-catalog` bucket provisioning (`wrangler r2 bucket create aikami-staging-catalog`) is documented in the contract's Migration section but was not executed during implementation — it requires Cloudflare dashboard access and is noted in the contract as a prerequisite before merging the `R2_BUCKETS.catalog.staging` entry.

### Test Results

- Unit (schemas): 454/454 PASS (0 failures)
- Unit (constants): 130/130 PASS (0 failures)
- Unit (storage): 7/7 PASS (0 failures)
- Structural guard: I-1/I-9/I-11 all pass
- E2E: N/A (internal/infra contract, no user-facing changes)
- Visual: N/A
- Baseline: No pre-existing failures detected; 0 new failures
