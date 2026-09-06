---
id: C-493
title: "Provision managed runtimes through the canonical setup operations"
source: "Split of C-482 into PR-sized contracts; AI setup execution plan queue row R05"
contract_type: thin
status: approved
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-09-06T03:20:00Z"
---

# Contract C-493: Provisioning through canonical setup operations

## Metadata

| Field | Value |
|---|---|
| **Source** | [C-482](C-482-managed-ai-runtime-lifecycle.md) provisioning integration; queue row R05 |
| **Target** | Client local-AI provisioning service and the C-487 setup operations |
| **Type** | thin |
| **Priority** | P1 — joins the runtime lane to the configuration lane |
| **Dependencies** | C-492, C-488 |
| **Status** | approved |
| **Promotion** | — |
| **Docs Impact** | internal → none |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: the install path and the configuration path are separate, so an installed engine is not necessarily registered as a usable connection through the same validated boundary.
- **Reproduction**: complete a local install and inspect whether the resulting connection was created through the canonical operations or a bespoke path.
- **Existing implementation to reuse**: C-487's setup operations, C-488's resolver, C-491's jobs and C-492's lifecycle.
- **Known gaps**: no end-to-end install → verify → persist → generate path; duplicate registration is possible.
- **Baseline tests**: local-AI wizard, config service and gateway tests.

## User Outcome

After this contract, a player can install a local engine and immediately use it for real text generation, with the connection saved once and resolvable like any other.

## Scope Boundaries

- **In Scope:** the install → verify → persist → real text request path expressed through the canonical operations; duplicate-registration prevention.
- **Out of Scope:** new engines or modalities, UI composition (C-495 onward), and the packaged-runtime checkpoint itself (C-494).

## Acceptance Criteria

### AC-1: Install completes into a usable canonical connection
**Given** a successful managed install
**When** provisioning finishes
**Then** the engine is verified through C-487's operations, persisted through the canonical transaction, and a real text request resolves and succeeds through C-488's resolver.

**Verification**: end-to-end test with a real local engine or an equivalently faithful harness; assert the request used the canonical snapshot.

### AC-2: No duplicate registration
**Given** an engine already registered
**When** provisioning runs again
**Then** the existing account and connection are reused rather than duplicated, and no second credential record is created.

**Verification**: repeat-provision tests asserting stable `providerId` and connection count.

### AC-3: Failure leaves nothing half-registered
**Given** a provisioning failure at download, verification or persistence
**When** it occurs
**Then** no partially registered connection is published and the previous state is retained.

**Verification**: fault injection at each stage.

## Edge Cases & Gotchas

- **Verified is scoped**: verification proves the tested endpoint and model, not that every model on the engine is ready.
- **Consent**: downloads, paid tests and privacy-affecting changes require explicit consent; there is no silent local-to-cloud fallback.

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)
