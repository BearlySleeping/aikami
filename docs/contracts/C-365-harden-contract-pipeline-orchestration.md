# Contract C-365: Harden Contract Pipeline Orchestration

## Metadata

| Field | Value |
|---|---|
| **Source** | User-approved architecture review — 2026-07-11 |
| **Target** | `scripts/src/lib/agents/contract_pipeline*`, `scripts/src/lib/herdr/`, `.pi/extensions/`, and `.pi/prompts/` — deterministic contract-worker orchestration |
| **Priority** | P0 — the current pipeline allowed the writer role to implement C-313 and cannot safely enforce stage ownership |
| **Dependencies** | `@earendil-works/pi-coding-agent`, Herdr CLI, `scripts/src/lib/ops/parse_backlog.ts`, `docs/contracts/TEMPLATE.md` |
| **Status** | verified |
| **Promotion** | `integrated` |
| **Docs Impact** | internal — no user-facing documentation page |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: `bun run contract C-313` launched a writer Pi session that implemented the feature, wrote tests, set the contract to `implemented`, and appended an Execution Report instead of stopping after contract authoring. The orchestrator subsequently marked only the writer stage as blocked and presented the implementation to review.
- **Reproduction**: run `bun run contract C-XXX` from the current pipeline, inspect the writer session input and `.pi/contract-runs/<run-id>/manifest.json`, then compare source changes with the writer role boundary. The C-313 run recorded `write_contract: BLOCKED` while source and test files were created by that session.
- **Existing implementation to reuse**: `scripts/src/lib/agents/contract_pipeline.ts`, `scripts/src/lib/agents/step_executor.ts`, `scripts/src/lib/herdr/session.ts`, `.pi/prompts/contract-create.md`, `.pi/prompts/contract-critique.md`, `.pi/prompts/contract.md`, `.pi/prompts/contract-verify.md`, and the atomic handoff/role-guard concepts in `examples/old/aikami/.pi/extensions/swarm_handoff.ts` and `swarm_guard.ts`.
- **Known gaps**: synthetic slash commands are not deterministically expanded; terminal scrollback regexes can match prompt examples; workers have unrestricted tools; critique and verification feedback is not persisted in full; manifests and locks are non-atomic; foreground launch duplicates initialization; review Pi consumes progress updates as tasks; production tests copy parser logic instead of importing it.
- **Baseline tests**: `scripts/src/lib/agents/contract_pipeline.test.ts` covers copied parser/transition logic but is not connected to production exports or a Moon test task. `scripts:typecheck` passes. The C-313 run is the required regression fixture.

## User Outcome

After this contract, a developer can run `bun run contract C-XXX`, observe each isolated stage in Herdr, resume interrupted runs, and trust that a writer or verifier cannot silently perform another role's source mutations.

## Success Measures

- **Time/latency target**: deterministic pipeline overhead outside model work stays below 5 seconds per stage; stage polling reacts within 2 seconds of a completion artifact.
- **Offline/degraded behavior**: if Pi, Herdr, or a model is unavailable, the run becomes `blocked` with a durable reason and resumable stage instead of advancing.
- **Production journey enabled**: TODO-backed contract generation → writer/critic loop → implementation/verification loop → one final interactive review session, with no automatic commit or push.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Canonical TODO parsing | `scripts/src/lib/ops/parse_backlog.ts` | reuse |
| Contract prompt content | `.pi/prompts/contract-*.md`, `.pi/prompts/contract.md` | modify and load directly |
| Herdr process control | `scripts/src/lib/herdr/session.ts` | extract/reuse shared CLI client |
| Bounded state transitions | `scripts/src/lib/agents/step_executor.ts` | reuse concept in a smaller contract-specific state machine |
| Atomic handoffs | `examples/old/aikami/.pi/extensions/swarm_handoff.ts` | reimplement as run-local validated stage results |
| Role tool guards | `examples/old/aikami/.pi/extensions/swarm_guard.ts` | reimplement for contract roles |
| Old scratchpad/director | `agent_scratchpad.ts`, `swarm_director.ts` | do not reuse for the serial pipeline |
| Review and Git scripts | `.pi/swarm/scripts/review_gate.ts`, `git_commit.ts` | replace; no automatic Git operations |

## Overview

Replace transcript-regex orchestration with a deterministic, run-local state machine. Worker Pi processes receive directly loaded role prompts, restricted tool sets, and a validated completion tool that writes atomic stage results. Herdr remains the visible process surface, while one interactive review Pi is created only after independent verification.

## Design Reference

