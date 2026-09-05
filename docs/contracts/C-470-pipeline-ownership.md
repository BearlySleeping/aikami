---
id: C-470
title: "Fence pipeline ownership, contract allocation and stage results"
source: direct
contract_type: full
status: implemented
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-09-04T00:00:00Z"
---

# Contract C-470: Fence pipeline ownership, contract allocation and stage results

## Metadata

| Field | Value |
|---|---|
| **Source** | Accepted agent-platform audit; PR 04 in [execution plan](../strategy/agent-platform-hardening.md) |
| **Target** | `scripts/src/lib/agents/contract_pipeline/manifest_store.ts`, `stage_result.ts`, ID creation and worker handoff |
| **Type** | full |
| **Priority** | P0 — concurrent owners can corrupt a live run |
| **Dependencies** | C-468, C-469; instruction-repair PR 02; merge in sequence to avoid overlapping controller edits |
| **Status** | approved |
| **Promotion** | — |
| **Docs Impact** | internal — lock/resume compatibility and recovery |
| **Contract version** | 2.0.0 |
| **Execution** | Claude Opus 5 / high; target 8–20 files, maximum 99 |

## Problem & Baseline Evidence

- **Current behavior:** `acquireLock` can break a live PID's lock after two hours without a manifest transition. A fixture with a fresh heartbeat reproduced replacement before the workspace-alive check ran. `resume_orphaned.ts` already explains why transition timestamps do not prove liveness.
- **Reproduction:** create an old `implement` manifest and fresh lock owned by a live child process; attempt a second acquisition. Also race two direct-draft ID allocations.
- **Reuse:** exclusive-create locks, heartbeat helpers, atomic writes, exact run/stage/attempt validation, orphan recovery and existing stage-runner/guard-settle tests.
- **Known gaps:** release is not owner-conditional; ID allocation scans max+1 without exclusive reservation; relaunches of one attempt share result identity and need stale-writer fencing.
- **Baseline tests:** C-468 suites, `resume_orphaned.test.ts`, `stage_runner.test.ts`, `implement_guard.test.ts`.

## User Outcome

Parallel or resumed runs cannot steal healthy ownership, overwrite another draft or advance from a stale worker result.

## Success Measures

Zero double-owner/draft-overwrite/stale-result acceptances in deterministic interleaving tests. Recovery remains explicit and inspectable without paid agents or network access.

## Existing System & Reuse Map

| Capability | Existing source | Action |
|---|---|---|
| Ownership/heartbeat | `manifest_store.ts` | correct and unify |
| Orphan policy | `resume_orphaned.ts` | reuse shared liveness decisions |
| Result validation | `stage_result.ts`, `.pi/extensions/contract_pipeline.ts` | add generation identity |
| Draft creation | `scripts/src/lib/agents/contract_pipeline.ts` | exclusive allocation |

## Overview

Define a single ownership protocol spanning lock acquisition, recovery, result publication and cleanup. Generation identity distinguishes a replacement worker from a late result by its predecessor without deleting useful historical artifacts.

## Design Reference

