# Contract C-317: Rebuild the Start Menu Around Campaigns, Not Personas

## Metadata

| Field | Value |
|---|---|
| **Source** | TODO.md — C-317 |
| **Target** | `apps/frontend/client/src/lib/views/start/start_view.svelte`, `start_view_model.svelte.ts`, and new campaign summary card components. |
| **Priority** | P0 — the first player decision currently branches on character count (persona-based), which is semantically wrong. |
| **Dependencies** | C-313 (Campaign Aggregate & Boot State Machine — `implemented`), C-121 (Start Menu & Optional Auth — `completed`), C-133 (Flexible Provider Onboarding — `completed`). |
| **Status** | approved |
| **Promotion** | — |
| **Docs Impact** | Internal only — no user-facing docs page. The start menu is self-documenting. |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: `start_view_model.startNewGame()` reads `localStorage` for saved characters (personas) and branches: 0 characters → `/setup`, 1 character → `/game` (bypasses campaign creation), 2+ characters → `/characters`. The "Continue" button uses `gameSaveService.availableSaves` (raw `SaveSlotInfo[]`) and calls `campaignService.loadCampaign()` with a save-slot ID — a category error (save slots ≠ campaigns). There is no "Load Campaign" button at all.
- **Reproduction**:
  1. Create a single character in a previous session.
  2. Return to the start menu and click "New Game."
  3. Observe: the game skips `/setup` entirely and jumps straight to `/game` — no new campaign is created.
  4. Save the game via `gameSaveService`. Restart. Click "Continue."
  5. Observe: `continueGame()` calls `campaignService.loadCampaign({ campaignId: latestSave.id })` where `latestSave.id` is a save-slot ID (`"auto-save"`), not a campaign UUID. This silently fails or creates an inconsistent state.
- **Existing implementation to reuse**:
  - `campaignService` (`apps/frontend/client/src/lib/services/campaign/campaign_service.svelte.ts`) — `startNewCampaign()`, `loadCampaign()`, `hasCampaigns()`, `getLatestCampaign()`, `campaigns: Campaign[]`, `activeCampaign`.
  - `Campaign` type (`packages/shared/types/src/lib/game/campaign.ts`, `packages/shared/schemas/src/lib/game/campaign.ts`) — `id`, `name`, `state`, `personaId`, `contentPackId`, `seed`, `createdAt`, `updatedAt`, `lastSavedAt`, `lastSaveSlotId`, `capabilityProfile`.
  - `StartViewModel` base structure (`apps/frontend/client/src/lib/views/start/start_view_model.svelte.ts`) — auth, Tauri quit, credits, provider dialog.
  - `start_view.svelte` — existing daisyUI hero layout, button structure.
- **Known gaps**:
  - Persona-based character-count branching (`_getCharacterCount`, `_startWithExistingCharacter`) must be removed entirely. `/characters` route exists but is a person-centric list, not campaign-centric.
  - Continue uses save-slot IDs instead of campaign IDs.
  - No "Load Campaign" modal or list.
  - No campaign summary cards (last checkpoint, content pack name, AI capability status).
  - No keyboard/gamepad navigation on the start menu.
  - No destructive confirmation for New Adventure when campaigns exist.
- **Baseline tests**:
  - `campaign_service.test.ts` — existing tests for campaign lifecycle (create, load, pause, resume, save). Run before starting: `bun moon run client:test`.
  - `boot_state_machine.ts` — pure transition function tests.
  - `campaign.test.ts` (schema) — schema validation tests.
  - `start_view_model.test.ts` — existing tests cover the old persona-based branching flow. Must be rewritten for the new campaign-first behavior.

## User Outcome

After this contract, a player lands on the start menu and sees a clean campaign-first hierarchy: **Continue** (latest resumable campaign with checkpoint preview), **New Adventure** (always starts a fresh campaign draft), **Load Campaign** (browse all campaigns), and **Settings**. Account and credits are secondary. The menu works with keyboard and gamepad.

## Success Measures

