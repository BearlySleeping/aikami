---
id: C-461
title: "Generate TypeBox row schemas from the D1 Drizzle schema"
source: "Author request, 2026-09-02. Renumbered on authoring: C-456 is already claimed by the approved 'Group Chat & Systemic NPC Interactions' contract; C-457..C-460 are also claimed. C-461 is the real next free ID."
contract_type: thin
status: implemented
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-09-02"
---

# Contract C-461: Generate TypeBox row schemas from the D1 Drizzle schema

## Metadata

| Field | Value |
|---|---|
| **Source** | `docs/contracts/C-461-generate-typebox-row-schemas-from-drizzle.md` (this contract) |
| **Target** | `apps/backend/cloudflare/src/lib/db/generate_schemas.ts` — the generator; `packages/shared/schemas/src/lib/db/` — its committed output |
| **Type** | thin |
| **Priority** | P2 — closes a dangling doc citation and a real drift hazard (hand-written wire schemas can silently diverge from Drizzle row shapes), but nothing is on fire |
| **Dependencies** | C-454 (D1/R2 infra + storage package — removed the `database` → `schemas` edge that would otherwise make this a cycle), C-455 (`apps/backend/cloudflare` as the one home for Cloudflare/D1 operations — this generator lives in its `db` subcommand tree) |
| **Status** | implemented |
| **Promotion** | `sandbox` |
| **Docs Impact** | internal → none (no `apps/frontend/docs` page; this is a build/codegen concern) |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: `packages/shared/schemas/src/lib/catalog/account.ts`'s header says row-to-wire drift detection "still requires a dedicated conformance test" but no such test exists at `packages/backend/database/tests/conformance.test.ts` (or anywhere else). There is also no mechanical check that any hand-written wire schema still matches the Drizzle row shape it claims to project from — drift is caught only if a human notices.
- **Reproduction**: `ls packages/backend/database/tests/` shows only `d1_schema.test.ts`; `grep -rn conformance packages/shared/schemas` shows the citation in `account.ts` with nothing on the other end. Add a column to `accounts` in `packages/backend/database/src/lib/schema.ts` and nothing fails — `AccountPublicSchema` in `account.ts` is untouched and no test notices.
- **Existing implementation to reuse**: `packages/backend/database/src/lib/schema.ts` already exports `$inferSelect`-derived row types per table (`D1UserRow`, `D1AccountRow`, etc. — see lines ~237-247) that the generator can walk/compare against. `apps/backend/cloudflare/src/lib/db/` already has the CLI subcommand pattern to extend (`index.ts` dispatches `migrate` / `status` / `exec` / `seed` / `reset` / `studio` by matching `Bun.argv[3]`). `packages/backend/database/package.json`'s `db:generate` script is the existing "generate committed output, `--check` it in CI" pattern for `drizzle-kit generate` (SQL migrations) — this contract's generator follows the same shape for schemas instead of SQL.
- **Known gaps**: The existing `db:generate` only generates SQL migrations from schema diffs; it does not touch TypeBox at all. There is no `packages/shared/schemas/src/lib/db/` directory yet.
- **Baseline tests**: `packages/backend/database/tests/d1_schema.test.ts` (D1 persistence conformance — keep green, out of scope to modify beyond what's needed); `apps/backend/cloudflare/src/lib/db/__tests__/migrate.test.ts` (existing CLI db-subcommand test pattern to follow for the new `generate` subcommand, if it's exercised there).

## User Outcome

After this contract, a developer who edits `packages/backend/database/src/lib/schema.ts` and forgets to regenerate row schemas gets a **CI failure that names the exact command to run** (`bun db generate`), instead of a silent drift between storage shape and the TypeBox schemas downstream code trusts. A developer can also run `bun db generate` locally to produce/update the committed row schemas, and can point at a real, passing conformance test instead of a dangling citation.

## Scope Boundaries