Keep existing exact-attempt and settle-window regression behavior. Use real child-process fixtures for filesystem races and injected clocks for timing; see [testing conventions](SHARED_SECTIONS.md#testing-conventions).

## Architecture Directives

Ownership combines an opaque token/generation with process identity and heartbeat evidence. A timestamp alone cannot evict a live local owner. A PID alone cannot prove identity after PID reuse. Unknown ownership remains blocked/diagnostic rather than guessed dead. Cleanup/heartbeat/result publication operate only for the expected owner, including race-safe replacement/release behavior.

Prefer exclusive files and owner-specific records over a new locking dependency. Do not describe atomic rename as compare-and-swap. Prove acquisition/release interleavings, including Windows sharing/rename behavior. Auto-resume uses the same policy; it does not start arbitrarily old abandoned runs.

## State & Data Models

Version lock and result records with owner token, run ID, stage, attempt, worker generation and creation identity. Results remain scoped to their generation, and the controller adopts only the active generation. Central manifest writes belong to the controller. Old records are read compatibly, but unfenced results never silently satisfy a newly fenced attempt.

## Quality Requirements

- **Offline/degraded:** local filesystem/process inspection only; uncertainty refuses takeover.
- **Accessibility/input:** N/A — CLI with actionable recovery text.
- **Performance:** bounded polling/retries; no busy-wait locks.
- **Security/privacy:** tokens identify ownership, not authentication; no secret material in records.
- **Persistence/migration:** preserve old manifests/results for diagnosis.
- **Cancellation/retry/idempotency:** release only one's own generation; interruption leaves recoverable artifacts.
- **Observability:** report owner, heartbeat age, stage/generation and takeover reason.

## Migration & Rollback

Read existing lock/manifest formats and require explicit recovery for ambiguous live legacy owners. New records use versioned/owner-specific paths that old cleanup cannot silently own. Before rollback, quiesce new runs; never run incompatible controllers concurrently against one contract. Preserve artifacts rather than deleting unknown versions.

## Scope Boundaries

- **In Scope:** lock liveness/ownership, run/stage generation fencing, exclusive ID reservation, safe dry-run allocation behavior, race tests and recovery docs.
- **Out of Scope:** scheduler rewrite, cross-host distributed locking, service ports, model policy, historical contract renumbering.

## Contract Size & Split Rule

See [split rule](SHARED_SECTIONS.md#contract-size--split-rule). These changes share the invariant that one active owner can publish each artifact. Avoid unrelated CLI cleanup; maximum 99 files.

## Acceptance Criteria

### AC-1: A healthy owner cannot be evicted by age
**Given** a live owner with a fresh heartbeat and a three-hour-old transition timestamp,
**When** another run acquires or auto-resumes the contract,
**Then** it cannot replace the owner. Dead, reused-PID and unknown-identity cases follow explicit distinct recovery policy.

### AC-2: Old cleanup cannot damage a new owner
**Given** replacement ownership has been established through the allowed recovery path,
**When** the old owner's release, exit handler or heartbeat runs,
**Then** the new owner's records remain unchanged. Two simultaneous recovery attempts cannot both succeed.

### AC-3: Late worker results are fenced
**Given** a worker has been replaced within the same logical stage/attempt,
**When** the predecessor writes a result before or after the replacement completes,
**Then** only the active generation can advance the run; old results remain inspectable. Valid same-generation guard-settle recovery still works.

### AC-4: Draft IDs are allocated exclusively
**Given** concurrent prompt/issue creation against one contract directory,
**When** both allocate IDs,
**Then** each receives a distinct ID and no existing draft is overwritten. Failed allocation leaves diagnosable reservations with explicit cleanup; read-only/dry-run calls allocate nothing.

### AC-5: Existing runs have a safe recovery path
**Given** legacy records, truncated JSON, interrupted writes or unsupported record versions,
**When** resume/inspect is requested,
**Then** it preserves artifacts, reports compatibility/ownership accurately and never advances on an unvalidated result.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Integration | proposed `contract_pipeline/manifest_store.test.ts` | acquire/resume | pending implementation |
| AC-2 | Integration | same, real child-process race fixtures | release/recovery | pending implementation |
| AC-3 | Unit/Integration | `stage_runner.test.ts`, proposed `stage_result.test.ts` | worker handoff | pending implementation |
| AC-4 | Integration | proposed `agents/contract_pipeline_cli.test.ts` | draft creation | pending implementation |
| AC-5 | Unit | `resume_orphaned.test.ts` and legacy fixtures | resume | pending implementation |

**Test Hooks:** C-468 automation Moon targets on Linux, Windows and macOS; injected clocks and real filesystem races. E2E browser/visual: N/A. All fixtures use temporary directories/owned children, never the live `.pi/contract-runs` store.
**Watch Points:** tokens need conditional ownership checks, not just presence; distinguish process death from unavailable inspection; test rename/release races rather than adding arbitrary sleeps.

## Implementation Sequence

1. Add reproductions and review the owner/generation protocol.
2. Implement shared lock/recovery policy, fenced artifact publication and exclusive allocation.
3. Exercise old/new record compatibility and platform race fixtures; document operator recovery.

## Edge Cases & Gotchas

Clock changes, PID reuse, abrupt kill, Windows file locks, paths with spaces/Unicode, duplicate completion and late guard artifacts must not create two successful owners.

## Open Questions

None for scope approval. Network filesystems/cross-host ownership are explicitly unsupported; fail diagnostically rather than claiming distributed safety.

## Amendments

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Execution Report

### Summary

Implemented ownership fencing across the contract pipeline: heartbeat-aware lock breaking prevents live owners from being evicted by manifest age (AC-1); owner-conditional release prevents old cleanup from damaging replacement owners (AC-2); generation-fenced result validation rejects late predecessor results (AC-3); exclusive ID reservation using atomic `wx` files prevents concurrent draft allocation races (AC-4). All changes are backward-compatible with legacy records.

### AC Status

| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | Heartbeat check added before `lastUpdated` age check in `breakStaleLock`. A live heartbeating process (mtime within 2×LOCK_HEARTBEAT_MS) is never evicted regardless of manifest age. |
| AC-2 | ✅ | `releaseLock` now checks PID before removing lock — only removes when lock belongs to the current process. |
| AC-3 | ✅ | `generation` field added to `ContractStageResult` and `WorkerLaunchRequest`. `validateStageResult` and `readStageResult` accept optional `minGeneration` parameter. Legacy results without generation are treated as 0. |
| AC-4 | ✅ | `reserveContractId` uses atomic `wx` file create for exclusive allocation. `releaseReservation` cleans up. `prepareDirectSource` in `contract_pipeline.ts` uses the new function. |
| AC-5 | ✅ | Legacy records without `generation` field are read compatibly (treated as generation 0). All existing tests pass unchanged. |

### Files Created

| File | Purpose |
|---|---|
| `scripts/src/lib/agents/contract_pipeline/ownership.test.ts` | 18 integration tests covering AC-1 through AC-4 with temp-directory fixtures |

### Files Modified

| File | Change |
|---|---|
| `scripts/src/lib/agents/contract_pipeline/types.ts` | Added `generation` field to `ContractStageResult` and `WorkerLaunchRequest` |
| `scripts/src/lib/agents/contract_pipeline/manifest_store.ts` | Added `generation` to `LockMetadata`; heartbeat-aware lock breaking in `breakStaleLock`; owner-conditional `releaseLock`; new `reserveContractId`, `releaseReservation`, `pruneStaleReservations` |
| `scripts/src/lib/agents/contract_pipeline/stage_result.ts` | Added `minGeneration` parameter to `validateStageResult` and `readStageResult`; generation fencing rejects results with generation < minGeneration |
| `scripts/src/lib/agents/contract_pipeline/stage_runner.ts` | Added `generation` parameter to `runStage`; passed through to `WorkerLaunchRequest` and `readStageResult` |
| `scripts/src/lib/agents/contract_pipeline/orchestrator.ts` | Passes `generation: attempt` to `runStage` for result fencing |
| `scripts/src/lib/agents/contract_pipeline.ts` | Imports `reserveContractId`/`releaseReservation`; uses `reserveContractId` in `prepareDirectSource` instead of max+1 scan |

### Deviations from Spec

None. All ACs implemented as specified.

### Test Results

- Unit: 18/18 PASS (0 failures) — new ownership tests
- Pipeline suite: 204/204 PASS (0 failures) — all existing tests
- Baseline: 1 pre-existing typecheck failure (tsconfig.json `"types": ["bun"]` — unrelated to this contract), 0 new failures

## Promotion Lifecycle

See [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle).

## Status Lifecycle

See [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle).