- **Time/latency target**: Start menu renders and campaign list loads within 500ms (IndexedDB `getAll()`).
- **Offline/degraded behavior**: Campaign data is fully local (IndexedDB). The menu shows AI capability status (text/image/voice availability) as advisory only — no provider blocks the flow.
- **Production journey enabled**: Player can always start a new campaign, no matter how many personas or saves exist. Continue only appears when a resumable campaign is available.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Campaign lifecycle | `campaign_service.svelte.ts` — `startNewCampaign`, `loadCampaign`, `hasCampaigns`, `campaigns`, `getLatestCampaign` | Reuse as-is |
| Campaign data model | `packages/shared/types/src/lib/game/campaign.ts`, `packages/shared/schemas/src/lib/game/campaign.ts` | Reuse as-is |
| Start menu ViewModel | `start_view_model.svelte.ts` — auth, Tauri, credits, provider check | **Modify** — remove persona branching, wire campaigns |
| Start menu View | `start_view.svelte` — daisyUI hero layout | **Modify** — new button hierarchy, campaign cards |
| AI provider detection | `aiSettingsService` — `textProvider`, `ttsProvider`, `imageProvider` | Reuse for capability status display |
| Content pack identity | `Campaign.contentPackId` — currently `'emberwatch'` | Reuse for campaign card display |
| Tauri quit | `getCurrentWindow().close()` via dynamic import | Reuse as-is |
| Router service | `routerService` from `@aikami/frontend/services` | Reuse — add `goToRoute('load_campaign', ...)` if a modal/route is needed |
| Save slot metadata | `gameSaveService` — `availableSaves` / `fetchAvailableSaves` | **Replace** — campaign service owns checkpoint data; save slots are internal |

## Overview

Rebuild the start menu ViewModel and View to center on campaigns instead of characters. Remove all character-count branching (`_getCharacterCount`, `_startWithExistingCharacter`). Wire **Continue** to `campaignService.getLatestCampaign()` filtered by resumable state. Wire **New Adventure** to always call `campaignService.startNewCampaign()` then route to `/setup` for character creation. Add **Load Campaign** to show all campaigns as cards with last-saved checkpoint, content pack name, and AI capability indicators. Keep auth, credits, settings, and Tauri quit as secondary actions. Preserve the missing-provider check but only as a soft warning, not a block.

## Design Reference

- **ViewModel pattern**: `BaseViewModel` from `@aikami/frontend/services` — `className`, `initialize()`, `$state` fields, `create()` factory. Follow `start_view_model.svelte.ts` structure.
- **View pattern**: `start_view.svelte` — daisyUI hero layout, `$props()` for ViewModel, no logic in the View. Follow `svelte-conventions` (zero-logic Views).
- **Service usage**: Import `campaignService` from `$services` — already wired in the current ViewModel.
- **Campaign summary card**: New component under `apps/frontend/client/src/lib/views/start/components/` — reuses `Campaign` type shape. No new Svelte page required.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- **Types**: No changes — `Campaign`, `CampaignState`, `CapabilityProfile` already exist in `@aikami/types` / `@aikami/schemas`.
- **ViewModels**: Modify `apps/frontend/client/src/lib/views/start/start_view_model.svelte.ts` — new interface methods, campaign-first state.
- **Views**: Modify `apps/frontend/client/src/lib/views/start/start_view.svelte`. New components in `apps/frontend/client/src/lib/views/start/components/` for campaign summary cards and load-campaign modal/list.
- **Services**: No changes — `campaignService` is already built (C-313).
- **Routes**: Use existing routes (`/setup`, `/game`, `/settings`). Optionally add a client-side route for load-campaign if a full-page view is used; otherwise a modal is sufficient.

## State & Data Models

No new schema or type changes. The `Campaign` type from `@aikami/types` is the data model:

```typescript
// packages/shared/types/src/lib/game/campaign.ts (existing, read-only)
export type { Campaign, CampaignState, CapabilityProfile } from '@aikami/schemas';
```

```typescript
// packages/shared/schemas/src/lib/game/campaign.ts (existing, read-only)
export type CampaignState = 'idle' | 'creating' | 'loading' | 'playing' | 'paused' | 'saving' | 'failed';

export type CapabilityProfile = {
  textProvider: boolean;
  imageProvider: boolean;
  voiceProvider: boolean;
};

export type Campaign = {
  id: string;
  name: string;
  state: CampaignState;
  personaId?: string;
  contentPackId: string;
  seed: number;
  createdAt: string;
  updatedAt: string;
  lastSavedAt?: string;
  lastSaveSlotId?: string;
  capabilityProfile: CapabilityProfile;
};
```

