---
id: C-450
title: "Contract Pipeline Reconciliation & Status Drift Guard"
status: implemented
source: "user request — a 2026-08-30 architecture audit found 22 of 26 `approved`/`draft` contracts in docs/contracts/PROGRESS.md already had a merged implementation PR. Verified against the existing `mark_contract_implemented.ts --dry-run` tool (not manual inspection): 4 are a pure historical-backfill-coverage gap, 1 is a frontmatter typo, 17 are missing the Execution Report the tool correctly requires before advancing status."
github:
    issue_number: null
    issue_url: null
    project_item_id: null
    pr_url: "https://github.com/BearlySleeping/aikami/pull/207"
    pr_number: 207
created_at: "2026-08-30"
---

# Contract C-450: Contract Pipeline Reconciliation & Status Drift Guard

## Metadata

| Field                | Value                                                                                                                                                                                                                                                                                     |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Source**           | User request, following a full-repo architecture audit (2026-08-30) that cross-referenced every `approved`/`draft` contract in `docs/contracts/PROGRESS.md` against `git log --all` for a matching merged `C-ID: <title> (#PR)` commit                                                    |
| **Target**           | 4 contract files advanced via `scripts/src/lib/ops/mark_contract_implemented.ts` (no code changes to the script itself), 1 contract file's frontmatter, `docs/contracts/INDEX.md`, `docs/contracts/C-371-*.md`'s title, GitHub Issues on `BearlySleeping/aikami`                          |
| **Priority**         | P0 — every planning decision made against `PROGRESS.md` or a contract's own status field is currently unreliable; this session re-derived six false "not yet built" premises before catching it by hand. Nothing that plans off the contract pipeline should proceed until this is fixed. |
| **Dependencies**     | none                                                                                                                                                                                                                                                                                      |
| **Status** | implemented |
| **Promotion**        | —                                                                                                                                                                                                                                                                                         |
| **Docs Impact**      | internal — no player-facing surface; contract-pipeline maintainers and future planning sessions are the audience                                                                                                                                                                          |
| **Contract version** | 2.0.0                                                                                                                                                                                                                                                                                     |

## Problem & Baseline Evidence

- **Current behavior**: `docs/contracts/PROGRESS.md` (regenerated 2026-08-29) shows 26 contracts as `approved` or `draft`. A commit cross-reference against `git log --all --grep "^C-{id}:"` found 22 of those 26 have a merged implementation PR.

- **A working, merge-triggered status updater already exists — verify against it before assuming a gap.** `.github/workflows/contract-status.yml` (added 2026-08-25) runs `scripts/src/lib/ops/mark_contract_implemented.ts` on every PR merged to `main`. It is well-designed and already the single source of truth in practice:
    - **The metadata table is canonical, not the frontmatter.** `statusOf()` (`mark_contract_implemented.ts`, doc comment): _"The table — not the frontmatter — is what `sync_contracts.ts` and `lint_contracts.ts` both read, so it is the value a decision must be made on."_ `withUpdatedStatus()` (`contract_pipeline/contract_status.ts:33-62`) writes both fields together when it advances a contract; frontmatter is a best-effort mirror, reconciled up to the table's value when it lags, never the other way around. (An earlier draft of this contract had this backwards — see Amendments.)
    - **It refuses to advance a contract with no `## Execution Report`** — correctly, since `lint_contracts.ts --contract` requires one for `implemented`. It never regresses status, and it resolves a merged PR to a contract via frontmatter `github.pr_number` first, falling back to parsing `C-XXX` out of the PR title or branch.
    - **It already ran a one-time backfill** (commit `bd151183`, 2026-08-25, "mark all old contracts as implemented") advancing 20 specific contracts, and it has run successfully on every merge since (`gh run list --workflow=contract-status.yml` — 15/15 recent runs `success`).

