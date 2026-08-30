---
id: C-452
title: "Backfill missing Execution Reports on 17 already-implemented contracts"
source: "docs/contracts/BACKLOG_C452_PLUS.md — C-450 OQ-1"
contract_type: full
status: implemented
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: "https://github.com/BearlySleeping/aikami/pull/210"
  pr_number: 210
created_at: "2026-08-31"
---

# Contract C-452: Backfill missing Execution Reports on 17 already-implemented contracts

## Metadata

| Field | Value |
|---|---|
| **Source** | `docs/contracts/BACKLOG_C452_PLUS.md` — C-450 OQ-1 |
| **Target** | 17 contract files in `docs/contracts/C-{329,330,331,332,333,334,335,336,337,338,340,341,342,343,345,370,422}-*.md` — add Execution Report section to each |
| **Type** | full |
| **Priority** | P1 — these contracts are stuck at `approved`/`implemented` in PROGRESS.md and can never auto-advance without this (see C-450 OQ-1) |
| **Dependencies** | C-450 (confirmed these are the correct 17 contracts via its Feature A/B sweep) |
| **Status** | implemented |
| **Promotion** | `integrated` — doc-only change, no sandbox route |
| **Docs Impact** | internal — contract pipeline maintainers and future planning sessions |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: `mark_contract_implemented.ts`'s `--dry-run` against all 22 originally-flagged contracts (run during C-450 drafting, 2026-08-30) confirmed these 17 already have real merged code behind them but were never advanced past `approved` because `hasExecutionReport` requires an Execution Report heading the original PRs never added. `lint_contracts.ts` refuses `implemented` status without one — this is a real gate, not a formality.

- **Reproduction**: Run `bun run scripts/src/lib/ops/lint_contracts.ts --contract C-329` (or any of the 17). The linter reports `missing-execution-report` error because status is `approved`/`implemented` but no Execution Report section exists.

- **Existing implementation to reuse**: The Execution Report section format is established in every contract that has already been advanced to `implemented` (e.g., C-448, C-450, C-249). Each report follows the same structure: Summary, AC Status table, Files Created, Files Modified, Deviations from Spec, Test Results.

- **Known gaps**: None of the 17 contracts have an Execution Report section. Additionally, 16 of the 17 contracts (C-329 through C-345, C-370) lack YAML frontmatter entirely — they use the old-format Metadata table with `| **Status** | approved |` but no `---` frontmatter block. C-422 has modern frontmatter with `status: implemented` but no Execution Report.

- **Baseline tests**: Run `bun run scripts/src/lib/ops/lint_contracts.ts --all` before and after to confirm the `missing-execution-report` errors are resolved for these 17 contracts.

### Verified PR mapping (from git log)

| Contract | PR | Commit | Status |
|---|---|---|---|
| C-329 | #29 | `7cedbc6a` | approved |
| C-330 | #30 | `d0647fd2` | approved |
| C-331 | #31 | `176b5c0a` | approved |
| C-332 | #32 | `a07eab89` | approved |
| C-333 | #33 | `fa7deeaf` | approved |
| C-334 | #34 | `bc58e1c9` | approved |
| C-335 | #35 | `816318e4` | approved |
| C-336 | #36 | `1f9f3794` | approved |
| C-337 | #37 | `3bbed112` | approved |
| C-338 | #38 | `0c863d18` | approved |
| C-340 | #40 | `759c2896` | approved |
| C-341 | #41 | `39a618fe` | approved |
| C-342 | #42 | `2f737ff5` | approved |
| C-343 | #43 | `01d9b4d8` | approved |
| C-345 | #45 | `6eaa0035` | approved |
| C-370 | #50 | `4439c53c` | approved |
| C-422 | #190 | `1fac8ff8` | implemented |

## User Outcome

After this contract, a **contributor or planning agent** running `mark_contract_implemented.ts --dry-run` against any of the 17 contracts sees `advance` instead of `skip (missing Execution Report)`, and `lint_contracts.ts` no longer reports `missing-execution-report` errors for them. Running the tool for real advances them to `implemented`.

