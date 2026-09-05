---
id: C-472
title: "Make worker lifecycle testable and simplify Herdr transport"
source: direct
contract_type: full
status: approved
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: "https://github.com/BearlySleeping/aikami/pull/251"
  pr_number: 251
created_at: "2026-09-04T00:00:00Z"
---

# Contract C-472: Make worker lifecycle testable and simplify Herdr transport

## Metadata

| Field | Value |
|---|---|
| **Source** | Accepted agent-platform audit; PR 06 in [execution plan](../strategy/agent-platform-hardening.md) |
| **Target** | Pipeline orchestrator/stage runner/Herdr adapter and their deterministic tests |
| **Type** | full |
| **Priority** | P1 — control-flow recovery is under-tested and PTY workarounds obscure completion |
| **Dependencies** | C-469, C-470, C-471 |
| **Status** | approved |
| **Promotion** | — |
| **Docs Impact** | internal — lifecycle, capabilities and transport compatibility |
| **Contract version** | 2.0.0 |
| **Execution** | Claude Sonnet 5 / high; Opus/high design review; target 12–35 files, maximum 99 |

## Problem & Baseline Evidence

- **Current behavior:** `orchestrator.ts` is about 2,042 lines and `herdr_adapter.ts` about 1,482. Pure helpers are tested, but the assembled lifecycle lacks direct scenario coverage. Interactive task delivery uses raw PTY sends, delays and repeated Enter presses despite installed Herdr agent APIs.
- **Reproduction:** inspect `_sendTaskText`, `isWorkerActive` and `stage_runner.ts` relaunch branches. A relaunch can pass an empty/minimal prompt and overwrite its prompt artifact; process existence also conflates alive and working.
- **Reuse:** existing adapter interface, JSON-mode workers, review-composer protections, state-machine functions, guard settle windows and C-470 fencing.
- **Known gaps:** no deterministic complete-loop test; runtime result validation and cancellation need one controller-owned interpretation; role postconditions are a no-op.
- **Baseline tests:** C-468 tooling suites plus current stage/review/implement/orphan regression tests.

## User Outcome

A contract run can be cancelled, resumed or retried predictably without duplicate prompts, stale completion, lost instructions or interference with the user's review input.

## Success Measures

Every lifecycle scenario below runs with fake agents and injected time, without paid calls or multi-minute sleeps. Live transport smoke is separate and uses a named test session. Preserve all established incident regressions while reducing duplicated lifecycle logic.

## Existing System & Reuse Map

| Capability | Existing source | Action |
|---|---|---|
| Transitions | `state_machine.ts` | preserve pure core |
| Effects | `orchestrator.ts` | extract small injected boundaries |
| Worker/review I/O | `herdr_adapter.ts`, `stage_runner.ts` | consolidate |
| Review input safety | `review_pane.ts`, `review_gate.ts` | retain tests |
| Process execution | existing process wrappers and Node runtime boundary | reuse |

## Overview

Refactor behind scenario tests into a pure transition core and a small effectful controller. Prefer supported Herdr agent operations for interactive delivery and structured event/process completion for headless workers. This is not a new framework or a wholesale rewrite.

## Design Reference

