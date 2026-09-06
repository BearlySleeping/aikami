---
id: C-490
title: "Share one model catalog across native and container planning"
source: "Split of C-482 into PR-sized contracts; AI setup execution plan queue row R02"
contract_type: thin
status: approved
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-09-06T03:20:00Z"
---

# Contract C-490: Shared catalog and native-vs-container planning

## Metadata

| Field | Value |
|---|---|
| **Source** | [C-482](C-482-managed-ai-runtime-lifecycle.md) shared catalog/planning; queue row R02 |
| **Target** | `packages/shared/constants/` catalog definitions and the client local-AI planning service |
| **Type** | thin |
| **Priority** | P1 — a divergent catalog produces a worse plan on native than on Docker |
| **Dependencies** | C-489, C-485 |
| **Status** | approved |
| **Promotion** | — |
| **Docs Impact** | internal → none |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: native and container paths plan from separate notions of what is installable, so a native plan can silently offer less than the Docker path.
- **Reproduction**: compare the model set and budgets used by the local-AI wizard's native plan against the local-stack container topology.
- **Existing implementation to reuse**: existing manifest and hardware detection in the local-AI wizard; the local-stack topology definitions.
- **Known gaps**: licenses and resource budgets are not expressed uniformly; compatibility is not derived from one catalog.
- **Baseline tests**: local-AI wizard tests and local-stack tests.

## User Outcome

After this contract, a player is offered the same honest set of compatible models with the same resource and license information whether their machine will run a native engine or a container.

## Scope Boundaries

- **In Scope:** one shared catalog describing artifacts, checksums, sizes, licenses and resource budgets; a planner that selects compatible models per host from that catalog.
- **Out of Scope:** durable job execution (C-491), process lifecycle (C-492), provisioning integration (C-493), new image sidecars and automatic Docker installation.

## Acceptance Criteria

### AC-1: One catalog, two plans, no downgrade
**Given** a host that can run either native or container execution
**When** a plan is produced for each
**Then** both read the same catalog and the native plan is never a silent downgrade of the container plan.

**Verification**: fixture hosts producing both plans; explicit assertion comparing offered model sets.

### AC-2: Budgets and licenses are compatible and shown
**Given** a machine with known RAM, VRAM and disk
**When** models are proposed
**Then** each candidate carries its resource budget and license, and candidates exceeding the budget are excluded or clearly marked rather than silently offered.

**Verification**: insufficient-resource and marginal-resource fixtures; license presence asserted per candidate.

### AC-3: Recommended is resource-aware, not largest
**Given** several compatible models
**When** one is recommended
**Then** the recommendation reflects compatibility and available resources, never simply the largest downloadable model or a paid provider chosen without consent.

**Verification**: ranking tests across host profiles.

## Edge Cases & Gotchas

- **Unknown facts**: locality, execution kind and ownership are independent and may be unknown. Unknown legacy ownership defaults to external.
- **Catalog integrity**: catalog entries carry the pinned checksum and size that C-489 verifies against — the two must not drift.

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)