- Pi structured completion: `.pi/node_modules/@earendil-works/pi-coding-agent/examples/extensions/structured-output.ts`.
- Pi tool-call guards: `.pi/node_modules/@earendil-works/pi-coding-agent/examples/extensions/protected-paths.ts`.
- Headless isolated agents: `.pi/node_modules/@earendil-works/pi-coding-agent/examples/extensions/subagent/index.ts`.
- Herdr control rules: `.pi/generated-skills/herdr/SKILL.md`.
- Atomic handoff reference: `examples/old/aikami/.pi/extensions/swarm_handoff.ts`.

For testing: this is internal Bun/TypeScript orchestration. Playwright and the Bun Visual Runner are N/A because no client route or visual surface is introduced.

## Architecture Directives

- Keep `scripts/src/lib/agents/contract_pipeline.ts` as a thin CLI entry point.
- Move state, manifest, prompt, stage, and postcondition logic into focused snake_case modules under `scripts/src/lib/agents/contract_pipeline/`.
- Use the Herdr CLI through one shared adapter; do not add another private socket-protocol consumer.
- Load canonical prompt files directly and expand arguments in code. Never send `/contract-*` as the machine protocol.
- Use run-local files under ignored `.pi/contract-runs/<run-id>/`; do not use global `.pi/swarm/outputs` or SQLite scratchpad state.
- Validate stage results at runtime and write via temporary file plus atomic rename.
- Restrict worker tools by role and add deterministic postconditions against a pre-stage Git snapshot.
- Never invoke `git add`, `git commit`, `git push`, deployment, or production data operations.
- Start review Pi only at the final review stage. Progress belongs in `pipeline.log` and the Herdr pipeline tab.
- Any source/test/config change after verifier PASS invalidates the verification fingerprint and requires a fresh verifier pass.

## State & Data Models

```typescript
type ContractPipelineStage =
  | 'prepare'
  | 'write_contract'
  | 'critique'
  | 'implement'
  | 'verify'
  | 'review'
  | 'accepted'
  | 'blocked';

type ContractStageResult = {
  runId: string;
  stage: 'writer' | 'critic' | 'implementer' | 'verifier';
  attempt: number;
  status: 'passed' | 'changes_requested' | 'blocked' | 'failed';
  summary: string;
  findings: string[];
  filesTouched: string[];
  evidence: string[];
  contractHash: string;
  diffHash: string;
};

type ContractReviewDecision = {
  runId: string;
  decision: 'approve' | 'changes_applied' | 'reject' | 'blocked';
  summary: string;
  diffHash: string;
};
```

These types are script-local orchestration shapes and do not cross application-package boundaries, so they remain in the scripts project rather than shared domain packages.

## Quality Requirements

- **Offline/degraded mode**: failed Herdr/Pi/model startup writes a blocked manifest state with retry instructions.
- **Accessibility/input**: N/A — no application UI; final interaction uses the existing Pi/Herdr terminal UI.
- **Performance budget**: completion detection within 2 seconds; no 10-second polling loop; no idle review model turns.
- **Security/privacy**: role tool allowlists; block Git writes and unauthorized file mutations; no secrets copied into run artifacts.
- **Persistence/migration**: existing `.pi/contract-runs` manifests are treated as legacy and reported as non-resumable unless they satisfy the new schema.
- **Cancellation/retry/idempotency**: atomic lock acquisition, run-scoped attempt IDs, stale result rejection, bounded writer/critic and implementer/verifier loops.
- **Observability**: structured manifest, per-stage result files, pipeline log, pane IDs, model usage and exact blocked reason.

## Migration & Rollback

- **Old data compatibility**: legacy manifests remain readable for status display but are not trusted for stage completion.
- **Migration**: new runs use the v3 manifest version and run-local `stages/` results. Existing ignored run directories require no rewrite.
- **Rollback**: restore the prior thin entry file and keep new run directories ignored; no persistent application state is changed.
- **Feature flag or kill switch**: `AIKAMI_CONTRACT_PIPELINE_V3=0` may retain a temporary legacy entry during migration, but the final implementation should default to v3.
- **Failure recovery**: preserve the current stage and error; `--resume <run-id>` reruns only the incomplete attempt after validating the contract and baseline.

## Scope Boundaries

- **In Scope:**
  - deterministic C-XXX/path resolution using canonical backlog parsing;
  - modular state machine and atomic manifest/lock storage;
  - direct prompt loading and worker wrapper;
  - structured completion/review-decision Pi extension;
  - role tool restrictions and stage postconditions;
  - final-only interactive review and verification invalidation;
  - production-linked unit/integration tests and Moon test task;
  - removal of tracked historical `.pi/swarm/outputs` and `.pi/swarm/plans` artifacts if safe.
