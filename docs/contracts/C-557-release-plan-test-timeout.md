---
id: C-557
title: "Release-plan test timeout chore"
source: "direct"
contract_type: thin
status: implemented
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-09-24T19:07:22+02:00"
---

# Contract C-557: Release-plan test timeout chore

## Metadata

| Field | Value |
|---|---|
| **Source** | Direct request: eliminate recurring `emberwatch:release --plan` CLI-test timeouts under `scripts:test` load. |
| **Target** | `scripts/src/lib/ops/__tests__/emberwatch_release_cli.test.ts`; read-only injection seams in `emberwatch_release.ts` and `emberwatch_release_cli.ts`. |
| **Type** | thin |
| **Priority** | P1 — recurring full-suite failures make the default scripts test lane unreliable. |
| **Dependencies** | Existing release-plane seam and catalog release-graph fixtures. |
| **Status** | implemented |
| **Promotion** | — |
| **Docs Impact** | internal → contract and execution report only. |
| **Contract version** | 1.0.0 |
| **Production Surface** | `tooling: bun run emberwatch:release --mode staging|production --plan`; CLI behavior is unchanged. |

## Problem & Baseline Evidence

`scripts/src/lib/ops/__tests__/emberwatch_release_cli.test.ts` deliberately spawned the real release CLI ten times. Each plan case launched Bun, ran two read-only preflight subprocesses, ran the coverage-audit subprocess, re-derived the candidate lock, and read the live published release pointer plus base-release graph. The suite therefore inherited remote latency and CPU contention.

Measured on the fresh C-557 worktree before source edits:

- Focused Moon test: `18.585s` wall, 10 pass, slowest case `4.273s`.
- Full `scripts:test`: `52.139s` wall; release case `staging does NOT require a staging approval` timed out at `5.011s` under Bun's default 5s limit. Ten additional pre-existing failures came from missing generated local game-data artifacts in the fresh worktree.
- A diagnostic successful staging plan spent only `20ms` on brief rebase, `12ms` on prop-table check, and `17ms` on coverage audit. The remaining multi-second latency was the repeated HTTP release-pointer/base-graph reads, not `--build-candidate` or a full content build.

C-557 was unused before creation.

## User Outcome

A developer can run the complete scripts test lane repeatedly under load without `emberwatch:release --plan` falling back to Bun's implicit five-second timeout, while the CLI-path tests remain real subprocess tests.

## Success Measures

- Focused release CLI suite completes in roughly two seconds instead of roughly nineteen seconds.
- Plan tests use a prepared local release graph and isolated release plane; no test performs live release-graph HTTP reads or rewrites the tracked coverage report.
- Every real-CLI test has an explicit, bounded 30-second timeout documenting the measured pre-fix duration.
- Three forced full-suite runs are green.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Isolated release artifacts | `RELEASE_PLANE_ENV` in `emberwatch_release_io.ts` | reuse and extend report capture. |
| Hash-consistent release graph | `catalog/__tests__/release_graph_fixture.ts` | reuse in CLI test setup. |
| Candidate verification | `buildCandidateLock()` / `verifyCandidate()` | preserve; build prepared parent lock once. |
| Live plan reads | `readReleasePointer()` / `buildPlanPhases({ reader })` | preserve for production; inject prepared reader only for isolated `--plan`. |

## Overview

C-557 removes network timing from release CLI tests without weakening the release target or staging-approval gates. The suite prepares a valid prior release graph once, reuses one candidate lock, and points the real CLI subprocesses at those isolated fixtures. Production `--plan` still reads the live origin by default; `--apply` can never consume the fixture seam.

## Architecture Directives

- Test-only release graph injection requires both the existing release-plane isolation variable and an explicit snapshot variable.
- Snapshot injection is honored only for read-only `--plan`; apply always resolves the live graph.
- The release-plane seam also redirects the coverage audit's generated report so tests do not mutate tracked documentation.
- Real subprocess coverage and non-zero exit-code assertions remain.

## Scope Boundaries

- **In Scope:** release CLI test setup/timing, read-only plan injection seam, coverage report redirection, contract evidence.
- **Out of Scope:** Emberwatch content, map builders, atlas painters, client views, release gates, production publication, R2 writes, guard policy.

## Acceptance Criteria

