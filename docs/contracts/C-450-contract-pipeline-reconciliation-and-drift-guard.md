---
id: C-450
title: "Contract Pipeline Reconciliation & Status Drift Guard"
source: "user request — a 2026-08-30 architecture audit found 20 of 26 `approved`/`draft` contracts in docs/contracts/PROGRESS.md already had a merged implementation PR; the status field was never updated. Verified by cross-referencing every approved/draft contract ID against `git log --all --grep`."
status: draft
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-08-30"
---

# Contract C-450: Contract Pipeline Reconciliation & Status Drift Guard

## Metadata

| Field | Value |
|---|---|
| **Source** | User request, following a full-repo architecture audit (2026-08-30) that cross-referenced every `approved`/`draft` contract in `docs/contracts/PROGRESS.md` against `git log --all` for a matching merged `C-ID: <title> (#PR)` commit |
| **Target** | `scripts/src/lib/ops/sync_contracts.ts`, `scripts/src/lib/agents/contract_pipeline/contract_status.ts`, `scripts/src/lib/agents/contract_pipeline/contract_resolver.ts`, ~20 contract files in `docs/contracts/`, `docs/contracts/INDEX.md`, GitHub Issues on `BearlySleeping/aikami` |
| **Priority** | P0 — every planning decision made against `PROGRESS.md` or a contract's own status field is currently unreliable; this session re-derived six false "not yet built" premises before catching it by hand. Nothing that plans off the contract pipeline should proceed until this is fixed. |
| **Dependencies** | none |
| **Status** | draft |
| **Promotion** | — |
| **Docs Impact** | internal — no player-facing surface; contract-pipeline maintainers and future planning sessions are the audience |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: `docs/contracts/PROGRESS.md` (regenerated 2026-08-29) shows 26 contracts as `approved` or `draft`. A commit cross-reference against `git log --all --grep "^C-{id}:"` (loosened to a plain substring match where the anchored form missed a naming variant) found **20 of those 26 already have a merged implementation PR** — including the entire Phase-2 RPG-depth batch (C-336–342, PRs #36–42: rules kernel, character progression, combat depth, party/companion, relationships/factions, world interactables), the LPC/infra batch (C-370, C-388, C-392, C-393), and several UX contracts (C-329, C-330–333, C-334, C-335, C-343, C-345, C-418, C-422, C-445).

- **Root cause, confirmed by reading the actual parsing code** — two independent bugs, not one:
  1. **Dual-source drift for v2 (YAML-frontmatter) contracts.** `withUpdatedStatus()` (`scripts/src/lib/agents/contract_pipeline/contract_status.ts:33-62`) correctly writes status to *both* the markdown metadata-table `| **Status** |` row and the YAML frontmatter `status:` line when both are present — its own doc comment says this is "so the two status sources... stay in sync." But the two **read** paths never consult the frontmatter at all: `sync_contracts.ts`'s `extractStatus()` (line 61, comment: *"This is the canonical source of truth"*) and `contract_resolver.ts`'s inline status regex (line 22) both match only `\|\s*\*\*Status\*\*\s*\|...` — the table row. Confirmed on disk: `docs/contracts/C-388-image-engine-provider-abstraction.md` has `status: implemented` in its frontmatter (line 5) and `| **Status** | approved |` in its metadata table (line 24) — simultaneously. Something updated the frontmatter (or the table was hand-edited before `withUpdatedStatus` existed) without going through the shared helper, and nothing downstream notices the two fields disagree.
  2. **No completion detection at all for pure-table (v1) contracts.** C-336, C-337, C-338, C-340, C-341, C-342 (and others) have no YAML frontmatter — a single `| **Status** |` row is their only status field, and it simply never got flipped from `approved` to `implemented` after their PRs merged. There is no dual-source bug here to detect from the file alone; the only evidence is external (the merged PR itself), which nothing in the pipeline checks for.

- **Compounding drift**: `docs/contracts/INDEX.md`'s static "Phase Organization" tables (Phase 1–4, nominally C-312–359) use a numbering scheme that predates the current one — the same ID now maps to a different contract in `PROGRESS.md` (e.g. INDEX.md's C-335 is "Build Party and Companion Gameplay"; the live C-335 is "Enforce the Playable Demo Release Gate"). INDEX.md's own banner already flags `docs/TODO.md` as stale and `PROGRESS.md` as authoritative, but does not flag its own Phase tables, which are the artifact actively contradicting `PROGRESS.md`.

