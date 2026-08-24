---
id: C-438
title: "Restore PR Checks — a cheap, reliable CI gate for outside contributions"
source: "user request 2026-08-24 — open-source readiness; PR validation is currently disabled"
status: approved
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-08-24"
---

# Contract C-438: Restore PR Checks — a cheap, reliable CI gate for outside contributions

## Metadata

| Field | Value |
|---|---|
| **Source** | User request (2026-08-24). `pr-checks.yml` has been disabled behind a no-match branch filter; the repo is about to invite outside contributions with no automated PR signal. |
| **Target** | `.github/workflows/pr-checks.yml` and the `runInCI` surface across `.moon/tasks/all.yml` and per-project `moon.yml` files |
| **Priority** | **P0** — this is the one item that blocks accepting contributions at all. Every other DX improvement assumes a merged PR was validated by something. |
| **Dependencies** | None. Independent of C-436 and C-437. |
| **Status** | approved |
| **Promotion** | — |
| **Docs Impact** | internal — `docs/guides/CI_CD.md` and `.claude/CLAUDE.md` both carry a "PR checks are disabled / tracked as C-438" warning to remove. |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: `.github/workflows/pr-checks.yml` declares `branches: [_]`. In GitHub's filter syntax `[_]` is a character class matching only a literal `_`, so **no pull request ever triggers the workflow**. The file's own TODO says so explicitly and records the rationale: `moon ci` runs `:build` for affected projects and "the client build compiles Tauri (Rust + full app bundle), which is very expensive on GitHub Actions free credits."

- **The recorded rationale is partly inaccurate, which matters.** `apps/frontend/client/moon.yml`'s `build` task is `bun run build` → `bun scripts/gate_dev_routes.ts && vite build`. That is Vite only; **no Rust, no Tauri**. The Rust bundle lives in a *separate* task, `tauri-build` (`bun scripts/tauri_build.ts`), which declares no `runInCI: false` and therefore does run under `moon ci`. The expensive thing is one task, not the build graph — so the fix is narrower than the TODO assumes, and an implementer who takes the TODO at face value will over-engineer.

- **Tauri is not the only concern.** `apps/e2e/moon.yml` defines `test`, `test-client`, `test-game`, `test-release-gate`, visual-runner, and site-a11y tasks, none of which opt out of CI. Playwright suites need browsers and a running dev server — slow, and flaky under a cold cache. A naive re-enable trades "no signal" for "a red X nobody trusts", which is worse.

- **Reproduction**:
  1. Open any PR against `main` → no checks appear.
  2. `grep -n "branches" .github/workflows/pr-checks.yml` → `branches: [_]`.
  3. `grep -rn "runInCI" .moon/tasks/all.yml apps/*/*/moon.yml` → the expensive tasks are silent, i.e. defaulted to running.

- **Existing implementation to reuse**: the workflow body is already correct — checkout with `fetch-depth: 0`, pinned Bun, a combined Bun + Moon cache keyed on lockfile/moon/tsconfig hashes, `bun install --frozen-lockfile`, and `bun moon ci --base=origin/<base>` with `MOON_TOOLCHAIN_FORCE_GLOBALS=true`. Only the trigger and the task selection need changing.

- **Known gaps**: no path or label gating exists; no separate workflow for the expensive suites; a first-time contributor's PR requires maintainer approval to run workflows at all (GitHub default), which is worth confirming rather than discovering.

- **Baseline tests**: `bun moon run :validate` and `bun run test` locally, and a timed local `bun moon ci --base=origin/main` on a representative branch to establish what "cheap" actually costs.

## User Outcome

After this contract, an **outside contributor** opens a PR and gets a clear
pass/fail within a few minutes, covering lint, format, typecheck, and unit tests
for exactly the projects their diff affects — and a **maintainer** can trust that
signal enough to review on it.

## Success Measures

- **Time/latency target**: the default PR check completes in **under 10 minutes** on a warm cache for a typical single-package change, and under 20 on a cold cache. If it cannot, cut scope rather than accepting a slow default.
- **Offline/degraded behavior**: N/A — CI is inherently online. A cache miss must degrade to "slower", never to "failed".
- **Production journey enabled**: the repo can accept pull requests from people the maintainer does not know.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Workflow body | `.github/workflows/pr-checks.yml` steps | **reuse** unchanged |
| Trigger | `branches: [_]` | **replace** with a real branch filter |
| Shared task defaults | `.moon/tasks/all.yml` | **modify** — audit `runInCI` |
| Tauri build task | `apps/frontend/client/moon.yml` → `tauri-build` | **modify** — exclude from the default CI graph |
| E2E task set | `apps/e2e/moon.yml` | **modify** — exclude from the default CI graph |
| Setup action | `.github/actions/setup-environment/action.yml` | **reuse** if it fits; do not duplicate its steps inline |

## Overview

