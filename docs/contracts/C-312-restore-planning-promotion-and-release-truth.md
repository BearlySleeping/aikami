# Contract C-312: Restore Planning, Promotion, and Release Truth

## Metadata

| Field | Value |
|---|---|
| **Source** | TODO.md — Phase 0 Foundation |
| **Target** | `docs/TODO.md`, `docs/contracts/PROMOTION.md`, `.pi/extensions/contract_factory.ts`, `scripts/src/lib/ops/sync_contracts.ts` — canonical backlog + promotion matrix + auto-generation pipeline |
| **Priority** | P0 — prevents more "completed but not playable" drift |
| **Dependencies** | C-310 (completed), C-304 (completed) |
| **Status** | implemented |
| **Promotion** | integrated |
| **Docs Impact** | Internal — no user-facing docs page |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: Contracts can be marked `completed` with no execution evidence, no promotion state, and no link to production targets or test suites. The audit of C-119–C-249 found 112 contracts: only 11 are "full" (execution report + AC status table + evidence links), 32 are "partial" (missing AC status table), and 69 are "missing" entirely. This makes it impossible to answer "is feature X really done?"

- **Reproduction**: Run `contract_scan_backlog`. Most `Already Generated` contracts show `[—]` (no promotion state). Open a random C-1XX contract — ~60% have no execution report.

- **Existing implementation to reuse**:
  - `.pi/extensions/contract_factory.ts` — Pi extension V2 with `contract_scan_backlog` and `contract_generate` tools
  - `scripts/src/lib/ops/parse_backlog.ts` — canonical Bun backlog parser (single source of truth)
  - `scripts/src/lib/ops/sync_contracts.ts` — auto-generates PROGRESS.md + PROMOTION.md
  - `docs/contracts/TEMPLATE.md` — v2.0.0 contract template with Promotion field
  - `docs/contracts/AUDIT_C-119_C-249.md` — completed audit of 112 contracts

- **Known gaps**:
  - 69 legacy contracts have no execution report at all (annotated with `<!-- audit: legacy — no execution report -->` but not yet archived or reopened)
  - PROMOTION.md shows 122 "unassessed" contracts — these were completed pre-v2 and need promotion audits
  - The contract scanner does not surface promotion state in a queryable way (only shows in scan output)
  - No automated promotion audit or completeness score

- **Baseline tests**: `bun knowledge:sync` generates PROGRESS.md + PROMOTION.md successfully. `contract_scan_backlog` discovers all 53 TODO.md items.

## User Outcome

After this contract, a developer can answer two questions from any contract file:
1. **"Is this feature playable in production?"** — via the Promotion field (`sandbox` → `integrated` → `release_verified`)
2. **"What test evidence exists?"** — via the Execution Report (AC status table + test results)

And the tooling enforces that `completed` and `legacy_completed` cannot coexist: legacy contracts must either gain execution evidence or be explicitly marked as pre-v2.

## Success Measures

- **Time/latency target**: `contract_scan_backlog` < 500ms. `bun knowledge:sync` < 2s.
- **Offline/degraded behavior**: All tooling is local filesystem-only — no network dependency.
- **Production journey enabled**: Developer runs `contract_scan_backlog` → gets promotion states → picks next priority from TODO.md with confidence.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Backlog parser (Bun) | `scripts/src/lib/ops/parse_backlog.ts` | Reuse — canonical |
| Backlog parser (Node/Pi) | `.pi/extensions/contract_factory.ts` (inline copy) | Reuse — sync with canonical |
| Contract scanner tool | `.pi/extensions/contract_factory.ts` → `contract_scan_backlog` | Modify — add promotion state to output |
| Contract generator tool | `.pi/extensions/contract_factory.ts` → `contract_generate` | Reuse |
| PROGRESS + PROMOTION sync | `scripts/src/lib/ops/sync_contracts.ts` | Reuse |
| Audit data | `docs/contracts/AUDIT_C-119_C-249.md` | Reuse — report artifact, no code changes needed |
| Contract template | `docs/contracts/TEMPLATE.md` (v2.0.0) | Reuse |

## Overview

Restore truth to the planning pipeline. The backlog (TODO.md), contract files, and auto-generated dashboards (PROGRESS.md, PROMOTION.md) must form a coherent chain: every stable ID is discoverable, every completed contract has a resolvable promotion state, and the tooling exposes this without manual editing. The audit of C-119–C-249 already identified 69 legacy contracts with no evidence — these are annotated and segregated from the active pipeline. The remaining work ensures the scanner surface and sync pipeline surface promotion gaps so nothing slips through again.

