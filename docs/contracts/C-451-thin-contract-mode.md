---
id: C-451
title: "Thin Contract Mode for Quick Fixes"
source: "User request during C-450 pipeline-integrity review, 2026-08-30. Idea: small fixes currently either skip the contract pipeline entirely (no history) or force a full 18-section contract (high overhead for a one-line change). Add a lightweight contract type that stays documented but skips the sections that don't apply to small changes."
status: implemented
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: "https://github.com/BearlySleeping/aikami/pull/206"
  pr_number: 206
created_at: "2026-08-30"
---

# Contract C-451: Thin Contract Mode for Quick Fixes

## Metadata

| Field | Value |
|---|---|
| **Source** | User request, 2026-08-30 — see frontmatter `source` |
| **Target** | `docs/contracts/THIN_TEMPLATE.md` (new), `docs/contracts/TEMPLATE.md` (cross-reference only), `scripts/src/lib/ops/lint_contracts.ts`, `scripts/src/lib/ops/sync_contracts.ts`, `scripts/src/lib/agents/contract_pipeline.ts`, `scripts/src/lib/agents/contract_pipeline/orchestrator.ts`, `docs/contracts/SHARED_SECTIONS.md` |
| **Priority** | P2 — process/tooling improvement, not user-facing, but reduces friction that currently pushes small fixes outside the contract system entirely (undocumented history) |
| **Dependencies** | None. Independent of [[C-450]] (which fixes historical status drift, not contract shape). |
| **Status** | approved |
| **Promotion** | — |
| **Docs Impact** | internal → `docs/contracts/` process docs only |
| **Contract version** | 1.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: Every contract must follow `TEMPLATE.md`'s full 18-section structure (Metadata, Problem & Baseline Evidence, User Outcome, Success Measures, Existing System & Reuse Map, Overview, Design Reference, Architecture Directives, State & Data Models, Quality Requirements, Migration & Rollback, Scope Boundaries, Contract Size & Split Rule, Acceptance Criteria with a full Evidence Matrix + Test Hooks per AC, Implementation Sequence, Edge Cases & Gotchas, Open Questions, Amendments, Promotion/Status Lifecycle). This is right-sized for features but is heavy overhead for a one-line bug fix, a typo, a config flag flip, or a small refactor.
- **Reproduction**: Compare `docs/contracts/C-450-contract-pipeline-reconciliation-and-drift-guard.md` (a process contract, ~18 sections, hours of drafting) against the kind of change tracked informally in `docs/TODO.md` item 8 ("misc small bugs 8a-8h") — those never became contracts because the overhead wasn't worth it for a 5-line fix, so they have no Execution Report, no AC, no discoverable history once TODO.md is retired.
- **Existing implementation to reuse**: `scripts/src/lib/ops/lint_contracts.ts`'s status-aware rule table (draft/approved/implemented have different structural requirements already — this is the same pattern extended one axis further, by contract *type* instead of only by *status*). `scripts/src/lib/agents/contract_pipeline.ts`'s `--source path`/bare `C-XXX` resume mode and `--critique` flag (a hand-authored-contract entry point already exists and is what thin contracts will also use). `mark_contract_implemented.ts`'s `hasExecutionReport` check (thin contracts still need an Execution Report to reach `implemented` — this does not change).
- **Known gaps**: No contract "type" concept exists today — every file is implicitly "full." No skip logic in the linter, orchestrator, or `sync_contracts.ts` dashboard generation.
- **Baseline tests**: `bun test scripts/` (linter/pipeline unit tests, if present); `moon run :validate` must stay green after the change.

## User Outcome

After this contract, a developer authoring a small, well-understood fix (bug fix, config change, small refactor, doc correction with code impact) can create a **thin contract** — a reduced-section file that still carries an ID, status lifecycle, and Execution Report — instead of either writing a full 18-section contract or skipping the pipeline entirely and losing history.

## Success Measures

