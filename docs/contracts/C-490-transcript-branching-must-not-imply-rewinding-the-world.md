---
id: C-490
title: "Transcript branching must not imply rewinding the world"
source: direct
contract_type: thin
status: implemented
github: { issue_number: null, issue_url: null, project_item_id: null, pr_url: null }
created_at: "2026-09-07T00:00:00Z"
---

# Contract C-490: Transcript branching must not imply rewinding the world

## Metadata

| Field | Value |
|---|---|
| **Source** | [`BACKLOG_C485_PLUS.md`](BACKLOG_C485_PLUS.md) § C-490, seeded from the 2026-09-06 external review; verified finding V-10 |
| **Target** | `apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay_view_model.svelte.ts:1792-1849` (`createBranch` at :1792 / `switchBranch` at :1822), the dialogue overlay's message-action UI (`apps/frontend/client/src/lib/components/chat/message_action_bar.svelte`, rendered via `rich_message_row.svelte`) |
| **Type** | thin |
| **Priority** | P1 — a reference-tool feature that does not transfer cleanly to a consequential RPG |
| **Dependencies** | None |
| **Status** | implemented |
| **Promotion** | — |
| **Docs Impact** | user-facing — which message actions are offered in campaign play |
| **Contract version** | 2.0.0 |
| **Production Surface** | `/game` — the campaign dialogue overlay's message-action UI |

## Problem & Baseline Evidence

- **Current behavior**: `createBranch` (`dialogue_overlay_view_model.svelte.ts:1792`) snapshots `[...this.messages]` (line 1806); `switchBranch` (`:1822`) restores `[...branch.messages]` (line 1847). Inventory, quest state, relationships, world flags and RNG are untouched.
- **The concrete corruption**: threaten Rollo, obtain the Ward Wand, switch back to the polite branch — the player keeps the wand while the conversation says they never asked for it. In a chat app that is a feature; here it silently corrupts campaign state.
- **The affordances**: `message_action_bar.svelte` offers `copy/retry/branch` on AI messages and `copy/edit/delete/branch` on user messages — a transcript-editing vocabulary that implies the world rewound along with the text.
- **Reproduction**: read `createBranch`/`switchBranch` at `:1792-1849`; then open a campaign dialogue, branch, change state, and switch back — the messages revert, the state does not.
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

Gated transcript-rewinding in campaign play by mode (C-490). Added an `isCampaignPlay` flag to the dialogue ViewModel (production overlay defaults `true`; the dev sandbox VM sets `false`). The dialogue overlay now passes it through to the message-action UI, which drops branch/edit/delete in campaign play while keeping them in the dev sandbox and non-campaign chat; retry is relabelled "Rephrase" everywhere. A new presentation-only `rephraseResponse` path never re-applies NpcStateDelta / quest activation / dialogue commands. The branch code (createBranch/switchBranch) is retained but its UI (branch selector + actions) is gated. CYOA branching (C-245) is untouched and its suite passes.

### AC Status

| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | Branch/edit/delete dropped in campaign play via `disableTranscriptEditing`; unit tests + dev-sandbox E2E pass. `/game` E2E written but unreachable in this ad-hoc env (baseline `dialogue_skill_check` fails identically — see Deviations). |
| AC-2 | ✅ | Retry relabelled "Rephrase" (helper `messageActionLabel`); new `rephraseResponse` performs no NpcStateDelta/quest/command mutation (unit test asserts quest not re-accepted). |
| AC-3 | ✅ (N/A — documented) | **Handling: N/A by design.** Branch/transcript data is **not persisted to saves** — `branches`/`activeBranchId` are in-memory, session-scoped state (cleared on overlay close per C-343); only input drafts persist (IndexedDB). So no "persisted branch data in a save" exists to load. The chosen handling: the campaign gating keeps any in-memory branch state **read-only** (branch selector + branch/edit/delete actions hidden) and **never silently discards** it; no save-schema change → contract stays thin. Unit test asserts this retention + gating. |
| AC-4 | ✅ | `cyoa_choices.spec.ts` (C-245) — all 10 tests pass. Message-action gating does not touch the CYOA branch path. |

### Files Created

| File | Purpose |
|---|---|
| `apps/frontend/client/src/lib/components/chat/message_actions.ts` | Pure, unit-testable source of truth for which message actions are offered (by sender + `disableRewind` mode) and how they are labelled (retry → "Rephrase"). |
| `apps/frontend/client/src/lib/components/chat/message_actions.test.ts` | Unit tests for AC-1 gating and AC-2 relabel (10 tests). |
| `apps/e2e/tests/client/dialogue_branching_gating.spec.ts` | E2E: campaign `/game` dialogue offers no branch/edit/delete and reads "Rephrase"; dev sandbox keeps the controls. |

### Files Modified

| File | Change |
|---|---|
| `apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay_view_model.svelte.ts` | Added `isCampaignPlay` option/field (default true) + interface member; added `rephraseResponse`; `_sendWithIntentAnalysis`/`_delegateGenerateResponse` accept `applyState` and skip quest-activation/command mutation on the rephrase path. |
| `apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay_view_model.dev.svelte.ts` | Dev VM sets `isCampaignPlay=false` (sandbox keeps rewinding controls). |
| `apps/frontend/client/src/lib/components/chat/message_action_bar.svelte` | Uses shared `message_actions` helper; added `disableRewind`; relabel retry → "Rephrase". |
| `apps/frontend/client/src/lib/components/messaging/rich_message_row.svelte` | Added `disableTranscriptEditing`; dialogue-variant inline actions gate branch/edit/delete and relabel retry → "Rephrase". |
| `apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay.svelte` | Passes `disableTranscriptEditing`; routes retry→`rephraseResponse`; guards branch/edit/delete when campaign; hides the branch selector in campaign play. |
| `apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay_view_model.test.ts` | Added C-490 tests: isCampaignPlay default/override, rephrase-no-quest-mutation, branch-data retention. |

### Deviations from Spec

- **AC-1 `/game` E2E could not execute in this environment.** The production campaign dialogue overlay is unreachable from the dev server in this ad-hoc worktree: the untouched baseline `dialogue_skill_check.spec.ts` fails identically (`approachAndTalkToNpc` never surfaces the dialogue overlay — the fresh profile boots to the movement tutorial and Elder Thalia is not reachable). This is an environment limitation, not a regression. The `/game` E2E spec is written to the same pattern as the baseline and will run in the proper harness. The dev-sandbox E2E (which mounts the production `DialogueOverlay`) passes and demonstrates the gating, alongside 50 unit tests.
- No AC change or scope change was required. The branch capability and CYOA branching are preserved per the contract's "gate the UI, keep the capability" scope.

### Test Results

- Unit: 50/50 pass (0 failures) — 40 dialogue ViewModel + 10 message_actions; plus 19/19 dev-VM tests.
- E2E: client — 12/12 pass (cyoa_choices 10/10 [AC-4] + dialogue_branching_gating sandbox 2/2). The campaign `/game` case is unreachable in this ad-hoc env (see Deviations).
- Visual: n/a — no sandbox created; production `/game` dialogue unreachable in this env.
- Baseline: 0 pre-existing failures in the unit baseline (`dialogue_overlay_view_model.test.ts`, `cyoa_choices.spec.ts`); 0 new failures introduced. The `dialogue_skill_check.spec.ts` `/game` spec fails in this ad-hoc env for both baseline and post-change runs (pre-existing environmental failure).
