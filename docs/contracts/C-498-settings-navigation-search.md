---
id: C-498
title: "Make settings navigation task-first, searchable and responsive"
source: "Split of C-484 into PR-sized contracts; AI setup execution plan queue row S01"
contract_type: thin
status: approved
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-09-06T03:20:00Z"
---

# Contract C-498: Searchable settings navigation and context filtering

## Metadata

| Field | Value |
|---|---|
| **Source** | [C-484](C-484-capability-first-settings.md) AC-1 and AC-6; queue row S01 |
| **Target** | `apps/frontend/client/src/lib/views/settings/` navigation and the existing pause mount |
| **Type** | thin |
| **Priority** | P1 — the shell every later settings page hangs from |
| **Dependencies** | C-488 (P08). Queue row S01 additionally requires *pilot accepted* — see [queue.md](../../plans/ai-setup/queue.md); the queue is the authoritative execution gate, C-488 alone is not sufficient to start. |
| **Status** | approved |
| **Promotion** | — |
| **Docs Impact** | internal → none |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: `settings_view.svelte` nests group and subsection tabs; the registry has page, pause and onboarding context but no unified platform action policy.
- **Reproduction**: open settings on a narrow viewport and observe nested tab behavior.
- **Existing implementation to reuse**: the existing context registry and pause overlay wiring.
- **Known gaps**: no search; no platform filtering policy; deep-link behavior under a reorganization is unproven.
- **Baseline tests**: `settings_view_model.test.ts`, existing settings POM and pause-overlay tests.

## User Outcome

After this contract, a player finds a setting by searching for what it does, on desktop or mobile, without learning the navigation hierarchy — and the pause overlay keeps working.

## Scope Boundaries

- **In Scope:** searchable task-first navigation across Play, AI, Content/automation, Data/privacy and optional Account; desktop section navigation and narrow-layout category list; context and platform filtering; deep-link preservation or explicit mapping.
- **Out of Scope:** the capability pages themselves (C-499), local resources (C-500), the shared setup components owned by C-495, and any new persistence.

## Acceptance Criteria

### AC-1: Task-first navigation on both layouts
**Given** desktop and narrow viewports
**When** settings opens
**Then** desktop uses section navigation and narrow layouts a category list, without nested tab confusion.

**Verification**: production visual captures at both widths; structural assertions on the rendered navigation.

### AC-2: Search indexes individual settings, not only sections
**Given** a search index built from **task records** — one per addressable setting or action, each carrying its label, its synonyms in the words a player would actually type, and the route plus section that reveals it
**When** a query matches a task record, matches only a section, or matches nothing
**Then** a task-record match navigates to the section *and* reveals the specific setting; a section match reaches the section; an empty result is stated clearly. All three are reachable by keyboard.

**Verification**: assert the index contains a task record per addressable setting (not one per section); an E2E query naming a *setting action* — not a section name — lands on that setting; keyboard and empty-result E2E with semantic focus assertions. A test that only searches section names cannot satisfy this AC.

### AC-3: Existing deep links and pause semantics survive
**Given** current deep links and the pause overlay
**When** navigation is reorganized
**Then** each link resolves or explicitly maps to its replacement, pause sections derive from the same context registry, Full Settings reaches non-pause categories, and existing values keep their apply and revert semantics.

**Verification**: route and search-param mapping tests; the existing settings and pause regression suite; a no-network guest load.

### AC-4: Context and platform filtering are verified
**Given** the four combinations of context (pause overlay vs full settings) and platform (browser vs native desktop)
**When** navigation, search results and the item list are rendered
**Then** each combination shows exactly its permitted items: pause shows only pause-context sections while Full Settings shows all; native-only actions (managed install, local process control, filesystem paths) are absent in the browser and present on desktop; search results are filtered by the same policy as the navigation, so a hidden item is never reachable through search.

**Verification**: a 2x2 matrix test over {pause, full} x {browser, native} asserting the expected item set per cell, plus one search assertion per cell proving search honors the same filter. The policy is read from one shared context/platform registry, not re-derived per view.

### AC-5: Nothing is silently dropped
**Given** the existing settings surface
**When** it is reorganized
**Then** music DJ, agents, automation, exports and account actions all remain reachable.

**Verification**: presence assertions per existing surface.

## Edge Cases & Gotchas

- **Boundary**: this contract must not modify the capability wizard or the shared setup components owned by C-495.
- **Theme**: use semantic project theme tokens and accessible controls; no hardcoded provider-specific layouts or colors, and no service logic in views.

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)