- **GitHub issue drift**: all 34 open issues on `BearlySleeping/aikami` were filed 2026-07-29 as a verbatim dump of INDEX.md's pre-renumbering Phase 2–4 titles. Cross-referenced against the corrected contract list: ~5 are superseded by shipped work (e.g. #61 A* Pathfinding → C-192, #58 Collision Grid → C-379), ~7 overlap an approved-or-implemented contract closely enough to need a scoping pass rather than a close, and the rest are the genuinely-open backlog with no contract representation at all.

- **Existing implementation to reuse**: `withUpdatedStatus()`'s dual-write logic is correct and should not be changed — the fix belongs entirely on the read side. `readContractStatus()` (`contract_status.ts:14-19`) is already the single function `contract_resolver.ts` *should* be calling instead of its own inline regex (line 22) — that duplication is itself part of the problem surface.

- **Known gaps**: no existing script or CI check compares a contract's declared status against its actual merge history. `sync_contracts.ts` has never had a "does this look wrong" pass — it faithfully regenerates `PROGRESS.md` from whatever the files say, including when the files disagree with themselves.

- **Baseline tests**: none exist for `sync_contracts.ts` or `contract_status.ts` today (only `contract_pipeline/contract_sync.test.ts` was found, covering a different module — verify its actual scope before assuming coverage).

## User Outcome

After this contract, a **contributor or planning agent** reading `docs/contracts/PROGRESS.md` can trust that "approved" means "not yet built" — and if a future contract's two status fields ever disagree, or its table status contradicts a merged PR referencing its ID, that surfaces automatically instead of requiring a manual `git log` audit to catch.

## Success Measures

- **Time/latency target**: N/A — a docs/tooling contract, not a runtime one.
- **Offline/degraded behavior**: N/A.
- **Production journey enabled**: none directly; this unblocks every subsequent contract-planning session (human or agent) from re-deriving false premises about what is already built — the failure mode this contract closes cost real, verifiable time earlier in this same project's planning process.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Dual-write status update (table + frontmatter) | `contract_status.ts:33-62` (`withUpdatedStatus`) | **reuse** — do not touch; it's already correct |
| Table-only status read | `contract_status.ts:10-11` (`parseContractStatus`) | **modify** — add frontmatter-aware resolution |
| Table-only status read, duplicated | `contract_resolver.ts:22` (inline regex) | **replace** — call `readContractStatus`/`parseContractStatus` instead of re-implementing the regex |
| `PROGRESS.md` generator | `sync_contracts.ts:61-67` (`extractStatus`) | **modify** — same frontmatter-aware resolution, plus a divergence warning |
| Contract ID → merged commit evidence | none | **new** — a small git-log lookup helper |
| GitHub issue ↔ contract cross-reference | none | **new** — one-time script, run once, not a permanent tool |

## Overview

Two independent features, bundled because both are read-side fixes to the same status-tracking surface and were discovered together. **Feature A** is a one-time reconciliation pass: fix the ~20 confirmed-stale statuses, manually resolve the two ambiguous cases (C-422, C-445 — frontmatter claims `implemented` but the file body shows no execution evidence), retire INDEX.md's stale Phase tables, bulk-convert the 34 GitHub issues into contracts (closing the issues once ported), and fix C-371's file, whose title is the literal placeholder text `"C 371"`. **Feature B** is the permanent fix: make the status-read path frontmatter-aware and add a lightweight git-log cross-check so this class of drift is caught going forward instead of requiring another manual audit.

## Design Reference

Follow the existing dual-write pattern in `contract_status.ts` — it already encodes the intended source-of-truth precedence (frontmatter is the newer, more actively-written field for v2 contracts; the table field is the only source for v1 contracts). Feature B's resolution rule should mirror that: prefer frontmatter status when the file has frontmatter, fall back to the table field when it doesn't, and treat disagreement between the two as a first-class signal, not silence.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- Keep the git-log cross-check read-only and advisory. It should never auto-write a status change — flag the mismatch for a human/agent to confirm, since "a commit mentioning C-XXX exists" is evidence, not proof (a commit can reference a contract without fully implementing every AC).
- `contract_resolver.ts` should call the shared `contract_status.ts` reader rather than keep its own copy — one parser, not two, is the whole point of this contract.
- No new packages, no new schemas — this is entirely `scripts/`-internal tooling logic plus a documentation-content pass.

## State & Data Models

No new persisted schemas. The only "data model" touched is the contract markdown files themselves (status fields) and `PROGRESS.md`'s generated table. If Feature B's cross-check needs to cache anything (e.g. to avoid re-running `git log` per contract on every `sync_contracts.ts` invocation), keep it in-memory for the run — no new on-disk cache file.

## Quality Requirements