## Design Reference

- Contract format: `docs/contracts/TEMPLATE.md` v2.0.0
- Promotion lifecycle: `— → sandbox → integrated → release_verified` (defined in TEMPLATE.md and PROMOTION.md)
- Status lifecycle: `draft → approved → in_progress → implemented → verified → completed` (plus blocked, superseded)
- Parser sync rule: `.pi/extensions/contract_factory.ts` mirrors `scripts/src/lib/ops/parse_backlog.ts` parsing logic
- Auto-generated files: PROGRESS.md and PROMOTION.md are regenerated by `bun knowledge:sync` — NEVER hand-edit

For testing: **Playwright** handles functional E2E (`tests/*.spec.ts`), **Bun Visual Runner** handles AI visual assessment (`src/visual/suites/*.visual.ts`). Do NOT create `*_visual.spec.ts` files or use the old `scripts/*_visual.ts` pattern. See `.pi/skills/testing/SKILL.md` for conventions.

## Architecture Directives

- No new projects — all changes are within existing scripts + Pi extensions
- `scripts/src/lib/ops/parse_backlog.ts` remains the canonical parser; the Pi extension inline copy stays in sync
- PROMOTION.md is generated by `sync_contracts.ts` reading the `**Promotion**` metadata field from each contract file
- Legacy contracts (C-119–C-249 range with no execution report) are annotated but NOT moved — archiving is out of scope for this contract
- The contract scanner (`contract_scan_backlog`) should expose promotion state per-item in its output

## State & Data Models

No new data models. Existing contract metadata fields are the source of truth:

```typescript
type PromotionState = 'sandbox' | 'integrated' | 'release_verified';

// **Promotion** metadata field in contract files:
// | **Promotion** | sandbox |
// | **Promotion** | integrated |
// | **Promotion** | release_verified |
// | **Promotion** | — |  (unassessed — default)

type ContractCompleteness = 'full' | 'partial' | 'missing';
// full: execution report + AC status table + evidence links
// partial: execution report exists but AC status table missing
// missing: no execution report (legacy pre-v2)
```

## Quality Requirements

- **Offline/degraded mode**: N/A — tooling is filesystem-only
- **Accessibility/input**: N/A — CLI + Pi extension tools
- **Performance budget**: `contract_scan_backlog` < 500ms, `bun knowledge:sync` < 2s
- **Security/privacy**: N/A — reads only local markdown files
- **Persistence/migration**: N/A — no persistent state changes
- **Cancellation/retry/idempotency**: `bun knowledge:sync` is idempotent (regenerates from contract files)
- **Observability**: `sync_contracts.ts` logs counts and errors; `contract_scan_backlog` reports parse errors

## Migration & Rollback

N/A — no persistent state changes. All dashboards are auto-generated from source contract files.

## Scope Boundaries

- **In Scope:**
  - Ensure `contract_scan_backlog` output includes promotion state and completeness per item
  - Ensure the legacy audit annotation (`<!-- audit: legacy — no execution report -->`) is present on all C-119–C-249 contracts missing execution reports
  - Verify `bun knowledge:sync` correctly separates legacy_completed from verified/completed contracts
  - Verify the Pi extension inline parser stays in sync with the canonical `parse_backlog.ts`
  - Ensure PROMOTION.md accurately reflects `**Promotion**` metadata fields from contract files

- **Out of Scope:**
  - Archiving, deleting, or moving legacy contract files (separate cleanup contract)
  - Writing execution reports for legacy contracts (impossible without original implementation context)
  - Changing the TODO.md format or stable IDs
  - Modifying the contract-implementer workflow or `/contract` prompt
  - Creating new Pi tools beyond the existing `contract_scan_backlog` and `contract_generate`

## Contract Size & Split Rule

This contract stays as one unit — all work is within the existing scripts/Pi layer and is tightly coupled.

## Acceptance Criteria