## Success Measures

- **Time/latency target**: N/A — a docs-only contract.
- **Offline/degraded behavior**: N/A.
- **Production journey enabled**: None directly. This unblocks the contract pipeline status for 17 contracts, enabling accurate PROGRESS.md generation and future planning.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Execution Report format | `docs/contracts/C-448-debundle-content-packs.md` (lines 532–600) | **reuse** — same section structure |
| Execution Report format | `docs/contracts/C-450-contract-pipeline-reconciliation-and-drift-guard.md` (lines 284–334) | **reuse** — same section structure |
| Status advance tool | `scripts/src/lib/ops/mark_contract_implemented.ts` | **reuse** — run after Execution Reports are added |
| Contract linter | `scripts/src/lib/ops/lint_contracts.ts` | **reuse** — verify Execution Report requirement is satisfied |
| PROGRESS.md generator | `scripts/src/lib/ops/sync_contracts.ts` | **reuse** — regenerate after status advance |

## Overview

17 contracts (C-329–C-338, C-340–C-343, C-345, C-370, C-422) have merged implementation PRs with real shipped code but no Execution Report section, blocking `mark_contract_implemented.ts` from advancing their status. This contract adds the missing Execution Report to each contract file, documenting what shipped, what deviated, and what test results were observed. The 14 Phase-2 RPG-depth contracts (C-329–C-338, C-340–C-343) share enough context to batch as one authoring pass even though they stay 14 separate contract files. C-345, C-370, and C-422 are unrelated to that cluster and are verified independently.

## Design Reference

Each Execution Report follows the established format from C-448 and C-450:

```markdown
### Summary
{2-4 sentences — what was built, what was deferred}

### AC Status
| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅/⚠️/❌ | {one-line note} |

### Files Created
| File | Purpose |
|---|---|
| `{path}` | {description} |

### Files Modified
| File | Change |
|---|---|
| `{path}` | {description} |

### Deviations from Spec
{Any AC change, scope expansion/reduction, or unplanned work.}

### Test Results
- Unit: {PASS}/{total} ({FAIL} failures)
- E2E: {PASS}/{total} ({FAIL} failures)
- Baseline: {N} pre-existing failures, {N} new failures
```

## Architecture Directives

- **No code changes** — this contract only edits markdown files in `docs/contracts/`.
- **Each contract gets its own Execution Report** — do not merge reports across contracts.
- **Old-format contracts (C-329–C-345, C-370)** — these have no YAML frontmatter. Add frontmatter with `id`, `title`, `source`, `status: implemented`, `github.pr_number`, and `github.pr_url` matching the verified PR mapping. The Metadata table's `| **Status** | approved |` must also be updated to `implemented`.
- **C-422** — already has modern frontmatter with `status: implemented` and `pr_number: 190`. Only the Execution Report section needs to be added.
- **AC Status table** — each AC from the contract's existing Acceptance Criteria section must be listed with a status. Use `✅` for ACs confirmed shipped, `⚠️` for partial or scaffolded, `❌` for not implemented.
- **Deviations from Spec** — be honest about any AC that was not fully implemented or was modified during implementation.
- **Test Results** — report the actual test results from the PR's CI run or from running tests against the current `main` branch.

## State & Data Models

No new persisted schemas, no new scripts. The only "data model" touched is the contract markdown files themselves (adding Execution Report sections and, for old-format contracts, YAML frontmatter).

## Quality Requirements

- **Offline/degraded mode**: N/A — docs-only change.
- **Accessibility/input**: N/A.
- **Performance budget**: N/A.
- **Security/privacy**: N/A.
- **Persistence/migration**: N/A — no persistent state changes.
- **Cancellation/retry/idempotency**: Adding an Execution Report is idempotent — re-adding the same section is a no-op.
- **Observability**: `lint_contracts.ts` reports `missing-execution-report` errors before; after, these errors are resolved.

## Migration & Rollback

N/A — no persistent state changes. All edits are to markdown files and are reversible via `git revert`.

## Scope Boundaries

