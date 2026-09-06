---
id: C-486
title: "Activate canonical v3 writes with validated loading and recoverable migration"
source: "Split of C-481 into PR-sized contracts; AI setup execution plan queue row P06"
contract_type: thin
status: approved
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-09-06T03:20:00Z"
---

# Contract C-486: Canonical v3 writes and migration safety

## Metadata

| Field | Value |
|---|---|
| **Source** | [C-481](C-481-ai-configuration-convergence.md) Migration & Rollback; queue row P06 |
| **Target** | `apps/frontend/client/src/lib/services/config/config_service.svelte.ts`, `config_migration.ts`, `crypto_vault.ts` |
| **Type** | thin |
| **Priority** | P1 — no consumer can rely on canonical routing until it is durable |
| **Dependencies** | C-485 |
| **Status** | approved |
| **Promotion** | — |
| **Docs Impact** | internal → none |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: `config_migration.ts` uses partial checks, first-row routing fallbacks and registry/model-only deduplication of legacy `models[]`. `config_service.load()` casts v2 data and absorbs rows stored only in `legacy`.
- **Reproduction**: load a v2 vault holding rows only under `legacy.connections` and observe they are absorbed without version-appropriate validation.
- **Existing implementation to reuse**: C-485's v3 schema and storage seam; existing `migrateVaultV1ToV2` transformations after their unsafe casts are removed.
- **Known gaps**: `crypto_vault.decrypt()` may rewrite legacy encryption during a read and cannot distinguish missing from locked/corrupt. `save()` does not retain the supplied PIN and writes vault and plain settings separately.
- **Baseline tests**: `config_migration.test.ts`, `config_service.test.ts`.

## User Outcome

After this contract, a player's existing accounts, models, routing choices and presets survive the upgrade to v3, and a failed or interrupted upgrade leaves their original configuration recoverable rather than replaced.

## Scope Boundaries

- **In Scope:** enabling v3 writes; version-appropriate validation of v1/v2/v3; normalize v1→v2→v3 in memory then validate the complete v3 candidate; recoverable encrypted pre-upgrade snapshot; single versioned committed record; isolated v3 storage namespace; read-only compatibility adapters for still-live legacy consumers.
- **Out of Scope:** setup/verification operations (C-487), routing consumers (C-488), UI rollback surface, and any new schema beyond C-485's frozen v3.

## Acceptance Criteria

### AC-1: Loads are validated per version and never silently downgraded
**Given** v1, v2, mixed legacy rows, and an unknown future version
**When** the vault is loaded
**Then** each is validated with its version-appropriate schema, an unknown future version never enters the v1 path, and once v3 exists no legacy copy is silently re-imported or fallen back to.

The one exception is the v2→v3 migration itself: it validates and absorbs `legacy.connections` rows **exactly once**, as part of producing the v3 candidate. A load that already finds v3 must never consult `legacy` — so rows are neither dropped at migration time nor re-imported on every subsequent load.

**Verification**: synthetic encrypted fixtures per version; explicit assertions that unknown versions are rejected with recovery rather than migrated.

### AC-2: Absent, locked, corrupt and unsupported are distinguished
**Given** a vault that is genuinely absent versus wrong-PIN, corrupt or unknown-version
**When** loading
**Then** only absence permits fresh initialization; the others expose recovery, block autosave and never publish an empty replacement. Reads do not rewrite storage.

**Verification**: fault-injected adapter tests for each case; assert no write occurs on a read path.

### AC-3: Migration is recoverable and idempotent
**Given** a real persisted v1 or v2 fixture
**When** migration runs, fails partway, or runs twice
**Then** a recoverable encrypted pre-upgrade snapshot exists before any rewrite, backup/quota/encryption/write failure aborts without changing the original, and a retry is idempotent.

**Verification**: injected backup, quota, encryption and write failures; double-run idempotence assertions; custom-PIN protection preserved and the recovery copy kept outside the active payload.

### AC-4: Routing intent survives migration exactly
**Given** v1 explicit capability defaults including `null`, and normalized v2 primary roles
**When** migrating
**Then** v1 honors explicit defaults, then text `defaultConnectionId`, then a unique `isDefault` row, else leaves unset; v2 maps valid primary roles to capability defaults and preserves every explicit role as an override even when equal to its default; previously unassigned roles become `null` where a new default would otherwise activate them.

**Verification**: fixture matrix per rule; dangling and cross-capability explicit selections fail with recovery, never substitution; equal legacy values never inferred as intentional inheritance.

### AC-5: One transaction, isolated namespace
**Given** AI configuration plus user options
**When** committing
**Then** they land in one versioned encrypted record (or an equivalently recoverable transaction), not independent vault and plain writes; unrelated plain settings are untouched; v3 uses an isolated storage namespace older binaries cannot parse or overwrite; legacy cleartext credentials are removed only after their encrypted replacement is durable, with retry-safe cleanup.

**Verification**: transaction tests including a crash between writes; old-binary storage isolation test; ambiguous standalone voice/image keys retained in the recovery snapshot without activation.

## Edge Cases & Gotchas

- **Legacy identity**: legacy `models[]` identity includes endpoint and account context, not just registry and model. Do not attach standalone voice/image keys to a guessed provider.
- **Overlap**: a v2 payload may hold canonical rows *and* rows only in `legacy.connections`. Absorb missing IDs once **during the v2→v3 migration only**, preserving canonical rows and explicit assignments on overlap. Re-running the migration over an already-migrated v3 record must be a no-op; a v3 load must not read `legacy` at all. Test both: absorb-once, and idempotent re-run.
- **Still-live consumers**: legacy readers get read-only compatibility adapters. Temporary legacy mutation methods must translate into the canonical transaction, never write a second store.

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)