- **Time/latency target**: authoring a thin contract by hand should take under 5 minutes, versus 20-60+ minutes for a full contract.
- **Offline/degraded behavior**: N/A — authoring-time tooling only, no runtime behavior.
- **Production journey enabled**: N/A — this is a contributor-facing process improvement, not a player-facing feature.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Contract template | `docs/contracts/TEMPLATE.md` | reuse as-is for full contracts; add sibling `THIN_TEMPLATE.md` |
| Status-aware structural linting | `scripts/src/lib/ops/lint_contracts.ts` | modify — add contract-type detection, branch rules |
| PROGRESS.md dashboard generation | `scripts/src/lib/ops/sync_contracts.ts` | modify — surface contract type in the dashboard table |
| Hand-authored contract → critique entry point | `scripts/src/lib/agents/contract_pipeline.ts` (`--source path`, `--critique`) | reuse as-is — thin contracts enter the pipeline the same way |
| Merge-triggered status advance | `.github/workflows/contract-status.yml` + `mark_contract_implemented.ts` | reuse as-is — `hasExecutionReport` gate applies identically to thin contracts |
| Shared lifecycle definitions | `docs/contracts/SHARED_SECTIONS.md` | modify — document thin-mode section list alongside existing Status/Promotion Lifecycle sections |

## Overview

