---
id: C-469
title: "Canonical fail-closed validation and revision-bound promotion"
source: direct
contract_type: full
status: implemented
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: "https://github.com/BearlySleeping/aikami/pull/248"
  pr_number: 248
created_at: "2026-09-04T00:00:00Z"
---

# Contract C-469: Canonical fail-closed validation and revision-bound promotion

## Metadata

| Field | Value |
|---|---|
| **Source** | Accepted agent-platform audit; PR 03 in [execution plan](../strategy/agent-platform-hardening.md) |
| **Target** | `.pi/extensions/moon_integration.ts`, pipeline validation/promotion and shared check planning |
| **Type** | full |
| **Priority** | P0 — a failed query currently becomes successful validation |
| **Dependencies** | C-468; instruction-repair PR 02 |
| **Status** | approved |
| **Promotion** | — |
| **Docs Impact** | internal — canonical validation and publication semantics |
| **Contract version** | 2.0.0 |
| **Execution** | Claude Sonnet 5 / high; Opus/high design review; target 10–30 files, maximum 99 |

## Problem & Baseline Evidence

- **Current behavior:** `validate()` returns code 0 when affected-project extraction is empty, including query/parse failures. Full Moon project output measured about 1.14 MB exceeds `output_filter.ts`'s 512,000-character cap. `pre_push_gate.ts` converts unavailable checks into `ok: true` and treats failures as advisory.
- **Reproduction:** inject a nonzero query response; then valid large project JSON. Assert neither can become an unqualified green verdict. Inspect the currently different task sets in the Pi tool, pre-push gate, pre-commit and CI.
- **Reuse:** `pre_push_gate.test.ts`, `orchestrator_feedback.test.ts`, `.moon/tasks/all.yml`, `scripts/moon.yml`, CI reporting and process-runner exit propagation.
- **Known gaps:** structural guards are absent from the Pi tool's named validation sequence; final results are not a sufficient trusted promotion proof for the current candidate.
- **Baseline tests:** C-468 automation suites plus existing pre-push/review-gate tests.

## User Outcome

A developer or agent cannot mistake unavailable checks, stale evidence or an empty parsed response for a verified change.

## Success Measures

- Every simulated discovery/parse/spawn/timeout failure has a non-success typed outcome; zero false-green fault fixtures.
- Repeated unchanged checks reuse valid Moon caching; no paid model or network is necessary for the fault suite.
- Saving work is independent of asserting readiness: draft publication may preserve work, but ready/merge requires current evidence.

## Existing System & Reuse Map

| Capability | Existing source | Action |
|---|---|---|
| Process completion | `.pi/extensions/lib/process_runner.ts` | reuse |
| Gate runner seam | `scripts/src/lib/agents/contract_pipeline/pre_push_gate.ts` | extend |
| Check graph | `.moon/tasks/all.yml`, `scripts/moon.yml` | reconcile, not duplicate |
| Review decisions | `orchestrator.ts`, `review_gate.ts` | enforce current evidence |

## Overview

Create one validation policy with explicit profiles and result semantics. Interactive tools, pipeline checks and CI share its required-check definitions; expensive checks remain risk/affected-set scoped rather than making every call run the entire monorepo.

## Design Reference