- **In Scope:**
    - Add Execution Report section to each of the 17 contract files.
    - For old-format contracts (C-329–C-345, C-370): add YAML frontmatter with `id`, `title`, `source`, `status: implemented`, `github.pr_number`, `github.pr_url`.
    - Run `mark_contract_implemented.ts` for real against each contract to advance status (this updates both the Metadata table and frontmatter).
    - Regenerate PROGRESS.md via `sync_contracts.ts`.
- **Out of Scope:**
    - Re-verifying whether every AC of a reclassified contract actually passes — advancing status here reflects "a PR merged with real code," matching the existing tool's own bar, not a fresh re-verification.
    - Modifying `mark_contract_implemented.ts`, `lint_contracts.ts`, `contract_status.ts`, or `sync_contracts.ts`.
    - Fixing any other contracts not in the list of 17.
    - Writing new contracts or amending existing ones beyond adding Execution Reports.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** The 17 contracts are independently verifiable but share the same mechanical task (add Execution Report). They are bundled here because:
1. They were all identified together by C-450's sweep.
2. Each is a small, mechanical docs-only change.
3. The research/verification pass (checking git log for PR mapping, reading ACs) is more efficient as one batch.

If review pressure demands a split: the 14 Phase-2 RPG-depth contracts (C-329–C-338, C-340–C-343) form one natural batch, and C-345, C-370, C-422 form three independent items.

## Acceptance Criteria

### AC-1: C-329 Execution Report added

**Given** C-329 (Integrate the Demo Quest from Offer Through Reward) was implemented by PR #29 with 8 files modified (quest state machine, NPC dialogue service, player state service, content pack schemas)
**When** an Execution Report is added documenting the implementation
**Then** the contract has a complete Execution Report section with AC status, files changed, deviations, and test results

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Manual | `docs/contracts/C-329-*.md` has Execution Report | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: N/A (docs-only)
- Integration: `bun run scripts/src/lib/ops/lint_contracts.ts --contract C-329` reports no `missing-execution-report` error
- E2E / Visual: N/A

**Watch Points**:
- C-329 has no YAML frontmatter — must add it alongside the Execution Report

### AC-2: C-330 Execution Report added

**Given** C-330 (Integrate Deterministic Demo Combat and Declared Skill Checks) was implemented by PR #30 with 12 files modified (combat service, encounter system, turn manager, seedable RNG, content pack schemas)
**When** an Execution Report is added documenting the implementation
**Then** the contract has a complete Execution Report section

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Manual | `docs/contracts/C-330-*.md` has Execution Report | N/A | Filled during verification |

**Test Hooks**:
- Integration: `lint_contracts.ts --contract C-330` reports no `missing-execution-report` error

### AC-3: C-331 Execution Report added

**Given** C-331 (Integrate Inventory, Equipment, Loot, and Vendor) was implemented by PR #31 with 48 files modified (inventory service, vendor service, equipment service, E2E tests, visual tests, content pack schemas)
**When** an Execution Report is added documenting the implementation
**Then** the contract has a complete Execution Report section

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Manual | `docs/contracts/C-331-*.md` has Execution Report | N/A | Filled during verification |

**Test Hooks**:
- Integration: `lint_contracts.ts --contract C-331` reports no `missing-execution-report` error

### AC-4: C-332 Execution Report added

**Given** C-332 (Redesign the Minimal Game HUD and Overlay Navigation) was implemented by PR #32 with 14 files modified (HUD components, overlay service, settings overlay, E2E/visual tests)
**When** an Execution Report is added documenting the implementation
**Then** the contract has a complete Execution Report section

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Manual | `docs/contracts/C-332-*.md` has Execution Report | N/A | Filled during verification |

**Test Hooks**:
- Integration: `lint_contracts.ts --contract C-332` reports no `missing-execution-report` error

### AC-5: C-333 Execution Report added

**Given** C-333 (Simplify Settings with Progressive Disclosure) was implemented by PR #33 with 14 files modified (settings sections, settings overlay, gameplay/ai-privacy views, E2E/visual tests)
**When** an Execution Report is added documenting the implementation
**Then** the contract has a complete Execution Report section

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | Manual | `docs/contracts/C-333-*.md` has Execution Report | N/A | Filled during verification |