- **Out of Scope:**
  - application `/dev/` routes or browser dashboard;
  - concurrent contracts or distributed workers;
  - automatic commit, push, merge, deployment, or production data access;
  - refactoring unrelated `scope_explorer`, `sandbox_scaffolder`, or `skill_optimizer` utilities;
  - changing game/client functionality from C-313;
  - deleting the entire old swarm implementation before v3 proves parity.

## Contract Size & Split Rule

This contract affects the scripts project and project-local Pi resources. It has five acceptance criteria and one independently releasable goal. Full deletion of the legacy swarm is deferred until v3 is verified.

## Acceptance Criteria

### AC-1: Direct Prompt Delivery and Structured Completion
**Given** a pipeline stage is launched
**When** the worker Pi starts
**Then** the orchestrator loads the exact canonical role prompt directly, does not submit a slash command, and advances only after a schema-valid run/stage/attempt result artifact is atomically written.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Integration | `scripts/src/lib/agents/contract_pipeline/stage_runner.test.ts` | `bun run contract C-XXX --dry-run` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon_run_task scripts:test`
- Integration: fake worker receives expanded writer prompt and writes a validated result; prompt examples and terminal output cannot complete the stage.
- E2E / Visual:
    - **Functional**: N/A — internal CLI integration test.
    - **Visual**: N/A.

**Watch Points**:
- Prompt frontmatter and `$ARGUMENTS` expansion must remain valid for manual slash use and automated direct loading.

### AC-2: Role Boundaries Reject Writer Overreach
**Given** a clean pre-stage snapshot and writer or critic role
**When** the worker attempts to change source, tests, configuration, Git state, or any path outside its allowed contract artifact
**Then** the tool call is blocked where possible, postconditions reject any bypass, the pipeline does not advance, and exact unauthorized paths are recorded.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Integration | `scripts/src/lib/agents/contract_pipeline/postconditions.test.ts` | C-313 writer regression fixture | Filled during verification |

**Test Hooks**:
- Moon Task: `moon_run_task scripts:test`
- Integration: simulate a writer producing source files and an implementation report; assert blocked state and no critic transition.
- E2E / Visual:
    - **Functional**: N/A — internal CLI integration test.
    - **Visual**: N/A.

**Watch Points**:
- The blocked/timeout branch must still execute postconditions; it may not bypass cleanup or scope reporting.

### AC-3: Atomic State, Locking, Resume, and Feedback
**Given** concurrent starts, an interrupted stage, stale artifacts, or a changes-requested verdict
**When** the orchestrator acquires state, resumes, or loops
**Then** exactly one process owns the contract lock, manifests remain valid JSON, stale results are ignored, resume targets the recorded contract/stage, and full critique/verification findings are passed to the next attempt.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Unit + Integration | `scripts/src/lib/agents/contract_pipeline/manifest_store.test.ts`, `state_machine.test.ts` | `bun run contract --resume <run-id>` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon_run_task scripts:test`
- Integration: race two lock acquisitions; corrupt/interupt manifest write; resume each non-terminal stage; verify exact feedback artifact is supplied.
- E2E / Visual:
    - **Functional**: N/A — internal CLI integration test.
    - **Visual**: N/A.

**Watch Points**:
- Foreground attach must not create a second manifest or restart review/worker sessions.

### AC-4: Final Review Is Interactive and Verification-Safe
**Given** a verifier PASS with a stored diff fingerprint
**When** the pipeline enters review
**Then** it starts one review Pi session with the review prompt exactly once and no earlier progress turns; approval succeeds only if the fingerprint remains current, while reviewer code changes require a new verifier pass before approval.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Integration | `scripts/src/lib/agents/contract_pipeline/review_gate.test.ts` | Herdr `review` tab | Filled during verification |

**Test Hooks**:
- Moon Task: `moon_run_task scripts:test`
- Integration: assert no review worker before PASS; simulate review edit, rejected approval, re-verification, then accepted approval.
- E2E / Visual:
    - **Functional**: N/A — internal Herdr adapter test.
    - **Visual**: N/A.

**Watch Points**:
- Reviewer never directly commands worker panes; it writes a validated decision consumed by the orchestrator.