### AC-1: Remove nondeterministic remote latency

**Given** the real release CLI path and a loaded scripts test process
**When** the focused release CLI suite runs
**Then** it completes without Bun's five-second default timeout and no test reads the live published release graph.

**Verification**: focused `scripts:test` timing before/after; temporary diagnostic output; forced full-suite runs.

### AC-2: Preserve fail-closed release behavior

**Given** prepared staging and production release graphs
**When** plan subprocesses run
**Then** the canonical target gate, candidate verification, coverage audit, and staging-receipt checks still execute; apply cannot use the prepared graph seam.

**Verification:** existing ten CLI-path tests and scripts typecheck/lint.

### AC-3: Full scripts lane is repeatable

**Given** generated local Emberwatch game-data prerequisites
**When** `scripts:test` runs three times with Moon caching disabled
**Then** each run reports 2,169 pass, 0 fail.

**Verification:** recorded forced Moon runs.

## Migration & Rollback

N/A — no persistent state changes. Rollback removes the test fixture and optional read-only plan reader seam.

## Contract Size & Split Rule

One test/injection-seam chore. Production release behavior is unchanged.

## Implementation Sequence

1. Measure focused/full baseline and identify latency source.
2. Prepare candidate and release graph once; redirect audit report through the isolated plane.
3. Add explicit subprocess timeout and run repeatability/validation checks.
4. Record evidence and hand off.

## Edge Cases & Gotchas

- `scripts:test` is intentionally local-only (`runInCI: false`); this harness exports `CI=true`, so verification unsets that ambient variable.
- A cached green Moon run does not prove repeatability; report uses `--force` timings.
- Fresh worktrees need local generated game-data prerequisites before the pre-existing real-pack tests can pass; generation is environment setup, not part of this diff.

## Amendments

| Version | Date | Change | Approved by |
|---|---|---|---|
| 1.0.0 | 2026-09-24 | Initial direct contract | user (direct prompt) |

---

## Execution Report

### Summary

Root cause was repeated live release-graph HTTP latency inside real CLI subprocess tests, amplified by full-suite load. Candidate hashing and preflight subprocesses were not the dominant cost, and no full content build ran. The suite now prepares one candidate lock and one valid release graph per mode, injects them only into isolated read-only plan runs, redirects audit output, and gives subprocess tests an explicit measured timeout.

### AC Status

| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | Final focused suite: `18.585s` before, `2.459s` after; slowest case `4.273s` before, `0.233s` after. No live graph reads in plan tests. |
| AC-2 | ✅ | Canonical target/candidate/staging checks retained; snapshot requires plane isolation and is disabled for apply. |
| AC-3 | ✅ | Three recorded full runs: `38.910s`, `35.417s`, `36.755s`; each 2,169 pass / 0 fail. Two later runs used `--force`; an additional forced run in the same invocation also passed. |

### Files Modified

| File | Change |
|---|---|
| `scripts/src/lib/ops/__tests__/emberwatch_release_cli.test.ts` | Prepare candidate/release graph once, inject plan snapshots, avoid tracked audit writes, and set explicit subprocess timeout. |
| `scripts/src/lib/ops/emberwatch_release.ts` | Redirect audit report under isolated plane; add plan-only prepared graph reader/pointer seam. |
| `scripts/src/lib/ops/emberwatch_release_cli.ts` | Define documented read-only plan snapshot environment contract. |
| `docs/contracts/C-557-release-plan-test-timeout.md` | Contract and execution evidence. |

### Validation

- Focused `scripts:test`: 10 pass, 0 fail, `2.459s` wall.
- Full forced `scripts:test` runs: 2,169 pass, 0 fail each.
- `scripts:typecheck`: pass.
- `scripts:lint`: pass.
- `validate`: pass (fix + typecheck + structural guards; 3/3).
- `bun moon ci --base=origin/main`: pass (21 completed, 1 cached, 2 skipped; 1,118 automation-unit tests).

### Risks and Follow-ups

- Snapshot injection is a production-recognized test seam, constrained to read-only `--plan` and requiring `AIKAMI_RELEASE_PLANE`; apply always uses the live origin.
- Generated local game-data prerequisites were recreated in the isolated worktree for full-suite verification and are gitignored; no generated files are in the diff.