**Test Hooks**:
- Integration: `lint_contracts.ts --contract C-333` reports no `missing-execution-report` error

### AC-6: C-334 Execution Report added

**Given** C-334 (Make Local Save, Continue, Autosave, and Recovery Reliable) was implemented by PR #34 with 9 files modified (save service, boot service, overlay service, save tests)
**When** an Execution Report is added documenting the implementation
**Then** the contract has a complete Execution Report section

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-6 | Manual | `docs/contracts/C-334-*.md` has Execution Report | N/A | Filled during verification |

**Test Hooks**:
- Integration: `lint_contracts.ts --contract C-334` reports no `missing-execution-report` error

### AC-7: C-335 Execution Report added

**Given** C-335 (Enforce the Playable Demo Release Gate) was implemented by PR #35 with 18 files modified (E2E release gate tests, Playwright config, engine replay fixtures, feature flags, POMs)
**When** an Execution Report is added documenting the implementation
**Then** the contract has a complete Execution Report section

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-7 | Manual | `docs/contracts/C-335-*.md` has Execution Report | N/A | Filled during verification |

**Test Hooks**:
- Integration: `lint_contracts.ts --contract C-335` reports no `missing-execution-report` error

### AC-8: C-336 Execution Report added

**Given** C-336 (Extract a Deterministic Rules Kernel and Typed Game Command Protocol) was implemented by PR #36 with 14 files modified (rules kernel, seedable RNG, rules command schemas/types, replay fixture)
**When** an Execution Report is added documenting the implementation
**Then** the contract has a complete Execution Report section

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-8 | Manual | `docs/contracts/C-336-*.md` has Execution Report | N/A | Filled during verification |

**Test Hooks**:
- Integration: `lint_contracts.ts --contract C-336` reports no `missing-execution-report` error

### AC-9: C-337 Execution Report added

**Given** C-337 (Complete Character Progression, Classes, Abilities, Skills, and Spells) was implemented by PR #37 with 25 files modified (progression system, class definitions, character sheet, hotbar, class schemas)
**When** an Execution Report is added documenting the implementation
**Then** the contract has a complete Execution Report section

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-9 | Manual | `docs/contracts/C-337-*.md` has Execution Report | N/A | Filled during verification |

**Test Hooks**:
- Integration: `lint_contracts.ts --contract C-337` reports no `missing-execution-report` error

### AC-10: C-338 Execution Report added

**Given** C-338 (Deepen Turn-Based Combat with Action Economy, Statuses, and Tactical AI) was implemented by PR #38 with 4 files modified (contract pipeline, PROGRESS.md, llms.txt)
**When** an Execution Report is added documenting the implementation
**Then** the contract has a complete Execution Report section

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-10 | Manual | `docs/contracts/C-338-*.md` has Execution Report | N/A | Filled during verification |

**Test Hooks**:
- Integration: `lint_contracts.ts --contract C-338` reports no `missing-execution-report` error

**Watch Points**:
- PR #38 appears to be a pipeline/process PR (contract pipeline, PROGRESS.md) — verify the actual combat implementation commit separately. The main implementation commit is `0c863d18`.

### AC-11: C-340 Execution Report added

**Given** C-340 (Build Party and Companion Gameplay) was implemented by PR #40 with 15 files modified (party roster service, NPC dialogue service, companion combat integration, ECS spawner, content pack schemas)
**When** an Execution Report is added documenting the implementation
**Then** the contract has a complete Execution Report section

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-11 | Manual | `docs/contracts/C-340-*.md` has Execution Report | N/A | Filled during verification |

**Test Hooks**:
- Integration: `lint_contracts.ts --contract C-340` reports no `missing-execution-report` error

### AC-12: C-341 Execution Report added

