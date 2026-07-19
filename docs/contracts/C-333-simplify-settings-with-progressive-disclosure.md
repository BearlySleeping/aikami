# Contract C-333: Simplify Settings with Progressive Disclosure

## Metadata

| Field | Value |
|---|---|
| **Source** | TODO.md — Phase 1 — Playable, Polished, Offline-Capable Vertical Slice |
| **Target** | `apps/frontend/client/src/lib/views/settings/settings_view.svelte`, `settings_view_model.svelte.ts`, settings registry, pause-menu `/settings` launch, in-game overlay |
| **Priority** | P0 — advanced configuration currently competes with basic player settings |
| **Dependencies** | C-127 (completed — tabbed layout), C-202 (completed — provider UX), C-219 (completed — component system), C-230 (completed — connection config), C-249 (completed — music DJ), C-318 (implemented — capability setup), C-332 (approved — HUD overlay stack) |
| **Status** | approved |
| **Promotion** | — |
| **Docs Impact** | user-facing — settings help page in `apps/frontend/docs/src/content/docs/` |
| **Contract version** | 1.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: The `/settings` page (and its route from the pause menu via `?from=game`) presents three equal-weight top-level tabs: **Game** (Display, Audio, Controls, Export & Data, Music, Autonomous NPCs), **AI Engine** (Text, Voice, Image, Advanced, Connections — the full `ProvidersView` from C-120/C-202), and **Agents** (agent list + editor). A first-time player sees 6 game sub-tabs, 5 AI-engine sub-tabs, and a full agent management UI — all equally prominent. There is no layering, no "simple mode," and no hiding of expert-level configuration behind a toggle. The pause menu's "Settings" button navigates to this full page; there is no in-game lightweight settings overlay.
- **Reproduction**:
  1. Start the client (`bun moon run client:dev`), open the start menu, navigate to `/settings`.
  2. Observe: three category tabs shown equally. Game sub-tabs include Export & Data, Music, Autonomous NPCs — domains irrelevant before the player has even started a campaign.
  3. Click "AI Engine" → full provider dashboard with Text/Voice/Image/Advanced/Connections tabs, API key fields, generation parameters (temperature, top_p, max_tokens), instruct template selectors, embedding model dropdowns, emotion method pickers.
  4. From in-game, press Escape → Pause Menu → Settings → same full page. No way to adjust a single setting (e.g. volume) without leaving the game world.
- **Existing implementation to reuse**:
  - `apps/frontend/client/src/lib/views/settings/settings_view.svelte` — tab layout (modify)
  - `apps/frontend/client/src/lib/views/settings/settings_view_model.svelte.ts` — category/sub-tab state (modify)
  - `apps/frontend/client/src/lib/views/settings/providers/providers_view_model.svelte.ts` — AI provider config (reuse, but gate behind Advanced)
  - `apps/frontend/client/src/lib/views/settings/display/`, `audio/`, `controls/` — per-section sub-ViewModels (reuse)
  - `apps/frontend/client/src/lib/views/settings/connection/` — connection manager (reuse in Advanced)
  - `apps/frontend/client/src/lib/views/settings/music/`, `export/`, `autonomous/` — existing sub-ViewModels (move to Advanced)
  - `apps/frontend/client/src/lib/views/game/ui/overlays/pause_menu/pause_menu_view_model.svelte.ts` — `goToSettings()` routes to `/settings?from=game` (modify to support inline overlay)
  - `apps/frontend/client/src/lib/services/game/game_overlay_service.svelte.ts` — overlay stack (add `SETTINGS` overlay type)
- **Known gaps**:
  - No progressive disclosure mechanism — no toggle, no section visibility filter.
  - No search/filter across settings keys.
  - No per-section reset; only a monolithic "reset all."
  - Display/audio changes have no immediate preview/revert pattern.
  - The `?from=game` context-aware close exists but no lightweight in-game overlay alternative.
  - No capability badges (e.g. "AI connected" / "no AI configured" indicators) in the settings header.
  - Keyboard/gamepad navigation is unimplemented for settings tabs.
- **Baseline tests**:
  - `apps/frontend/client/src/lib/views/settings/providers/providers_view_model.test.ts` — provider config tests
  - No existing settings-view or progressive-disclosure tests.

## User Outcome