Re-enable PR validation with a deliberately cheap default: lint, format,
typecheck, and unit tests across affected projects. Move the expensive suites —
the Tauri desktop bundle and the Playwright E2E/visual runs — out of the default
graph and behind an explicit opt-in, so they can still be run on demand without
taxing every PR.

The workflow body is already right. This contract is about **task selection**,
and about being honest that a check nobody trusts is worse than no check.

## Design Reference

- `.moon/tasks/all.yml` — the shared task definitions and the `runInCI` flag that controls the `moon ci` graph.
- `apps/frontend/client/moon.yml` — `build` (Vite, cheap) versus `tauri-build` (Rust, expensive); the distinction this contract turns on.
- `.github/workflows/release.yml` — where the Tauri build legitimately belongs, and already runs.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- **`moon ci --affected` is the mechanism.** Do not hand-roll a list of projects or a path-filter matrix in YAML. Moon's affected-project detection already exists and already works; duplicating it in the workflow guarantees the two drift.
- **`runInCI` is the control surface.** Task inclusion is decided in `moon.yml` files, not by grepping in a shell step. A task that should not run on every PR says so where it is defined, next to a comment explaining why.
- **Cheap by default, expensive on request.** The default PR check must never build Rust or start a browser. Provide an explicit way to run the heavy suites on a PR that needs them — a label, a manual dispatch, or a separate workflow — and document which.
- **Fail loudly, never silently.** 🔴 The failure mode this contract exists to fix is a workflow that looks configured and does nothing. Whatever gating is chosen must be *visibly* skipped rather than silently inert. A no-match branch filter is exactly the anti-pattern to avoid repeating.
- **Do not weaken the gate to make it pass.** If a project currently fails lint or typecheck on `main`, fix the project. Excluding it from CI to get a green check reintroduces the problem in a quieter form.

## State & Data Models

N/A — no application state. Configuration only.

## Quality Requirements

- **Offline/degraded mode**: N/A.
- **Accessibility/input**: N/A.
- **Performance budget**: see Success Measures. Budget is the primary requirement here, not a secondary one.
- **Security/privacy**: 🔴 `pull_request` (not `pull_request_target`) must remain the trigger. `pull_request_target` runs with repository secrets in scope against untrusted fork code and would hand any contributor the repo's credentials. Do not switch triggers to work around a fork limitation.
- **Persistence/migration**: N/A.
- **Cancellation/retry/idempotency**: the existing `concurrency` group with `cancel-in-progress: true` is correct — keep it.
- **Observability**: a failed check must name the failing task and project in the job summary, not only in a collapsed log.

## Migration & Rollback

- **Old data compatibility**: N/A.
- **Migration**: none.
- **Rollback**: revert the workflow file. Note that reverting returns the repo to *no PR validation* — if the check proves too slow, the correct response is narrowing its scope, not disabling it again.
- **Feature flag or kill switch**: the branch filter itself.
- **Failure recovery**: if the re-enabled check turns out to be flaky, quarantine the specific flaky task out of the default graph and open a follow-up — do not disable the workflow wholesale.

## Scope Boundaries

- **In Scope:**
  - Restore a real branch filter on `pr-checks.yml`
  - Audit `runInCI` across `.moon/tasks/all.yml` and every project `moon.yml`; exclude `client:tauri-build` and the `apps/e2e` task set from the default CI graph, with comments explaining why
  - Provide and document an explicit opt-in path for the heavy suites
  - Verify the workflow actually runs against a fork PR, including the first-time-contributor approval behaviour
  - Remove the "PR checks are disabled" warnings from `docs/guides/CI_CD.md` and `.claude/CLAUDE.md`
  - Add the resulting check names to the branch protection settings, or state explicitly in the PR that this is a manual follow-up
- **Out of Scope:**
  - Any change to lint, format, or typecheck *rules*
  - Fixing pre-existing failures unrelated to CI configuration — report them, open follow-ups, do not silently exclude
  - The release workflow
  - Adding coverage reporting, required reviews, or merge queues

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** stays whole and should be small. If `bun moon ci` turns
out to surface many pre-existing failures, **do not** grow this contract to fix
them — land the CI configuration, and open a separate contract for the backlog it
reveals.

## Acceptance Criteria

### AC-1: PR checks actually run
**Given** a pull request targeting `main`
**When** it is opened or updated
**Then** the PR Checks workflow runs and reports a visible pass or fail — verified on a real PR, not by reading the YAML.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Manual | link to a PR showing the check | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: N/A
- Integration: open a throwaway PR with a one-line change and link the run
- E2E / Visual: N/A

**Watch Points**:
- 🔴 A YAML diff is **not** evidence for this AC. The bug being fixed is precisely a config that looks correct and does nothing. Only a workflow run link counts.
- Confirm the behaviour for a PR from a **fork**, which is what an outside contributor will open — including whether first-time contributors need maintainer approval to run workflows.

