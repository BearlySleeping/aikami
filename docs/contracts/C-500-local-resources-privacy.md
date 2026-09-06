---
id: C-500
title: "Present local resources and data privacy with honest ownership"
source: "Split of C-484 into PR-sized contracts; AI setup execution plan queue row S03"
contract_type: thin
status: approved
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-09-06T03:20:00Z"
---

# Contract C-500: Local resources and data/privacy presentation

## Metadata

| Field | Value |
|---|---|
| **Source** | [C-484](C-484-capability-first-settings.md) AC-5 and AC-6; queue row S03 |
| **Target** | Settings Local resources and Data/privacy pages |
| **Type** | thin |
| **Priority** | P1 — the surface where ownership mistakes are destructive |
| **Dependencies** | C-499, C-493 |
| **Status** | approved |
| **Promotion** | — |
| **Docs Impact** | user-facing → settings/AI guidance in `apps/frontend/docs/src/content/docs/` |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: there is no surface distinguishing assets this app installed from external services the player runs themselves.
- **Reproduction**: connect an external Ollama and look for a disconnect action that is clearly non-destructive.
- **Existing implementation to reuse**: C-491's durable jobs and C-492's ownership facts.
- **Known gaps**: no disk, status or repair presentation for owned assets; web action filtering is undefined.
- **Baseline tests**: settings suite.

## User Outcome

After this contract, a player manages what the app installed — disk use, start, stop, repair, removal — while their own external servers are never deleted or stopped by the app.

## Scope Boundaries

- **In Scope:** Local resources presentation for owned jobs and assets; non-destructive connection management for external services; browser and native action filtering; Data/privacy explanation of online usage and credential protection.
- **Out of Scope:** installer executors and lifecycle implementation (C-491, C-492), account deletion redesign, and new native image installers.

## Acceptance Criteria

### AC-1: Owned assets expose real job state
**Given** managed assets in running, stopped, downloading and failed states
**When** Local resources opens
**Then** each shows download, status, disk, start/stop, repair and removal actions derived from C-491's durable state.

**Verification**: fixtures per state asserting presentation derives from job state, not local component memory.

### AC-2: Disconnecting an external service is never destructive
**Given** an external service the player installed themselves
**When** they disconnect it
**Then** only the app's connection is removed — no delete, stop or reconfigure reaches that service.

**Verification**: non-destructive disconnect tests asserting zero lifecycle calls.

### AC-3: Web hides native controls but keeps browser assets
**Given** a browser host
**When** Local resources opens
**Then** native and Docker controls are absent while supported browser asset management remains.

**Verification**: browser and native action matrix.

### AC-4: Data and privacy stay explicit
**Given** configured online providers
**When** Data/privacy opens
**Then** it explains what is sent online and how credentials are protected, with no credential exposed in the UI.

**Verification**: presentation tests asserting no secret rendering and accurate online-usage statements.

## Edge Cases & Gotchas

- **Ready is not running**: a stopped owned engine can be ready-to-start without being Running; process state comes from runtime observation.
- **Unknown ownership**: unknown legacy ownership defaults to external, which means the non-destructive path.

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)