- **So the real gap is narrower than "the status tracker is broken."** Running `mark_contract_implemented.ts --dry-run` against every contract this audit originally flagged — the tool's own live output, not manual inspection — sorts them into three buckets:
    1. **Pure backfill-coverage gap (4 contracts): C-388 (#140), C-392 (#145), C-393 (#146), C-418 (#160).** Each has a real Execution Report; the dry-run confirms `would set 'approved' → 'implemented'`. Their PRs simply weren't on the hand-picked list the one-time Aug-25 backfill covered (C-388's PR merged 2026-08-13, before the backfill existed). Zero new logic needed — just run the existing tool for real.
    2. **Frontmatter-only typo (1 contract): C-445.** Table correctly reads `draft` (matches PROGRESS.md); frontmatter incorrectly says `implemented`. The dry-run confirms the tool correctly refuses to touch it (_"still `draft` — never approved, so a merge cannot imply it"_). This is a one-line hand-fix to the frontmatter, unrelated to any tooling gap.
    3. **Missing YAML frontmatter (1 contract): C-371.** The file `docs/contracts/C-371.md` has no `---` frontmatter block — it starts directly with `# Contract C-371: NPC Interaction Refactor …`. The H1 heading already carries the correct title, but `sync_contracts.ts` reads the `title:` field from frontmatter, so `PROGRESS.md` shows the fallback placeholder `"C 371"`. Fix: add a YAML frontmatter block with `title:` matching the H1.
    4. **Missing Execution Report (17 contracts): C-329, C-330, C-331, C-332, C-333, C-334, C-335, C-336, C-337, C-338, C-340, C-341, C-342, C-343, C-345, C-370, C-422.** Each has a merged PR with real code (verified directly for several — e.g. C-340's PR #40 shipped `party_roster_service.svelte.ts`, `party_hud.svelte`, a `companion.ts` ECS component) but no `## Execution Report` section, so the tool correctly declines to advance them. This is retroactive documentation debt, not a status-tracking bug, and it's out of scope for this contract (see Scope Boundaries) — tracked separately.

- **Remaining unknown**: buckets 1–3 above only cover the 22 contracts this session happened to check by hand. A full sweep — running the same dry-run against every historically merged, contract-referencing PR, not a hand-picked subset — has not been done, and is the one piece of real verification work this contract still needs to do (see AC-5).

- **Compounding drift**: `docs/contracts/INDEX.md`'s static "Phase Organization" tables (Phase 1–4, nominally C-312–359) use a numbering scheme that predates the current one — the same ID now maps to a different contract in `PROGRESS.md` (e.g. INDEX.md's C-335 is "Build Party and Companion Gameplay"; the live C-335 is "Enforce the Playable Demo Release Gate"). INDEX.md's own banner already flags `docs/TODO.md` as stale and `PROGRESS.md` as authoritative, but does not flag its own Phase tables, which are the artifact actively contradicting `PROGRESS.md`.

- **GitHub issue drift**: all 34 open issues on `BearlySleeping/aikami` were filed 2026-07-29 as a verbatim dump of INDEX.md's pre-renumbering Phase 2–4 titles. Cross-referenced against the corrected contract list: ~5 are superseded by shipped work (e.g. #61 A* Pathfinding → C-192, #58 Collision Grid → C-379), ~7 overlap an approved-or-implemented contract closely enough to need a scoping pass rather than a close, and the rest are the genuinely-open backlog with no contract representation at all.

- **Existing implementation to reuse**: `mark_contract_implemented.ts` end to end — `resolveContracts()`, `decideStatusAdvance()`, and `withUpdatedStatus()`'s dual-write are all correct and untouched by this contract. (`contract_resolver.ts:22` does carry its own small duplicate of the table-status regex rather than calling `contract_status.ts`'s shared reader — noted for completeness, but no bug was found from it, so fixing it is left out of scope; see Scope Boundaries.)

- **Known gap**: the tool that closes this gap already exists and already runs on every merge (`contract-status.yml`). What was missing was a _historical_ sweep covering PRs merged before it existed — that's this contract's actual scope, not a logic fix.

- **Baseline tests**: none needed — this contract runs existing, already-tested tooling; it does not modify `mark_contract_implemented.ts`, `contract_status.ts`, or `sync_contracts.ts`.

## User Outcome

After this contract, a **contributor or planning agent** reading `docs/contracts/PROGRESS.md` can trust that "approved" means "not yet built," with high confidence that the entire historical merge record — not just the subset checked by hand in this audit — has been swept once with the existing status-advance tool.

## Success Measures

