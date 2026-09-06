---
id: C-494
title: "Prove the text vertical slice on production mounts"
source: "Split of the AI setup execution plan; queue row T01"
contract_type: thin
status: approved
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-09-06T03:20:00Z"
---

# Contract C-494: Text vertical-slice checkpoint

## Metadata

| Field | Value |
|---|---|
| **Source** | [AI setup execution plan](../plans/ai-setup/README.md); queue row T01 |
| **Target** | Existing production `/capability` and `/settings` mounts wired to the new services |
| **Type** | thin |
| **Priority** | P1 — proves the configuration and runtime lanes actually meet |
| **Dependencies** | C-493 |
| **Status** | approved |
| **Promotion** | `integrated` |
| **Docs Impact** | internal → none |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: the configuration lane (C-485 through C-488) and the runtime lane (C-489 through C-493) are proven separately, largely against fixtures.
- **Reproduction**: no single test today drives an existing production route end to end against a packaged native text engine.
- **Existing implementation to reuse**: the existing production UI, unchanged — this contract wires it to the new services rather than redesigning it.
- **Known gaps**: mocks do not prove packaging; offline reopen is unproven.
- **Baseline tests**: full client suite plus E2E; record actual failures before starting.

## User Outcome

After this contract, a player can complete text setup on a real build — using an existing server, an online provider, or a packaged native engine — and reopen the app offline with that configuration intact.

## Scope Boundaries

- **In Scope:** wiring existing production mounts to the new services and proving four journeys: existing server, online provider, packaged native text, and offline reopen.
- **Out of Scope:** UI redesign (C-495 onward), image and read-aloud journeys (C-497), and any new capability.

## Acceptance Criteria

### AC-1: Existing server journey works on a production route
**Given** a reachable external text server
**When** the player configures it through the existing production route
**Then** it verifies, persists and generates, with the external process untouched.

**Verification**: production-route E2E against a controlled server fixture.

### AC-2: Online provider journey works
**Given** a cloud provider key
**When** the player configures it
**Then** key validation succeeds without paid generation, and a subsequent request resolves through the canonical snapshot.

**Verification**: recorded-transport E2E; no paid generation during setup.

### AC-3: Packaged native text is proven, not mocked
**Given** a packaged desktop build
**When** the managed native text engine is installed and started
**Then** it generates real text, and the evidence comes from the packaged runtime rather than a mocked Tauri global.

**Verification**: packaged-build run with captured evidence; a mocked global is explicitly not acceptable.

### AC-4: Offline reopen retains configuration
**Given** a configured app and no network
**When** it is reopened
**Then** it boots, retains its configuration and remains usable without any cloud call or sign-in.

**Verification**: offline reopen E2E asserting zero network dependencies on boot.

## Edge Cases & Gotchas

- **Freeze the baseline**: this checkpoint's evidence is only valid on the code baseline it ran against; do not reuse it after unrelated merges.
- **Independent check**: the plan asks for an independent verifier at this checkpoint to confirm packaged-runtime evidence.

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)