### AC-5: Production Tests and Token Observability
**Given** the pipeline modules and worker event stream
**When** scripts tests run
**Then** tests import production state/parser functions, cover the C-313 regression plus timeout/blocked/resume cases, and the manifest records per-stage model, turns, input/output/cache tokens, and cost without storing full model transcripts.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | Unit + Integration | `scripts/src/lib/agents/contract_pipeline/*.test.ts`, `scripts/moon.yml` | `moon_run_task scripts:test` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon_run_task scripts:test`
- Integration: JSON worker event fixture aggregates usage and truncates diagnostic output; tests fail if they duplicate production transition logic.
- E2E / Visual:
    - **Functional**: N/A — internal test suite.
    - **Visual**: N/A.

**Watch Points**:
- Do not count cached tokens as uncached input; do not persist sensitive prompt or tool payloads in metrics.

## Implementation Sequence

1. **Phase 1 (Data/Logic)**: extract production types, state machine, atomic manifest/lock store, prompt loader, and canonical contract resolution.
2. **Phase 2 (Integration)**: add Herdr adapter/worker wrapper, structured completion extension, role restrictions, postconditions, feedback loops, and final review lifecycle.
3. **Phase 3 (Validation)**: wire `scripts:test`, run regression/integration tests, `scripts:fix`, `scripts:typecheck`, contract lint, and affected validation.

## Edge Cases & Gotchas

- **Prompt examples spoof completion**: result artifacts, not terminal text, are authoritative.
- **Writer returns an implementation report**: scope postconditions block before any transition.
- **Blocked worker**: preserve findings and pane diagnostics; do not reinterpret it as success.
- **Dirty worktree**: fail preflight with exact unrelated files unless resuming the same recorded baseline.
- **Stale run workspace**: workspace label includes run ID; never reuse a prior run's worker/review tabs.
- **Review changes contract ACs**: route to critique, not only verification.
- **Herdr IDs**: treat returned IDs as opaque; never construct `<workspace>:1`.
- **Raw description input**: unsupported in unattended mode unless all decisions are supplied; C-XXX/path remains the stable entry.

## Open Questions

None. User explicitly requested creation and implementation of this contract without adding a TODO.md item.

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
| `—` | Internal orchestration change not yet verified. | None |
| `sandbox` | N/A for this internal CLI contract. | N/A |
| `integrated` | Real `bun run contract` dry-run and resume flows pass using Herdr adapter integration tests. | Production CLI path + integration tests |
| `release_verified` | All ACs independently verified, including a controlled real contract run. | Verified ACs + no regressions |

## Status Lifecycle

```
draft → approved → in_progress → implemented → verified → completed
                                      ↘ verification_failed → implemented