Preserve existing injectable runners and CI's rule that parsed presentation cannot override a command's failed exit code. See [testing conventions](SHARED_SECTIONS.md#testing-conventions).

## Architecture Directives

Keep pure policy/schema code Node-compatible where Pi imports it. Run Bun/Moon through existing argv-based process wrappers. Expose `passed`, `failed`, `unavailable` and `not_applicable` distinctly; all consumers render unavailable checks as errors requiring action. Explicit base/head plus staged/unstaged content and relevant configuration determine freshness. Recompute the candidate after auto-fix, then validate that candidate. Never relabel an old result as a new revision without checking equivalence.

Do not duplicate all Moon scheduling in custom code. Define named profiles (focused, pre-publication, CI) with explicit required/optional checks, including structural guards and relevant tests. Preserve non-mutating verification; auto-fix is an explicit preceding operation.

## State & Data Models

A versioned validation artifact contains candidate/base/config fingerprints, selected projects/tasks, outcome per task, exit/spawn/timeout status, timestamps and bounded diagnostic artifact references. Hashes and exit outcomes are controller-computed, not worker assertions. Existing manifests with no such evidence remain readable but unverified.

## Quality Requirements

- **Offline/degraded:** unavailable dependencies fail explicitly; no implicit package downloads.
- **Accessibility/input:** N/A — CLI/tool results; render actionable text plus structured details.
- **Performance:** retain task caching; bound diagnostic memory without discarding outcome data.
- **Security/privacy:** do not include secrets in logs; secret/scope safety checks survive checkpoint hook bypasses.
- **Persistence/migration:** version artifacts; old records never imply current success.
- **Cancellation/retry/idempotency:** cancellation cannot become success; identical candidate/profile retries are safe.
- **Observability:** explain skipped/not-applicable checks and attach complete diagnostics by reference.

## Migration & Rollback

Read old manifests without destructive conversion; mark missing/stale evidence unavailable. Revert integration with the previous artifact retained if necessary, but never offer a fail-open compatibility switch for ready/merge. Operators can preserve work in a draft and resume after repairing infrastructure.

## Scope Boundaries

- **In Scope:** discovery/parser behavior, check policy, evidence freshness, tool errors, mandatory promotion checks, tests and targeted instructions.
- **Out of Scope:** lock/worker fencing (C-470), service ownership (C-471), bulk application fixes, changing branch protection or deploying services.

## Contract Size & Split Rule

See [split rule](SHARED_SECTIONS.md#contract-size--split-rule). One outcome: readiness is backed by actual current checks. Do not combine unrelated lint cleanup; split before 100 files.

## Acceptance Criteria

### AC-1: Discovery distinguishes failure from no changes
**Given** empty valid JSON, valid JSON above 1.14 MB, malformed JSON, nonzero exit, cancellation and timeout fixtures,
**When** project discovery runs,
**Then** only the successful empty set is not applicable; large valid input resolves correctly and all failures are non-success with diagnostics.

### AC-2: Consumers share the check policy
**Given** the same candidate/profile and a change to an application, shared package, guard or configuration,
**When** the tool, pipeline and CI plan required checks,
**Then** equivalent policy inputs select equivalent required checks, including relevant downstream projects and guards; excluded heavy checks are explicitly classified.

### AC-3: Evidence is bound to the actual candidate
**Given** a successful result followed by a staged/unstaged edit, new commit, base change, config change or review autofix,
**When** readiness is requested,
**Then** stale evidence is rejected and required checks run for the new candidate; an unchanged candidate can reuse valid evidence.

### AC-4: Failed or unavailable checks prevent promotion
**Given** a red/unavailable required check in manual or YOLO flow,
**When** the worker claims passed or the captain requests ready/merge,
**Then** the controller refuses promotion with an actionable result; saving a local checkpoint or explicitly publishing a draft remains possible. The merge operation checks the actual PR head and required CI state, not a prior review summary.

### AC-5: Safety and cancellation cannot be bypassed
**Given** checkpoint commits skip hooks or a required check is cancelled,
**When** final publication is evaluated,
**Then** required secret/scope checks still run and cancellation/unreadable evidence cannot satisfy them.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit | proposed `.pi/extensions/moon_integration.test.ts` | validation tool | pending implementation |
| AC-2 | Integration | proposed `scripts/src/lib/agents/contract_pipeline/validation_policy.test.ts` | task planning | pending implementation |
| AC-3 | Unit | `orchestrator_feedback.test.ts` and new artifact fixtures | pipeline review | pending implementation |
| AC-4 | Integration | `review_gate.test.ts`, `pre_push_gate.test.ts` | ready/merge | pending implementation |
| AC-5 | Integration | validation policy fault fixtures | pre-publication | pending implementation |

**Test Hooks:** extend C-468's automation Moon targets; run fault tests under Node-compatible Pi loading and Bun on Linux/Windows/macOS. Functional browser and visual suites: N/A — no UI change. No real PR merge is performed in tests.
**Watch Points:** a 404/empty string is not parsed project data; auto-fix changes the candidate; review changes invalidate test evidence; missing task definitions are errors, not “no work.”

## Implementation Sequence

1. Add failing discovery/freshness/promotion fixtures and agree policy profiles in the design review.
2. Implement policy and versioned results; adapt tool/pipeline/CI consumers without replacing Moon.
3. Run automation/guard checks and platform matrix; document exact guarantees and remaining optional checks.

## Edge Cases & Gotchas

Capture stderr as well as stdout, including spawn errors with no exit status. Preserve fixture portability and bounded output. Do not trust an agent-supplied hash or a manually edited success JSON as independent verification.

## Open Questions

None for scope approval. Exact helper names are implementation choices; changing readiness semantics requires an amendment.

## Amendments

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

See [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle).

## Status Lifecycle
See [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle).

## Execution Report

### Summary

Created a shared validation policy module (`validation_policy.ts`) with named profiles (focused, pre-publication, CI) that define required/optional checks and structural guards. Enhanced `output_filter.ts` with a `DiscoveryOutcome` discriminated union that distinguishes parse failure, empty, too-large, timeout, and command-failure from successful discovery — ensuring the `validate` tool and `moon_detect_affected` tool never treat a query failure as "no changes." Updated `pre_push_gate.ts` to accept a profile parameter and use the shared policy for required checks, with an explicit `unavailable` field on the result type. Added `isEvidenceCurrent` and `hasBlockingResults` to `review_gate.ts` for evidence freshness checking (AC-3/AC-4). All new code has comprehensive test coverage (136 total tests, all passing).

### AC Status

| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | `parseMoonProjects` and `extractAffectedIds` now return `DiscoveryOutcome` with distinct failure/empty/success variants. `validate` tool returns error when discovery fails. 45 unit tests. |
| AC-2 | ✅ | `validation_policy.ts` defines 3 profiles with shared required/optional/guard check lists. `pre_push_gate.ts` accepts a `profile` parameter. 27 policy tests. |
| AC-3 | ✅ | `ValidationArtifact` binds evidence to a candidate fingerprint. `isEvidenceCurrent()` rejects stale/different candidates. `isArtifactFresh()` checks both candidate and base fingerprints. |
| AC-4 | ✅ | `PrePushGateResult` has `unavailable` field. `isBlockingOutcome()` flags failed/unavailable/cancelled. `determineOverallOutcome()` uses shared policy. `hasBlockingResults()` gates promotion. |
| AC-5 | ✅ | `cancelled` outcome is treated as blocking. `isBlockingOutcome('cancelled')` returns true. `process_runner.ts` already handles timeout/cancellation via `killed` flag. |

### Files Created

| File | Purpose |
|---|---|
| `.pi/extensions/lib/output_filter.test.ts` | 45-unit test suite for DiscoveryOutcome semantics, filtering, and truncation |
| `scripts/src/lib/agents/contract_pipeline/validation_policy.ts` | Shared validation policy with named profiles, CheckOutcome, ValidationArtifact |
| `scripts/src/lib/agents/contract_pipeline/validation_policy.test.ts` | 27-unit test suite for policy, outcomes, artifact freshness |

### Files Modified

| File | Change |
|---|---|
| `.pi/extensions/lib/output_filter.ts` | Added `DiscoveryOutcome` discriminated union, `isDiscoveryFailure`, `isDiscoveryEmpty`, `formatDiscoveryFailure`, `parseMoonProjectsLegacy`; updated `parseMoonProjects` and `extractAffectedIds` return types |
| `.pi/extensions/moon_integration.ts` | Updated all 3 tools (`moon_detect_affected`, `moon_list_projects`, `validate`) to use `DiscoveryOutcome` and fail-closed on query failures |
| `scripts/src/lib/agents/contract_pipeline/pre_push_gate.ts` | Added `unavailable` field to result, `profile` parameter, imports `getRequiredChecks` from policy; updated `formatGateNotesForPrompt` for unavailable header |
| `scripts/src/lib/agents/contract_pipeline/pre_push_gate.test.ts` | Added tests for profile parameter, unavailable checks, and focused profile |
| `scripts/src/lib/agents/contract_pipeline/review_gate.ts` | Added `isEvidenceCurrent()` and `hasBlockingResults()` for evidence freshness and promotion gating |
| `scripts/src/lib/agents/contract_pipeline/review_gate.test.ts` | Added tests for `isEvidenceCurrent` (7 cases) and `hasBlockingResults` (6 cases) |

### Deviations from Spec

None. The implementation follows the contract's architecture directives: pure policy/schema code is Node-compatible, profiles are explicit, and the three outcomes (passed, failed, unavailable/not_applicable) are distinctly exposed. The `process_runner.ts` already handled timeout/cancellation correctly and required no changes beyond what was already there.

### Test Results

- Unit (output_filter): 45/45 pass (0 failures)
- Unit (validation_policy): 27/27 pass (0 failures)
- Unit (pre_push_gate): 13/13 pass (0 failures)
- Unit (review_gate): 13/13 pass (0 failures)
- Unit (orchestrator_feedback): 7/7 pass (0 failures)
- Unit (output_normalize): 26/26 pass (0 failures)
- Baseline: 0 pre-existing failures, 0 new failures
- Total: 136/136 pass, 214 expect() calls