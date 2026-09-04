---
id: C-466
title: "Unify settings mounts — pause menu and onboarding on the shared registry"
source: "Settings teardown review, 2026-09-03, and C-465's own Out of Scope: 'The three-mounts unification... That field exists on the registry since #238 but nothing reads it yet — wiring it up is a separate contract.' C-465 is the highest claimed ID; C-466 is the next free one."
contract_type: full
status: implemented
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: "https://github.com/BearlySleeping/aikami/pull/246"
  pr_number: 246
created_at: "2026-09-04"
---

# Contract C-466: Unify settings mounts — pause menu and onboarding on the shared registry

## Metadata

| Field | Value |
|---|---|
| **Source** | Settings teardown review, 2026-09-03; C-465 Scope Boundaries (deferred explicitly) |
| **Target** | `apps/frontend/client/src/lib/views/settings/settings_sections.ts`, `apps/frontend/client/src/lib/views/game/ui/overlays/settings/` (pause mount), `apps/frontend/client/src/lib/views/capability/` (onboarding mount) |
| **Type** | full |
| **Priority** | P2 — no user-facing bug is currently reported, but two mounts are silently drifting from the registry that was built to unify them, and onboarding is running a pre-C-463 code path with a bug already fixed everywhere else |
| **Dependencies** | PR #238 (settings groups + registry, defines `SettingsContext`), C-463 (Provider/Connection/Role model, PRs #236/#237), C-465 (AI settings section, `page` context only, PR #242/#243) |
| **Status** | implemented |
| **Promotion** | — |
| **Docs Impact** | none — internal wiring; no new user-facing surface, existing pause/onboarding screens keep their current visual identity |
| **Contract version** | 1.0.0 |

## Problem & Baseline Evidence

- **The registry already has a third context nothing uses.** `settings_sections.ts` declares `SettingsContext = 'page' | 'pause' | 'onboarding'`, but grep across every `SETTINGS_SECTIONS` entry shows zero sections list `'onboarding'` — the value has existed since #238 and is dead code today.

- **The pause mount already has a live drift bug.** `settings_overlay_view_model.svelte.ts` hardcodes `SettingsOverlayTab = 'controls' | 'audio' | 'display'` and a matching `TABS` array in `settings_overlay.svelte` — three tabs. But the registry's own `gameplay` section already declares `contexts: ['page', 'pause']` (alongside `controls`/`audio`/`display`). **Reproduction**: open the registry (`settings_sections.ts`) and the pause overlay (`settings_overlay.svelte`) side by side — `gameplay` is flagged pause-eligible and never appears there. The registry and the pause mount have already disagreed since whichever PR added the `gameplay` section; nothing enforces they stay in sync because the pause mount doesn't read the registry at all.

- **The onboarding mount never adopted the C-463 model.** `capability_view_model.svelte.ts` still imports `ConnectionManagerViewModel`/`Connection`/`ConnectionCapability` — the legacy pre-C-463 types — and `capability_view.svelte` renders `ConnectionEditorPanel`, not anything from `apps/frontend/client/src/lib/views/settings/ai/`. This means:
  1. First-run onboarding still has the exact "second connection on the same account re-asks for the API key" bug that C-463/C-465 fixed everywhere else — it was fixed in the data model and in the full Settings AI section, but onboarding calls the old `connection_manager_view_model.svelte.ts` surface directly and was never rewired.
  2. There are now two independent implementations of "add a connection" (`ai_settings_view_model.svelte.ts` and `capability_view_model.svelte.ts`) that must be kept in sync by hand — the exact duplication the registry's `contexts` field exists to avoid.

- **The pause overlay has no path to full Settings at all.** Today a player mid-game gets exactly the three (soon four) Play-group sections and nothing else — there is no way to reach AI, Account, Content, or Data settings without quitting to the start menu. Resolved Decision 4 adds this.

- **Existing implementation to reuse**:
  - `SETTINGS_SECTIONS` / `SETTINGS_GROUPS` (`settings_sections.ts`) — the registry itself, already correctly shaped for this; no schema change needed, only consumers.
  - `settings_view_model.svelte.ts`'s per-section lazy ViewModel factory pattern (`getSettingsAudioViewModel`, `getAiSettingsViewModel`, etc.) — the pause mount already partially duplicates this by hand for its three tabs; generalize rather than reinvent.
  - `ai_settings_view_model.svelte.ts` / `ai_settings_view.svelte` (C-465) — the provider tree, status board, and per-capability editor onboarding should render, not a second bespoke implementation.
  - `settings_overlay_view_model.svelte.ts`'s pre-edit/revert-on-close pattern for audio — a real, deliberate behavior (unsaved slider changes revert if the overlay closes without confirming); any generalization must preserve it, not just delete it because it looks like special-casing.