After this contract, a **player** can open Settings and immediately see only the sections they need to play: Gameplay, Controls, Audio, Display, and AI & Privacy. With one click they can connect an AI provider (or confirm offline demo mode). Advanced configuration — agents, automation, music DJ, export, full provider dashboards — is hidden behind an "Advanced" toggle. In-game, a lightweight settings overlay accessible from the pause menu lets them adjust volume or brightness without leaving the game world. Settings are searchable and each section can be reset independently.

## Success Measures

- **Time/latency target**: Settings page renders and is interactive within 500ms of navigation; toggle between Basic and Advanced modes is instant (no layout shift).
- **Offline/degraded behavior**: All settings affecting local gameplay (display, audio, controls) remain functional without any AI provider configured. AI & Privacy section shows a clear "no AI connection" state with a call-to-action to Capability Setup (C-318) or an explicit "Play Offline" confirmation.
- **Production journey enabled**: A first-time player can open Settings, set controls/audio/display preferences, and connect exactly one AI provider (or confirm offline mode) without exposure to raw generation parameters, agent pipelines, or provider jargon.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Tabbed settings shell | `settings_view.svelte` + `settings_view_model.svelte.ts` | Modify — add Basic/Advanced toggle, restructure sections |
| Display settings | `display/settings_display_view_model.svelte.ts` + view | Reuse |
| Audio settings | `audio/settings_audio_view_model.svelte.ts` + view | Reuse |
| Controls settings | `controls/settings_controls_view_model.svelte.ts` + view | Reuse |
| **Gameplay summary** *(new)* | — | **Create** — options overview section (language, region, accessibility quick-toggles) |
| AI & Privacy panel *(new)* | C-318 capability flow, `config_service.svelte.ts` | **Create** — simplified connection status + offline mode + privacy toggles |
| AI Provider dashboard | `providers/providers_view_model.svelte.ts` + view | Reuse — gate behind Advanced; extract simplified "AI & Privacy" subset |
| Connection manager | `connection/connection_manager_view_model.svelte.ts` | Reuse — move to Advanced |
| Music DJ | `music/settings_music_view_model.svelte.ts` + view | Reuse — move to Advanced |
| Export & Data | `export/export_view_model.svelte.ts` + view | Reuse — move to Advanced |
| Autonomous NPCs | `autonomous/autonomous_settings_view_model.svelte.ts` + view | Reuse — move to Advanced |
| Agent list/editor | `agent/list/` + `agent/editor/` | Reuse — move to Advanced |
| Overlay stack (C-332) | `game_overlay_service.svelte.ts` | Modify — add `SETTINGS` overlay type |
| Pause menu settings launch | `pause_menu_view_model.svelte.ts` → `goToSettings()` | Modify — support inline overlay + full-page modes |
| Context-aware close | `settings_view_model.svelte.ts` → `closeSettings()` | Modify — handle overlay-pop vs route-navigate |
| Capability detection | `config_service.svelte.ts` + C-318 | Reuse — drive capability badges |

## Overview

Restructure Settings around progressive disclosure: a Basic mode surfaces only Gameplay, Controls, Audio, Display, and AI & Privacy (simplified AI connection + offline confirmation). An Advanced toggle reveals Connections, Agents, Automation (autonomous NPCs), Music, Export & Data, and the full provider dashboard. Add search across all visible settings keys. Wire an in-game lightweight settings overlay through the C-332 overlay stack so players can adjust volume/brightness/controls without leaving `/game`. Each section gets independent reset. Display/audio changes preview immediately and revert on close-without-save.

## Design Reference

- **Current tab pattern**: `settings_view.svelte` uses `CATEGORIES` and `GAME_SUB_TABS` static arrays driving `{#each}` loops — extend this pattern with a visibility filter gated on `viewModel.isAdvanced`.
- **Overlay pattern**: `game_ui_view.svelte` maps `GameOverlayType` to overlay components via `{#if}` / `{:else if}` — follow the same pattern for a new `SETTINGS` overlay entry.
- **Sub-ViewModel containment**: The `SettingsViewModel` constructor creates every sub-ViewModel eagerly. For Advanced-only sub-ViewModels, defer creation until the toggle is first activated to avoid unnecessary init.
- **Provider connection simplicity**: C-318's capability flow already has a "connect one provider" guided experience. The AI & Privacy basic section should reuse that flow's detection results and offer a single "Connect AI" or "Continue Offline" choice — not the full provider dashboard.
- **`as const` / `satisfies`**: Settings section registries use `as const` on literal arrays and `satisfies` for type-checking (per `aikami-conventions`).

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