Use `adapterFactory` and existing injectable runner seams. Preserve named incidents as regression cases; see [testing conventions](SHARED_SECTIONS.md#testing-conventions).

## Architecture Directives

Inject clock, process/Herdr transport, artifact store, Git and validation effects. Capture exact headless process exit and structured completion separately; neither an idle pane nor text containing “done” proves success. Distinguish working, waiting-for-user, blocked, exited and transport-unavailable states. A lost transport is not a dead worker.

Interactive delivery uses supported `agent start/prompt/wait` semantics after capability checks; do not type into approval dialogs or overwrite human composer text. If the installed Herdr cannot support the required operation, report an actionable compatibility error rather than silently reverting to arbitrary Enter storms. Keep ordinary shell service commands on the pane API.

Controller-only operations include manifest transitions and publication authorization. Define coarse role write/operation expectations with explicit artifact/scratch allowances. Remove misleading no-op postcondition claims; enforce high-value protected paths and sensitive actions at trusted boundaries without claiming arbitrary shell execution is sandboxed. Keep pure Node-compatible sharing; do not spawn Bun for every helper.

## State & Data Models

Use discriminated controller events/effects and C-470 generation identity. Persist only resumable run facts; derive presentation from them. Relaunch preserves the original role prompt, contract, feedback and effective configuration. Structured schemas reject malformed external/IPC results rather than accepting broad casts.

## Quality Requirements

- **Offline/degraded:** transport failures are explicit; local state remains inspectable.
- **Accessibility/input:** preserve interactive human input and approval boundaries.
- **Performance:** event/exit-driven headless completion; bounded backoff for unavailable external state.
- **Security/privacy:** no model authorization of its own merge/deploy; no routine root-checkout mutations by workers.
- **Persistence/migration:** legacy manifests remain readable through explicit adapters.
- **Cancellation/retry/idempotency:** bounded cleanup; exactly one logical transition per accepted result; safe retry of effects.
- **Observability:** event/effect records with run/stage/generation correlation and original failure reasons.

## Migration & Rollback

Introduce the controller seam behind current entrypoints and preserve CLI options. Keep old manifest fixtures. If rollout is reverted, quiesce new controllers and preserve owned workers/artifacts; do not run both implementations as simultaneous authorities. No automatic workspace deletion for an unsupported schema.

## Scope Boundaries

- **In Scope:** scenario harness, lifecycle control-flow extraction, structured delivery/completion, compatibility checks, narrow role/control boundaries and regression tests.
- **Out of Scope:** replacing Herdr/Pi/Moon, new scheduler, broad task concurrency, model routing (C-474), cost aggregation (C-473), upstream Herdr source changes.

## Contract Size & Split Rule

See [split rule](SHARED_SECTIONS.md#contract-size--split-rule). Tests lead extraction; do not move unrelated helpers merely to reduce line counts. If the tested behavioral change exceeds 99 files, propose a separate behavior-preserving extraction first.

## Acceptance Criteria

### AC-1: The complete loop is exercised without live agents
**Given** fake clock/transport/Git/store adapters,
**When** happy path, verifier bounce, failed validation, review change, reject and interrupted-resume scenarios run,
**Then** transitions/effects match the expected sequence and required gates cannot be skipped.

### AC-2: Recovery preserves task identity and instructions
**Given** crash, late completion, guard halt, duplicate event or process exit without result,
**When** recovery/relaunch runs,
**Then** fencing remains correct, original instructions and feedback survive, and missing completion produces a typed failure rather than a false pass.

### AC-3: Interactive transport respects user control
**Given** receptive, working, blocked and nonempty-composer fixtures,
**When** the captain/writer is started or retasked,
**Then** a task is submitted at most once when permitted; no approval is answered automatically and no human input is overwritten.

### AC-4: Cancellation and unavailable transport are distinct
**Given** an active worker, a disconnected Herdr transport or a cancelled run,
**When** supervision executes,
**Then** transport uncertainty cannot trigger duplicate workers, cancellation stops only owned work, and retries/time budgets are bounded and explainable.

### AC-5: Sensitive effects have trusted boundaries
**Given** a worker requests publication, edits protected policy or reports a forged success artifact,
**When** the controller evaluates the event,
**Then** generation/validation/capability checks reject unauthorized advancement while legitimate scratch/evidence writes remain allowed. Document that shell-capable workers are not an OS sandbox.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Integration | proposed `contract_pipeline/orchestrator.test.ts` | full run | pending implementation |
| AC-2 | Integration | `stage_runner.test.ts`, scenario fixtures | recovery | pending implementation |
| AC-3 | Unit/Integration | `review_pane.test.ts`, proposed `herdr_adapter.test.ts` | interactive agent | pending implementation |
| AC-4 | Integration | controller/transport fault fixtures | cancel/resume | pending implementation |
| AC-5 | Unit/Integration | proposed controller capability fixtures | sensitive effects | pending implementation |

**Test Hooks:** C-468 automation targets on three OS families. Add an opt-in Herdr smoke against a disposable named test session; never stop the user's server. Browser/visual: N/A. Required correctness suite uses no model tokens.
**Watch Points:** same logical attempt versus replacement generation; alive versus working; event delivery after cancellation; resumable review decisions; preservation of human input.

## Implementation Sequence

1. Build fake-adapter scenarios around the current loop and preserve incident tests.
2. Extract controller effects, integrate safe transport and preserve prompt/result identity.
3. Prove cancellation/resume and platform compatibility; document the supported minimum capabilities.

## Edge Cases & Gotchas

Handle paths with spaces/Unicode, CRLF, Windows shell/creation behavior and mixed Node/Bun entrypoints. No fixed sleep may serve as proof of command completion.

## Open Questions

None for scope approval. Minimum Herdr version/capabilities are measured during implementation and documented; no automatic upgrade is authorized.

## Amendments

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

See [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle).

## Status Lifecycle

See [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle).