- **In Scope:**
  - A hand-rolled generator at `apps/backend/cloudflare/src/lib/db/generate_schemas.ts` (~150 lines) that reads Drizzle table metadata from `@aikami/backend-database` and emits one TypeBox 1.x row schema per table into `packages/shared/schemas/src/lib/db/`.
  - Wiring the generator into the existing `db` CLI subcommand tree (`apps/backend/cloudflare/src/lib/db/index.ts`) as `db generate`, exposed at the repo root as a root-level `package.json` script alias (e.g. `"db:generate-schemas"` to avoid collision with the existing `"db:generate"` drizzle-kit script), and invocable as `bun db generate` through a `"db"` script or as `bun run db:generate-schemas` (and a `--check` mode that diffs generated output against what's committed, without writing).
  - A moon task on the `cloudflare` project (`apps/backend/cloudflare/moon.yml`) that runs `db generate --check` and fails on a stale diff, wired into CI the same way `drizzle-kit generate --check` already is for SQL.
  - Committing the generated output under `packages/shared/schemas/src/lib/db/`.
  - A conformance test (location TBD by the implementer, but must supersede the dangling citation) asserting every generated row `Static<>` type is structurally assignable to/from its Drizzle `$inferSelect` counterpart, and that it passes for every table currently in `schema.ts`.
  - Updating `account.ts`'s header comment to cite the new, real conformance test path instead of the nonexistent `packages/backend/database/tests/conformance.test.ts`.
- **Out of Scope:**
  - Generating or touching **wire** schemas (`AccountPublicSchema` and siblings in `packages/shared/schemas/src/lib/catalog/`). The standing "TypeBox owns the wire boundary, Drizzle owns storage" decision survives unchanged — wire shapes deliberately omit columns (e.g. `authUid`, server timestamps), so generating them from the row would leak fields that must never appear on the wire.
  - Adding `drizzle-typebox` as a dependency, in any form. It targets `@sinclair/typebox` `^0.34`; this repo is on `typebox` `1.3.24`, a different package with a different `Static<>` inference path. Its output would be structurally similar JSON Schema at runtime but would not type-infer correctly, and it would pin a second TypeBox into the tree. This is a hard blocker, not a preference — do not attempt to route around it by vendoring, patching, or wrapping `drizzle-typebox`.
  - Running the generator as part of `db migrate`, `db seed`, or any other existing `db` subcommand's runtime path — it is a standalone, developer/CI-invoked codegen step, same as SQL migration generation.
  - CI ever *running* the generator to produce fresh output — CI only checks committed output is not stale (`--check`), matching the `drizzle-kit generate` pattern already in place.
  - Any change to `packages/backend/database/src/lib/schema.ts` itself, beyond what's strictly needed to export whatever table metadata the generator needs (it likely already has enough via Drizzle's own table objects).

## Acceptance Criteria

### AC-1: Generator produces a row schema per table, correctly typed
**Given** `packages/backend/database/src/lib/schema.ts`'s current 8 tables (`users`, `sessions`, `accounts`, `verifications`, `deviceCodes`, `packs`, `packVersions`, `accountBackups`)
**When** `bun db generate` is run
**Then** `packages/shared/schemas/src/lib/db/` contains one TypeBox 1.x `Type.Object(...)` schema per table, and for each, `Static<typeof GeneratedSchema>` is assignable to and from the corresponding `typeof table.$inferSelect` Drizzle row type (verified by a compile-time assignability check, e.g. a `satisfies`/identity-function test fixture, not just runtime shape).

**Verification**: `bun run --cwd apps/backend/cloudflare src/cli.ts db generate` followed by `tsc --noEmit` on the new fixture/test file; `bun run validate`.

### AC-2: Stale generated output fails CI with an actionable message
**Given** a developer edits `schema.ts` (e.g. adds a column to `accounts`) and does not run `bun db generate`
**When** the moon `cloudflare` project's generate-check task runs (as CI does via `moon ci --affected`)
**Then** the task fails, and its output names `bun db generate` as the command to run to fix it — not a generic diff dump with no next step.

**Verification**: Locally, edit `schema.ts`, run the moon check task, confirm non-zero exit and the message content; revert the edit.

### AC-3: Wire-to-row conformance test exists, passes, and is correctly cited
**Given** the new conformance test asserting row-schema-to-Drizzle-type conformance for every table
**When** `bun test` is run
**Then** the test exists at a real path, passes, and `packages/shared/schemas/src/lib/catalog/account.ts`'s header comment is updated to cite that real path (replacing the dangling `packages/backend/database/tests/conformance.test.ts` reference).

**Verification**: `bun test <new test path>`; `grep -n conformance packages/shared/schemas/src/lib/catalog/account.ts` shows a path that exists on disk.

## Edge Cases & Gotchas (optional)