Use domain-level names and logical paths. Let Pi decide exact file placement based on its `aikami-conventions` skill.

- **Settings section registry**: Define a typed registry of all settings sections with metadata (id, label, category: `basic` | `advanced`, icon, search keywords). This drives both the tab UI and search. Living in the ViewModel file or a co-located `settings_sections.ts`.
- **Basic/Advanced toggle**: A single `$state` boolean `isAdvanced` in `SettingsViewModel`. When false, only `basic` sections render in the tab bar and content area. When true, all sections render with the advanced ones visually grouped under an "Advanced" divider.
- **AI & Privacy (basic)**: A simplified panel showing (a) AI connection status (capability badge from `configService` — "Connected" / "Offline" / "Not Configured"), (b) a single "Connect AI Provider" button routing to C-318's capability flow or a simplified connection picker, (c) privacy toggles (telemetry opt-out, local-only mode).
- **In-game overlay**: Add `SETTINGS` to `GameOverlayType`. Create `game/ui/overlays/settings/` with a lightweight ViewModel that composes only the sections relevant during gameplay (Audio, Display, Controls — maybe a simplified AI status). Reuses the same sub-ViewModels. The full-page `/settings` route continues to work for main-menu access.
- **Search**: A text input at the top of settings. As the user types, filter visible sections to those whose labels or keywords match. Non-matching sections hide. Clear the search to restore full visibility. Respect the Basic/Advanced toggle (searching in Basic mode only searches basic sections).
- **Per-section reset**: Each sub-ViewModel gains a `reset()` method. The section header renders a "Reset to defaults" button. Not a global reset — targeted.
- **Immediate preview/revert**: Display and Audio settings apply changes immediately via their respective services on every change. On "Close" or "Cancel," if the user hasn't explicitly saved, revert to the last-saved state.
- **Capability badges**: Use `configService.isLoaded` and provider status to render small badges in the settings header: "AI: Connected" (green) / "AI: Offline" (yellow) / "AI: Not Set Up" (gray).

## State & Data Models

```typescript
// Settings section registry entry
type SettingsSection = {
  /** Unique section identifier — matches existing sub-tab IDs where applicable */
  id: string;
  /** Display label */
  label: string;
  /** Which disclosure tier this section belongs to */
  category: 'basic' | 'advanced';
  /** Icon identifier (heroicon or inline SVG) */
  icon: string;
  /** Search keywords for fuzzy matching */
  keywords: readonly string[];
  /** Optional capability key for badge display */
  capabilityKey?: string;
};

// AI & Privacy panel state (basic section)
type AIPrivacyState = {
  /** Derived from configService — is any AI provider configured and verified? */
  readonly isAiConnected: boolean;
  /** Derived from configService — which provider is active */
  readonly activeProvider: string | undefined;
  /** Offline mode toggle — when true, no AI calls are attempted even if configured */
  readonly offlineMode: boolean;
  /** Telemetry opt-out */
  readonly telemetryOptOut: boolean;
};

// Settings search state
type SettingsSearchState = {
  /** Current search query */
  query: string;
  /** Sections that match the current query (empty query = all visible sections) */
  readonly visibleSections: readonly string[];
};
```

Existing types that remain unchanged:

- `SettingsCategory` ('game' | 'ai_engine' | 'agents') — replaced by the section registry; the old enum becomes a derived grouping.
- `GameSubTab` — dissolved; each former sub-tab becomes a section entry in the registry.
- All sub-ViewModel interfaces (`SettingsDisplayViewModelInterface`, etc.) — unchanged.

## Quality Requirements

- **Offline/degraded mode**: Settings page fully functional offline. AI & Privacy section shows clear offline status. Display/Audio/Controls work without any network. Advanced sections that depend on live services (voice test, model fetch) show degraded state with a "Requires connection" hint when offline.
- **Accessibility/input**: All settings controls reachable via Tab key in logical order. Toggle switches and sliders operable with Space/Arrow keys. Search input auto-focuses on open and traps focus while typing. Escape clears search or closes the overlay/settings page. Section headers are proper `<h2>`/`<h3>` for screen-reader hierarchy. Capability badges have `aria-label` describing status.
- **Performance budget**: Settings page initial render < 500ms. Advanced toggle must not cause layout shift — reserve space or use CSS `visibility`/`opacity` transitions. Search filtering is synchronous (no network) and responds within 16ms (one frame). Deferred sub-ViewModel creation for Advanced sections avoids unnecessary service instantiation.
- **Security/privacy**: API keys already masked (`••••`) in the providers view — this contract does not change that. The new "Privacy" subsection adds telemetry opt-out which must persist to `configService` and be respected by the logger. No new sensitive data paths.
- **Persistence/migration**: The section registry changes how settings are *displayed*, not how they are *stored*. `configService` state shape is unchanged. Per-section reset must write through the same `configService.set*()` paths as the individual controls.
- **Cancellation/retry/idempotency**: "Close without saving" for display/audio reverts changes. Per-section reset is idempotent (resetting to defaults twice is safe). Save is debounced (existing 800ms debounce reused).
- **Observability**: Logging via `this.debug()` in ViewModels for toggle, search, section reset, and overlay open/close. No new metrics required.