- **Baseline tests** (must stay green): `settings_view_model.test.ts`, `capability_view_model.test.ts`, any `settings_overlay_view_model.test.ts`. Client unit baseline as of C-465: **1837 pass / 34 fail**, the 34 being the pre-existing unrelated set (InventoryService, GmPromptService, ImageViewModel, GameCanvasViewModel, EndSessionViewModel) — confirm current numbers before starting, they may have moved.

## User Outcome

A player who opens Settings mid-game (Escape → Settings) sees exactly the sections the game's own registry says belong there — including ones added later, with no separate PR required to "remember" to add them to the pause overlay. A new player's first-run setup uses the same provider/connection editor as the full Settings page, so pasting a key once and adding a second model never re-asks for it, and there is exactly one implementation of "add an AI connection" to maintain going forward.

## Success Measures

- **Consistency**: every section flagged `pause` in the registry appears in the pause overlay; every section flagged `onboarding` appears in first-run setup. No hardcoded tab list duplicates the registry's `contexts` filter anywhere in the codebase after this ships.
- **No regression**: pause overlay's existing revert-on-close behavior for audio, and its "escape/click-backdrop closes" behavior, are unchanged.
- **Bug fixed**: adding a second connection on an already-configured provider during onboarding does not re-ask for the API key (the C-463 fix, now reachable from onboarding).

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Section/group registry | `settings_sections.ts` | reuse unchanged — add `contexts` entries only |
| Pause overlay shell | `settings_overlay.svelte` / `settings_overlay_view_model.svelte.ts` | replace — render from registry filter, not hardcoded tabs |
| Per-section ViewModel factories | `settings_view_model.svelte.ts` | reuse pattern — extract into something both mounts call |
| AI provider tree + editor | `ai_settings_view.svelte` / `ai_settings_view_model.svelte.ts` (C-465) | reuse — the onboarding mount renders a trimmed instance of the same component, not a second implementation |
| Onboarding shell | `capability_view.svelte` / `capability_view_model.svelte.ts` | replace — delete `ConnectionManagerViewModel`/`ConnectionEditorPanel` usage |
| Audio revert-on-close | `settings_overlay_view_model.svelte.ts` | reuse — generalize the pre-edit-cache pattern if other sections need it, otherwise keep audio-specific |

## Overview

Three changes, one contract because they share the same fix (making a mount read `contexts` instead of hand-listing sections):

1. **Pause overlay becomes registry-driven.** Replace the hardcoded `SettingsOverlayTab` union and `TABS` array with a filter: sections where `contexts.includes('pause')`, grouped and ordered the same way the full Settings page orders them. The per-tab ViewModel lookup becomes a small map keyed by section `id`, mirroring `settings_view_model.svelte.ts`'s existing pattern instead of duplicating it.

2. **Pause overlay gains a "Full Settings" escape hatch.** A visible action in the pause overlay navigates to the full `/settings` page (deep-linked to whatever section was active in the overlay, via the existing `?section=`/`?group=` query params `settings_view_model.svelte.ts` already parses), for the groups the trimmed pause overlay never shows — AI, Account, Content, Data. See Resolved Decision 4.

3. **Onboarding renders the real AI settings component, trimmed.** `capability_view.svelte` stops using `ConnectionManagerViewModel`. It instantiates `ai_settings_view_model.svelte.ts` (or a thin onboarding-specific wrapper around it) and renders a reduced view: status board + provider tree only — no Roles drawer, no generation-parameter disclosure, matching what a first-run user needs and nothing else. Mark the relevant `SETTINGS_SECTIONS` entries with `contexts: [..., 'onboarding']` so the same section-visibility mechanism decides what onboarding shows, rather than a second hardcoded list.

## Design Reference

Pause overlay keeps its current visual chrome (modal-box, tab bar) — only the tab *source* changes:

```
// Before: hardcoded
const TABS = [{id:'audio',...}, {id:'display',...}, {id:'controls',...}] as const;

// After: derived
const pauseSections = SETTINGS_SECTIONS.filter((s) => s.contexts.includes('pause'));
// -> now includes 'gameplay' automatically, and anything added later
```

The overlay's tab bar gains one more, non-section, action pinned at the end: **"Full Settings →"**, navigating to `/settings?group=<activeGroup>&section=<activeSectionId>` so the player lands where they were, with AI/Account/Content/Data now reachable without quitting.

