# Contract C-332: Redesign the Minimal Game HUD and Overlay Navigation

## Metadata

| Field | Value |
|---|---|
| **Source** | TODO.md — Phase 1 — Playable, Polished, Offline-Capable Vertical Slice |
| **Target** | `apps/frontend/client/src/lib/views/game/ui/` (HUD components, overlay router, pause menu), `apps/frontend/client/src/lib/services/game/game_overlay_service.svelte.ts` (overlay stack), `apps/frontend/client/src/lib/views/game/game_view.svelte` (combat-aware canvas), `apps/e2e/` (tests) |
| **Priority** | P0 — production currently exposes capability overlays without a clear player hierarchy; always-visible essentials (HP, objective, interaction hint) are missing or scattered |
| **Dependencies** | C-125 (legacy_completed — overlay architecture), C-161 (completed — spatial UI camera), C-164 (completed — combat split-screen layout), C-213 (not_started per PROGRESS, clock HUD already mounted — reuse only), C-327 (implemented — interaction prompt + onboarding hints), C-329 (approved — quest tracker component exists but is orphan), C-330 (approved — combat state), C-331 (approved — inventory/vendor overlays) |
| **Status** | approved |
| **Promotion** | `integrated` — the HUD and overlay navigation already live on the production `/game` route; this contract redesigns them in place. Dev sandboxes are updated alongside. |
| **Docs Impact** | internal → none (player-facing HUD documentation lands with the Phase 1 release gate, C-335) |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: The game UI routes overlays through a flat `{#if}` chain in `game_ui_view.svelte` — exactly one overlay is active at a time, and there is no stack. Pressing Escape toggles the pause menu when nothing is open, or closes the current overlay. There is no formal "back" navigation: closing inventory returns to `NONE`, not to the previously-open overlay. No always-visible player HP exists in explore mode (HP is only visible in the combat sidebar). The autosave status tracked by `gameOverlayService.autoSaveStatus` is never displayed as a HUD element — only a snackbar toast fires. The quest tracker component (`quest_tracker_view.svelte`) was built for C-329 but never wired into `game_ui_view.svelte`. The Clock HUD, interaction prompt, and onboarding hint float independently with no coordinated layout zones. No focus trap or focus restore exists for overlay open/close. No `autofocus` attributes appear anywhere in the overlay views.

- **Reproduction**:
  1. Start the game at `/game`, wait for engine ready.
  2. Observe: no HP bar visible in explore mode. Clock HUD in top-right. Interaction prompt appears near NPCs at bottom-center.
  3. Press `i` to open inventory — overlay appears. Press Escape — overlay closes to `NONE`, not to any prior state.
  4. Press Escape — pause menu opens. "End Session" → "Return to Pause Menu" goes back to pause menu correctly, but this is a hardcoded transition, not a stack pop.
  5. Trigger combat — the canvas shrinks to 65vw but HUD elements (clock, interaction prompt) don't reposition or hide.
  6. Tab through the pause menu — focus order is unpredictable; no `aria-modal` focus trapping enforces it.

- **Existing implementation to reuse**:
  - `apps/frontend/client/src/lib/views/game/ui/game_ui_view.svelte` — overlay router (modify)
  - `apps/frontend/client/src/lib/views/game/ui/game_ui_view_model.svelte.ts` — overlay ViewModel (modify)
  - `apps/frontend/client/src/lib/services/game/game_overlay_service.svelte.ts` — overlay state + key handling (modify)
  - `apps/frontend/client/src/lib/views/game/ui/overlays/clock_hud/clock_hud.svelte` — clock HUD (reuse)
  - `apps/frontend/client/src/lib/views/game/ui/hud/interaction_prompt.svelte` — interaction prompt (reuse)
  - `apps/frontend/client/src/lib/views/game/ui/hud/onboarding_hint.svelte` — onboarding hint (reuse)
  - `apps/frontend/client/src/lib/views/game/ui/quest_tracker_view.svelte` — quest tracker (wire in)
  - `apps/frontend/client/src/lib/views/game/ui/quest_tracker_view_model.svelte.ts` — quest tracker VM (reuse)
  - `apps/frontend/client/src/lib/services/game/player_state_service.svelte.ts` — HP state (consume)
  - `apps/frontend/client/src/lib/views/game/ui/overlays/pause_menu/pause_menu_view.svelte` — pause menu (modify)
  - `apps/frontend/client/src/lib/views/game/game_view.svelte` — grid layout for combat (modify)
  - `apps/frontend/client/src/lib/services/game/game_overlay_service.test.ts` — baseline tests (extend)