## Migration & Rollback

N/A — no persistent state changes. Section visibility is UI-only state; all settings data continues through `configService`. The `SETTINGS` overlay type added to `GameOverlayType` is additive — removing it falls back to the existing full-page `/settings` route. No data migration needed.

## Scope Boundaries

- **In Scope:**
  - Progressive disclosure (Basic/Advanced toggle) restructuring settings sections
  - AI & Privacy simplified panel (connection status, offline mode, telemetry toggle)
  - Search/filter across settings sections
  - Per-section reset
  - Immediate preview/revert for Display and Audio
  - Context-aware Close (overlay-pop from game, navigate-to-start from main menu)
  - In-game lightweight settings overlay via C-332 overlay stack
  - Capability badges in settings header
  - Keyboard navigation (Tab, Escape, Arrow keys)
- **Out of Scope:**
  - Changing how individual settings values are stored (configService unchanged)
  - Modifying the provider dashboard internals (`providers_view_model.svelte.ts`)
  - Gamepad navigation (C-346 handles full input coverage)
  - Mobile/responsive layout (C-346)
  - Settings import/export (C-359)
  - Content-pack-level settings defaults
  - AI provider capability *detection* itself (C-318, C-322 own that)

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** 5 ACs across one primary view and one new overlay. All changes are within `apps/frontend/client/src/lib/views/settings/` and `apps/frontend/client/src/lib/views/game/ui/overlays/`. Single project affected (client). No split needed.

## Acceptance Criteria

### AC-1: Basic Mode Shows Only Essential Settings
**Given** a first-time player with no prior configuration
**When** they open Settings from the start menu or in-game pause menu
**Then** only Basic sections are visible: Gameplay (options summary), Controls (keybindings), Audio (volume, mute), Display (resolution, fullscreen, brightness), and AI & Privacy (connection status + single "Connect AI" action + offline toggle + telemetry toggle). No generation parameters, provider dashboards, agent lists, music DJ, export, or autonomous NPCs are visible.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | E2E + Visual | `tests/client/settings.spec.ts`, `suites/settings.visual.ts` | `/settings`, `/game` → Pause → Settings | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:typecheck`
- Integration: Navigate to `/settings`, verify only 5 section tabs visible; open from in-game pause menu, verify same. Count rendered section headers.
- E2E / Visual:
    - **Functional**: `tests/client/settings.spec.ts` — test "settings page shows only basic sections by default" using `$pom` POMs. Verify section count = 5. Verify Advanced sections not in DOM.
    - **Visual**: `suites/settings.visual.ts` — `defineConfig` entry for `/settings` route. AI evaluation prompt: "Score 90+: Settings page shows exactly 5 section tabs (Gameplay, Controls, Audio, Display, AI & Privacy). No generation parameters, agent editors, or export sections visible. Clean tab bar with clear labels."

**Watch Points**:
- The "AI & Privacy" section must render even when `configService.isLoaded` is false (initial state). Show a loading skeleton or "Loading..." placeholder until config loads.
- The pause menu "Settings" option must still work; ensure `?from=game` still reaches the overlay or page correctly.

### AC-2: Advanced Toggle Reveals Hidden Sections
**Given** Settings is open in Basic mode
**When** the user clicks the "Advanced" toggle (or presses a keyboard shortcut)
**Then** additional sections appear: Connections, Agents, Automation (Autonomous NPCs), Music, Export & Data. The AI & Privacy section expands to include the full provider dashboard. Toggling Advanced off hides them again without losing any unsaved changes in the basic sections.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | E2E | `tests/client/settings.spec.ts` | `/settings` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:typecheck`
- Integration: Toggle Advanced on → verify Connections, Agents, Automation, Music, Export sections appear. Toggle off → verify they disappear. Verify basic section state preserved across toggles.
- E2E / Visual:
    - **Functional**: `tests/client/settings.spec.ts` — test "advanced toggle reveals hidden sections." Toggle on, count sections ≥ 10. Toggle off, count = 5. Change audio volume in Basic mode, toggle Advanced on/off, verify volume unchanged.
    - **Visual**: N/A — this is a functional toggle behavior, not a distinct visual layout.

