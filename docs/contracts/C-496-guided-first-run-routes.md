---
id: C-496
title: "Guide first run through recommended, existing and text-only routes"
source: "Split of C-483 into PR-sized contracts; AI setup execution plan queue row U02"
contract_type: thin
status: approved
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-09-06T03:20:00Z"
---

# Contract C-496: Guided first-run routes and resumable presentation

## Metadata

| Field | Value |
|---|---|
| **Source** | [C-483](C-483-guided-ai-setup.md) AC-1, AC-3, AC-4, AC-5; queue row U02 |
| **Target** | `apps/frontend/client/src/lib/views/capability/` and the `/setup` route |
| **Type** | thin |
| **Priority** | P1 — this is the first-run experience |
| **Dependencies** | C-495 |
| **Status** | approved |
| **Promotion** | — |
| **Docs Impact** | user-facing → short first-run guidance in `apps/frontend/docs/src/content/docs/` |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: `capability_view.svelte` presents fixed Text/Image/Voice tabs plus a separate text-only wizard, so users choose infrastructure before understanding outcomes.
- **Reproduction**: open `/capability` as a new guest and observe that the first decision is a provider tab.
- **Existing implementation to reuse**: C-495's focused components; C-491's durable jobs for resume.
- **Known gaps**: no recommended path, no honest reuse offer, no resumable presentation.
- **Baseline tests**: capability tests and the existing `/capability` → `/setup` E2E.

## User Outcome

After this contract, a new player picks Recommended, connects something they already run, or takes a text-only shortcut, and can leave and come back without losing progress.

## Scope Boundaries

- **In Scope:** the three entry points sharing one flow; consented discovery and reuse; plan review with costs, licenses and consent; back, leave and resume backed by durable job state.
- **Out of Scope:** optional image and read-aloud integration (C-497), settings navigation (C-498), new persistence schemas, and automatic Docker installation.

## Acceptance Criteria

### AC-1: Three entry points, one flow, no probes on mount
**Given** a new guest opening `/capability`
**When** the page mounts
**Then** Recommended is primary, Connect existing secondary and text-only available, all using the same components, and no sign-in, hardware probe, network scan or AI request happens on mount.

**Verification**: production-route POM E2E for all three paths with network and IPC spies asserting zero calls on mount.

### AC-2: Discovery is explicit and never mutates
**Given** running compatible and incompatible local services
**When** the player explicitly scans
**Then** findings distinguish service from model compatibility, reuse is offered without mutating the service, manual URL entry stays available after permission or timeout failure, and finding a server never installs a model.

**Verification**: controlled fixtures for mixed sources, empty model list, permission denied and retry.

### AC-3: Consent precedes cost
**Given** a proposed plan
**When** it is reviewed
**Then** required downloads, bytes, storage, licenses, resource warnings and any online-data or paid-test implication are shown before action, and back or edit retains prior choices.

**Verification**: insufficient-resource and existing-model fixtures; assert no download or paid generation before explicit confirmation.

### AC-4: Leave, return and resume reflect real work
**Given** a setup job in progress
**When** the player navigates away, returns or reopens the app
**Then** presentation reflects durable job state and Cancel reaches real cancellation.

**Verification**: C-491-backed leave, reopen, cancel, error and retry journey.

## Edge Cases & Gotchas

- **Honest readiness**: a previously verified but now unreachable endpoint is not permanently Ready, and a saved key is not Ready. Reachability, model and generation are reported separately.
- **Platform**: browser users never see native or Docker install actions, while supported browser and server paths remain available.

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)
