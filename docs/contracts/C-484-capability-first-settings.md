---
id: C-484
title: "Make settings task-first with capability pages and local resources"
source: direct
contract_type: thin
status: draft
github: { issue_number: null, issue_url: null, project_item_id: null, pr_url: null }
created_at: "2026-09-05T15:34:22Z"
---
# Contract C-484: Capability-first settings

## Metadata
| Field | Value |
|---|---|
| **Source** | [AI setup execution plan](../plans/ai-setup/README.md); C-465/C-466 follow-up |
| **Target** | Client settings navigation, feature pages, connections/resources and existing pause mount |
| **Type** | thin |
| **Priority** | P1 — replace provider-tree-first configuration with user tasks |
| **Dependencies** | C-481 P08 before S01; C-483 U01 before S02; C-482 R05 before S03; milestone dependencies, not full parent completion |
| **Status** | draft |
| **Promotion** | — |
| **Docs Impact** | Settings/AI configuration guidance in `apps/frontend/docs/src/content/docs/` |
| **Contract version** | 1.0.0 |

## Problem & Baseline Evidence
`settings_view.svelte` nests group/subsection tabs; `ai_settings_view.svelte` combines status, provider tree, roles and modality controls. The registry has page/pause/onboarding context but lacks a unified platform action policy. Existing pause behavior and deep links must not regress.
Baseline: `settings_view_model.test.ts`, existing settings POM/spec and pause-overlay tests; C-481 configuration and C-483 focused setup components are dependencies, not logic to copy into this contract.

## User Outcome
A player finds the setting by task, changes the AI used for a feature, manages accounts separately from owned installations, and returns to play without understanding infrastructure terminology.

## Scope Boundaries
In: searchable responsive navigation, AI overview and capability pages, Connections, Local resources, Advanced routing, context/platform filtering, ordinary settings preservation and focused shared setup mounts.
Out: new config/persistence schemas, provider adapters, install executors, account/deletion redesign, new inference capabilities, new native image installer, changes to campaign/gameplay behavior or unrelated visual restyling.
Use existing services/persistence and C-481 routing. Search/navigation state is transient or existing URL state; adding a durable preference requires an amendment, not hidden schema work.

## Acceptance Criteria
### AC-1: Task-first, searchable and responsive navigation
Given desktop/mobile layouts, when opening settings, then users can search sections and navigate Play, AI, Content/automation, Data/privacy and optional Account; desktop uses a section navigation and narrow layouts a category list, without nested tab confusion.
**Verification**: keyboard/search/empty-result/mobile E2E, semantic focus behavior and production visual captures; current deep links resolve or explicitly map to their replacement.

### AC-2: AI overview leads to feature-specific configuration
Given configured/unconfigured/unreachable capabilities, when opening AI, then Story/dialogue, Artwork and Read aloud show honest per-feature status/model/location and Change/Set up/Preview actions; unsupported future features are absent.
**Verification**: status fixtures and settings E2E for changed/default/off/error states; no HTTP/probe on mount or model name used as evidence of health.

### AC-3: Connections manage endpoints and accounts once
Given a provider supporting several configurations, when adding/editing a model or rotating credentials, then the same account is reused intentionally, distinct endpoints remain distinct, and the focused setup subflows are the same as onboarding.
**Verification**: real C-481 config integration plus POM add-second/edit/key-change/reload flows; no duplicate credential in a model record or component.

### AC-4: Deletion, defaults and overrides are explicit
Given a connection used by multiple features/roles, when removing or reassigning it, then affected uses are explained, replacement is explicit, default changes preserve role overrides, and no other provider is silently selected or charged.
**Verification**: routing/deletion fixtures and UI confirmation/cancel/reload tests; Advanced routing remains optional for normal setup.

### AC-5: Local resources reflect ownership and real jobs
Given managed and external resources, when opening Local resources, then supported owned jobs/assets show download/status/disk/start-stop/repair/removal actions; external services offer connection management without delete/stop ownership. Web hides native/Docker controls but retains supported browser asset management.
**Verification**: C-482-backed running/stopped/downloading/failed fixtures, disconnect-external-is-nondestructive tests, browser/native action matrix.

### AC-6: Existing settings and pause semantics survive
Given existing controls/audio/display/gameplay/data/account values, when navigating or using the pause overlay, then values persist with existing apply/revert semantics and pause sections derive from the same context registry; Full Settings reaches non-pause categories.
**Verification**: existing settings/pause regression suite, no-network guest load and persistence E2E; Data/privacy still explains online usage and protects credentials.

## Edge Cases & Gotchas
C-483 owns shared setup components during U01; S01 may run independently but must not edit capability routes or those components. Coordinate shared POM/preload/index changes; separate worktrees alone do not prevent conflicts.
Use semantic project theme tokens and accessible controls; no hardcoded provider-specific layouts/colors or new service logic in views. Model-generation controls belong to the feature page, ordinary playback volume remains under Audio.
Preserve existing route/search-param behavior with mapping tests, and do not silently remove music DJ, agents, automation, exports or account actions while reorganizing navigation.
Require production-route E2E/visual evidence and affected validation. Unsupported packaged/platform behavior remains unverified rather than accepted from mocks.

## Amendments
No amendments; draft specification. Scope/AC changes require version bump and user approval.

## Promotion Lifecycle
See [shared promotion rules](SHARED_SECTIONS.md#promotion-lifecycle).
## Status Lifecycle
See [shared status rules](SHARED_SECTIONS.md#status-lifecycle). Append execution report when all ACs pass; partial navigation PRs do not complete this contract.