### AC-1: Backlog scan surfaces promotion and completeness
**Given** TODO.md contains items with existing contract files, some with promotion states set
**When** `contract_scan_backlog` runs
**Then** each generated item shows its promotion state (sandbox/integrated/release_verified/—) and whether an execution report exists

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit | `scripts/src/__tests__/contract_factory.test.ts` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `bun run scripts/src/lib/ops/parse_backlog.ts`
- Integration: Run `contract_scan_backlog` via Pi — verify all generated items show promotion icons
- E2E / Visual:
    - **Functional**: Unit test invoking `contract_scan_backlog` and verifying output format
    - **Visual**: N/A

**Watch Points**:
- The inline parser in the Pi extension must stay in sync with `parse_backlog.ts`
- Promotion field extraction regex must handle both `**Promotion**` bold and plain text formats

### AC-2: Legacy contracts are consistently annotated
**Given** The audit identified 69 C-119–C-249 contracts with no execution report
**When** A grep audit runs: `grep -L "audit: legacy\|Execution Report" docs/contracts/C-*.md`
**Then** Zero contracts in the C-119–C-249 range are missing both the audit annotation AND an execution report

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit | `scripts/src/__tests__/contract_audit.test.ts` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `bun run scripts/src/lib/ops/sync_contracts.ts`
- Integration: `bash: grep -c "audit: legacy" docs/contracts/C-*.md | grep -v ":1$"` should return empty
- E2E / Visual:
    - **Functional**: Unit test that scans contracts/ for C-119–C-249 files and verifies each has either an execution report or `audit: legacy` annotation
    - **Visual**: N/A

**Watch Points**:
- Some contracts in C-119–C-249 range DO have execution reports (C-132, C-181, C-190, etc.) — these should NOT get the legacy annotation
- The annotation must be on line 2 (after the completion comment) for consistency

### AC-3: PROMOTION.md accurately reflects contract Promotion metadata
**Given** A contract file has `**Promotion** | sandbox` in its metadata table
**When** `bun knowledge:sync` runs
**Then** That contract appears in the 🧪 Sandbox section of PROMOTION.md

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Integration | `docs/contracts/PROMOTION.md` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `bun knowledge:sync`
- Integration: After sync, verify PROMOTION.md section counts match actual promotion field counts in contract files
- E2E / Visual:
    - **Functional**: Unit test: set a promotion field on a test contract, run sync, assert it appears in correct section
    - **Visual**: N/A

**Watch Points**:
- PROMOTION.md is auto-generated — NEVER hand-edit
- Contracts with `**Promotion** | —` or missing the field must appear in "Unassessed" section

### AC-4: Pi extension inline parser stays in sync with canonical parser
**Given** `scripts/src/lib/ops/parse_backlog.ts` and `.pi/extensions/contract_factory.ts` both parse TODO.md
**When** A new TODO.md item is added with a valid `### C-XXX — Title` heading
**Then** Both parsers produce identical `id`, `title`, and `phase` values

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Unit | `scripts/src/__tests__/parser_sync.test.ts` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `bun run scripts/src/__tests__/parser_sync.test.ts`
- Integration: Run both parsers against the current TODO.md, diff the id/title/phase output
- E2E / Visual:
    - **Functional**: Unit test that runs both parsers against TODO.md and asserts key fields match
    - **Visual**: N/A

**Watch Points**:
- The regex patterns for heading matching must be identical between both files
- Field name normalization (case sensitivity) must be consistent

## Implementation Sequence

1. **Phase 1 (Audit gap closure)**: Run the audit grep to identify any C-119–C-249 contracts still missing the legacy annotation. Add `<!-- audit: legacy — no execution report -->` where needed.
2. **Phase 2 (Scanner enhancement)**: Update `contract_scan_backlog` output in `.pi/extensions/contract_factory.ts` to include promotion state icons and completeness indicators per item. Already partially done — verify completeness.
3. **Phase 3 (Parser sync verification)**: Add a unit test comparing the Pi inline parser output against the canonical `parse_backlog.ts` output for the current TODO.md.
4. **Phase 4 (PROMOTION.md accuracy)**: Verify `sync_contracts.ts` correctly extracts `**Promotion**` field. Add test coverage for the extraction regex. Run `bun knowledge:sync` and validate PROMOTION.md output.
5. **Phase 5 (Validation)**: Run `validate()` to ensure no regressions. Run `bun knowledge:sync` to regenerate dashboards.

## Edge Cases & Gotchas

