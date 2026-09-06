---
id: C-495
title: "Extract reusable setup subflows and their presentation models"
source: "Split of C-483 into PR-sized contracts; AI setup execution plan queue row U01"
contract_type: thin
status: approved
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-09-06T03:20:00Z"
---

# Contract C-495: Reusable setup subflows and presentation models

## Metadata

| Field | Value |
|---|---|
| **Source** | [C-483](C-483-guided-ai-setup.md) AC-1 and AC-2; queue row U01 |
| **Target** | `apps/frontend/client/src/lib/views/` focused setup components and their ViewModels |
| **Type** | thin |
| **Priority** | P1 — both onboarding and settings depend on these components |
| **Dependencies** | C-487 (the shared setup operations these components call), C-494 (checkpoint gate) |
| **Status** | approved |
| **Promotion** | — |
| **Docs Impact** | internal → none |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: reusing the connection editor means mounting the whole AI settings ViewModel, which carries status board, provider tree, roles drawer and modality panels.
- **Reproduction**: inspect `ai_settings_view_model.svelte.ts` — the editor draft state is entangled with every other settings concern.
- **Existing implementation to reuse**: C-487's setup operations; the existing editor markup.
- **Known gaps**: no focused ViewModel exists that a non-settings route can mount.
- **Baseline tests**: `ai_settings_view_model.test.ts` and capability tests.

## User Outcome

After this contract, a player gets the same connection setup experience in onboarding and in settings, because both mount the same focused components rather than one screen imitating the other.

## Scope Boundaries

- **In Scope:** focused setup components and their presentation models, calling C-487's shared services; the existing settings screen migrated onto them.
- **Out of Scope:** guided routes (C-496), optional modalities (C-497), settings navigation (C-498), new persistence, and provider or runtime logic.

## Acceptance Criteria

### AC-1: Focused components mount without the settings ViewModel
**Given** a non-settings route
**When** it needs connection setup
**Then** it mounts the focused components and their ViewModels alone, with no dependency on the AI settings ViewModel.

**Verification**: a test route mounts the components; assert the settings ViewModel is never constructed.

### AC-2: Views stay logicless and services stay shared
**Given** the focused components
**When** they render
**Then** every displayed value comes from its ViewModel, and all endpoint validation, credential reuse, discovery and verification go through C-487's services.

**Verification**: MVVM guard passes; service call assertions from the components.

### AC-3: The existing settings screen uses them
**Given** the migrated settings screen
**When** a player adds, edits or tests a connection
**Then** behavior is unchanged from before the extraction.

**Verification**: existing settings tests pass unmodified in intent; regression assertions on add, edit, test and delete.

## Edge Cases & Gotchas

- **Ownership**: this contract owns the shared setup components. C-498 must not edit them; later changes are serialized through this contract's owner.
- **Transient drafts**: unsaved sensitive form drafts remain transient — no new onboarding persistence system.

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)