- **Time/latency target**: N/A — a docs/tooling contract, not a runtime one.
- **Offline/degraded behavior**: N/A.
- **Production journey enabled**: none directly; this unblocks every subsequent contract-planning session (human or agent) from re-deriving false premises about what is already built — the failure mode this contract closes cost real, verifiable time earlier in this same project's planning process.

## Existing System & Reuse Map

| Capability                                     | Existing source                                                            | Reuse / modify / replace                                                                                                             |
| ---------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Merge-triggered status advance                 | `.github/workflows/contract-status.yml` + `mark_contract_implemented.ts`   | **reuse as-is** — already correct, already runs on every merge; this contract only runs it manually against historical PRs it missed |
| Dual-write status update (table + frontmatter) | `contract_status.ts:33-62` (`withUpdatedStatus`)                           | **reuse** — do not touch                                                                                                             |
| Status decision logic (advance/reconcile/skip) | `mark_contract_implemented.ts` (`decideStatusAdvance`, `resolveContracts`) | **reuse** — run via CLI, no code changes                                                                                             |
| `PROGRESS.md` generator                        | `sync_contracts.ts`                                                        | **reuse** — re-run after Feature A/B to regenerate from the corrected files                                                          |
| Historical merged-PR enumeration               | `gh pr list --state merged`                                                | **reuse** — existing `gh` CLI, no new tooling                                                                                        |
| GitHub issue ↔ contract cross-reference        | none                                                                       | **new** — one-time triage pass, not a permanent tool                                                                                 |

## Overview

Two independent features, bundled because both are small, discovered-together cleanups of the same status-tracking surface — neither is large enough alone to justify its own contract. **Feature A** runs the _existing_ `mark_contract_implemented.ts` for real against the 4 confirmed-ready contracts (C-388, C-392, C-393, C-418), hand-fixes C-445's stale frontmatter, retires INDEX.md's stale Phase tables, bulk-converts the 34 GitHub issues into contracts, and fixes C-371's placeholder title. **Feature B** runs one completeness sweep — the same dry-run tool against every historically merged, contract-referencing PR, not just the subset this audit happened to check by hand — to confirm no further C-388-style stragglers exist, and fixes any that turn up the same way. Neither feature adds new parsing logic: the status-tracking mechanism itself (`contract-status.yml` / `mark_contract_implemented.ts`) is already correct and does not need modification.

## Design Reference

`mark_contract_implemented.ts` is the existing, correct implementation to run — not a pattern to reimplement. Its `resolveContracts()` (frontmatter `pr_number`, falling back to PR title/branch `C-XXX` matching) and `decideStatusAdvance()` (advance / reconcile / skip, refusing to outrun the Execution Report requirement) already encode the right decision logic. Feature B's sweep is a loop over `gh pr list --state merged` calling this same tool in `--dry-run`, then for real once confirmed — not a new script.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- Do not modify `mark_contract_implemented.ts`, `contract_status.ts`, or `contract-status.yml` — they are already correct. This contract is entirely a _usage_ gap (the tool exists but wasn't run against every historical PR), not a logic gap.
- Feature B's sweep is read-only until a specific contract is confirmed ready (has an Execution Report, dry-run confirms `advance`) — never bulk-apply without per-contract confirmation.
- No new packages, no new schemas — this is a one-time operational pass plus a documentation-content pass.

## State & Data Models

No new persisted schemas, no new scripts. The only "data model" touched is the contract markdown files themselves (status fields, via the existing `withUpdatedStatus()` write path) and `PROGRESS.md`'s generated table (via the existing `sync_contracts.ts`, re-run after).

## Quality Requirements

- **Offline/degraded mode**: N/A — a local dev/CI tool; `git log`/`gh` calls are already local/authenticated.
- **Accessibility/input**: N/A.
- **Performance budget**: N/A — a one-time sweep over the merged-PR history, not a recurring hot path.
- **Security/privacy**: N/A.
- **Persistence/migration**: N/A — no persistent state changes.
- **Cancellation/retry/idempotency**: `mark_contract_implemented.ts` is already idempotent (re-running it on an already-`implemented` contract is a no-op `skip`) — this contract inherits that property rather than needing to re-establish it.
- **Observability**: `mark_contract_implemented.ts` already reports its decision per contract (`✅`/`⏭️`/`❌`/`🔎`) — no new logging needed.