**Given** C-341 (Add Relationships, Factions, Reputation, and Persistent Consequences) was implemented by PR #41 with 29 files modified (relationship service, faction standing schemas, reputation UI, dialogue context, content pack schemas)
**When** an Execution Report is added documenting the implementation
**Then** the contract has a complete Execution Report section

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-12 | Manual | `docs/contracts/C-341-*.md` has Execution Report | N/A | Filled during verification |

**Test Hooks**:
- Integration: `lint_contracts.ts --contract C-341` reports no `missing-execution-report` error

### AC-13: C-342 Execution Report added

**Given** C-342 (Add World Interactables, Dungeons, Puzzles, and Loot Tables) was implemented by PR #42 with 20 files modified (interactable components, puzzle resolver, pressure plate system, interactable state schemas, content pack schemas)
**When** an Execution Report is added documenting the implementation
**Then** the contract has a complete Execution Report section

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-13 | Manual | `docs/contracts/C-342-*.md` has Execution Report | N/A | Filled during verification |

**Test Hooks**:
- Integration: `lint_contracts.ts --contract C-342` reports no `missing-execution-report` error

### AC-14: C-343 Execution Report added

**Given** C-343 (Promote Rich Chat UX into Production Gameplay) was implemented by PR #43 with 5 files modified (dialogue overlay, dialogue view model, dialogue types, test preload)
**When** an Execution Report is added documenting the implementation
**Then** the contract has a complete Execution Report section

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-14 | Manual | `docs/contracts/C-343-*.md` has Execution Report | N/A | Filled during verification |

**Test Hooks**:
- Integration: `lint_contracts.ts --contract C-343` reports no `missing-execution-report` error

### AC-15: C-345 Execution Report added

**Given** C-345 (Add a Campaign/Content-Pack Browser and a Second Adventure) was implemented by PR #45 with 19 files modified (pack registry service, campaign service, pack browser view, whispering caves content pack, pack index schemas)
**When** an Execution Report is added documenting the implementation
**Then** the contract has a complete Execution Report section

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-15 | Manual | `docs/contracts/C-345-*.md` has Execution Report | N/A | Filled during verification |

**Test Hooks**:
- Integration: `lint_contracts.ts --contract C-345` reports no `missing-execution-report` error

### AC-16: C-370 Execution Report added

**Given** C-370 (Fix LPC Paperdoll Base Layering and Neck Alignment) was implemented by PR #50 with 29 files modified (paperdoll rendering, save system, map data, serializer, content pack maps)
**When** an Execution Report is added documenting the implementation
**Then** the contract has a complete Execution Report section

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-16 | Manual | `docs/contracts/C-370-*.md` has Execution Report | N/A | Filled during verification |

**Test Hooks**:
- Integration: `lint_contracts.ts --contract C-370` reports no `missing-execution-report` error

**Watch Points**:
- C-370 also has a follow-up PR #119 (map-authoritative saves + synced portal spawns) — the Execution Report should note both PRs.

### AC-17: C-422 Execution Report added

**Given** C-422 (Guided First-Session Onboarding Arc) was implemented by PR #190 with 15 files modified (onboarding hint service, game UI, start view, content pack loader, onboarding hint schemas)
**When** an Execution Report is added documenting the implementation
**Then** the contract has a complete Execution Report section

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-17 | Manual | `docs/contracts/C-422-*.md` has Execution Report | N/A | Filled during verification |

**Test Hooks**:
- Integration: `lint_contracts.ts --contract C-422` reports no `missing-execution-report` error

**Watch Points**:
- C-422 already has modern frontmatter with `status: implemented` — only the Execution Report section needs to be added (no frontmatter changes needed).

### AC-18: All 17 contracts pass lint and can be advanced

**Given** all 17 contracts now have Execution Reports
**When** `bun run scripts/src/lib/ops/lint_contracts.ts --all` is run
**Then** no `missing-execution-report` errors are reported for any of the 17 contracts

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-18 | Integration | `lint_contracts.ts --all` output | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: N/A (docs-only)
- Integration: `bun run scripts/src/lib/ops/lint_contracts.ts --all` shows 0 `missing-execution-report` errors
- E2E / Visual: N/A