**Watch Points**:
- Sub-ViewModels for advanced sections should be lazily created on first Advanced toggle to avoid unnecessary init. The toggle must be instant — no async loading.
- If the user has advanced sections open and toggles Advanced off, any unsaved advanced-section changes are lost (acceptable — advanced sections are expert territory; add a confirmation dialog if `isAdvanced` is toggled off while advanced fields are dirty).

### AC-3: Search Filters Settings Sections
**Given** Settings is open (Basic or Advanced mode)
**When** the user types in the search field (e.g. "vol" or "key")
**Then** only sections whose labels or keywords match the query remain visible. Non-matching sections hide. Clearing the search restores the previous visibility state. Search respects the Basic/Advanced toggle — searching in Basic mode only searches basic sections.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Unit + E2E | `tests/client/settings.spec.ts` | `/settings` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test -- -- settings_search` (unit test for filter logic)
- Integration: Type "audio" → only Audio section visible. Type "keybind" → only Controls visible. Type "zzz" → "No settings found" empty state. Clear search → all sections return. In Basic mode, search "agent" → no results (Agents is advanced). Toggle Advanced on, search "agent" → Agents section appears.
- E2E / Visual:
    - **Functional**: `tests/client/settings.spec.ts` — test "search filters settings sections." Cover: exact match, partial match, no match, clear, cross-tier search in Basic vs Advanced.
    - **Visual**: N/A — search is functional, not visual.

**Watch Points**:
- Search must be debounced (150ms) to avoid jank during fast typing.
- The search input should auto-focus when Settings opens (both full-page and overlay) so the user can start typing immediately.
- Non-matching sections should be `display: none`, not just opacity-hidden, to avoid Tab-key navigation into invisible controls.

### AC-4: In-Game Settings Overlay via Pause Menu
**Given** the player is in an active game session
**When** they press Escape → Pause Menu → "Settings"
**Then** a lightweight Settings overlay appears on top of the paused game (not a full-page route navigation). It shows Basic sections (Controls, Audio, Display, AI status). Closing the overlay returns to the pause menu (not to the start menu). The game world remains visible and paused beneath. Pressing Escape from within the settings overlay pops it and returns to the pause menu.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | E2E + Visual | `tests/client/settings.spec.ts`, `suites/settings.visual.ts` | `/game` → Pause → Settings | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:typecheck`
- Integration: Start game, open pause menu, click Settings → verify overlay renders, verify game canvas still visible behind semi-transparent backdrop. Click Close → verify back on pause menu. Press Escape from overlay → verify back on pause menu.
- E2E / Visual:
    - **Functional**: `tests/client/settings.spec.ts` — test "in-game settings overlay." Navigate to `/game`, wait for engine ready, trigger pause menu, open Settings overlay, adjust volume, close, verify back at pause menu, resume, verify game running.
    - **Visual**: `suites/settings.visual.ts` — entry for in-game overlay state. AI evaluation prompt: "Score 90+: Settings overlay is a centered modal with semi-transparent backdrop. Game world (map, sprites) visible behind the backdrop. Overlay shows Audio, Display, Controls sections. No full-page navigation."