**ViewModel-level derived shape** (not a schema — computed display state):

```typescript
// apps/frontend/client/src/lib/views/start/start_view_model.svelte.ts
/** Display-ready summary of a campaign for the start menu. */
type CampaignSummary = {
  /** Campaign ID. */
  id: string;
  /** Display name. */
  name: string;
  /** ISO timestamp of last save, or undefined if never saved. */
  lastSavedAt: string | undefined;
  /** Content pack display label. */
  contentPackLabel: string;
  /** Whether the campaign is resumable (state is playing, paused, or saving). */
  isResumable: boolean;
  /** AI capability indicators. */
  capabilities: CapabilityProfile;
};
```

## Quality Requirements

Check each that applies. Use "N/A — reason" when genuinely irrelevant.

- **Offline/degraded mode**: Campaign data is local IndexedDB — fully offline. AI capability status is advisory only (read from `aiSettingsService` at render time). No network required.
- **Accessibility/input**: **Required** — keyboard navigation (Tab order through buttons, Enter/Space to activate). Basic gamepad support (d-pad up/down through menu items, A to select). All buttons have `role="button"` or are native `<button>` elements. Escape closes modals.
- **Performance budget**: Start menu must render in under 500ms from mount. Campaign list from IndexedDB `getAll()` must complete in under 200ms. Memory: campaign cards are lightweight (no images in Phase 1).
- **Security/privacy**: N/A — no new auth surfaces. The start menu already handles Google sign-in; this contract doesn't change auth flow.
- **Persistence/migration**: Old `aikami-characters` localStorage data is read-only (not migrated). Campaigns live in IndexedDB `aikami_saves` v2 `campaigns` store (already created by C-313). The old `gameSaveService` `saves` store is untouched — Continue is rewired to read campaigns, not save slots.
- **Cancellation/retry/idempotency**: `startNewCampaign()` is guarded by `isBusy` in `campaignService` — double-click safe. `loadCampaign()` validates the campaign ID exists before transitioning. Destructive "New Adventure" while a campaign exists shows a confirmation dialog.
- **Observability**: ViewModel inherits `this.debug()`, `this.warn()`, `this.error()` from `BaseViewModel`. Log: campaign list load, New Adventure start, Continue selection, Load Campaign open.

## Migration & Rollback

N/A — no persistent state changes. The `Campaign` schema and IndexedDB store already exist (C-313). The `aikami-characters` localStorage key is not migrated or removed — it's simply no longer read by the start menu. Rollback restores `start_view_model.svelte.ts` to its current persona-based branching; the campaign store coexists peacefully.

## Scope Boundaries

- **In Scope:**
  - Rewrite `start_view_model.svelte.ts`: remove `_getCharacterCount`, `_startWithExistingCharacter`, `availableSaves` (from `gameSaveService`). Replace with `campaigns`, `latestResumableCampaign`, campaign-first flow methods.
  - Rewrite `start_view.svelte`: new button hierarchy (Continue → New Adventure → Load Campaign → Settings), secondary actions (account, credits, quit).
  - Add `CampaignSummaryCard` component: shows campaign name, content pack, last-saved time, AI capability badges.
  - Add `LoadCampaignModal` or `LoadCampaignList` component: shows all campaigns as summary cards, sorted newest first.
  - Wire Continue to `campaignService.getLatestCampaign()` filtered to resumable states (`playing | paused | saving`).
  - Wire New Adventure to always call `campaignService.startNewCampaign()` then route to `/setup`.
  - Add destructive confirmation dialog when starting a new adventure while a resumable campaign exists.
  - Add keyboard navigation (Tab order, Enter/Space) and basic gamepad d-pad support.
  - Preserve existing auth, credits, settings, and Tauri quit flows.
  - Preserve the missing-provider check as a soft advisory, not a hard block.