## Implementation Sequence

1. **Phase 1 (Research)**: For each of the 17 contracts, verify the PR mapping against git log, read the contract's ACs, and identify the files changed in the PR.
2. **Phase 2 (Write Execution Reports)**: For each contract, add the Execution Report section with:
   - Summary describing what was built
   - AC Status table marking each AC as ✅/⚠️/❌
   - Files Created and Files Modified tables
   - Deviations from Spec (if any)
   - Test Results from the PR's CI
3. **Phase 3 (Add frontmatter for old-format contracts)**: For C-329–C-345, C-370: add YAML frontmatter with `id`, `title`, `source`, `status: implemented`, `github.pr_number`, `github.pr_url`.
4. **Phase 4 (Advance status via tool)**: Run `mark_contract_implemented.ts --pr <number>` for each of the 17 PRs. The tool reads the Metadata table status (`approved`), confirms the Execution Report exists, and advances both the table and frontmatter to `implemented`.
5. **Phase 5 (Validate)**: Run `lint_contracts.ts --all` to confirm no `missing-execution-report` errors remain. Run `mark_contract_implemented.ts --dry-run` against each contract to confirm `advance` is reported (or `skip` with reason `already implemented` if the tool already ran for real).

## Edge Cases & Gotchas

- **C-338's PR #38 is a pipeline PR**: The main implementation commit `0c863d18` ("C-338: Deepen Turn-Based Combat...") is the real implementation. PR #38 appears to be a separate pipeline/process PR. Verify both.
- **C-370 has two PRs**: PR #50 (original implementation) and PR #119 (map-authoritative saves follow-up). The Execution Report should reference both.
- **Old-format contracts have no frontmatter**: Adding YAML frontmatter to C-329–C-345 and C-370 is required for `mark_contract_implemented.ts` to resolve them. Without `github.pr_number` in frontmatter, the tool falls back to title/branch matching.
- **C-422 is already `implemented`**: Its frontmatter already has `status: implemented` and `pr_number: 190`. Only the Execution Report section needs to be added.
- **The Metadata table is canonical, not the frontmatter**: Per C-450's findings, the table is what `sync_contracts.ts` and `lint_contracts.ts` read. Both must be updated together.

## Open Questions

Must be resolved before status becomes `approved`:

- None — fully resolved by C-450's sweep and the backlog document.

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

## Execution Report

### Summary
Added missing Execution Report sections to 17 contract files (C-329–C-338, C-340–C-343, C-345, C-370, C-422) that had merged implementation PRs but were stuck at `approved` status because `lint_contracts.ts` requires an Execution Report section before advancing to `implemented`. For the 16 old-format contracts (C-329–C-345, C-370), also added YAML frontmatter with `id`, `title`, `source`, `status: implemented`, and `github.pr_number`/`github.pr_url`. Updated all Metadata table status fields to `implemented`. All 17 contracts now pass lint with no `missing-execution-report` errors.

### AC Status
| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | C-329: Frontmatter + Execution Report added; linter passes |
| AC-2 | ✅ | C-330: Frontmatter + Execution Report added; linter passes |
| AC-3 | ✅ | C-331: Frontmatter + Execution Report added; linter passes |
| AC-4 | ✅ | C-332: Frontmatter + Execution Report added; linter passes |
| AC-5 | ✅ | C-333: Frontmatter + Execution Report added; linter passes |
| AC-6 | ✅ | C-334: Frontmatter + Execution Report added; linter passes |
| AC-7 | ✅ | C-335: Frontmatter + Execution Report added; linter passes |
| AC-8 | ✅ | C-336: Frontmatter + Execution Report added; linter passes |
| AC-9 | ✅ | C-337: Frontmatter + Execution Report added; linter passes |
| AC-10 | ✅ | C-338: Frontmatter + Execution Report added; linter passes |
| AC-11 | ✅ | C-340: Frontmatter + Execution Report added; linter passes |
| AC-12 | ✅ | C-341: Frontmatter + Execution Report added; linter passes |
| AC-13 | ✅ | C-342: Frontmatter + Execution Report added; linter passes |
| AC-14 | ✅ | C-343: Frontmatter + Execution Report added; linter passes |
| AC-15 | ✅ | C-345: Frontmatter + Execution Report added; linter passes |
| AC-16 | ✅ | C-370: Frontmatter + Execution Report added; linter passes |
| AC-17 | ✅ | C-422: Execution Report added (already had frontmatter); linter passes |
| AC-18 | ✅ | All 17 contracts pass `lint_contracts.ts --all` with 0 `missing-execution-report` errors |

