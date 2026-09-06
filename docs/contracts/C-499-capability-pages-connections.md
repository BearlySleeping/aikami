---
id: C-499
title: "Give each AI feature its own settings page with shared connection setup"
source: "Split of C-484 into PR-sized contracts; AI setup execution plan queue row S02"
contract_type: thin
status: approved
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-09-06T03:20:00Z"
---

# Contract C-499: Capability pages, connections and advanced routing

## Metadata

| Field | Value |
|---|---|
| **Source** | [C-484](C-484-capability-first-settings.md) AC-2, AC-3, AC-4; queue row S02 |
| **Target** | `apps/frontend/client/src/lib/views/settings/ai/` pages |
| **Type** | thin |
| **Priority** | P1 — replaces provider-tree-first configuration with user tasks |
| **Dependencies** | C-498, C-495 |
| **Status** | approved |
| **Promotion** | — |
| **Docs Impact** | user-facing → settings/AI guidance in `apps/frontend/docs/src/content/docs/` |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: `ai_settings_view.svelte` combines status, provider tree, roles and modality controls on one screen organized by provider rather than by what the player wants to change.
- **Reproduction**: try to change the model used for artwork and observe that the path runs through the provider tree.
- **Existing implementation to reuse**: C-495's setup subflows and C-488's routing; the honest per-connection status established by the P03 work.
- **Known gaps**: no per-feature page; deletion and default changes do not explain their effects.
- **Baseline tests**: `ai_settings_view_model.test.ts` and settings E2E.

## User Outcome

After this contract, a player changes the AI used for a feature from that feature's own page, manages an account once rather than per model, and is told what a deletion will affect before it happens.

## Scope Boundaries

- **In Scope:** an AI overview plus Story/dialogue, Artwork and Read-aloud pages; a Connections surface mounting C-495's subflows; Advanced routing; explicit deletion and default/override semantics.
- **Out of Scope:** local resources (C-500), navigation shell (C-498), provider adapters, and new persistence.

## Acceptance Criteria

### AC-1: Per-feature pages show honest status
**Given** configured, unconfigured and unreachable capabilities
**When** the AI section opens
**Then** each feature shows honest status, model and location with Change, Set up or Preview actions, unsupported future features are absent, and no HTTP or probe runs on mount.

**Verification**: status fixtures and settings E2E across changed, default, off and error states; assert a model name is never used as evidence of health.

### AC-2: Accounts are managed once
**Given** a provider supporting several configurations
**When** the player adds a model, edits one, or rotates a credential
**Then** the same account is reused intentionally, distinct endpoints stay distinct, and the subflows are literally the same components as onboarding.

**Verification**: real C-488 integration plus POM add-second, edit, key-change and reload flows; assert no duplicate credential in a model record.

### AC-3: Deletion and routing changes are explicit
**Given** a connection used by several features or roles
**When** it is removed or reassigned
**Then** affected uses are explained, replacement is explicit, changing a default preserves pinned and disabled overrides, and no other provider is silently selected or charged.

**Verification**: routing and deletion fixtures with confirmation, cancel and reload tests; Advanced routing stays optional for ordinary setup.

## Edge Cases & Gotchas

- **Component ownership**: C-495 owns the shared setup components. Consume them; do not fork them here.
- **Placement**: model-generation controls belong to the feature page; ordinary playback volume stays under Audio.

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)
