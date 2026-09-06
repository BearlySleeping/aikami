---
id: C-480
title: "Evaluate agent quality and tune routing using cost per accepted task"
source: direct
contract_type: thin
status: approved
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-09-04T22:21:38Z"
---

# Contract C-480: Evaluate agent quality and tune routing using cost per accepted task

## Metadata

| Field | Value |
|---|---|
| **Source** | Accepted agent-platform audit; PR 14 in [execution plan](../strategy/agent-platform-hardening.md) |
| **Target** | Small agent evaluation fixtures/runner, reports and evidence-based routing recommendations |
| **Type** | thin |
| **Priority** | P2 — replace model/token-price assumptions with comparable observed outcomes |
| **Dependencies** | C-473, C-474, C-475, C-476, C-477, C-478, C-479 |
| **Status** | approved |
| **Promotion** | — |
| **Docs Impact** | internal — evaluation protocol, model routing and budget decisions |
| **Contract version** | 2.0.0 |
| **Execution** | Claude Sonnet 5 / medium; target 8–20 files, maximum 99 |

## Problem & Baseline Evidence

- **Current behavior:** executor assignments in the plan are risk-based hypotheses. Historical run manifests lacked usage; role labels did not imply different models. Token price alone cannot show whether a model's retries/review burden make it economical.
- **Reproduction:** inspect C-473 usage completeness and C-474 effective model/profile reports. Do not use the audit's historical manifest state counts as a controlled success-rate dataset.
- **Existing implementation to reuse:** C-473 ledger, C-474 profile/model resolution, C-469 validation, C-475 examples and C-472 fake controller/worktree isolation.
- **Known gaps:** no small versioned task set, fixed acceptance oracle, comparable run protocol or authorized paid-run cap.
- **Baseline tests:** deterministic ledger/profile/controller tests; paid evaluation is opt-in and not part of ordinary CI.

## User Outcome

The maintainer can choose model/thinking/routing settings from actual accepted outcomes, with visible uncertainty and a hard spending boundary.

## Scope Boundaries

- **In Scope:** 8–12 small versioned evaluation tasks spanning representative work, frozen acceptance checks, offline runner tests, explicit opt-in paid execution, reports and proposed routing/budget changes.
- **Out of Scope:** changing defaults without reviewed results, unlimited benchmark spending, a hosted leaderboard/platform, training models, copying proprietary tasks or modifying application production behavior.

## Acceptance Criteria

### AC-1: Tasks have independent, frozen acceptance checks
**Given** small fixtures covering instruction repair, pure TypeScript, validation/error handling, process concurrency, Svelte reactivity and cross-platform scripting,
**When** the runner prepares an evaluation,
**Then** it records task/base/acceptance/config hashes and evaluates the result against tests the worker cannot rewrite to improve its score. Include a held-out subset; no real user data or credentials enter fixtures.
**Verification**: proposed `scripts/src/lib/agents/evaluation/` runner/fixture tests, including a worker patch that tries to weaken its evaluator and must be rejected. Keep each task bounded enough to reset/replay cheaply.

### AC-2: Comparisons use equivalent conditions
**Given** configurations for Flash, Sonnet, Opus or Astra available in the installed catalogue,
**When** a comparison is requested,
**Then** each run starts from the same task state and declared tool/profile/environment policy, uses the supported effective thinking setting and records provider/model version. Missing models fail preflight; cached/warm and cold conditions are identified rather than mixed invisibly.
**Verification**: offline catalogue/configuration fixtures and reproducibility hashes. A default recommendation cannot rest on one cherry-picked run; the report records repetitions and labels insufficient evidence inconclusive.

### AC-3: Metrics include the whole cost of acceptance
**Given** successful, failed, retried, reviewed and externally evaluated attempts,
**When** results are summarized,
**Then** the report includes acceptance rate, first-pass acceptance, retries/tool failures, elapsed time, token/cache categories, total cost per accepted task and incomplete billing. Failed attempts contribute cost; unaccepted or incomplete groups cannot be represented as cheap successes.
**Verification**: C-473-backed report tests with exact expected totals, zero-acceptance groups, missing billing and external-review costs. Include outcome counts and sample size beside averages/percentiles.

### AC-4: Paid work requires explicit bounded authorization
**Given** no spending authorization,
**When** the runner or CI executes,
**Then** it performs only offline planning/fixture checks. Paid mode requires explicit model/task selection and positive run-wide cost, turn and elapsed-time caps, including retries and permitted delegates. Exhaustion cancels owned work and preserves partial results.
**Verification**: fake-provider budget/cancellation tests; no budget defaults to unlimited. Record authorization/caps in run metadata. Unknown billing prevents starting further paid attempts under a cap that cannot be enforced; it must not be treated as zero.