Add a second contract shape, "thin," alongside the existing "full" shape. A thin contract keeps the parts of the template that give real value at any size — a stable ID, Metadata table, Problem statement, Scope Boundaries, Acceptance Criteria, Amendments, and (once implemented) an Execution Report — and drops the parts that only pay off at feature scale: Design Reference, full State & Data Models, Migration & Rollback, per-AC Evidence Matrix/Test Hooks tables, Implementation Sequence phases, and Open Questions (a thin contract that has open questions isn't thin — it should be a full contract). The contract's frontmatter and metadata table both gain a `contract_type: full | thin` field, defaulting to `full` for every existing contract so no backfill is required.

## Design Reference

Follow `lint_contracts.ts`'s existing status-branch pattern (`IMPLEMENTED_OR_LATER`, `APPROVED_OR_LATER` sets gating which rules apply) — add a parallel `contract_type` branch rather than a new linter file. Follow `TEMPLATE.md`'s placeholder-token style (`{FEATURE_CODE}`, `{TITLE}`) for the new `THIN_TEMPLATE.md`.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- Add `docs/contracts/THIN_TEMPLATE.md` with the reduced section list (see State & Data Models below for the exact list).
- Extend the frontmatter schema documented in `TEMPLATE.md`'s header comment and `SHARED_SECTIONS.md` to include `contract_type: full | thin` (default `full`).
- Extend the Metadata table with a `| **Type** | full \| thin |` row.
- `lint_contracts.ts`: read `contract_type` the same way `extractStatus`/frontmatter parsing already work; when `thin`, skip structural-completeness checks for the sections thin contracts omit (no error for missing Design Reference, State & Data Models, Migration & Rollback, per-AC Evidence Matrix detail, Implementation Sequence, Open Questions section). Keep every other rule (no TBD in approved-or-later, dup ID checks, Execution Report required for `implemented`) identical for both types.
- `sync_contracts.ts`: add a `Type` column to the generated `PROGRESS.md` table so thin vs. full is visible at a glance; no change to status-rollup logic.
- `contract_pipeline.ts` / `orchestrator.ts`: no new CLI flag needed — a thin contract is still authored by hand (or via `--source path`/bare `C-XXX` resume) and enters the same `--critique` → implementer flow. The only change is that stages reading section content (e.g. any stage that expects a Design Reference or Implementation Sequence to plan from) must tolerate those sections being absent for `contract_type: thin` files — grep the stage prompts in `orchestrator.ts` for hard assumptions about section presence and make them conditional on `contract_type`.

## State & Data Models

Thin contract section list (subset of `TEMPLATE.md`, same order):

```
Metadata (adds Type: thin row)
Problem & Baseline Evidence
User Outcome
Scope Boundaries
Acceptance Criteria (AC list only — no per-AC Evidence Matrix/Test Hooks table,
  just Given/When/Then plus a single "Verification" line per AC naming the
  command or manual check that proves it)
Edge Cases & Gotchas (optional — omit if none)
Amendments
Promotion Lifecycle
Status Lifecycle
```

Omitted entirely for thin: Success Measures, Existing System & Reuse Map, Overview, Design Reference, Architecture Directives, State & Data Models, Quality Requirements, Migration & Rollback, Contract Size & Split Rule, Implementation Sequence, Open Questions.

Frontmatter addition (both templates):

```yaml
contract_type: full   # or: thin
```

## Quality Requirements

- **Offline/degraded mode**: N/A — authoring tooling only.
- **Accessibility/input**: N/A.
- **Performance budget**: N/A.
- **Security/privacy**: N/A.
- **Persistence/migration**: existing contracts have no `contract_type` field; linter and `sync_contracts.ts` must treat a missing field as `full` (the current de facto behavior), not as an error.
- **Cancellation/retry/idempotency**: N/A.
- **Observability**: N/A.

## Migration & Rollback

- **Old data compatibility**: all ~450 existing contracts lack `contract_type` — they must be treated as `full` by default, no backfill edit required.
- **Migration**: none — additive field with a safe default.
- **Rollback**: revert the linter/sync_contracts.ts changes; existing thin contracts remain valid markdown, just under-linted (harmless).
- **Feature flag or kill switch**: N/A — opt-in by field, not a global switch.
- **Failure recovery**: N/A — no automated migration step to fail.

## Scope Boundaries

- **In Scope**: `THIN_TEMPLATE.md` creation; `contract_type` frontmatter/table field on both templates; `lint_contracts.ts` type-aware rule branching; `sync_contracts.ts` Type column; `orchestrator.ts`/`contract_pipeline.ts` tolerance for missing sections on thin contracts; `SHARED_SECTIONS.md` documentation of the thin section list.
- **Out of Scope**: retroactively converting any existing full contract to thin; building a new CLI flag or interactive prompt to choose type (author sets `contract_type` by picking which template file to copy); changing the status or promotion lifecycle values themselves (unchanged for both types); the C-450 historical-drift work (separate contract); migrating `docs/TODO.md` items into thin contracts (a possible future use of this mode, not part of building the mode itself).

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** Single contract — template file, linter branch, and dashboard column are one cohesive change with no natural split point.

## Acceptance Criteria

### AC-1: Author a thin contract from the new template
**Given** a developer wants to document a small, well-understood fix
**When** they copy `docs/contracts/THIN_TEMPLATE.md` to a new `C-XXX-*.md` file and fill it in
**Then** the file passes `lint_contracts.ts --contract C-XXX` at `status: draft` with no errors about missing full-contract sections

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Integration | `bun run scripts/src/lib/ops/lint_contracts.ts --contract <a real thin test contract>` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run scripts:lint-contracts` (or the equivalent task name in `scripts/moon.yml`)
- Integration: create a throwaway thin contract in a scratch branch, run the linter against it, confirm zero errors for the omitted sections
- E2E / Visual: N/A — authoring-tooling change, no UI

**Watch Points**:
- Don't let the linter treat a *missing* `contract_type` field on an old contract as thin — default must resolve to `full`.

### AC-2: Existing full contracts are unaffected
**Given** the full corpus of ~450 existing contracts, none of which declare `contract_type`
**When** `lint_contracts.ts --all` and `sync_contracts.ts` run after this change
**Then** every existing contract is linted exactly as before (treated as `full`) and `PROGRESS.md` regenerates with identical status/promotion data, only gaining a `Type` column that reads `full` for all of them

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Integration | `bun run scripts/src/lib/ops/lint_contracts.ts --all` and `bun run scripts/src/lib/ops/sync_contracts.ts` diffed against pre-change output | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run scripts:lint-contracts -- --all`
- Integration: `git diff docs/contracts/PROGRESS.md` after regeneration — only the new Type column should differ
- E2E / Visual: N/A

**Watch Points**:
- `sync_contracts.ts`'s table-column change must not break any downstream tooling that parses `PROGRESS.md` by fixed column position (grep for consumers before changing column order — append `Type` as the last column to be safe).

### AC-3: Thin contract still requires an Execution Report to reach `implemented`
**Given** a thin contract at `status: approved`
**When** a PR implementing it merges and `contract-status.yml` runs `mark_contract_implemented.ts`
**Then** the tool applies the same `hasExecutionReport` gate as for full contracts — no advance to `implemented` without one, regardless of `contract_type`

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Integration | `bun run scripts/src/lib/ops/mark_contract_implemented.ts --dry-run --pr <test PR>` against a thin test contract | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: N/A (existing `mark_contract_implemented.ts` has no dedicated Moon task — invoke directly per its own CLI)
- Integration: run `--dry-run` against a thin contract with no Execution Report — confirm it reports `skip`, matching full-contract behavior
- E2E / Visual: N/A

**Watch Points**:
- This AC is a regression check, not new work — `mark_contract_implemented.ts` should need zero changes since it never branched on section content, only on the presence of an `## Execution Report` heading.

## Implementation Sequence

1. **Phase 1 (Template + docs)**: create `THIN_TEMPLATE.md`; add `contract_type` to both templates' frontmatter and metadata table; document the thin section list and its rationale in `SHARED_SECTIONS.md`.
2. **Phase 2 (Tooling)**: extend `lint_contracts.ts` with type-aware branching; add the `Type` column to `sync_contracts.ts`'s `PROGRESS.md` generation; audit `orchestrator.ts` stage prompts for hard assumptions about section presence and guard them behind `contract_type`.
3. **Phase 3 (Validation)**: author one real throwaway thin contract, run it through `lint_contracts.ts --contract`, `sync_contracts.ts`, and (if convenient) a real `--critique` pass; run `bun run fix`, `moon run :validate`, `bun run test`; delete the throwaway contract before merging (or keep it as the first real thin contract if a genuine small fix is available).

## Edge Cases & Gotchas

- **A thin contract accumulates Open Questions during drafting**: treat that as a signal the change isn't actually small — convert it to a full contract (copy content into `TEMPLATE.md`'s shape) rather than adding an Open Questions section back to the thin type.
- **A thin contract's fix turns out to touch persistent state (schema/save format)**: same signal — thin contracts have no Migration & Rollback section by design, so anything needing one belongs in a full contract.

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
|---|---|---|---|
| 1.0.0 | 2026-08-30 | Initial draft, approved directly per user instruction (no critic pass required for this contract). | snorreks, 2026-08-30 |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