- **Timestamp columns**: `schema.ts` uses `integer(..., { mode: 'timestamp_ms' })`, which Drizzle infers as `Date` in `$inferSelect`. The generator must map this to a TypeBox representation whose `Static<>` is `Date`-compatible (not `number` or `string`), or the assignability check in AC-1 will fail.
- **Nullable vs. optional columns**: Drizzle's `$inferSelect` marks a non-`.notNull()` column as `| null`, not `?:`. TypeBox schemas must use `Type.Union([X, Type.Null()])`, not `Type.Optional(X)`, to match — mixing these up passes a shallow "looks right" review but fails strict assignability in both directions.
- **`PACK_VISIBILITY_VALUES`-style enum columns**: `packs.visibility` (or similar) is a `text()` column constrained by an app-level const array, not a SQL enum Drizzle can introspect as a union. Decide once whether the generator narrows these to `Type.Union` over the literal values (better DX, requires the generator to special-case or read a naming convention) or falls back to `Type.String()` (simpler, loses precision) — and apply that decision consistently across all such columns rather than per-table.
- **New tables added later**: the generator must fail loudly (not silently skip) if it encounters a table export it doesn't know how to introspect, so a future schema addition can't ship without a corresponding row schema.

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

## Execution Report

### Summary

Built a hand-rolled generator at `apps/backend/cloudflare/src/lib/db/generate_schemas.ts` (~150 lines) that reads Drizzle table metadata from `@aikami/backend-database` and emits one TypeBox 1.x row schema per table into `packages/shared/schemas/src/lib/db/`. Wired it into the existing `db` CLI subcommand tree as `db generate` with `--check` mode. Added a conformance test asserting bidirectional structural assignability between generated `Static<>` types and Drizzle `$inferSelect` types. Updated `account.ts`'s header comment to cite the new real conformance test path. All 8 tables (users, sessions, accounts, verifications, deviceCodes, packs, packVersions, accountBackups) are covered.

### AC Status

| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | Generator produces correct TypeBox schemas for all 8 tables; conformance test verifies structural assignability |
| AC-2 | ✅ | `--check` mode detects stale files with actionable message naming `bun db generate`; moon task `generate-schemas-check` wired for CI |
| AC-3 | ✅ | Conformance test at `packages/shared/schemas/src/lib/db/db_schemas_conformance.test.ts` passes; `account.ts` header updated |

### Files Created

| File | Purpose |
|---|---|
| `apps/backend/cloudflare/src/lib/db/generate_schemas.ts` | Hand-rolled generator reading Drizzle table metadata, emitting TypeBox 1.x row schemas |
| `packages/shared/schemas/src/lib/db/index.ts` | Barrel file for auto-generated D1 row schemas |
| `packages/shared/schemas/src/lib/db/users.ts` | Generated row schema for `user` table |
| `packages/shared/schemas/src/lib/db/sessions.ts` | Generated row schema for `session` table |
| `packages/shared/schemas/src/lib/db/accounts.ts` | Generated row schema for `account` table |
| `packages/shared/schemas/src/lib/db/verifications.ts` | Generated row schema for `verification` table |
| `packages/shared/schemas/src/lib/db/device_codes.ts` | Generated row schema for `deviceCode` table |
| `packages/shared/schemas/src/lib/db/packs.ts` | Generated row schema for `packs` table (with enum-narrowed visibility) |
| `packages/shared/schemas/src/lib/db/pack_versions.ts` | Generated row schema for `pack_versions` table |
| `packages/shared/schemas/src/lib/db/account_backups.ts` | Generated row schema for `account_backups` table |
| `packages/shared/schemas/src/lib/db/db_schemas_conformance.test.ts` | Compile-time conformance test verifying bidirectional structural assignability |

### Files Modified

| File | Change |
|---|---|
| `apps/backend/cloudflare/src/lib/db/index.ts` | Added `case 'generate'` to the db subcommand switch |
| `apps/backend/cloudflare/moon.yml` | Added `generate-schemas-check` task with `runInCI: true` |
| `apps/backend/cloudflare/package.json` | Added `drizzle-orm` dependency (needed by generator at runtime) |
| `package.json` | Added `db:generate-schemas` root-level script alias |
| `packages/shared/schemas/src/index.ts` | Added re-exports for all generated row schemas |
| `packages/shared/schemas/src/lib/catalog/account.ts` | Updated header comment to cite the new conformance test path |

### Deviations from Spec

None. All ACs were implemented as specified.

### Test Results

- Unit (schemas): 472/472 pass (0 failures)
- Unit (cloudflare): 19/19 pass (0 failures)
- Unit (database): 9/9 pass (0 failures) — baseline unchanged
- Conformance: 8/8 pass (0 failures)
- Baseline: 0 pre-existing failures, 0 new failures