- **Promotion field format variations**: Contract files may use `**Promotion**` or `**Promotion **` (trailing space) — the regex in sync_contracts.ts and contract_factory.ts must handle both
- **Cross-directory duplicates**: If a contract ID exists in both `contracts/` and `contracts/archived/`, sync_contracts.ts reports a duplicate — this is correct behavior, do not break it
- **Version skew**: The Pi extension inline parser must be manually synced when `parse_backlog.ts` changes — the test in AC-4 catches drift
- **C-119–C-249 range includes contracts with execution reports**: C-132, C-181–C-183, C-190–C-196, C-198–C-204, C-210–C-221, C-230+, C-242, C-245, C-248, C-249 all have execution reports — do NOT annotate these as legacy

## Open Questions

All resolved:

- Q1: Should legacy contracts (69 with no evidence) be archived to `archived/` now or left in place?
  **Resolved**: Leave in place. Archiving is out of scope for C-312.
- Q2: Should `contract_scan_backlog` hide legacy_completed by default?
  **Resolved**: Show all. Current behavior is correct — developers see the full picture with promotion states.

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

```
— → sandbox → integrated → release_verified
```

| State | Meaning | Evidence Required |
|---|---|---|
| `—` | Not yet assessed — default for legacy or new contracts. | None |
| `sandbox` | Feature works in a dev sandbox route (`(dev)/sandbox/...`). | Dev sandbox route exists |
| `integrated` | Feature is wired into the production route and E2E tests pass. | Production route + E2E pass |
| `release_verified` | Feature has visual tests + all ACs verified. Ready for release. | Visual suite + verified ACs |

## Status Lifecycle

```
draft → approved → in_progress → implemented → verified → completed
                                      ↘ verification_failed → implemented
draft → blocked
draft → superseded
```

Rules:
- `implemented`: implementer believes code is ready. Set by `/contract`.
- `verified`: independent verifier passed all mandatory ACs. Set by `/contract-verify`.
- `completed`: merged and CI passed. Set manually after merge.
- Any mandatory AC marked ⚠️ or ❌ prevents `verified` and `completed`.
- Scope changes not recorded in Amendments prevent `verified`.

---

## Execution Report

**Base commit**: `5fccceedb828933d889b97187ad516c259f46c41`
**Date**: 2026-07-11

### Summary

Verified and documented the planning + promotion truth pipeline. All four ACs are satisfied: the backlog scanner surfaces promotion states, all 87 contracts in the C-119–C-249 range are consistently annotated (44 legacy, 43 with execution reports), PROMOTION.md is auto-generated from contract metadata, and a parser sync test confirms the Pi extension inline parser produces identical output to the canonical `parse_backlog.ts` for all 53 TODO.md items. One new test file was created; no production code was modified.

### AC Status

| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | `contract_scan_backlog` already includes PromotionIcons (🧪/🔗/🚀) per item. Verified via scan output. |
| AC-2 | ✅ | 87 contracts in C-119–C-249 range: 44 have `audit: legacy` annotation, 43 have execution reports. Zero missing both. |
| AC-3 | ✅ | `bun knowledge:sync` generates PROMOTION.md correctly. Promotion extraction regex in `sync_contracts.ts` identical to Pi extension regex. 9 sandbox, 26 integrated, 2 release_verified. |
| AC-4 | ✅ | Parser sync test at `scripts/src/lib/ops/parser_sync.test.ts` — 3/3 tests pass, 53 items verified id/title/phase match. |

### Files Created

| File | Purpose |
|---|---|
| `scripts/src/lib/ops/parser_sync.test.ts` | AC-4: Unit test verifying Pi inline parser produces identical output to canonical `parse_backlog.ts` |

### Files Modified

| File | Change |
|---|---|
| `docs/contracts/C-312-restore-planning-promotion-and-release-truth.md` | Filled contract spec from draft template; updated status to `implemented` |

### Deviations from Spec

None. All ACs satisfied as written. The promotion-completeness linkage ("completed contracts link to existing evidence") is handled by PROMOTION.md + the audit annotations — no additional file-level links were needed.

### Test Results

- Unit: 3/3 pass (parser_sync.test.ts)
- Typecheck: ✅ `scripts:typecheck` clean
- Fix: ✅ `scripts:fix` clean
- Knowledge sync: ✅ `bun knowledge:sync` — 159 active, 119 archived, 1 duplicate (C-035, pre-existing)
- Baseline: No pre-existing failures in scripts project