- **Out of Scope:**
  - `/characters` route redesign — belongs to C-319 (Fast Character Onboarding).
  - `/game` boot flow — belongs to C-321 (Atomic Game Boot).
  - Content pack browser — belongs to C-340 (Campaign/Content-Pack Browser).
  - Save/load system changes — belongs to C-329 (Local Save, Continue, Autosave).
  - Visual tests for the start menu — deferred to visual suite, not part of this contract's ACs.
  - Migration of old localStorage `aikami-characters` to campaign format — not required; old data is silently ignored.
  - Changes to `campaignService` or `campaignRepository` — those are C-313 and are already implemented.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** 5 ACs, 1 project (client). All ACs touch the same View/ViewModel pair. Size is acceptable — no split needed.

## Acceptance Criteria

### AC-1: Continue Shows Only for Resumable Campaigns
**Given** the player has campaigns in IndexedDB, where at least one is in a resumable state (`playing`, `paused`, or `saving`).
**When** the start menu loads and `campaignService.refreshCampaigns()` completes.
**Then** the **Continue** button is visible and shows the latest resumable campaign's name and last-saved timestamp. If no resumable campaigns exist, the Continue button is hidden.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit | `apps/frontend/client/src/lib/views/start/start_view_model.test.ts` | `/` (start menu) | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test`
- Integration: Manual browser check — seed a campaign with state `playing`, reload, verify Continue appears. Delete all campaigns, verify Continue is hidden.
- E2E / Visual:
    - **Functional**: `apps/e2e/tests/client/start_menu.spec.ts` — test that Continue visibility toggles based on campaign state.
    - **Visual**: N/A — start menu visual tests are deferred.

**Watch Points**:
- Campaigns in `failed` state must NOT trigger Continue visibility.
- Campaigns in `creating` or `loading` state (incomplete boot) must NOT show as resumable.

### AC-2: New Adventure Always Creates a Fresh Campaign Draft
**Given** the player is on the start menu, regardless of how many campaigns, personas, or saves exist.
**When** the player clicks **New Adventure**.
**Then** `campaignService.startNewCampaign()` is called, a new `Campaign` is created with `state: 'creating'` and `contentPackId: 'emberwatch'`, and the player is routed to `/setup` for character creation.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit | `apps/frontend/client/src/lib/views/start/start_view_model.test.ts` | `/` → `/setup` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test`
- Integration: Manual browser check — click New Adventure with 0, 1, or 3 existing campaigns. Every time, verify navigation to `/setup` and a new campaign in IndexedDB.
- E2E / Visual:
    - **Functional**: `apps/e2e/tests/client/start_menu.spec.ts` — verify New Adventure always routes to `/setup` regardless of prior state.
    - **Visual**: N/A.

**Watch Points**:
- No character-count check — the old `_getCharacterCount()` and `_startWithExistingCharacter()` code paths must be removed.
- The text provider check remains: if no provider is configured, the missing providers dialog is shown as advisory, not a hard block (player can still proceed offline).

### AC-3: Load Campaign Shows All Campaigns as Summary Cards
**Given** the player has one or more campaigns in IndexedDB.
**When** the player clicks **Load Campaign**.
**Then** a modal or list view displays all campaigns, each rendered as a summary card showing: campaign name, content pack label, last-saved date (or "Not yet saved"), and AI capability badges (text/image/voice availability). Cards are sorted newest-first by `updatedAt`. Clicking a card loads that campaign via `campaignService.loadCampaign()`.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Unit | `apps/frontend/client/src/lib/views/start/start_view_model.test.ts` | `/` → Load Campaign modal | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test`
- Integration: Manual browser check — open Load Campaign modal, verify cards display correct names, dates, and capability state.
- E2E / Visual:
    - **Functional**: `apps/e2e/tests/client/start_menu.spec.ts` — open load modal, verify campaign list renders, click a campaign, verify navigation to `/game`.
    - **Visual**: N/A.

**Watch Points**:
- Empty state: if no campaigns exist, the Load Campaign button is disabled or shows "No campaigns found" in the modal.
- Campaigns in `failed` state are shown but the load action is prevented (error toast).