### AC-5: Routing changes are proposed, not self-applied
**Given** comparable measured results or insufficient evidence,
**When** the evaluation finishes,
**Then** it produces a concise recommendation for executor/thinking/escalation choices and uncertainty, without silently editing model defaults or budgets. A human reviews any subsequent configuration change; the executor cannot approve its own promotion rules.
**Verification**: report snapshots, read-only recommendation test and a documented bounded escalation policy. Preserve Flash as a valid candidate rather than assuming a higher-priced model always wins.

## Edge Cases & Gotchas

- Fix seeds/environment where possible, but do not pretend model output is deterministic. Report variance and failed attempts.
- Provider names supplied by a human are not executable model slugs. Resolve actual IDs/capabilities and preserve effective settings.
- Do not re-run the entire task on every review note. The evaluation must record any incremental retry policy so comparisons remain fair.
- C-480 implementation can be verified with fake providers. A real paid comparison and any resulting default change require separate explicit spend approval; no fabricated benchmark numbers belong in the implementation report.

## Amendments

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

See [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle).

## Status Lifecycle

See [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle).

## Execution Report

Implemented the offline evaluation harness under `scripts/src/lib/agents/evaluation/`. No paid comparison run was executed and no model/thinking/routing default was changed — both remain explicitly out of scope for this PR.

- **AC-1 (frozen tasks):** 8 versioned tasks in `tasks/*.ts` cover all six required categories (instruction repair, pure TypeScript, validation/error handling, process concurrency, Svelte reactivity, cross-platform scripting), 2 of them held out (`pure_typescript_v2`, `validation_error_handling_v2`). `task_registry.ts` hashes task/base/acceptance/config content. Each acceptance check runs from the host import graph, never from a file inside the sandbox — `acceptance_runner.test.ts` verifies a patch that plants a fake "acceptance" file inside the sandbox cannot make an unsolved task pass.
- **AC-2 (equivalent conditions):** `catalogue.ts` resolves Flash/Sonnet/Opus/Astra family labels against the installed provider catalogue via `pi auth check --json`, never treating a family label as a literal slug. A family with no valid candidate fails preflight (`catalogue.test.ts`); `EvalConfig` records provider/model/thinking/cache-condition per run.
- **AC-3 (whole cost of acceptance):** `reporter.ts` aggregates accepted/rejected/errored/halted attempts (reusing `aggregateUsage` from the C-473 ledger), reporting acceptance rate, first-pass rate, retries, tool failures, elapsed time, cost-per-accepted-task (`null`, never zero, when a group has no acceptances), unknown-billing counts and sample size beside every rate (`reporter.test.ts`).
- **AC-4 (bounded paid authorization):** `budget.ts`'s `RunBudget` refuses to record usage or start an attempt without explicit caps; exhaustion (cost, turns, minutes, or unknown billing) cancels further owned attempts while keeping already-recorded results (`budget.test.ts`, `runner.test.ts`). The CLI (`cli.ts`) requires `--paid` plus `--max-cost`/`--max-turns`/`--max-minutes`/`--tasks` together; the default is offline plan mode.
- **AC-5 (proposed, not self-applied):** `recommendation.ts` formats a per-task recommendation from an `EvalReport` and never writes any file (`recommendation.test.ts` snapshots this and confirms Flash wins when it is cheapest and comparable).

Deviations from the original module sketch, both to keep the harness testable without external dependencies:
- Per-attempt isolation (`worktree_fixture.ts`) uses a plain temp directory rather than a real `herdr`-provisioned git worktree — the herdr path requires a live daemon, which would make every offline test network/service-dependent. Evaluation tasks are small, self-contained file sets with no git-history dependency, so a disposable directory gives the same isolation guarantee.
- The runner spawns `pi` directly (`real_provider.ts`), parsing the same `message_end`/`message.usage` JSON-stream shape as the legacy `contract_pipeline/worker.ts` path, because the herdr-pane adapter (`herdr_adapter.ts`) has no usage parsing wired to it at all in this codebase.

**Verification:**
- `bun test scripts/src/lib/agents/evaluation` — 32 pass, 0 fail.
- `bun run test:automation-unit` (now includes `src/lib/agents/evaluation`) — 521 pass, 0 fail.
- `bunx tsgo --noEmit` in `scripts/` — clean.
- `bunx biome check` over the new files — clean.
- `bun run src/lib/agents/evaluation/cli.ts` (no flags) — ran plan mode only; catalogue preflight correctly reported the configured Flash candidates as `UNAVAILABLE` in this environment (no matching `pi auth check` credential), spent nothing, launched no provider.
- `--paid` mode was not run — no maintainer spend authorization was granted for this contract (Edge Cases).