- **Known gaps**:
  - No overlay stack — only a flat active overlay type, so "back" navigation can't return to prior overlay
  - No always-visible player HP bar in explore mode
  - No autosave indicator HUD element
  - Quest tracker component is orphan — not mounted in `game_ui_view.svelte`
  - HUD elements lack a shared layout zone system — they're absolutely positioned independently
  - No focus trap inside `PAUSE_MENU`, `INVENTORY`, `QUEST_LOG`, `CHARACTER_DASHBOARD`, `VENDOR`, `END_SESSION` overlays
  - No focus restore when an overlay closes — keyboard focus is lost
  - Combat grid layout (35vw sidebar) changes canvas dimensions but HUD elements ignore this
  - No input block on inappropriate overlay transitions (e.g., can't open inventory during dialogue but this is only enforced by the `handleKeyDown` handler, not a formal guard)
  - No notification area for transient events (autosave, item pickup, quest update)

- **Baseline tests**:
  - `apps/frontend/client/src/lib/services/game/game_overlay_service.test.ts` — 19 tests covering overlay open/close state transitions, keyboard handling, singleton export
  - `apps/e2e/tests/client/game_page.spec.ts` — 5 tests: canvas render, UI layer render, engine load, Escape → pause menu
  - `apps/e2e/tests/client/game_boot.spec.ts` — game boot E2E (adjacent)

## User Outcome

After this contract, a player can see their HP and current objective at all times during exploration, open and close overlays with predictable back-navigation, see when the game autosaves, and know that keyboard focus returns to the game after any overlay closes. Overlays feel like a coherent stack — pressing Back always does exactly one thing.

## Success Measures

- **Time/latency target**: HUD re-renders within one frame (16ms) on overlay open/close. No layout shift on overlay transitions.
- **Offline/degraded behavior**: HUD and overlays are 100% local — no network dependency. AI-related indicators (e.g., "AI summarizing" in end-session) already handled by C-327/C-240 patterns; no new AI dependency introduced.
- **Production journey enabled**: Player can enter the game world and immediately see their status (HP, active objective, interaction availability). Pressing Escape closes overlays predictably. Combat mode adapts the HUD to the narrower canvas. This establishes the UI foundation that C-333 (Settings), C-334 (Saves), and C-335 (Release Gate) build on.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Overlay router | `game_ui_view.svelte` (flat `{#if}` chain) | **Modify** — replace with stack-driven rendering |
| Overlay state machine | `game_overlay_service.svelte.ts` (`GameOverlayType`, single value) | **Modify** — add stack array, push/pop methods |
| Clock HUD | `overlays/clock_hud/clock_hud.svelte` | **Reuse** — reposition into HUD zone layout |
| Interaction prompt | `hud/interaction_prompt.svelte` | **Reuse** — reposition into HUD zone layout |
| Onboarding hint | `hud/onboarding_hint.svelte` | **Reuse** — keep as top-center toast |
| Quest tracker | `quest_tracker_view.svelte` (orphan) | **Reuse** — wire into HUD zone layout |
| Player HP state | `player_state_service.svelte.ts` (`playerHp`, `playerMaxHp`) | **Reuse** — consume for new HP bar component |
| Autosave state | `game_overlay_service.svelte.ts` (`autoSaveStatus`) | **Reuse** — consume for new autosave indicator |
| Pause menu | `overlays/pause_menu/pause_menu_view.svelte` | **Modify** — add focus trap, autofocus |
| Combat sidebar | `combat/combat_sidebar.svelte` | **Reuse** — no changes needed |
| Combat grid layout | `game_view.svelte` (CSS grid 35vw + 1fr) | **Modify** — pass combat state to HUD for layout adaptation |
| Key handling | `game_overlay_service.svelte.ts` (`handleKeyDown`) | **Modify** — route through overlay stack instead of flat check |
| Inventory, vendor, dialogue, game-over, end-session overlays | `overlays/*` | **Reuse** — no visual changes needed (focus trap is additive) |
| E2E tests | `apps/e2e/tests/client/game_page.spec.ts` | **Extend** — add overlay stack, HP bar, autosave indicator assertions |

## Overview

The current game UI is a flat overlay router with scattered, independently-positioned HUD elements. This contract establishes a minimal, coordinated game HUD with three zones (top-right status, bottom-center interaction, bottom-left objective) and replaces the flat overlay toggle with an explicit overlay stack. Pressing Escape always pops the top overlay — exactly one layer at a time. It adds the missing always-visible player HP bar and autosave indicator, wires the orphan quest tracker component, enforces focus trapping in every overlay, and makes the HUD combat-aware so elements don't overlap the combat sidebar or get clipped by the grid resize.

## Design Reference

- **Existing overlay patterns**: `game_ui_view.svelte` uses `{#if viewModel.activeOverlay === 'X'}` chains. This contract replaces the chain with a `$derived` stack of active overlays, keeping the same component-per-overlay pattern.
- **ViewModel delegation**: `game_ui_view_model.svelte.ts` already creates sub-ViewModels for each overlay via `$effect` — this pattern is preserved.
- **Service layer**: `game_overlay_service.svelte.ts` owns the overlay state as `$state` — the new stack is added here, with the existing `activeOverlay` property derived from the top of the stack.
- **HUD pattern**: `clock_hud.svelte` uses a self-contained absolute-positioned component. New HUD components follow the same pattern — no shared layout engine, just coordinated CSS zones.
- **Focus management**: DaisyUI modals provide `aria-modal` but no built-in focus trapping. Use a minimal `onkeydown` trap pattern consistent with existing `pause_menu_view.svelte` that already captures Escape.
- **Testing conventions**: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- **`apps/frontend/client/src/lib/services/game/game_overlay_service.svelte.ts`**: Add `overlayStack: GameOverlayType[]` ($state array), `pushOverlay(type)`, `popOverlay()`, `replaceOverlay(type)`. Derive `activeOverlay` from the top of the stack. Refactor `handleKeyDown` to call `popOverlay()` on Escape instead of the flat type-switch. Add guard methods (`canOpenOverlay(type): boolean`) that block inventory/vendor during combat, etc.
- **`apps/frontend/client/src/lib/views/game/ui/game_ui_view_model.svelte.ts`**: Expose `playerHp`, `playerMaxHp`, `hpPercent` (from `playerStateService`). Expose `autoSaveStatus` for HUD indicator. Expose `questTrackerViewModel`. Pass `isCombat` flag to HUD for layout adaptation.
- **`apps/frontend/client/src/lib/views/game/ui/game_ui_view.svelte`**: Add HUD bar with three zone slots. Add HP bar component (top-left zone). Add autosave indicator component (top-right zone, adjacent to clock). Wire `QuestTrackerView` (bottom-left zone). Keep interaction prompt and onboarding hint in their current positions. Render overlay stack — the top entry wins for full-screen overlays, but the HUD bar remains visible behind semi-transparent overlays (pause menu) and hidden behind opaque overlays (dialogue, combat, game over).
- **New HUD components**: `hud/hp_bar.svelte` — horizontal progress bar with `{hp}/{maxHp}` text. `hud/autosave_indicator.svelte` — small icon + text ("Saving…", "Saved", "Save failed") with auto-dismiss.
- **`apps/frontend/client/src/lib/views/game/game_view.svelte`**: Pass `isCombat` to `GameUIView` so the HUD layout adapts to the narrower canvas during combat grid mode.
- **Focus trap**: Add `onkeydown` focus-trap handler to `pause_menu_view.svelte`, `inventory_view.svelte`, `quest_view.svelte`, `vendor_view.svelte`, `character_sheet_view.svelte`, and `end_session_view.svelte`. Each overlay's outermost container element gets `autofocus` on mount and traps Tab/Shift+Tab within itself.
- **Focus restore**: When an overlay closes (stack pop), `game_overlay_service` stores the previously-focused element before push and restores focus to it on pop. If no stored element, focus the game canvas container.

## State & Data Models

```typescript
// ── Overlay Stack (adds to game_overlay_service.svelte.ts) ──

type GameOverlayType =
  | 'NONE'
  | 'PAUSE_MENU'
  | 'DIALOGUE'
  | 'COMBAT'
  | 'INVENTORY'
  | 'QUEST_LOG'
  | 'GAME_OVER'
  | 'CHARACTER_DASHBOARD'
  | 'VENDOR'
  | 'END_SESSION';

// Overlay stack entries — the active overlay is the top of the stack.
// 'NONE' is never pushed; an empty stack means no overlay.
type OverlayStackEntry = {
  type: GameOverlayType;
  /** Element that had focus before this overlay opened (for restore on pop). */
  previousFocus: HTMLElement | undefined;
};

// ── HUD Zone Layout (conceptual — implemented via CSS Tailwind classes) ──

// Three zones, all absolutely positioned within the game UI layer:
//
//   ┌────────────────────────────────────────────┐
//   │  top-left: HP bar        top-right: Clock  │
//   │                           + Autosave       │
//   │                                            │
//   │                                            │
//   │  bottom-left:            bottom-center:    │
//   │  Quest objective          Interaction hint │
//   └────────────────────────────────────────────┘
//
// HUD zones are pointer-events-none; child elements use pointer-events-auto.
// During combat (grid mode), top-right shifts left by 35vw to avoid the sidebar.

// ── HUD Visibility Rules ──

// HP bar:          visible during EXPLORE, hidden during COMBAT, PAUSE_MENU, GAME_OVER, END_SESSION
// Quest tracker:   visible during EXPLORE, hidden during PAUSE_MENU, COMBAT, GAME_OVER, END_SESSION
// Interaction hint: visible during EXPLORE, hidden when any overlay is active
// Clock + Autosave: visible during EXPLORE, hidden during PAUSE_MENU, GAME_OVER, END_SESSION
// Onboarding hint: visible during EXPLORE, hidden when any overlay is active

type HudVisibility = {
  hpBar: boolean;
  questTracker: boolean;
  interactionHint: boolean;
  clockHud: boolean;
  autosaveIndicator: boolean;
  onboardingHint: boolean;
};
```

## Quality Requirements

- **Offline/degraded mode**: N/A — all HUD data (HP, quest state, autosave status) is local; no network dependency.
- **Accessibility/input**: All new HUD elements use `role="status"` or `aria-live="polite"` for screen reader announcements. Focus trapping enforces `aria-modal` behavior in every overlay. Focus restore on overlay close ensures keyboard users don't get stranded. Tab order respects visual layout within overlays. HP bar and autosave indicator use semantic progress elements.
- **Performance budget**: HUD bar re-render: < 1 frame (16ms). Overlay open/close transition: < 100ms to first paint. No additional rAF callbacks beyond what the engine already drives. HUD components use `$derived` and `$state` — no manual subscription management.
- **Security/privacy**: N/A — no new data exposure. HP/quest state are already available to the client. No PII in HUD.
- **Persistence/migration**: No persistent state schema changes. Overlay stack is ephemeral (resets on game route navigation, which is the existing behavior). Focus state is DOM-only, not persisted.
- **Cancellation/retry/idempotency**: Overlay push/pop operations are synchronous and idempotent — pushing the same overlay type twice has no effect (guard in `pushOverlay`). Pop on empty stack is a no-op.
- **Observability**: `gameOverlayService` logs overlay push/pop with `this.debug('overlay:push' | 'overlay:pop', { type, stackDepth })`. Focus trap violations log a warning. Autosave indicator transitions logged.

## Migration & Rollback

N/A — no persistent state changes. The overlay stack is an in-memory data structure reset on navigation. The HUD layout is CSS-only. Rollback is a git revert.

## Scope Boundaries

- **In Scope:**
  - Overlay stack with push/pop semantics — Escape always pops exactly one layer
  - Always-visible HP bar during exploration (consumes `playerStateService.playerHp`/`playerMaxHp`)
  - Always-visible quest objective during exploration (wires the existing orphan `QuestTrackerView` into `game_ui_view.svelte`)
  - Autosave indicator HUD element (consumes `gameOverlayService.autoSaveStatus`)
  - HUD zone layout: three coordinated zones (top-left, top-right, bottom-left, bottom-center)
  - HUD visibility rules: which elements show/hide per overlay and combat state
  - Focus trapping in all modal overlays (Tab/Shift+Tab cycle within overlay)
  - Focus restore when overlay closes (return to element that was focused before overlay opened)
  - Combat-aware HUD positioning (HUD zones adapt to 35vw sidebar)
  - Overlay transition guards (block incompatible overlay combinations)
  - Pause menu layout cleanup — remove dev/debug controls if any remain; keep: Resume, Save, Settings, End Session, Replay Tutorial, Quit
  - Clock HUD repositioning from top-right absolute to HUD zone

- **Out of Scope:**
  - Settings redesign (C-333 — progressive disclosure, searchable settings)
  - Save system changes (C-334 — autosave logic, save slots, recovery)
  - Gamepad/touch/controller navigation (C-346 — focus system, touch controls)
  - Accessibility beyond focus management (screen-reader completeness, contrast/motion settings — C-346)
  - Minimap implementation (deferred — optional per TODO.md)
  - Notification system beyond autosave indicator (quest updates, loot notifications — deferred)
  - Combat UI redesign (C-330 owns combat sidebar; this contract only adapts HUD positioning)
  - Quest journal content (C-329 owns quest data; this contract only wires the tracker component)
  - Inventory/vendor/dialogue overlay UI changes (C-331, C-328 own those; this contract only adds focus trap)
  - Dev/debug controls — remove if present in pause menu, do NOT add new ones
  - AI involvement of any kind
  - Visual effects, animations, or transitions beyond existing patterns

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** 5 ACs — at the limit but coherent: all five serve one releasable capability (the game HUD and overlay navigation system). Projects touched: `client` (primary), `e2e` (test extension). The engine is not modified (HP state already flows through `playerStateService`; overlay state is client-only). No further split recommended.

## Acceptance Criteria

### AC-1: Always-Visible Minimal HUD Bar During Exploration
**Given** the game engine is running in `EXPLORE` mode with player HP at 85/100 and an active quest objective
**When** the player looks at the game screen
**Then** three HUD elements are visible: (a) an HP bar in the top-left showing "85/100" with a partially-filled progress bar, (b) the quest objective text in the bottom-left (e.g., "Emberwatch: Find Elder Thalia"), and (c) the interaction prompt at bottom-center when near an NPC (existing C-327 behavior). The HP bar uses `role="progressbar"` with `aria-valuenow`, `aria-valuemin`, `aria-valuemax`. The quest tracker is wired through the existing `QuestTrackerView` component.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | E2E + Visual | `apps/e2e/tests/client/game_page.spec.ts`, `apps/e2e/src/visual/suites/game_hud.visual.ts` (new) | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:typecheck && bun moon run :test`
- Integration: Manual check — load `/game`, wait for engine ready, verify HP bar shows in top-left, quest objective shows in bottom-left, interaction prompt appears near NPC
- E2E / Visual:
    - **Functional**: Extend `apps/e2e/tests/client/game_page.spec.ts` — add test: "should render HP bar during exploration" (assert `role="progressbar"` visible, text contains "{hp}/{maxHp}"). Add test: "should render quest tracker with active objective" (assert bottom-left text visible, not empty).
    - **Visual**: New suite `apps/e2e/src/visual/suites/game_hud.visual.ts` — test case "hud-exploration": route `/game`, verify HP bar in top-left zone, quest tracker in bottom-left zone, no overlap between HUD elements. AI evaluation prompt: "Score 90+: Three HUD zones visible (HP top-left, clock top-right, objective bottom-left). No overlapping elements. HP bar shows progress fill. Layout is clean and readable."

**Watch Points**:
- HP bar must gracefully handle HP=0 (dead) — show empty bar with "0/100"
- HP bar must handle maxHp changes (level-up) — the progress bar max attribute updates reactively
- Quest tracker must handle "no active quests" — hide entirely (existing behavior in `QuestTrackerView`)
- Disabled AI mode must not affect HUD visibility — nothing in the HUD depends on AI

### AC-2: Overlay Stack — Escape Pops Exactly One Layer
**Given** the player has the inventory overlay open (opened after the pause menu)
**When** the player presses Escape
**Then** the inventory overlay closes and the pause menu is visible (not `NONE`). When the player presses Escape again, the pause menu closes and the game returns to `EXPLORE` mode with the HUD bar visible. At no point does pressing Escape skip a layer or close multiple overlays at once.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit + E2E | `apps/frontend/client/src/lib/services/game/game_overlay_service.test.ts`, `apps/e2e/tests/client/game_page.spec.ts` | `/game` (pause → inventory → escape × 2) | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test -- --testPathPattern="game_overlay_service"`
- Integration: Manual check — press Escape → pause menu opens, press `i` → inventory opens (over pause menu), press Escape → inventory closes to pause menu, press Escape → pause menu closes to game
- E2E / Visual:
    - **Functional**: Extend `apps/e2e/tests/client/game_page.spec.ts` — add test: "should pop overlay stack one layer at a time on Escape" (open pause menu, open inventory, press Escape, assert pause menu visible, press Escape, assert game canvas visible)
    - **Visual**: N/A — overlay stack behavior is functional, not visual

**Watch Points**:
- Overlay stack must not allow duplicates — pushing the same overlay type twice is a no-op
- Popping an empty stack (Escape when no overlay open) must not error — it's a no-op
- Dialogue overlay close must return to `NONE`, not a prior overlay — dialogue is always a leaf in the stack
- Game Over overlay must clear the entire stack (it's terminal UI state)
- End Session must return to Pause Menu (not NONE) when cancelled
- Combat start must clear non-combat overlays from the stack (can't have inventory open during combat)

### AC-3: Autosave Indicator in HUD
**Given** the game engine triggers an autosave (first map load completes)
**When** the autosave status transitions through `saving → saved → idle`
**Then** an autosave indicator appears in the top-right HUD zone adjacent to the clock: (a) "Saving…" with a spinner during `saving`, (b) "Saved ✓" with a checkmark for 2 seconds during `saved`, (c) hidden during `idle`. If autosave fails (`error`), the indicator shows "Save failed ✗" for 3 seconds. The indicator uses `aria-live="polite"` for screen reader announcement.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Unit + E2E | `apps/frontend/client/src/lib/services/game/game_overlay_service.test.ts`, `apps/e2e/tests/client/game_page.spec.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test -- --testPathPattern="game_overlay_service"`
- Integration: Manual check — load `/game`, trigger map transition (walk to edge), verify autosave indicator appears during save and dismisses after "Saved"
- E2E / Visual:
    - **Functional**: Extend `apps/e2e/tests/client/game_page.spec.ts` — add test: "should show autosave indicator on map load" (assert indicator visible with "Saved" text within 5s of page load)
    - **Visual**: Included in `game_hud.visual.ts` — test case "hud-autosave": verify autosave indicator appears adjacent to clock in top-right without layout shift

**Watch Points**:
- Autosave indicator must not overlap or push the clock HUD — they share the top-right zone with horizontal layout
- Rapid autosave triggers (multiple map transitions) must not stack multiple indicators
- Autosave indicator must be hidden during PAUSE_MENU, GAME_OVER, and END_SESSION
- The existing snackbar toast for autosave should remain as a secondary feedback channel (don't remove it)

### AC-4: Focus Trap in Overlays and Focus Restore on Close
**Given** the player has opened the pause menu overlay
**When** the player presses Tab repeatedly
**Then** focus cycles through all focusable elements within the pause menu (Resume, Save, Settings, End Session, Replay Tutorial, Quit) and never escapes to the underlying game canvas or browser chrome. When the player presses Escape to close the pause menu, focus returns to the element that was focused before the overlay opened (the game canvas container if no specific element was focused).

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | E2E | `apps/e2e/tests/client/game_page.spec.ts` | `/game` (pause → tab × N → escape → focus check) | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run e2e:test -- --testPathPattern="game_page"`
- Integration: Manual check — open pause menu, press Tab 10 times, verify focus never leaves the menu. Press Escape, verify keyboard input reaches the game (WASD moves character)
- E2E / Visual:
    - **Functional**: Extend `apps/e2e/tests/client/game_page.spec.ts` — add test: "should trap focus in pause menu overlay" (open pause menu, tab through all buttons, assert focus never leaves dialog). Add test: "should restore focus on overlay close" (focus a button before opening overlay, open overlay, close, assert focus returns)
    - **Visual**: N/A — focus management is functional, not visual

**Watch Points**:
- Focus trap must work in all modal overlays: PAUSE_MENU, INVENTORY, QUEST_LOG, CHARACTER_DASHBOARD, VENDOR, END_SESSION
- Dialogue overlay (C-328) already handles its own focus — do not break existing dialogue focus behavior
- If no element was focused before overlay open (e.g., fresh page load), restore focus to `#game-canvas-container`
- Focus trap must not interfere with screen reader virtual cursor navigation
- `autofocus` attribute should be set on the most relevant element in each overlay (e.g., Resume button in pause menu, first item in inventory)

### AC-5: Combat-Aware HUD Layout
**Given** the player is in `EXPLORE` mode with the HUD bar visible
**When** combat starts and the game grid switches to `35vw sidebar + 1fr canvas`
**Then** the HUD elements reposition: (a) top-right zone (clock + autosave indicator) shifts to remain within the 1fr canvas area (not overlapping the combat sidebar), (b) HP bar hides during combat (the combat sidebar already shows detailed HP — avoids duplication), (c) interaction prompt hides during combat, (d) quest tracker hides during combat, (e) onboarding hint hides during combat. When combat ends and the grid returns to full-width, all HUD elements return to their exploration positions.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | E2E + Visual | `apps/e2e/tests/client/game_page.spec.ts`, `apps/e2e/src/visual/suites/game_hud.visual.ts` | `/game` (explore → combat trigger → HUD check) | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run e2e:test -- --testPathPattern="game_page"`
- Integration: Manual check — trigger combat via NPC (if available in Emberwatch), verify HUD elements hide/reposition during combat mode
- E2E / Visual:
    - **Functional**: Extend `apps/e2e/tests/client/game_page.spec.ts` — add test: "should hide interaction prompt during combat" (trigger combat, assert interaction prompt hidden). Add test: "should hide HP bar during combat" (trigger combat, assert HP bar not visible). Add test: "should reposition clock HUD during combat" (check clock position relative to combat sidebar)
    - **Visual**: Included in `game_hud.visual.ts` — test case "hud-combat": verify HUD elements reposition/hide during combat grid. AI evaluation prompt: "Score 90+: HP bar hidden (combat sidebar shows HP). Clock+autosave visible in top-right of canvas area (not overlapping sidebar). Interaction prompt and quest tracker hidden. No elements clipped by grid boundary."

**Watch Points**:
- HUD zone repositioning must be CSS-only (using a `data-combat` attribute or class on the HUD container) — no JavaScript layout calculations
- The combat sidebar changes the canvas size, not the HUD layer — HUD positions relative to the canvas container, not the viewport
- Combat start/end must not cause visible layout flicker — position changes should be synchronous with the grid change
- Game Over overlay during combat must still cover the full viewport (including sidebar)

## Implementation Sequence

1. **Phase 1 (Data/Logic)**: Add overlay stack to `game_overlay_service.svelte.ts` — `overlayStack` array, `pushOverlay()`, `popOverlay()`, `replaceOverlay()`, `canOpenOverlay()` guard. Derive `activeOverlay` from stack top. Refactor `handleKeyDown` to use stack operations. Add `previousFocusElement` tracking for focus restore. Add overlay compatibility matrix (e.g., INVENTORY can open over PAUSE_MENU but not over COMBAT). Expose `autoSaveStatus` for HUD consumption.

2. **Phase 2 (HUD Components)**: Create `hud/hp_bar.svelte` — consume `playerHp`/`playerMaxHp` from `playerStateService` via `GameUIViewModel`. Create `hud/autosave_indicator.svelte` — consume `autoSaveStatus` from `gameOverlayService` via `GameUIViewModel`. Define HUD zone CSS layout in `game_ui_view.svelte`. Wire `QuestTrackerView` into the HUD. Add `isCombat` prop to `GameUIView` from `GameView`. Add combat-aware CSS classes.

3. **Phase 3 (Focus Management)**: Add focus trap to all modal overlays (pause menu, inventory, quest log, character dashboard, vendor, end session). Implement `autofocus` on the primary action in each overlay. Implement focus restore in `game_overlay_service.popOverlay()`. Add `data-combat` attribute to HUD container for CSS-driven repositioning.

4. **Phase 4 (Validation)**: Extend `game_overlay_service.test.ts` with stack push/pop, guard, and focus restore tests. Extend `game_page.spec.ts` with HP bar, autosave indicator, overlay stack, focus trap, and combat-awareness assertions. Create `game_hud.visual.ts` visual test suite.

## Edge Cases & Gotchas

- **Rapid Escape mashing**: If the player presses Escape faster than Svelte reactivity propagates, the stack could pop multiple times before the View re-renders. Solution: `popOverlay()` checks `activeOverlay` synchronously (derived from `overlayStack[overlayStack.length - 1]`), so a second Escape before re-render sees the already-updated stack and pops the next layer correctly. This is the desired behavior — each keypress pops one layer.
- **Dialogue as leaf overlay**: Dialogue is always a leaf — if any overlay is open and dialogue starts (from NPC proximity), the stack is cleared and dialogue becomes the only overlay. The engine owns the dialogue trigger, not the UI. Closing dialogue should not restore a prior overlay.
- **Combat overlay transition**: Combat start must clear the stack (inventory can't be open during combat). The combat overlay is managed by `combatService`, not the overlay stack directly — `startCombat()` must call `gameOverlayService.clearStack()` before pushing `COMBAT`.
- **Game Over terminal state**: Game Over overlay is terminal — it must clear the stack and block Escape (the overlay has its own Respawn/Load buttons). The `handleKeyDown` handler must check for `GAME_OVER` before processing Escape.
- **HUD visibility during transitions**: The transition overlay (black fade) covers the HUD — this is existing behavior and should be preserved. HUD elements should not pierce through the transition.
- **Quest tracker with no quests**: The `QuestTrackerView` already handles this — `hasQuests` returns false and the component renders nothing. No additional guard needed.
- **HP bar during combat**: The combat sidebar already shows HP — the HUD HP bar should hide during combat to avoid duplication. The combat service calls `gameModeService.setMode('COMBAT')`, which the HUD can read via `isCombat` prop.
- **Overlay push guard during combat**: Opening inventory, quest log, character dashboard, or vendor during combat is blocked by the overlay guard. The `handleKeyDown` handler silently ignores these keypresses when combat is active (existing behavior, formalized by the guard).
- **Focus restore after route navigation**: If the player navigates away from `/game` with an overlay open, the overlay stack is destroyed with the component. No focus leak possible. On return, the game boots fresh with an empty stack.

## Open Questions

- **Should the HUD HP bar show during combat?** The combat sidebar already shows detailed HP in its top section. Showing an HP bar in the HUD during combat would duplicate information. **Recommendation**: Hide the HUD HP bar during combat — the combat sidebar is the authoritative HP display during encounters. This keeps the HUD minimal.
- **Should the quest tracker show during dialogue?** Dialogue is NPC conversation that may advance quests. **Recommendation**: Hide the quest tracker during dialogue — the dialogue overlay takes visual priority, and quest updates can fire an onboarding-hint-style toast post-dialogue if needed (out of scope for this contract).
- **Should overlay transitions animate?** Adding fade/slide animations to overlay open/close would improve perceived quality. **Recommendation**: No new animations in this contract — the existing backdrop blur transition is sufficient. Animation polish is deferred to C-163 (visceral feedback) or a future polish phase.

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