- **Offline/degraded mode**: N/A — a local dev/CI tool; `git log` is already local.
- **Accessibility/input**: N/A.
- **Performance budget**: the git-log cross-check runs once per `sync_contracts.ts` invocation over ~450 contracts — must stay well under a few seconds; a single `git log --all --oneline` piped through in-memory matching (as prototyped during this audit) is fast enough, avoid one `git log` subprocess spawn per contract.
- **Security/privacy**: N/A.
- **Persistence/migration**: N/A — no persistent state changes.
- **Cancellation/retry/idempotency**: Feature A's reconciliation pass must be idempotent — running it twice should not double-edit files. Feature B's check is read-only by design, so idempotency is automatic.
- **Observability**: Feature B's mismatch warnings should print clearly in `sync_contracts.ts`'s existing console output (it already has a per-contract loop) — no new logging infrastructure needed.

## Migration & Rollback

N/A — no persistent state changes. Feature A edits contract markdown files and closes GitHub issues (both reversible via git revert / issue reopen). Feature B is a pure script-logic change.

## Scope Boundaries

- **In Scope:**
  - Feature A: correct the 20 confirmed-stale statuses; manually verify and resolve C-422 and C-445; retire or clearly mark-historical INDEX.md's Phase 1–4 tables; convert the 34 open GitHub issues into contracts (or link them to an existing overlapping contract, per the earlier audit's disposition), closing each issue once ported; fix C-371's placeholder title.
  - Feature B: make `contract_status.ts`'s status reader frontmatter-aware; point `contract_resolver.ts` at the shared reader instead of its own regex; add a git-log cross-check to `sync_contracts.ts` that flags (does not silently fix) any `approved`/`draft` contract with a matching merged commit.
- **Out of Scope:**
  - Verifying whether every AC of the 20 reclassified contracts actually passes — this contract corrects *status metadata*, not contract *completeness*. A contract moving from `approved` to `implemented` here reflects "a PR merged claiming this," not a re-run of its Acceptance Criteria.
  - Building thin-contract mode (tracked separately).
  - Rewriting `docs/TODO.md`'s remaining actionable items into contracts (tracked separately — TODO.md keeps whatever isn't yet migrated until those land).

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** Feature A (one-time reconciliation) and Feature B (permanent detection) are bundled deliberately, per explicit user direction to batch optimally rather than split every independently-mergeable piece into its own contract. They touch the same status-tracking surface and were discovered in the same audit. Each has its own Acceptance Criteria below and is independently mergeable if review pressure demands a split later.

## Acceptance Criteria

### AC-1: Every confirmed-stale contract's status matches its merge history
**Given** the 20 contracts confirmed in this audit to have a merged implementation PR
**When** Feature A's reconciliation pass runs
**Then** each contract's table `| **Status** |` field (and frontmatter `status:` field, where present) reads `implemented` — or, for contracts fully verified against their own Acceptance Criteria in the process, `completed`/`verified` per the existing status vocabulary

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Integration | manual diff of the 20 files pre/post | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: N/A (docs-only change)
- Integration: re-run this audit's cross-reference script after the edit; zero mismatches should remain among the original 20
- E2E / Visual: N/A

**Watch Points**:
- C-371's status should be corrected too, but its title fix is a separate, unambiguous edit — don't conflate "is it implemented" with "is its filename/title placeholder text."

### AC-2: C-422 and C-445 are resolved, not blindly flipped
**Given** C-422 (Onboarding Arc) and C-445 (Shared Preview Package), whose frontmatter claims `implemented` but whose file bodies show no Execution Report or completed-work evidence
**When** Feature A reviews them
**Then** each is set to whatever its actual code state supports — checked against the real codebase, not against either of its own self-contradicting fields — and the resolution is recorded in that contract's own Amendments table

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Manual | amendment entries in both files | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: N/A
- Integration: grep the codebase for the features each contract claims (onboarding arc steps; the `packages/frontend/preview` package) and confirm presence/absence directly
- E2E / Visual: N/A

**Watch Points**:
- Do not default to trusting the frontmatter just because it says `implemented` — that's the exact failure mode this contract exists to fix.

### AC-3: INDEX.md no longer contradicts PROGRESS.md
**Given** INDEX.md's static Phase 1–4 tables using a numbering scheme PROGRESS.md has since diverged from
**When** Feature A retires or historically-marks those tables
**Then** no live document in `docs/contracts/` presents two different contracts under the same ID

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Manual | diff of INDEX.md | N/A | Filled during verification |

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
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Manual | `gh issue list --repo BearlySleeping/aikami --state open` returns 0 untriaged feature issues | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: N/A
- Integration: `gh issue list --repo BearlySleeping/aikami --state open --label feature`
- E2E / Visual: N/A

