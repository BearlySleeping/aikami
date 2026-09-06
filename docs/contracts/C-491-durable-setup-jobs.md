---
id: C-491
title: "Make setup jobs durable, cancellable and restart-safe"
source: "Split of C-482 into PR-sized contracts; AI setup execution plan queue row R03"
contract_type: thin
status: approved
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-09-06T03:20:00Z"
---

# Contract C-491: Durable setup jobs, cancellation and restart recovery

## Metadata

| Field | Value |
|---|---|
| **Source** | [C-482](C-482-managed-ai-runtime-lifecycle.md) durable jobs; queue row R03 |
| **Target** | Client setup-job service and its Tauri-side transfer implementation |
| **Type** | thin |
| **Priority** | P1 — a cancel that does not stop the transfer is a broken promise |
| **Dependencies** | C-490 |
| **Status** | approved |
| **Promotion** | — |
| **Docs Impact** | internal → none |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: download progress lives in ViewModel state, so leaving the screen or reopening the app loses the job's real status.
- **Reproduction**: start a model download, navigate away and return; observe whether progress reflects the underlying transfer.
- **Existing implementation to reuse**: C-489's verified downloader; existing progress events.
- **Known gaps**: cancel does not provably stop the underlying transfer; a restart mid-download has no defined recovery; retry can corrupt an already-valid artifact.
- **Baseline tests**: local-AI wizard download tests.

## User Outcome

After this contract, a player can start a download, leave the screen, come back or even restart the app, and see the job's real state — and cancelling actually stops it.

## Scope Boundaries

- **In Scope:** durable job state outside the ViewModel; real cancellation reaching the underlying transfer; restart recovery; retry-safe resumption that never corrupts a valid artifact.
- **Out of Scope:** process lifecycle and ports (C-492), provisioning integration (C-493), and UI presentation of jobs (C-500).

## Acceptance Criteria

### AC-1: Job state survives navigation and restart
**Given** a running setup job
**When** the player navigates away and back, or restarts the app
**Then** the presented state derives from durable job state, not from ViewModel memory.

**Verification**: navigation and simulated-restart tests asserting state is read from the durable store.

### AC-2: Cancel stops the underlying transfer
**Given** an in-flight download
**When** the player cancels
**Then** the underlying transfer stops, partial output is not presented as ready, and the job records a cancelled terminal state.

**Verification**: transfer-level assertion that the request was aborted, not merely that the UI changed.

### AC-3: Retry and restart never corrupt a valid asset
**Given** a completed and verified artifact, and separately a partial one
**When** a retry or restart occurs
**Then** the valid artifact is left intact and the partial one is resumed or discarded safely, with verification re-anchored to the pinned checksum.

**Verification**: idempotence tests for both cases plus a crash-mid-write case.

## Edge Cases & Gotchas

- **Corrupted is never ready**: an interrupted or corrupted download must never be mistaken for a ready model — this is the failure the existing wizard already guards, and it must survive the move to durable jobs.
- **Ownership**: a job may only manage assets this app owns. Discovery of an external service never grants lifecycle control over it.

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)