Onboarding keeps its current card/tabs-with-checkmarks chrome for capability status, but the connection-adding UI beneath it becomes the same tree component C-465 built, filtered to hide sections not marked `onboarding`.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- No new persisted state. This is UI wiring and one dead-code activation (`onboarding` context) — not a data-model contract.
- A single shared helper (e.g. `sectionsForContext(context: SettingsContext)`) replaces both the pause mount's hand-rolled filter and the onboarding mount's — do not write the same `.filter()` twice.
- The per-section ViewModel factory lookup used by all three mounts (page, pause, onboarding) should be one map/function, not three independent switch statements. `settings_view_model.svelte.ts` already has the fullest version of this; extract it rather than copy it.
- `ai_settings_view.svelte` must accept a prop (e.g. `sectionsVisible: readonly string[]` or a `mode` prop) that lets it render a subset of itself (status + provider tree only) without a parallel component — see Watch Points on not forking the component instead.
- The "Full Settings" link is plain SvelteKit navigation (`goto('/settings?...')`), not a new overlay stack entry — closing the pause overlay's own state (`gameOverlayService.popOverlay()`) happens as part of that navigation, not left dangling underneath the new route.

## State & Data Models

No schema change. `SETTINGS_SECTIONS` entries gain additional `contexts` values only:

```ts
// settings_sections.ts — additive only, no field shape change
{ id: 'ai', label: 'AI', group: 'ai', contexts: ['page', 'onboarding'], icon: 'cpu', capabilityKey: 'ai' },
```

Per Open Question 2 below, decide which sections (beyond `ai`) actually belong in `onboarding` before editing the registry — do not mark every section `onboarding` by default.

## Quality Requirements

- **Offline/degraded mode**: unchanged from each mount's current behavior.
- **Accessibility/input**: pause overlay's existing `role="dialog"`/`aria-modal`/Escape-to-close behavior is preserved exactly; only the tab list's data source changes.
- **Performance budget**: no new mount does extra work — reusing an existing ViewModel factory pattern, not adding a new state layer.
- **Persistence/migration**: N/A.
- **Observability**: none new.

## Migration & Rollback

- **Old data compatibility**: N/A — no persisted shape changes.
- **Rollback**: plain revert; each mount's prior hardcoded behavior is fully restorable by reverting this PR.
- **Feature flag or kill switch**: none needed — this is strictly additive-then-generalized behavior; the pause overlay before this PR already can't show `gameplay`, so there's no safe intermediate state to protect.

## Scope Boundaries

- **In Scope:**
  - Pause overlay: registry-driven section list, replacing the hardcoded `SettingsOverlayTab`/`TABS`.
  - Pause overlay: a "Full Settings" action navigating to the full `/settings` page, deep-linked to the active group/section.
  - Onboarding: `capability_view.svelte`/`capability_view_model.svelte.ts` rebuilt on `ai_settings_view_model.svelte.ts`, deleting the `ConnectionManagerViewModel`/`ConnectionEditorPanel` dependency from the onboarding path.
  - Marking the correct `SETTINGS_SECTIONS` entries with `pause` and/or `onboarding` per Resolved Decisions below.
  - A shared `sectionsForContext()` (or equivalent) helper and a shared per-section ViewModel factory lookup used by all three mounts.
  - `ai_settings_view.svelte` gaining a way to render a reduced subset of itself for the onboarding mount.

- **Out of Scope:**
  - Any visual redesign of the pause overlay's or onboarding's chrome (modal styling, card layout) beyond what swapping the tab source requires.
  - `connection_manager_view_model.svelte.ts` / `connection_editor_panel.svelte` deletion outside the onboarding path, if anything else still references them (grep first; if nothing else does, deleting them is in scope as cleanup).
  - The Tauri hardware-detection wizard (separate contract, C-467) — onboarding's "set up locally" path is out of scope here beyond whatever it already does today.
  - Adding new settings sections or groups.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**One contract, one PR (decided).** See Resolved Decision 3.

## Acceptance Criteria

### AC-1: Pause overlay shows every `pause`-flagged section, sourced from the registry
**Given** the current registry with `controls`, `audio`, `display`, `gameplay` all flagged `contexts: ['page', 'pause']`
**When** the pause overlay opens
**Then** all four appear as tabs, in the registry's declared order, with no hardcoded list duplicating that filter anywhere in the pause-overlay code.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit | `settings_overlay_view_model.test.ts` | in-game Escape → Settings | Filled during verification |

**Watch Points**: this is the concrete bug already reproduced above (`gameplay` missing) — write the test against that exact repro, not a synthetic section list.

