---
id: C-490
title: "Transcript branching must not imply rewinding the world"
source: direct
contract_type: thin
status: draft
github: { issue_number: null, issue_url: null, project_item_id: null, pr_url: null }
created_at: "2026-09-07T00:00:00Z"
---

# Contract C-490: Transcript branching must not imply rewinding the world

## Metadata

| Field | Value |
|---|---|
| **Source** | [`BACKLOG_C485_PLUS.md`](BACKLOG_C485_PLUS.md) § C-490, seeded from the 2026-09-06 external review; verified finding V-10 |
| **Target** | `apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay_view_model.svelte.ts:1624-1685` (`createBranch` / `switchBranch`), the dialogue overlay's message-action UI (`apps/frontend/client/src/lib/components/chat/message_action_bar.svelte`) |
| **Type** | thin |
| **Priority** | P1 — a reference-tool feature that does not transfer cleanly to a consequential RPG |
| **Dependencies** | None |
| **Status** | draft |
| **Promotion** | — |
| **Docs Impact** | user-facing — which message actions are offered in campaign play |
| **Contract version** | 2.0.0 |
| **Production Surface** | `/game` — the campaign dialogue overlay's message-action UI |

## Problem & Baseline Evidence

- **Current behavior**: `createBranch` (`dialogue_overlay_view_model.svelte.ts:1624`) snapshots `[...this.messages]`; `switchBranch` (`:1654`) restores `[...branch.messages]`. Inventory, quest state, relationships, world flags and RNG are untouched.
- **The concrete corruption**: threaten Rollo, obtain the Ward Wand, switch back to the polite branch — the player keeps the wand while the conversation says they never asked for it. In a chat app that is a feature; here it silently corrupts campaign state.
- **The affordances**: `message_action_bar.svelte` offers `copy/retry/branch` on AI messages and `copy/edit/delete/branch` on user messages — a transcript-editing vocabulary that implies the world rewound along with the text.
- **Reproduction**: read `createBranch`/`switchBranch` at `:1624-1685`; then open a campaign dialogue, branch, change state, and switch back — the messages revert, the state does not.
- **Existing implementation to reuse**: the branch code stays; the fix is gating the UI in campaign play, relabelling retry, and handling any already-persisted branch data without crashing. C-245's CYOA branching is a separate feature and must keep working.
- **Baseline tests**: `dialogue_overlay_view_model.test.ts` (branch unit tests), `apps/e2e/tests/client/cyoa_choices.spec.ts` (CYOA branching), and any dev-sandbox dialogue specs that exercise branch/delete.

## User Outcome

After this contract, a campaign player cannot use a transcript-branch control to silently un-commit a world change; retry is presented honestly as "Rephrase" (presentation only), and CYOA story branching still works.

## Scope Boundaries

- **In Scope:** hiding history edit/delete/branch controls in campaign play (keeping them in the dev sandbox and non-campaign chat modes); relabelling retry as "Rephrase" with presentation-only semantics; handling already-persisted branch data on load without crashing or silently discarding it; keeping C-245 CYOA branching working.
- **Out of Scope:** implementing real rewind (whole-campaign checkpoint restore) or fork-campaign — name them as the future options, build neither here; removing the branch code — gate the UI, keep the capability.

## Acceptance Criteria

### AC-1: Branch/edit/delete are not offered in campaign play
**Given** campaign play
**When** the player opens a message's actions in the dialogue overlay
**Then** history edit, delete, and branch controls are not offered. They remain available in the dev sandbox and in non-campaign chat modes.

**Verification**: E2E on `/game` — open a message's actions in the campaign dialogue overlay and assert edit/delete/branch are absent; unit test on the message-action bar component asserting the campaign mode drops those actions.

> 🔴 **Production Path rule**: Every contract needs at least one AC whose **Verification** line references a production route, a named entry point, or a declared tooling command. A unit test alone cannot satisfy an AC for a player-facing capability. Row-level `N/A` or `N/A — <reason>` alone fails; use `| **Production Surface** | none — <reason> |` in Metadata for a whole-contract opt-out.

### AC-2: Retry is relabelled and does not re-run state mutation
**Given** the player wants to retry a reply
**When** they use the retry affordance
**Then** it is labelled as changing presentation only ("Rephrase"), and it does not re-run any state mutation.

**Verification**: unit test on the message-action bar + a service/ViewModel test asserting the rephrase path performs no `NpcStateDelta` application; manual check on `/game` that the label reads "Rephrase".

### AC-3: Persisted branch data loads without crash or silent loss
**Given** existing branch data already persisted in a save
**When** it is loaded
**Then** it does not crash and is not silently discarded — the handling is stated explicitly in the Execution Report.

**Verification**: unit test loading a fixture save containing branch data and asserting a defined, documented outcome (render it read-only, keep it hidden behind the gated UI, or an explicit migration — whichever is chosen and recorded).

### AC-4: CYOA campaign branching still works
**Given** C-245's CYOA branching
**When** this contract lands
**Then** it still works — campaign branching and transcript branching are different features and only the latter is gated.

**Verification**: `apps/e2e/tests/client/cyoa_choices.spec.ts` still passes, plus a unit test asserting the CYOA branch path is untouched by the message-action gating.

## Edge Cases & Gotchas (optional)

- **The gate is by mode, not by component**: the same message-action bar appears in chat modes and the dev sandbox — gate on campaign/dialogue context, not by deleting the actions globally.
- **AI vs. user actions**: both the AI action set (`copy/retry/branch`) and the user action set (`copy/edit/delete/branch`) lose their transcript-rewinding members in campaign play; `copy` stays.
- **Upgrade to full if AC-3 touches the save schema**: if the chosen handling for persisted branch data requires a save-format change, this contract upgrades to full per SHARED_SECTIONS thin-mode rules.

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

---

## Execution Report

### Summary

To be filled during implementation — what was built, what was deferred.

### AC Status

| AC | Status | Notes |
|---|---|---|
| AC-1 | — | fill during implementation — be honest |
| AC-2 | — | fill during implementation — be honest |
| AC-3 | — | fill during implementation — be honest |
| AC-4 | — | fill during implementation — be honest |

### Files Created

| File | Purpose |
|---|---|
| — | fill during implementation |

### Files Modified

| File | Change |
|---|---|
| — | fill during implementation |

### Deviations from Spec

Fill during implementation — any AC change, scope expansion/reduction, or unplanned work. If the contract's AC was wrong, note it here and propose an Amendment.

### Test Results

- Unit: fill during implementation (pass/total, failures)
- E2E: fill during implementation (pass/total, failures)
- Baseline: fill during implementation (pre-existing failures, new failures)
