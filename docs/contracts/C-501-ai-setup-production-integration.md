---
id: C-501
title: "Verify the whole AI setup programme on supported platforms"
source: "Split of the AI setup execution plan; queue row F01"
contract_type: thin
status: approved
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-09-06T03:20:00Z"
---

# Contract C-501: Production integration and supported-platform verification

## Metadata

| Field | Value |
|---|---|
| **Source** | [AI setup execution plan](../plans/ai-setup/README.md); queue row F01 |
| **Target** | Whole programme; docs and packaged journeys |
| **Type** | thin |
| **Priority** | P1 — the only contract that may claim the parents are delivered |
| **Dependencies** | C-497, C-500 |
| **Status** | approved |
| **Promotion** | — |
| **Docs Impact** | user-facing → setup and settings guidance in `apps/frontend/docs/src/content/docs/` |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: each slice proves its own acceptance criteria; nothing yet proves the parent contracts' acceptance matrices together on a frozen candidate.
- **Reproduction**: no single run today covers every parent AC across packaged platforms.
- **Existing implementation to reuse**: every preceding contract's evidence, valid only on this candidate baseline.
- **Known gaps**: cleanup of temporary compatibility shims; docs; platform coverage statements.
- **Baseline tests**: full suite plus E2E and packaged journeys.

## User Outcome

After this contract, a player on a supported platform can complete AI setup and play, and the project can honestly say the AI setup programme is delivered.

## Scope Boundaries

- **In Scope:** verifying every parent acceptance criterion on a frozen candidate, removing temporary shims, updating documentation, and stating which platforms are actually verified.
- **Out of Scope:** new features, new capabilities, and any redesign.

## Acceptance Criteria

### AC-1: Parent acceptance matrices pass together
**Given** the frozen candidate baseline
**When** the acceptance matrices of C-481, C-482, C-483 and C-484 are exercised
**Then** each criterion passes or is explicitly recorded as unverified with its reason.

**Verification**: an acceptance matrix mapping every parent AC to its evidence; an independent verifier reviews it.

### AC-2: No new failures and no leftover shims
**Given** the full suite and the candidate
**When** validation runs
**Then** there are no new failures against the recorded baseline and no temporary compatibility shims remain.

**Verification**: baseline comparison plus absence assertions for the shims C-486 introduced.

### AC-3: Docs and packaged journeys match reality
**Given** the shipped behavior
**When** documentation and packaged journeys are reviewed
**Then** setup and settings guidance matches what the build does, and unverified platforms are stated as unverified rather than implied.

**Verification**: docs review against packaged runs; explicit platform coverage statement.

## Edge Cases & Gotchas

- **Freeze the candidate**: queue unrelated implementation while this runs; another merge invalidates the evidence.
- **Honest reporting**: never mark a parent implemented because one queue row passed, and do not rewrite earlier execution reports to hide discovered failures.

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)