### Files Created
None.

### Files Modified
| File | Change |
|---|---|
| `docs/contracts/C-329-integrate-the-demo-quest-from-offer-through-reward.md` | Added YAML frontmatter + Execution Report; status → implemented |
| `docs/contracts/C-330-integrate-deterministic-demo-combat-and-declared-skill-check.md` | Added YAML frontmatter + Execution Report; status → implemented |
| `docs/contracts/C-331-integrate-inventory-equipment-loot-and-vendor-into-the-demo.md` | Added YAML frontmatter + Execution Report; status → implemented |
| `docs/contracts/C-332-redesign-the-minimal-game-hud-and-overlay-navigation.md` | Added YAML frontmatter + Execution Report; status → implemented |
| `docs/contracts/C-333-simplify-settings-with-progressive-disclosure.md` | Added YAML frontmatter + Execution Report; status → implemented |
| `docs/contracts/C-334-make-local-save-continue-autosave-and-recovery-reliable.md` | Added YAML frontmatter + Execution Report; status → implemented |
| `docs/contracts/C-335-enforce-the-playable-demo-release-gate.md` | Added YAML frontmatter + Execution Report; status → implemented |
| `docs/contracts/C-336-extract-a-deterministic-rules-kernel-and-typed-game-command.md` | Added YAML frontmatter + Execution Report; status → implemented |
| `docs/contracts/C-337-complete-character-progression-classes-abilities-skills-and.md` | Added YAML frontmatter + Execution Report; status → implemented |
| `docs/contracts/C-338-deepen-turn-based-combat-with-action-economy-statuses-and-ta.md` | Added YAML frontmatter + Execution Report; status → implemented |
| `docs/contracts/C-340-build-party-and-companion-gameplay.md` | Added YAML frontmatter + Execution Report; status → implemented |
| `docs/contracts/C-341-add-relationships-factions-reputation-and-persistent-consequ.md` | Added YAML frontmatter + Execution Report; status → implemented |
| `docs/contracts/C-342-add-world-interactables-dungeons-puzzles-and-loot-tables.md` | Added YAML frontmatter + Execution Report; status → implemented |
| `docs/contracts/C-343-promote-rich-chat-ux-into-production-gameplay.md` | Added YAML frontmatter + Execution Report; status → implemented |
| `docs/contracts/C-345-add-a-campaigncontent-pack-browser-and-a-second-adventure.md` | Added YAML frontmatter + Execution Report; status → implemented |
| `docs/contracts/C-370-fix-lpc-paperdoll-base-layering-and-neck-alignment.md` | Added YAML frontmatter + Execution Report; status → implemented |
| `docs/contracts/C-422-onboarding-arc.md` | Added Execution Report (already had frontmatter); Metadata table status → implemented |
| `docs/contracts/C-452-backfill-execution-reports.md` | Status updated to `implemented`; Execution Report appended |

### Deviations from Spec
None. All 17 contracts received their Execution Reports. Old-format contracts received YAML frontmatter. C-422 received only the Execution Report (frontmatter already existed). All Metadata table statuses updated to `implemented`. `mark_contract_implemented.ts --dry-run` confirms all 17 contracts are at `implemented` status.

### Test Results
- Lint: `lint_contracts.ts --all` — 0 `missing-execution-report` errors for the 17 target contracts (2 pre-existing errors for C-400, C-425 are outside scope)
- Tool: `mark_contract_implemented.ts --dry-run` — all 17 report `already implemented`
- Unit/E2E/Visual: N/A (docs-only changes)

---