---

## Execution Report

### Summary

Created the Thin Contract Mode for quick fixes: added `docs/contracts/THIN_TEMPLATE.md` with a reduced section list, added `contract_type` frontmatter field to both templates, updated `SHARED_SECTIONS.md` with thin-mode documentation, extended `lint_contracts.ts` to skip Evidence Matrix and Open Questions checks for thin contracts, added a Type column to `sync_contracts.ts`'s PROGRESS.md/PROMOTION.md generation, and audited all pipeline prompts (implement, verify, critique, create, review) to be thin-contract-aware.

### AC Status

| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | THIN_TEMPLATE.md created; linter passes thin contracts without errors about missing full-contract sections |
| AC-2 | ✅ | Existing contracts default to `full`; PROGRESS.md gains Type column showing `full` for all existing contracts |
| AC-3 | ✅ | `mark_contract_implemented.ts` unchanged — `hasExecutionReport` gate applies identically to both types |

### Files Created

| File | Purpose |
|---|---|
| `docs/contracts/THIN_TEMPLATE.md` | Reduced-section template for small, well-understood fixes |

### Files Modified

| File | Change |
|---|---|
| `docs/contracts/TEMPLATE.md` | Added `contract_type: full` frontmatter field and `Type` metadata row |
| `docs/contracts/SHARED_SECTIONS.md` | Added Thin Contract Mode documentation with section list and upgrade guidance |
| `scripts/src/lib/ops/lint_contracts.ts` | Added `contract_type` extraction, THIN_TEMPLATE.md exclusion, skip Evidence Matrix/Open Questions checks for thin contracts |
| `scripts/src/lib/ops/sync_contracts.ts` | Added `contract_type` extraction, Type column to PROGRESS.md and PROMOTION.md tables |
| `.pi/prompts/contract-implement.md` | Updated to reference thin contract format and section expectations |
| `.pi/prompts/contract-verify.md` | Updated to handle Verification lines instead of Evidence Matrix for thin contracts |
| `.pi/prompts/contract-critique.md` | Updated to skip thin-omitted sections in critique questions |
| `.pi/prompts/contract-create.md` | Updated to mention THIN_TEMPLATE.md as an alternative to TEMPLATE.md |
| `.pi/prompts/contract-review.md` | Updated to reference Verification lines for thin contracts |

### Deviations from Spec

None. All ACs implemented as specified.

### Test Results

- Unit: 415/422 pass (5 pre-existing failures due to missing `sharp` package in worktree, 2 skipped)
- E2E: N/A — authoring-tooling change, no UI
- Visual: N/A — authoring-tooling change, no UI
- Baseline: 5 pre-existing failures (missing `sharp` package), 0 new failures