### AC-2: The default check is cheap
**Given** a PR touching a single package
**When** the check runs on a warm cache
**Then** it completes in under 10 minutes; no Rust toolchain is installed; no Playwright browser is downloaded or launched.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Manual | workflow timing + step log | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon ci --base=origin/main` locally, timed, for comparison
- Integration: grep the CI log for `cargo`, `rustc`, and `playwright install` — all must be absent
- E2E / Visual: N/A

**Watch Points**:
- A docs-only PR should do almost nothing. If it rebuilds the world, moon's affected detection is misconfigured — likely an over-broad `inputs` group — and that is worth fixing here.
- Report both cold- and warm-cache timings. A 10-minute warm run hiding a 40-minute cold run is not a pass.

### AC-3: Expensive suites are excluded deliberately and visibly
**Given** the moon task graph
**When** `bun moon ci` is resolved
**Then** `client:tauri-build` and the `apps/e2e` task set are absent from it, each excluded by an explicit `runInCI: false` carrying a comment that says why and where the task still runs.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Unit | `moon ci --dryRun` output showing the resolved task list | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon ci --base=origin/main --dryRun`
- Integration: assert the resolved list contains no `tauri-build` and no `e2e:*` task
- E2E / Visual: N/A

**Watch Points**:
- Excluding a task from CI without a comment guarantees someone re-enables it in six months and rediscovers this problem. The comment is part of the deliverable.
- `client:build` (Vite) **stays in CI** — it is cheap and catches real breakage. Only `tauri-build` leaves. Do not conflate the two, which is exactly the error the old TODO invites.

### AC-4: The heavy suites remain runnable on demand
**Given** a PR that genuinely needs desktop or E2E validation
**When** a maintainer opts in through the documented mechanism
**Then** those suites run against that PR and report their own status, without having slowed down any other PR.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Manual | link to an opt-in run | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: whatever the opt-in path invokes
- Integration: trigger it on a real PR and link the run
- E2E / Visual: N/A

**Watch Points**:
- Whichever mechanism is chosen — label, manual dispatch, or separate workflow — document it in `docs/guides/CI_CD.md`. An opt-in nobody can find is not an opt-in.
- If a label triggers it, note that labels applied by non-maintainers may not fire workflows as expected; verify rather than assume.

### AC-5: Documentation matches reality
**Given** a contributor reading about CI
**When** they open `docs/guides/CI_CD.md` or `.claude/CLAUDE.md`
**Then** neither still says PR checks are disabled; both describe what runs by default, what does not, and how to opt in.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | Manual | doc diff | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run :validate`
- Integration: `grep -rn "C-438" docs/ .claude/` returns only intentional history
- E2E / Visual: N/A

**Watch Points**:
- `CONTRIBUTING.md` tells contributors to run the gate locally before pushing. Keep that advice — it stays true and useful — but make sure it names the same commands CI runs.

## Implementation Sequence

1. **Phase 1 (Measure)**: run `bun moon ci --base=origin/main --dryRun` and record the resolved task list. This is the baseline every later decision references. Time a real local `moon ci`.
2. **Phase 2 (Exclude)**: set `runInCI: false` with explanatory comments on `client:tauri-build` and the `apps/e2e` tasks. Re-run the dry run and confirm the list shrank as intended.
3. **Phase 3 (Enable)**: restore `branches: [main]` (add `staging` if Open Question 3 resolves to include it). Open a throwaway PR and a fork PR; capture timings and run links.
4. **Phase 4 (Opt-in + docs)**: add the documented on-demand path for the heavy suites; update `docs/guides/CI_CD.md` and `.claude/CLAUDE.md`; note any branch-protection change needed.

## Edge Cases & Gotchas

- **`fetch-depth: 0` is load-bearing.** Moon diffs against the base branch; a shallow checkout silently makes *everything* look affected, which turns a cheap check into an expensive one. Do not "optimize" it away.
- **`MOON_TOOLCHAIN_FORCE_GLOBALS=true`** must stay exported, or moon downloads its own Bun alongside the installed one and the cache key stops meaning anything.
- **Cache key coverage.** The key hashes `bun.lock`, `moon.yml`, and `tsconfig.json`. A change to `.moon/tasks/all.yml` does *not* invalidate it — consider whether it should, and say so either way.
- **Fork PRs and secrets.** Workflows on fork PRs receive no repository secrets. If any task in the CI graph needs one, it will fail for exactly the contributors this contract exists to serve. Check before enabling, not after.
- **Pre-existing failures.** `main` may not be green under `moon ci` today. Find out in Phase 1. If it isn't, that is a separate contract — say so, don't absorb it.
- **Concurrency cancellation** is desirable on PRs and already configured. Leave it.

## Open Questions

Must be resolved before status becomes `approved`:

- Does `main` currently pass `bun moon ci` end to end? Phase 1 answers this, but the answer changes whether this contract can land alone.
- Which opt-in mechanism for the heavy suites — a `run-e2e` label, `workflow_dispatch`, or a separate workflow keyed on paths?
- Should `staging` be in the branch filter, or `main` only?

## Amendments

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

---