### AC-4: Destructive Confirmation Before Overwriting Active Campaign
**Given** the player has a resumable campaign (state `playing`, `paused`, or `saving`).
**When** the player clicks **New Adventure**.
**Then** a confirmation dialog is shown: "Start a new adventure? Your current progress will be saved and a new campaign will be created." The player must confirm before `startNewCampaign()` is called.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Unit | `apps/frontend/client/src/lib/views/start/start_view_model.test.ts` | `/` → confirmation dialog | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test`
- Integration: Manual browser check — with a resumable campaign active, click New Adventure. Verify dialog appears. Cancel → no action. Confirm → new campaign created, navigate to `/setup`.
- E2E / Visual:
    - **Functional**: `apps/e2e/tests/client/start_menu.spec.ts` — test confirmation dialog appears and behaves correctly.
    - **Visual**: N/A.

**Watch Points**:
- No confirmation when no resumable campaigns exist — just route directly.
- The existing campaign is NOT deleted; it remains in IndexedDB and is loadable from Load Campaign.

### AC-5: Keyboard and Gamepad Navigation
**Given** the player is on the start menu.
**When** the player uses Tab/Shift+Tab or gamepad d-pad up/down.
**Then** focus moves through menu buttons in the visible order: Continue → New Adventure → Load Campaign → Settings → (account actions) → Credits → (Quit if Tauri). Enter/Space or gamepad A activates the focused button. Escape closes any open modal. Arrow keys do not scroll the page when gamepad mode is active.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | Unit + Integration | `apps/frontend/client/src/lib/views/start/start_view_model.test.ts` (focus order unit test), manual keyboard + gamepad verification | `/` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test` (keyboard focus order unit test)
- Integration: Manual browser check — Tab through all buttons, verify correct order. Press Enter on each, verify correct action. Connect gamepad, verify d-pad navigation and A-button selection.
- E2E / Visual:
    - **Functional**: `apps/e2e/tests/client/start_menu.spec.ts` — keyboard Tab + Enter to navigate and activate buttons. Gamepad simulation if Playwright supports it.
    - **Visual**: N/A.

**Watch Points**:
- Tauri Quit button must be in Tab order only when `isTauri` is true.
- Modals (credits, load campaign, confirmation) must trap focus when open.
- Google Sign-In state change does not steal focus.

## Implementation Sequence

1. **Phase 1 (ViewModel)**: Rewrite `start_view_model.svelte.ts` — remove persona branching, add campaign-first state (`campaigns`, `latestResumableCampaign`, `campaignSummaries`), new methods (`startNewAdventure`, `continueLatestCampaign`, `openLoadCampaign`, `loadCampaignById`). Wire confirmation dialog state. Add keyboard focus management.
2. **Phase 2 (Views)**: Rewrite `start_view.svelte` — new button hierarchy. Add `CampaignSummaryCard.svelte` and `LoadCampaignModal.svelte` components. Wire keyboard/gamepad handlers. Add confirmation dialog.
3. **Phase 3 (Validation)**: Run `bun moon run client:test` for unit tests. Run `bun moon run :validate` for full CI check. Manual keyboard/gamepad verification.

## Edge Cases & Gotchas

- **Zero campaigns on first launch**: Continue hidden, Load Campaign disabled. New Adventure is the only primary action.
- **One campaign in `creating` state (interrupted setup)**: It is NOT resumable — Continue hidden. It IS shown in Load Campaign with a warning state. Clicking it routes to `/setup` to resume character creation, not `/game`.
- **Campaign in `failed` state**: Shown in Load Campaign with error indicator. Load action is blocked — show toast with error message.
- **`campaignService.refreshCampaigns()` fails**: Show a degraded state — Continue hidden, Load Campaign disabled with error indicator. New Adventure still works (it doesn't depend on existing campaigns).
- **Rapid double-click on New Adventure**: `campaignService.isBusy` gate prevents duplicate campaign creation. Confirmation dialog also acts as a debounce.
- **`aikami-characters` localStorage data coexisting**: Ignored by the new start menu. No migration, no cleanup. The `/characters` route may still use it until C-319.
- **Content pack label**: For Phase 1, `contentPackId` is always `'emberwatch'`. Map it to a human-readable label: "Emberwatch: The Fading Ward". Future: read from content pack manifest (C-315).

## Open Questions

None — all decisions are resolved by existing code and C-313's implemented campaign aggregate.

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