**Watch Points**:
- The overlay must use the C-332 overlay stack — `pushOverlay('SETTINGS')` → rendered by `game_ui_view.svelte`. Escape pops the overlay per C-332's single-layer-pop rule.
- The overlay's settings state (volume slider position, etc.) must be the same as the full-page `/settings` route — both read from the same `configService`.
- Do NOT pause the engine a second time (it's already paused by the pause menu overlay beneath).

### AC-5: Per-Section Reset and Immediate Preview/Revert
**Given** Settings is open with modified values in Display or Audio sections
**When** the user clicks "Reset to defaults" on a specific section (e.g. Audio)
**Then** only that section's values revert to factory defaults. Other sections are unaffected. Additionally, Display and Audio changes take effect immediately (resolution change, volume change) without requiring a "Save" click. If the user closes Settings without explicitly saving, the pre-open values are restored.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | E2E | `tests/client/settings.spec.ts` | `/settings` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:typecheck`
- Integration: Change volume to 80%, change brightness to 50%. Click "Reset to defaults" on Audio → volume returns to default, brightness stays at 50%. Change volume again, close settings without saving → reopen → volume at pre-change value. Change display resolution → verify Tauri window resizes immediately.
- E2E / Visual:
    - **Functional**: `tests/client/settings.spec.ts` — test "per-section reset" and "preview/revert on close." Mock or spy on `configService` to verify reset scope. Test that close-without-save reverts.
    - **Visual**: N/A — behavior verified functionally.

**Watch Points**:
- Per-section reset must call the existing `configService` setters with default values, not directly mutate state. Defaults should be defined as constants alongside each section's ViewModel.
- Immediate preview for Display means calling `appWindow.setSize()` / `appWindow.setFullscreen()` from `@tauri-apps/api/window` on every change. Revert on close means caching the pre-edit values when settings open and restoring them if the user cancels.
- The "Close" button and Escape key must both trigger the revert-if-unsaved logic, but the overlay-backdrop click should also be treated as cancel.

## Implementation Sequence

1. **Phase 1 (Registry + Toggle)**: Create the settings section registry (`settings_sections.ts` co-located with the ViewModel). Refactor `SettingsViewModel` to use the registry instead of hardcoded `CATEGORIES`/`GAME_SUB_TABS`. Add `isAdvanced` state and `visibleSections` derivation. Update `settings_view.svelte` to render from the registry. Lazy-initialize advanced sub-ViewModels.
2. **Phase 2 (AI & Privacy + Search + Per-Section Reset)**: Build the simplified AI & Privacy panel. Add search input with debounced filter. Add per-section reset buttons wired to default constants. Wire Display/Audio immediate preview and close-without-save revert.
3. **Phase 3 (In-Game Overlay)**: Add `SETTINGS` to `GameOverlayType` and overlay compatibility matrix. Create `game/ui/overlays/settings/` with lightweight ViewModel and View. Wire pause menu "Settings" to push overlay instead of navigating to `/settings`. Ensure full-page `/settings` route still works for main-menu access.
4. **Phase 4 (Validation)**: Run `validate()` and E2E/visual suites. Verify all 5 ACs.

## Edge Cases & Gotchas

- **Config not yet loaded**: Settings page mounts before `configService.load()` resolves. The AI & Privacy section must handle `isLoaded: false` gracefully — show skeleton UI or "Loading configuration..." placeholder. Don't flash "Not Configured" before the load completes.
- **Advanced toggle dirty state**: If the user modifies an advanced field, then toggles Advanced off, those changes are abandoned. Add a confirmation dialog: "You have unsaved changes in advanced settings. Disable Advanced and discard changes?" unless the fields are clean.
- **Overlay vs full-page consistency**: The in-game overlay and full-page `/settings` must share the same sub-ViewModels and configService — no forked state. The overlay simply composes fewer sections and uses modal chrome instead of a full-page layout.
- **Overlay stack interaction**: When `SETTINGS` overlay is pushed on top of `PAUSE_MENU`, pressing Escape must only pop `SETTINGS` — not the pause menu. The C-332 overlay stack handles this automatically. Verify the overlay compatibility matrix allows `SETTINGS` on top of `PAUSE_MENU`.
- **Tauri window APIs in browser**: Display settings (resolution, fullscreen) call Tauri APIs that throw in browser dev mode. Guard with `__TAURI_INTERNALS__` or `window.__TAURI__` check and show "Desktop only" hint in browser.
- **Search + keyboard navigation**: When search filters sections, Tab order must skip hidden sections. Use `display: none` (not `visibility: hidden` or `opacity: 0`) so hidden controls are removed from the tab sequence.

## Open Questions

- **Exact keywords per section**: The registry includes a `keywords` array for search. The initial set is defined by the implementer based on common synonyms (e.g., "volume" "sound" "loud" for Audio; "resolution" "fullscreen" "monitor" for Display). Should these be reviewed post-implementation or are reasonable defaults acceptable?
- **AI & Privacy "Connect AI" flow**: Should this inline a simplified connection picker (provider dropdown + API key field + verify button — a subset of the existing connection manager) or link out to the full C-318 capability setup flow? Recommendation: link out to C-318 for Phase 1; inline simplifier can be a follow-up.

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |
| 1.0.0 | 2026-07-19 | Initial contract — progressive disclosure settings redesign | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

---