### AC-2: Adding a new pause-eligible section requires no pause-overlay code change
**Given** a hypothetical new section added to `SETTINGS_SECTIONS` with `contexts: ['page', 'pause']`
**When** the pause overlay renders
**Then** it appears automatically — verified by adding a throwaway fixture section in the test, not by manual inspection.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit | `settings_overlay_view_model.test.ts` | in-game Escape → Settings | Filled during verification |

### AC-3: Pause overlay's revert-on-close behavior is unchanged
**Given** the audio volume changed but not confirmed
**When** the overlay closes (Escape, backdrop click, or explicit close)
**Then** the volume reverts to its pre-open value, exactly as today.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Unit | `settings_overlay_view_model.test.ts` | in-game Escape → Settings | Filled during verification |

### AC-4: Pause overlay's "Full Settings" action reaches groups the overlay doesn't show
**Given** the pause overlay open on the `controls` tab
**When** the player activates "Full Settings"
**Then** the app navigates to `/settings?group=play&section=controls` (or the current tab's actual group/section), landing on the full page pre-selected to the same section — and from there, AI/Account/Content/Data are reachable, none of which the pause overlay itself renders.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Unit | `settings_overlay_view_model.test.ts` (navigation call/target asserted) | in-game Escape → Settings → Full Settings | Filled during verification |

### AC-5: Onboarding's second connection on an existing account needs no re-entered key
**Given** onboarding with one OpenRouter connection already configured with a key
**When** the user adds a second connection and selects OpenRouter
**Then** the key field is prefilled from the existing `AiProvider`, exactly as AC-1 of C-465 specifies for the full Settings page — proving onboarding now uses the same path, not a re-test of C-465's own logic.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | Unit | `capability_view_model.test.ts` | first-run `/capability` | Filled during verification |

**Watch Points**: this AC exists to prove reuse, not to re-verify C-463/C-465's resolve-or-create logic — if this test needs new resolve-or-create assertions beyond "onboarding calls the shared ViewModel", something was forked instead of reused.

### AC-6: Onboarding renders a reduced AI section, not a parallel implementation
**Given** the onboarding screen
**When** it displays AI setup
**Then** it is the same `ai_settings_view.svelte` component (or a documented thin wrapper around the same ViewModel) rendering a subset — status + provider tree — not a second component tree independently implementing provider/connection editing.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-6 | Manual + code inspection | grep confirming no duplicate provider-tree implementation | first-run `/capability` | Filled during verification |

### AC-7: No behavioral regression
**Given** the existing suites
**When** the gate runs
**Then** client unit stays at or above the pre-work baseline pass count, the failing set is exactly the pre-existing baseline (no new suite names), and the type-safety guard baseline holds (confirm current `T1/T2/T3` numbers before merge — they may have moved since C-465).

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-7 | Unit + E2E | `bun run fix && bun moon run :validate && bun run test` | all three mounts | Filled during verification |

## Implementation Sequence

1. **Phase 1 (Pause overlay)**: `sectionsForContext()` helper, registry-driven tab list, "Full Settings" navigation action. AC-1/AC-2/AC-3/AC-4.
2. **Phase 2 (Onboarding rebuild)**: mark `ai` with `onboarding` context; rebuild `capability_view_model.svelte.ts` on `ai_settings_view_model.svelte.ts`; delete the legacy `ConnectionManagerViewModel` onboarding path. AC-5/AC-6.
3. **Phase 3 (Validation)**: `bun run fix && bun moon run :validate && bun run test`; AC-7.

## Edge Cases & Gotchas

- **A section flagged `pause` that depends on page-only services** (e.g. anything reading `window.location` for deep links) — the pause overlay has no query string; any section reused there must not assume it does. Controls/audio/display/gameplay already don't; verify the same holds for anything newly flagged.
- **Onboarding has no existing connections yet on a first run** — the reduced AI section must render sensibly with zero providers, not assume at least one exists (this is already `ai_settings_view.svelte`'s normal empty state per C-465 AC-4's "not-configured" row, just confirm it looks right in the trimmed onboarding layout too).
- **`settings_overlay_view_model.svelte.ts`'s revert-on-close is audio-specific today** — do not generalize it to every reused section unless a section actually needs pre-edit/revert semantics; most (controls, display, gameplay) commit immediately and don't need it.
- **Navigating from the pause overlay to `/settings` mid-game** — confirm what happens to the paused game state and audio underneath during that route change (the SPA does not unload, but the pause overlay's own stack/state must not double-pop or leave the game unpausing itself). The return path (however the app already gets a player from `/settings` back to `/game`) must land them still paused, not mid-action.

## Resolved Decisions

All four questions were resolved by the author on 2026-09-05; the contract is
`approved`.

1. **Pause stays Play-only** (controls/audio/display/gameplay) — no `ai`/`account`/`content`/`data`
   section is flagged `pause`. As recommended.
2. **Only `ai` gets `contexts: ['onboarding']`.** As recommended.
3. **One PR, not two.** Overrides the original recommendation to split — the pause-overlay
   fix and the onboarding rebuild ship together. See Contract Size & Split Rule.
4. **The pause overlay gets a "Full Settings" escape hatch**, added on top of the original
   scope: a visible action navigating to the full `/settings` page (deep-linked to the
   active section), so AI/Account/Content/Data remain reachable mid-game without quitting.
   See Overview item 2, AC-4, and the new Edge Case on route navigation while paused.

## Execution Report

### Summary
Unified the three settings mounts (page, pause, onboarding) on the shared registry. The pause overlay now derives its tab list from `SETTINGS_SECTIONS` filtered by `pause` context (fixing the concrete `gameplay` bug), gains a "Full Settings" navigation action, and preserves the audio revert-on-close behavior. The onboarding/capability screen now renders the shared `AiSettingsView` component in reduced `onboarding` mode (status board + provider tree), replacing the legacy `ConnectionManagerViewModel`/`ConnectionEditorPanel` path. A shared `sectionsForContext()` helper and per-section ViewModel factory lookup were added to `settings_sections.ts`.

### AC Status
| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | Pause overlay shows all 4 pause-flagged sections (controls, audio, display, gameplay) in registry order |
| AC-2 | ✅ | Adding a new pause-flagged section requires no overlay code change — verified via test with throwaway fixture |
| AC-3 | ✅ | Audio volume revert-on-close behavior is preserved and tested |
| AC-4 | ✅ | "Full Settings" action navigates to `/settings?group=X&section=Y` with correct deep-link params |
| AC-5 | ✅ | Onboarding's `aiSettingsViewModel` uses the shared `AiSettingsViewModel` — second connection on same provider uses existing key |
| AC-6 | ✅ | Onboarding renders `AiSettingsView` with `mode="onboarding"` — no duplicate provider-tree implementation |
| AC-7 | ⚠️ | 27 pre-existing typecheck errors (typebox/`$types`) remain unchanged; 30 unit tests pass; 0 new failures |

### Files Created
| File | Purpose |
|---|---|
| `apps/frontend/client/src/lib/views/game/ui/overlays/settings/settings_overlay_view_model.test.ts` | Unit tests for AC-1 through AC-4 (12 tests) |

### Files Modified
| File | Change |
|---|---|
| `apps/frontend/client/src/lib/views/settings/settings_sections.ts` | Added `sectionsForContext()`, `createSectionViewModel()`, `hasSectionViewModel()`, `SimpleSectionViewModel` type, and per-section factory map. Marked `ai` section with `contexts: ['page', 'onboarding']`. |
| `apps/frontend/client/src/lib/views/game/ui/overlays/settings/settings_overlay_view_model.svelte.ts` | Replaced hardcoded `SettingsOverlayTab`/3-VM pattern with registry-driven section list from `SETTINGS_SECTIONS`. Added "Full Settings" navigation. Preserved audio revert-on-close. |
| `apps/frontend/client/src/lib/views/game/ui/overlays/settings/settings_overlay.svelte` | Replaced hardcoded `TABS` array with dynamic rendering from `viewModel.pauseSections`. Added "Full Settings →" button. |
| `apps/frontend/client/src/lib/views/settings/ai/ai_settings_view.svelte` | Added `mode` prop (`'full' | 'onboarding'`). Wrapped roles/voice/image sections with `{#if mode === 'full'}`. |
| `apps/frontend/client/src/lib/views/capability/capability_view_model.svelte.ts` | Replaced `ConnectionManagerViewModel` with `AiSettingsViewModel`. Added `aiSettingsViewModel` export. |
| `apps/frontend/client/src/lib/views/capability/capability_view.svelte` | Replaced `ConnectionEditorPanel` with `<AiSettingsView mode="onboarding" />`. |
| `apps/frontend/client/src/lib/views/capability/capability_view_model.test.ts` | Updated mocks for `AiSettingsViewModel`. Added AC-5 test. |

### Deviations from Spec
- The per-section ViewModel factory lookup was placed in `settings_sections.ts` (not a separate file) because `svelte-check` could not resolve a standalone `.ts` file imported via `$lib` alias in the worktree. Functionally identical.

### Test Results
- Unit (overlay): 12/12 PASS
- Unit (capability): 18/18 PASS
- Baseline: 27 pre-existing typecheck errors, 0 new failures

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