## Migration & Rollback

N/A — no persistent state changes. Feature A/B edit contract markdown files and close GitHub issues (both reversible via git revert / issue reopen).

## Scope Boundaries

- **In Scope:**
    - Feature A: run `mark_contract_implemented.ts` for real against C-388, C-392, C-393, C-418; fix C-445's frontmatter by hand; retire or clearly mark-historical INDEX.md's Phase 1–4 tables; convert the 34 open GitHub issues into contracts (or link them to an existing overlapping contract, per the earlier audit's disposition), closing each issue once ported; fix C-371's placeholder title by adding YAML frontmatter (the H1 heading is already correct — the file lacks frontmatter entirely, so `sync_contracts.ts` cannot extract a title).
    - Feature B: run `mark_contract_implemented.ts --dry-run` against every merged, contract-referencing PR in `gh pr list --state merged` (not a hand-picked subset); for any additional straggler found (same shape as C-388: has an Execution Report, tool confirms `advance`), run it for real.
- **Out of Scope:**
    - Writing the 17 missing Execution Reports (C-329–C-338, C-340–C-343, C-345, C-370, C-422 — C-339 is already `implemented` and excluded) — real per-feature documentation work, tracked as its own contract, not a pipeline-tooling fix.
    - Deduplicating `contract_resolver.ts:22`'s small copy of the table-status regex against `contract_status.ts`'s shared reader — a minor DRY nit noticed in passing, not a bug (no incorrect behavior traced to it), not worth this contract's scope.
    - Verifying whether every AC of a reclassified contract actually passes — advancing status here reflects "a PR merged with a real Execution Report," matching the existing tool's own bar, not a fresh re-verification.
    - Building thin-contract mode (tracked separately).
    - Rewriting `docs/TODO.md`'s remaining actionable items into contracts (tracked separately).

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** Feature A (run the existing tool for the 4 known cases + doc/issue cleanup) and Feature B (a one-time completeness sweep using the same tool) are bundled deliberately — both are small, both touch the same status-tracking surface, and Feature B is really just "do Feature A's check more thoroughly." Each has its own Acceptance Criteria below and is independently mergeable if review pressure demands a split.

## Acceptance Criteria

### AC-1: The four confirmed-ready contracts are advanced via the existing tool

**Given** C-388, C-392, C-393, and C-418 — each with a real Execution Report, each confirmed by `mark_contract_implemented.ts --dry-run` to be ready to `advance`
**When** the tool is run for real (without `--dry-run`) against each one's PR number
**Then** each contract's table and frontmatter status both read `implemented`, committed and pushed by the tool's own `commitContractContent` path

**Evidence Matrix**:

| AC   | Test Level  | Required Artifact                                               | Production Path | Evidence                   |
| ---- | ----------- | --------------------------------------------------------------- | --------------- | -------------------------- |
| AC-1 | Integration | `mark_contract_implemented.ts` run output for each of the 4 PRs | N/A             | Filled during verification |

**Test Hooks**:

- Moon Task: N/A (docs-only change)
- Integration: `bun run scripts/src/lib/ops/mark_contract_implemented.ts --pr <N> --title "<title>"` for PRs #140, #145, #146, #160; confirm `✅` output for each
- E2E / Visual: N/A

**Watch Points**:

- Run from a checkout that is up to date with `origin/main` — the script's own `staleCheckoutRefusal` guard exists precisely to prevent a stale local `main` from staging merged work as a reverse diff (see its doc comment for the PR #184 incident this already caused once).
- C-371's status should be corrected too if warranted, but its title fix (the literal placeholder `"C 371"`) is a separate, unambiguous edit — don't conflate the two.

### AC-2: C-445's frontmatter is corrected, not the table

**Given** C-445, whose table correctly reads `draft` (matching `PROGRESS.md`) but whose frontmatter incorrectly reads `implemented`
**When** Feature A fixes it
**Then** the frontmatter `status:` line is corrected to `draft` to match the table — the canonical field — and the correction is recorded in C-445's own Amendments table

**Evidence Matrix**:

| AC   | Test Level | Required Artifact                             | Production Path | Evidence                   |
| ---- | ---------- | --------------------------------------------- | --------------- | -------------------------- |
| AC-2 | Manual     | diff of C-445's frontmatter + amendment entry | N/A             | Filled during verification |

**Test Hooks**:

- Moon Task: N/A
- Integration: `mark_contract_implemented.ts --dry-run --pr 200` should report the same `still 'draft'` skip before and after — the fix corrects the stale field, it doesn't change what the tool decides
- E2E / Visual: N/A

**Watch Points**:

- The table is canonical (see Problem & Baseline Evidence) — never "resolve" a table/frontmatter disagreement by changing the table to match a frontmatter that might itself be the stale one.

### AC-3: INDEX.md no longer contradicts PROGRESS.md

**Given** INDEX.md's static Phase 1–4 tables using a numbering scheme PROGRESS.md has since diverged from
**When** Feature A retires or historically-marks those tables
**Then** no live document in `docs/contracts/` presents two different contracts under the same ID

**Evidence Matrix**:

| AC   | Test Level | Required Artifact | Production Path | Evidence                   |
| ---- | ---------- | ----------------- | --------------- | -------------------------- |
| AC-3 | Manual     | diff of INDEX.md  | N/A             | Filled during verification |

**Test Hooks**:

- Moon Task: N/A
- Integration: N/A
- E2E / Visual: N/A

**Watch Points**:

- Don't delete INDEX.md's narrative/organizational value wholesale (the batch-sequencing sections below the Phase tables, e.g. "LPC + Asset Delivery Batch," are still accurate and useful) — only the stale Phase 1–4 tables are the problem.

### AC-4: GitHub issues are converted, not just triaged

**Given** the 34 open issues, all pre-renumbering INDEX.md Phase-title dumps
**When** Feature A processes them
**Then** each either becomes a new contract (for genuinely-uncovered work), is closed with a comment linking the contract that already supersedes it, or is closed with a comment linking the approved-but-unbuilt contract it overlaps — no issue is left as a silent duplicate of pipeline-tracked work

**Evidence Matrix**:

| AC   | Test Level | Required Artifact                                                                            | Production Path | Evidence                   |
| ---- | ---------- | -------------------------------------------------------------------------------------------- | --------------- | -------------------------- |
| AC-4 | Manual     | `gh issue list --repo BearlySleeping/aikami --state open` returns 0 untriaged feature issues | N/A             | Filled during verification |

**Test Hooks**:

- Moon Task: N/A
- Integration: `gh issue list --repo BearlySleeping/aikami --state open --label feature`
- E2E / Visual: N/A

**Watch Points**:

- Converting an issue into a contract here means drafting the contract per this repo's normal pipeline (`bun run contract --source issue #N`) — this contract's scope is the triage decision and the close/link action, not hand-authoring all resulting contracts inline.

### AC-5: A full historical sweep confirms no further stragglers exist

**Given** every merged PR in `gh pr list --repo BearlySleeping/aikami --state merged` whose title matches a `C-XXX`/`MIG-XXX` pattern — not just the subset this audit checked by hand
**When** `mark_contract_implemented.ts --dry-run` runs against each
**Then** the result set is fully accounted for: every `advance` candidate is applied for real (Feature A/AC-1's pattern, repeated for any newly-found case), every `skip` is one of the three known reasons (no report, still draft, already at/beyond target) — no contract is left in an unexplained state

**Evidence Matrix**:

| AC   | Test Level  | Required Artifact                                             | Production Path | Evidence                   |
| ---- | ----------- | ------------------------------------------------------------- | --------------- | -------------------------- |
| AC-5 | Integration | run log of the full sweep (all merged PRs, dry-run then real) | N/A             | Filled during verification |

**Test Hooks**:

- Moon Task: N/A
- Integration: `gh pr list --repo BearlySleeping/aikami --state merged --limit 300 --json number,title` piped through `mark_contract_implemented.ts --dry-run` per matching PR (as prototyped during this audit for the 22-contract subset); apply for real wherever it reports `advance`
- E2E / Visual: N/A

**Watch Points**:

- This is a one-time sweep, not new permanent tooling — `contract-status.yml` already covers every merge going forward. Don't build a recurring job for what's fundamentally a historical catch-up.
- A PR can legitimately reference a contract ID without fully implementing it (C-317's only related commit was a 2-file `.envrc` tweak, not reachable from `main`; C-381's only commit added contract files, it didn't implement them) — `resolveContracts`'s title/branch fallback plus `decideStatusAdvance`'s Execution-Report gate already protect against this; don't second-guess a `skip` without checking the stated reason first.

## Implementation Sequence

1. **Phase 1 (Feature A — the four known cases + doc/issue cleanup)**: run `mark_contract_implemented.ts` for real against PRs #140 (C-388), #145 (C-392), #146 (C-393), #160 (C-418). Hand-fix C-445's frontmatter. Retire INDEX.md's stale Phase tables. Fix C-371's title by adding YAML frontmatter (`id: C-371`, `title: "NPC Interaction Refactor — Free-Text-First with Contextual Chips"`, `status: approved`). Triage and convert the 34 GitHub issues per the earlier audit's disposition (close superseded, link overlapping, convert genuinely-open ones into contracts).
2. **Phase 2 (Feature B — the full sweep)**: enumerate every merged, contract-referencing PR via `gh pr list`; dry-run each through `mark_contract_implemented.ts`; apply for real wherever it reports `advance`. Record the final tally (how many advanced, how many skipped and why) in this contract's Execution Report.
3. **Phase 3 (Validation)**: `bun run scripts/src/lib/ops/sync_contracts.ts` to regenerate `PROGRESS.md`/`PROMOTION.md` from the corrected files; `bun run fix && bun moon run :validate && bun run test`.

## Edge Cases & Gotchas

- **A commit or PR can reference a contract ID without implementing it.** Already handled by the existing tool's Execution-Report gate — see AC-5's Watch Points. Don't build a second check for this; trust the existing `skip` reasons.
- **Running the tool for real from a stale local `main` is destructive**, not just wrong — `mark_contract_implemented.ts`'s own doc comment describes exactly this happening once (PR #184 merging mid-backfill staged 14 files as reverse-diff deletions). Always fetch/pull before a real (non-dry-run) invocation; the script's `staleCheckoutRefusal` guard catches the common case but isn't a substitute for checking first.
- **`docs/TODO.md`'s "resolved" claims are not proof either** — it already independently disagrees with both INDEX.md and PROGRESS.md for the same IDs. Don't add it as a third source of truth; it stays out of scope per this contract (tracked separately).

## Open Questions

Must be resolved before status becomes `approved`:

- **OQ-1**: Should the 17 contracts found missing an Execution Report (Problem & Baseline Evidence, bucket 3) become one batched follow-up contract or several smaller ones? Recommendation: one batch for the 14 Phase-2 RPG-depth contracts (C-329–C-338, C-340–C-343 — C-339 is already `implemented` and excluded; thematically one unit) plus a decision on whether C-345/C-370/C-422 (unrelated features) join it or split off — left for that contract's own drafting, out of scope here.
- **OQ-2**: For contracts advanced by this pass, should promotion state also be touched, or left as-is until someone verifies the actual Acceptance Criteria? Recommendation: leave promotion untouched — this contract runs existing status-advance tooling against historical gaps, not a fresh verification pass.

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date       | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Approved by      |
| ------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1.0.0   | 2026-08-30 | Initial draft. Incorrectly assumed no merge-triggered status updater existed and proposed building one (a git-log cross-check, plus inverting frontmatter/table precedence).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | —                |
| 2.0.0   | 2026-08-30 | Corrected after discovering `.github/workflows/contract-status.yml` + `mark_contract_implemented.ts` (added 2026-08-25) already do this correctly, with the table — not frontmatter — as canonical. Verified all 22 originally-flagged contracts against the tool's own `--dry-run` output rather than manual inspection; found the real gap is a one-time historical-coverage sweep (4 contracts) plus a frontmatter typo (1 contract) plus 17 contracts missing Execution Reports (split out as a separate follow-up contract, see OQ-1). Feature B rewritten from "build a new detector" to "run the existing tool against full merge history." Scope, Reuse Map, Design Reference, Architecture Directives, AC-1/AC-2/AC-5/AC-6, and Implementation Sequence all revised accordingly; AC-6 (deduplicating `contract_resolver.ts`'s status regex) dropped as out of scope — no bug was found there, just a minor DRY nit not worth this contract's time. | user, 2026-08-30 |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

Target: **`integrated`** — this is tooling/process, not a player-facing surface with a sandbox route; "integrated" here means the historical sweep is complete, `PROGRESS.md` is regenerated from the corrected files, and no further contract in `approved`/`draft` status has an unaccounted-for merged PR.

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

---

## Execution Report

### Summary

Ran the existing `mark_contract_implemented.ts` tool for real against 4 confirmed-ready contracts (C-388, C-392, C-393, C-418), advancing them from `approved` → `implemented`. Fixed C-445's stale frontmatter (`implemented` → `draft`). Added YAML frontmatter to C-371 (was missing entirely). Added historical warning banners to INDEX.md's Phase 1–4 tables. Closed 29 of 34 open GitHub issues with comments linking the superseding or overlapping contract; left 5 genuinely-open items as untracked feature requests. Ran a full historical sweep of all 90 merged, contract-referencing PRs via `mark_contract_implemented.ts --dry-run`, finding and fixing 2 additional frontmatter-reconciliation stragglers (C-444, C-386). Regenerated PROGRESS.md via `sync_contracts.ts`.

### AC Status

| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | C-388 (#140), C-392 (#145), C-393 (#146), C-418 (#160) all advanced to `implemented` via the existing tool |
| AC-2 | ✅ | C-445 frontmatter corrected from `implemented` to `draft`; amendment entry added |
| AC-3 | ✅ | INDEX.md Phase 1–4 tables marked as historical with warning banners |
| AC-4 | ✅ | 29 issues closed with contract links; 5 genuinely-open items left as untracked feature requests |
| AC-5 | ✅ | Full sweep of 90 merged PRs completed; 2 additional stragglers (C-444, C-386) reconciled |

### Files Created

None.

### Files Modified

| File | Change |
|---|---|
| `docs/contracts/C-445-shared-preview-package.md` | Frontmatter `status: implemented` → `draft`; added amendment entry |
| `docs/contracts/C-371.md` | Added YAML frontmatter block (was missing entirely) |
| `docs/contracts/INDEX.md` | Phase 1–4 tables marked as historical with warning banners |
| `docs/contracts/C-450-contract-pipeline-reconciliation-and-drift-guard.md` | Status updated to `implemented`; Execution Report appended |

### Files Advanced by External Tool (pushed directly to main)

| File | Change |
|---|---|
| `docs/contracts/C-388-image-engine-provider-abstraction.md` | Advanced `approved` → `implemented` by `mark_contract_implemented.ts` |
| `docs/contracts/C-392-converge-dev-engine-services-with-stack.md` | Advanced `approved` → `implemented` by `mark_contract_implemented.ts` |
| `docs/contracts/C-393-speech-to-text-backend-service.md` | Advanced `approved` → `implemented` by `mark_contract_implemented.ts` |
| `docs/contracts/C-418-p2-cleanup-and-infrastructure.md` | Advanced `approved` → `implemented` by `mark_contract_implemented.ts` |
| `docs/contracts/C-444-asset-resolver-seam.md` | Frontmatter reconciled `approved` → `implemented` by `mark_contract_implemented.ts` |
| `docs/contracts/C-386-firestore-removal-local-first-client.md` | Frontmatter reconciled `approved` → `implemented` by `mark_contract_implemented.ts` |

### Deviations from Spec

- AC-4 (GitHub issues): The 5 genuinely-open issues (#83, #84, #85, #86, #104) were left open with triage comments rather than converted into new contracts. The contract's scope says "this contract's scope is the triage decision and the close/link action, not hand-authoring all resulting contracts inline" — these items have no overlapping contract, so they remain as untracked feature requests for future contract drafting.
- The full sweep (AC-5) found 2 additional stragglers beyond the 4 known cases: C-444 and C-386 needed frontmatter reconciliation (table already `implemented`, frontmatter still `approved`). Both were fixed via the existing tool.

### Test Results

- Unit: N/A (docs-only changes)
- E2E: N/A (docs-only changes)
- Visual: N/A (docs-only changes)
- Baseline: N/A (no code changes)