approved → blocked
approved → superseded
```

Rules:
- `implemented`: implementation and connected tests are ready for independent verification.
- `verified`: every mandatory AC passed against production modules and the C-313 regression.
- `completed`: merged and CI passed; set manually after merge.
- Any mandatory AC marked ⚠️ or ❌ prevents `verified` and `completed`.
- Scope changes not recorded in Amendments prevent `verified`.

## Execution Report

### Summary
Replaced the active 1,895-line transcript-regex pipeline with a thin v3 CLI, modular orchestrator, run-specific Herdr adapter, headless Pi worker, atomic structured stage results, content-aware Git postconditions, and project-local completion/review tools. The legacy pipeline remains available only through `AIKAMI_CONTRACT_PIPELINE_V3=0`; v3 is the default for `bun run contract`. Prompt lifecycle contradictions were corrected, final review now starts only after verifier PASS, and generated knowledge dashboards are left to the existing pre-commit hook instead of being redundantly regenerated by automated workers.

### AC Status
| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | Active CLI loads canonical prompts directly, workers finish only through `contract_stage_complete`, exact run/role/attempt artifacts are validated, and terminal completion spoofing is ignored. |
| AC-2 | ✅ | Role-specific tool guards plus content-hash snapshots block writer, critic, and verifier source mutations. The C-313 writer-overreach regression covers added, modified, and deleted paths. |
| AC-3 | ✅ | Lock creation uses exclusive file creation; manifests/results use atomic rename; run IDs scope attempts; stale results are rejected; resume starts at the recorded stage; complete critic findings reach the next writer. |
| AC-4 | ✅ | Review Pi is created once at final review, approval requires the verified content fingerprint, code edits route to verification, and contract edits route back through critique. |
| AC-5 | ✅ | Production modules are imported by connected tests; worker JSON events populate per-stage model/token/cost usage without persisting transcripts; `scripts:test` is a Moon task. |

### Files Created
| File | Purpose |
|---|---|
| `.pi/extensions/contract_pipeline.ts` | Structured completion/review tools and deterministic role mutation guards. |
| `scripts/src/lib/agents/contract_generator.ts` | Restores the root `contract:generate` command through the canonical resolver. |
| `scripts/src/lib/agents/contract_pipeline_legacy.ts` | Temporary opt-out implementation behind `AIKAMI_CONTRACT_PIPELINE_V3=0`. |
| `scripts/src/lib/agents/contract_pipeline/*.ts` | Resolver, status, Git state, Herdr adapter, manifest, orchestrator, postconditions, prompts, review gate, results, runner, state machine, types, worker, and connected tests. |

### Files Modified
| File | Change |
|---|---|
| `scripts/src/lib/agents/contract_pipeline.ts` | Replaced legacy implementation with the v3 CLI/background launcher and production orchestrator entry. |
| `scripts/moon.yml` | Added the cached `scripts:test` task. |
| `scripts/package.json` | Added the `bun test` package script. |
| `.pi/prompts/contract-create.md` | Allows critique-driven contract revision while retaining writer-only scope. |
| `.pi/prompts/contract-critique.md` | Aligns automated critic approval with `bun run contract` authorization. |
| `.pi/prompts/contract.md` | Assigns knowledge sync to the existing pre-commit hook for automated runs. |
| `.pi/prompts/contract-review-captain.md` | Uses `.pi/contract-runs`, structured review decisions, and orchestrator-owned re-verification. |
| `.pi/skills/contract-implementer/SKILL.md` | Documents non-redundant knowledge-sync ownership. |
| `docs/contracts/C-365-harden-contract-pipeline-orchestration.md` | Corrected implementation evidence and advanced through independent verification. |

### Files Removed
| File | Reason |
|---|---|
| `scripts/src/lib/agents/contract_pipeline.test.ts` | Disconnected tests copied legacy parser/state logic instead of importing production modules. |

### Deviations from Spec
- A live model-driven Herdr run was not launched against the dirty verification worktree because it could autonomously mutate the implementation under review. The production CLI dry-run and a full fake-adapter orchestration test cover the entry point, all worker transitions, final-only review, feedback, usage, and resume. The first real contract run should remain monitored.
- Legacy swarm deletion remains out of scope. The former active pipeline is retained as an explicit environment-variable fallback until v3 has completed a monitored real run.

### Test Results
- Focused pipeline: 27/27 PASS across 7 files.
- Full scripts suite: 67/67 PASS across 11 files.
- Typecheck: `scripts:typecheck` PASS; `pi:typecheck` PASS.
- Affected validation: 4/4 PASS (`scripts`, `pi`).
- Contract lint: 0 errors, 0 warnings.
- Production CLI: `bun run contract docs/contracts/C-365-harden-contract-pipeline-orchestration.md --dry-run --allow-dirty` PASS; resolved C-365 and start stage `verify` without starting Herdr/Pi.
- E2E/visual: N/A — internal terminal orchestration, no browser surface.

## Verification Verdict: PASS

### AC Evidence
| AC | Status | Evidence | Notes |
|---|---|---|---|
| AC-1 | ✅ | `stage_runner.test.ts`, dry-run CLI | Direct prompt delivery and exact structured artifact completion verified. |
| AC-2 | ✅ | `postconditions.test.ts`, Pi extension typecheck | Writer-overreach, existing-file modification, deletion, critic, verifier, and implementer boundaries verified. |
| AC-3 | ✅ | `manifest_store.test.ts`, `state_machine.test.ts`, `orchestrator.test.ts` | Atomic state, stale lock/result rejection, bounded loops, feedback, and recorded-stage resume verified. |
| AC-4 | ✅ | `review_gate.test.ts`, `orchestrator.test.ts` | One final review, content fingerprint invalidation, and critique-vs-verify routing verified. |
| AC-5 | ✅ | Full scripts tests, worker usage aggregation, Moon task | Production imports and usage schema verified; disconnected legacy tests removed. |

### Structural Issues
None remaining. The active root command imports and executes the v3 orchestrator; Herdr and Pi integration are no longer deferred.

### Quality Gaps
- First full model-driven run remains a monitored rollout step because verification intentionally avoided an autonomous worker against the implementation worktree.
- Knowledge dashboards are intentionally not regenerated now; `.moon/workspace.yml` runs and stages `bun knowledge:sync` during pre-commit.

### Baseline Tests
Pre-existing failures: 0
New failures: 0
→ CLEAN

### Verdict
PASS — all mandatory ACs are implemented and connected to the production command, all focused/full tests and affected validation pass, and no automatic Git or deployment operation was introduced.