**Watch Points**:
- Converting an issue into a contract here means drafting the contract per this repo's normal pipeline (`bun run contract --source issue #N`) — this contract's scope is the triage decision and the close/link action, not hand-authoring all resulting contracts inline.

### AC-5: Future status drift is detected automatically
**Given** a contract in `approved` or `draft` status whose ID appears in a merged commit message (`C-{id}: ...`)
**When** `sync_contracts.ts` runs
**Then** it prints a visible warning naming the contract and the matching commit, without altering the file

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | Unit | test file for the new git-log cross-check helper | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `bun test scripts/src/lib/ops/`
- Integration: run `bun run scripts/src/lib/ops/sync_contracts.ts` against this repo's current history post-Feature-A and confirm zero warnings (the reconciliation should have cleared them all)
- E2E / Visual: N/A

**Watch Points**:
- Keep this a warning, not a hard failure — a contract can legitimately have a commit referencing its ID (e.g. a partial spike, a revert) without being done. False-positive tolerance matters more than perfect precision here.

### AC-6: `contract_resolver.ts` and `sync_contracts.ts` agree with each other
**Given** the same contract file
**When** both `contract_resolver.ts`'s status read and `sync_contracts.ts`'s status read run against it
**Then** they return the same status, because both call the same underlying `contract_status.ts` function

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-6 | Unit | existing/new tests for `contract_status.ts`, `contract_resolver.ts` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `bun test scripts/src/lib/agents/contract_pipeline/`
- Integration: N/A
- E2E / Visual: N/A

**Watch Points**:
- `contract_resolver.ts:22`'s inline regex must be deleted, not left dead alongside the new call — duplication left in place defeats the point.

## Implementation Sequence

1. **Phase 1 (Feature B — fix the parser first)**: make `parseContractStatus`/`readContractStatus` in `contract_status.ts` frontmatter-aware (prefer frontmatter when present, else table; expose whether the two disagreed). Point `contract_resolver.ts` at it, deleting its inline regex. Add the git-log cross-check helper and wire its warning into `sync_contracts.ts`'s existing per-contract loop.
2. **Phase 2 (Feature A — run the now-fixed tooling to reconcile)**: re-run `sync_contracts.ts` with Phase 1 landed; it should now surface most of the 20 known-stale contracts on its own via the frontmatter-preference fix, plus warn on the pure-table ones (C-336 etc.) via the new cross-check. Manually confirm each warning, update statuses via the existing `updateContractStatus()` helper (not hand-edits), and separately resolve C-422/C-445, INDEX.md, C-371, and the GitHub issues.
3. **Phase 3 (Validation)**: `bun run fix && bun moon run :validate && bun run test`, then `bun run scripts/src/lib/ops/sync_contracts.ts` once more and confirm zero warnings remain.

## Edge Cases & Gotchas

- **A commit can reference a contract ID without implementing it.** C-317's only related commit was a 2-file `.envrc` tweak, not real feature work, and isn't even reachable from `main`. C-381's only commit added contract files, it didn't implement them. The cross-check must be treated as a lead to verify, never as ground truth to auto-apply.
- **Some contracts intentionally have two different statuses across their own fields for a reason other than drift** — none were found in this audit, but Feature B's resolver should log (not silently pick) whenever frontmatter and table disagree, so a future genuine edge case is visible rather than swallowed.
- **`docs/TODO.md`'s "resolved" claims are not proof either** — it already independently disagrees with both INDEX.md and PROGRESS.md for the same IDs. Don't add it as a third source of truth; it stays out of scope per this contract (tracked separately).

## Open Questions

Must be resolved before status becomes `approved`:

- **OQ-1**: For contracts reclassified from `approved` to `implemented` by this pass, should promotion state also be touched, or left as-is until someone verifies the actual Acceptance Criteria? Recommendation: leave promotion untouched — this contract fixes status metadata, not verification depth (see Scope Boundaries).
- **OQ-2**: Should the git-log cross-check run as part of `moon ci` (blocking) or stay a local/manual `sync_contracts.ts` warning? Recommendation: local warning only, at least initially — false positives on legitimate spike/revert commits would make a CI gate noisy.

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
|---|---|---|---|
| 1.0.0 | 2026-08-30 | Initial draft, seeded from a full-repo contract-status audit. | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

Target: **`integrated`** — this is tooling/process, not a player-facing surface with a sandbox route; "integrated" here means the fixed reader is what `sync_contracts.ts` and `contract_resolver.ts` actually run in production use, and the reconciliation pass is committed.

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

---
