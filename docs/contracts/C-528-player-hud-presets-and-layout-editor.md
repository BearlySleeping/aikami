---
id: C-528
title: "Player HUD presets and layout editor"
source: "direct"
contract_type: full
status: implemented
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: "https://github.com/BearlySleeping/aikami/pull/357"
  pr_number: 357
created_at: "2026-09-14"
---

# Contract C-528: Player HUD presets and layout editor

## Metadata

| Field | Value |
|---|---|
| **Source** | User request: optimal customizable Aikami UI/HUD/menus and community themes; source review at `b3e8234b6ced2c6c8ae1a62aa023850ed3ad85c4` |
| **Target** | Client HUD host/registry, Interface settings and local versioned UI preferences |
| **Type** | full |
| **Priority** | P1 — coherent player experience and safe customization foundation |
| **Dependencies** | C-527 (`implemented` on `main`) — stable HUD host, slots and input/pause policy. C-502/C-503 are `draft`: integrate them only if actually implemented on the execution base; neither may be required (leave the registry capability absent instead of stubbing a fake widget). |
| **Status** | implemented |
| **Promotion** | — |
| **Docs Impact** | User-facing → add `apps/frontend/docs/src/content/docs/guides/customizing-your-hud.mdx`. The Guides sidebar autogenerates from that directory (`apps/frontend/docs/astro.config.ts`), so no manual navigation entry is needed; precedent is `guides/play-shell-navigation.md` from C-527. Theme/HUD author docs where relevant. |
| **Contract version** | 2.0.1 |
| **Production Surface** | `/game` (Pause → Customize HUD) and `/settings?section=interface` → Interface → HUD |

`C-528` is already registered in [PROGRESS.md](PROGRESS.md) as `📝 draft`, part of the C-527–C-530 UI/HUD bundle; re-confirm no collision with a merged contract before implementation begins. This document records proposed behavior; its ACs are not yet verified or approved by this planning deliverable.

## Problem & Baseline Evidence

- Production visibility is mostly hardcoded by overlay state and individual quest/music toggles. Widget components still need a unified editable layout contract.
- A player cannot currently be assumed to have a general editor for placement, contextual visibility, presets or responsive layout recovery.
- Reproduce: at `/game`, Settings → Gameplay exposes only the expanded-quest-card toggle and Settings → Audio only the music-player toggle. Nothing anywhere lets a player move, resize, reorder or hide player status, the objective or the hotbar, and there is no preset, no editor and no Hide HUD. `grep -rniE "hide.?hud|hud.?preset|customize.?hud|layout.?editor" apps packages` returns no matches on the execution base, so no partial implementation exists to reconcile.
- Reuse `apps/frontend/client/src/lib/views/game/ui/game_ui_hud_visibility.ts`, the three persisted legacy owners listed in the Reuse Map below, the client `localStorage` convention and the C-527 host (`.../ui/hud_slots.ts`, `.../ui/hud/management_host.svelte`). Run the baseline tests named under Test Hooks before changes.

## User Outcome

A player can choose a HUD preset, hide or show optional information, move and size supported widgets, preview modes, and keep those choices through reload and viewport changes.

## Success Measures

- Editing a visible setting updates preview within 100ms p95 on the reference machine recorded in the performance evidence; no persistence write per pointer move.
- Save/Cancel/Reset are deterministic and work offline. Cancelling restores the exact pre-edit configuration.
- Production journey: Pause → Customize HUD → Minimal → move objective with keyboard → preview Combat → Save → reload → recover original desktop layout after a compact viewport visit.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| HUD host and slots | `apps/frontend/client/src/lib/views/game/ui/hud_slots.ts` (`HudSlot`, `HudWidgetId`, `HUD_SLOT_CLASS`, `HUD_WIDGET_SLOT`, `hudWidgetSlot`, `hudWidgetPositionClass`); `.../ui/hud/management_host.svelte` | Extend. The slot table is the registry seed; child widgets no longer own viewport positioning |
| HUD composition | `apps/frontend/client/src/lib/views/game/ui/game_ui_view.svelte` (slot wrappers `hud-slot-top-start`, `hud-slot-top-end`, `hud-slot-objective`, `hud-slot-bottom-center`) | Modify; each widget renders from resolved preferences instead of a fixed `{#if viewModel.showX}` gate |
| Visibility policy | `apps/frontend/client/src/lib/views/game/ui/game_ui_hud_visibility.ts` (`showHpBar`, `showQuestTracker`, `showHotbar`, `showClockHud`, `showAutosaveIndicator`, `showManagementNav`, `HIDDEN_IN_MENU`, `HIDDEN_WHILE_BUSY`) | Evolve into a pure preference/context resolver that supersedes these predicates; keep the predicates as thin adapters until every call site migrates (Directive 11) |
| Legacy persisted options | `apps/frontend/client/src/lib/services/game/quest_overlay_service.svelte.ts` → `aikami:quest-overlay:visible` (`'0'`/`'1'`); `apps/frontend/client/src/lib/services/audio/music_player_service.svelte.ts` → `aikami:music-player:visible`; `apps/frontend/client/src/lib/views/game/ui/hud/clock_hud_preference.svelte.ts` → `aikami:clock-hud:visible` (`'1'` or absent) | Migrate these three stored values once into the new authority; keep the services as owners of their domain controls (quest density, music playback) |
| Legacy ViewModels (no storage key) | `.../ui/hud/quest_overlay_view_model.svelte.ts`, `.../ui/hud/music_player_view_model.svelte.ts` | Leave alone — they read the services above and persist nothing themselves |
| Accessibility owner | `apps/frontend/client/src/lib/services/settings/motion_preference_service.svelte.ts` → `aikami:motion:preference`, publishes `<html data-motion>` (C-527 AC-6 / Directive 11) | Reuse as-is. The HUD model must never duplicate or export motion (or future contrast/text-scale) selections |
| Client preference convention | Raw `localStorage` under `aikami:<area>:<name>`, restored in the constructor rather than in `initialize()` — see the three services above | Reuse this pattern for the HUD snapshot. `packages/frontend/services/src/lib/base/preference/` (`CorePreferenceProviderService`) is the **hub** adapter (`apps/frontend/hub/src/lib/client/services/app/preference.svelte.ts`) and is not a client dependency today — do not introduce it into the client without a recorded decision |
| Baseline regression guard | `apps/frontend/client/src/lib/services/__tests__/preference_service_construction.test.ts` (C-527 AC-6 construction-time restore) | Extend for the HUD preference; never regress construction-time restore |
| Input and dialogs | `apps/frontend/client/src/lib/services/game/game_overlay_service.svelte.ts`; `apps/frontend/client/src/lib/services/game/input_action_service.svelte.ts`; `Modal` from `@aikami/frontend/components` (`packages/frontend/components/src/lib/modal/modal.svelte`) | Reuse scopes/pause/focus, including edit-mode ownership |
| Overlay routing | `apps/frontend/client/src/lib/types/game.ts` (`GameOverlayType`); `game_ui_hud_visibility.ts` hidden sets | Extend with the editor overlay type and add it to the pause/management hidden sets — no second overlay router |

All paths are repo-relative. Verify exact exports at the implementation base.

## Overview

Add a trusted widget registry, four shipped layout presets, a bounded editor and versioned device-local preferences. Separate saved user intent from viewport-derived placement and instantaneous visibility. The game remains playable if preferences are invalid or a registered optional capability is missing.

## Design Reference

- `docs/design/aikami_ui_hud_theme_review_2026q3.md` in this bundle defines visual direction, navigation mapping, defaults and ecosystem boundaries.
- Existing `docs/design/game_ui_hud_overhaul.md` and `views/dev/obsidian/` are context; do not copy stale defect claims or treat a dev sandbox as production evidence.
- Read current `AGENTS.md`, `.context/CONTEXT.md`, `.context/index.md` and required project skills: `aikami-conventions`, `svelte-conventions`, `aikami-ui`, `testing`; add backend/PixiJS skills when actually touching those boundaries.
- Keep Aikami semantic HTML/classes; complex components only for meaningful structure, behavior, accessibility or a reusable API.

> Testing conventions: [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions).

## Architecture Directives

1. Register trusted built-in widgets with stable namespaced IDs, labels, capabilities, supported anchors/densities, minimum dimensions and criticality. Composition maps IDs to trusted views/factories. Metadata contains no executable strings. Community packs cannot register arbitrary components.
2. Persist two independent HUD concepts: selected preset and per-widget overrides. Personal accessibility selections are a third *concept* but never a third *copy* — they remain in their existing owner services (`motion_preference_service.svelte.ts` for motion; a future contrast/text-scale owner if one exists) and are read at resolve time. Theme choice is separate. Keybindings (`aikami:settings:keybindings`), campaign data, party composition and action permissions are never part of a preset.
3. Visibility values are `always`, `contextual`, `hidden` for eligible optional widgets. Capability and current game-state restrictions still apply to `always`. Contextual visibility uses semantic events/relevance, with a configurable settle delay; a focused widget stays mounted/visible until focus safely moves. Hidden means no pointer interception or tab stop.
4. Ship Adventure, Minimal, Tactical and Readable presets described in the design review. System notices, required combat actions and recovery navigation are outside ordinary hide policies. Hide HUD is temporary and reversible; it does not erase saved preferences or hide destructive confirmations.
5. Editor: labeled outlines, drag-to-anchor, stack reorder, keyboard/controller alternative, scale, density, visibility, Explore/Dialogue/Combat fixture preview, Undo/Redo, per-widget reset, layout reset, Cancel and Save. Preview is read-only fixture presentation over a paused session, not a second engine or a combat simulator. The editor is a registered `GameOverlayType` in `apps/frontend/client/src/lib/types/game.ts`, routed by the existing `GameOverlayService` and added to the pause/management hidden sets in `game_ui_hud_visibility.ts` so HUD chrome cannot paint over it.
6. V1 persisted placement uses named anchors and order, with bounded optional inset values relative to the safe content rectangle. No raw global viewport x/y positions and no automatic moving-the-HUD-around-the-player feature. RTL maps start/end logically while preserving meaningful directional game controls.
7. Pure layout policy uses measured widget minimums, viewport class, text scale and reserved regions. Pack lower-priority optional groups, collapse detail, then place overflow behind a labeled accessible entry. Never overlap required action/confirmation/subtitle regions. If minimums cannot fit, use a focused single-surface layout with scrolling.
8. Runtime reflow is derived, not saved. Maintain separate user-selected compact layout overrides if desired; visiting compact mode never mutates desktop intent. A disappearing capability retains dormant preferences and explains unavailability rather than deleting user choices.
9. Storage uses the client convention — raw `localStorage`, `aikami:<area>:<name>` keys, restore in the constructor — with an explicit version and an atomic committed snapshot (`aikami:hud:preferences`; migration marker `aikami:hud:migration`). Map the legacy keys listed in the Reuse Map once, honouring each one's own encoding (quest-overlay stores `'0'` for an explicit false; the clock key stores only `'1'` and treats absence as off). Keep unrelated settings and campaign stores untouched. Corrupt versions recover to a safe preset with a readable notice.
10. Personal accessibility choices have final precedence over preset scale, motion, contrast and opacity. Preset export strips personal accessibility settings, device IDs, transient selection, screenshots of real saves, and campaign references. Export/import schema will be reused by C-529/C-530.
11. Use one effective resolver for HUD settings everywhere: main Settings, in-game editor and legacy toggles. Adapters may forward to it during migration but no permanent dual write/store authority.
12. On applying/resetting presets, provide Undo instead of repeated confirmations. Closing an unsaved editor follows existing unsaved-change dialog conventions. Persist only on explicit Save, aside from a clearly identified recoverable local edit draft if already supported.

## State & Data Models

```ts
type HudVisibility = 'always' | 'contextual' | 'hidden';
type HudWidgetPreference = {
  widgetId: string; // validated against registered IDs; unknown optional IDs stay dormant
  visibility: HudVisibility;
  anchor: 'top-start' | 'top-end' | 'bottom-start' | 'bottom-center' | 'bottom-end';
  order: number;
  density: 'compact' | 'comfortable';
  scale: number; // initially 0.8–1.5; effective text/hit-target minima win
};
type HudLayoutPreset = {
  schemaVersion: 1;
  id: string;
  name: string;
  widgets: HudWidgetPreference[];
};
type HudUserPreferences = {
  schemaVersion: 1;
  selectedPresetId: string;
  overrides: HudWidgetPreference[];
};
```
Canonical placement: TypeBox schemas in `packages/shared/schemas/src/lib/game/hud_layout.ts` (+ `packages/shared/schemas/src/index.ts` barrel); exported types in `packages/shared/types/src/lib/game/hud_layout.ts` derived with `Static<typeof …Schema>` and re-exported from `packages/shared/types/src/index.ts` — never hand-written duplicates; the widget registry constants in `packages/shared/constants/src/lib/game/hud_widgets.ts` so C-529/C-530 can validate an uploaded preset against the same ID set. Trusted view/factory composition stays client-side under `views/game/ui/` and holds no executable strings in the metadata. UI edit history remains local. Reject duplicate IDs, non-finite values, excess widgets, invalid anchors and out-of-range scales. Unknown optional IDs are inert; required unsupported IDs make an import incompatible. Keep current context and resolved pixels out of the persisted model.

## Quality Requirements

- **Offline/degraded:** all built-in editing/persistence local; unavailable minimap/markers do not block use.
- **Accessibility/input:** every drag action has form/keyboard/controller parity; visible selection, narrated labels, logical DOM order, text reflow and no disappearing focused control.
- **Performance:** no per-frame storage, expensive global DOM measurements or Svelte tick mirroring. Coalesce resize/drag preview to animation frames and measure layout only when inputs change.
- **Security/privacy:** bounded data-only presets; no scripts/styles/remote URLs; no private campaign content exported.
- **Persistence/migration:** versioned atomic snapshots; explicit false preserved; legacy keys read once and migration marker committed with result.
- **Cancellation/retry/idempotency:** Save is repeatable; Cancel restores snapshot; interrupted write retains last valid snapshot; Undo does not replay gameplay.
- **Observability:** log preference recovery and layout incompatibility without values containing personal content; no drag-coordinate telemetry.

## Migration & Rollback

- Capture all three legacy preferences before migrating: `aikami:quest-overlay:visible` (`'0'` is an explicit false and must survive), `aikami:music-player:visible`, and `aikami:clock-hud:visible` (written only as `'1'`; absence means off and must not be reported as a lost explicit choice). Use new defaults only for absent values.
- Commit migrated values and the `aikami:hud:migration` marker together; leave old keys intact during the rollback window. Existing controls route to the new authority after migration.
- On unknown future schema, retain stored bytes and use a safe runtime fallback without destructively rewriting them.
- Rollback can disable the editor and use the shipped safe layout; disabling customization must not remove saves or unrelated preferences. Provide Restore default interface from Settings even when layout data is corrupt.

## Scope Boundaries

- **In Scope:** registry/policy, four presets, bounded editor, temporary Hide HUD, migration, local settings, responsive reflow and exchangeable preset schema.
- **Out of Scope:** arbitrary draggable desktop windows, arbitrary user widgets, executing theme code, new minimap/marker implementation, cloud preference sync, theme appearance editor, Hub distribution.

## Contract Size & Split Rule

> Split on independent mergeability: [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule).

**For this contract:** One player customization outcome. It depends on the stable host but is independently shippable before community theme distribution. Do not make import/export of a whole appearance package a requirement here.

## Acceptance Criteria

### AC-1: Preset and visibility semantics
**Given** a valid local campaign and Adventure preset.
**When** the player chooses Minimal/Tactical/Readable or changes a widget policy.
**Then** eligible widgets resolve predictably, absent capabilities remain absent, and required system/action surfaces stay reachable.
**Production Path**: `/game`; `/settings?section=interface`.
### AC-2: Complete editor input parity
**Given** the HUD editor is open.
**When** a player moves/reorders/scales a widget using pointer, keyboard or gamepad.
**Then** each method can reach the same valid configuration, reserved regions are respected and unsaved preview does not mutate committed state.
**Production Path**: `/game` → Pause → Customize HUD.
### AC-3: Transactional editing
**Given** a modified edit draft exists.
**When** the player uses Undo/Redo/Reset then Cancel, or Save then reload.
**Then** Cancel restores the exact prior snapshot; Save restores the new snapshot after reload; reset affects only the requested scope.
**Production Path**: `/game` → Pause → Customize HUD; `/settings?section=interface`.
### AC-4: Context without instability
**Given** a contextual widget has changed status or gained focus.
**When** movement begins/ends, settle time elapses or an overlay opens.
**Then** visibility follows policy, neighboring controls do not jump, active focus remains safe and hidden nodes cannot capture input.
**Production Path**: `/game`.
### AC-5: Responsive intent preservation
**Given** a customized desktop layout exists.
**When** viewport shrinks, virtual keyboard appears, text scales to 200%, then desktop returns.
**Then** derived layout remains usable without overlap and the original desktop intent returns unchanged.
**Production Path**: `/game`; `/settings?section=interface`.
### AC-6: Legacy and corrupt preferences
**Given** old settings contain explicit false values or malformed/unknown versions.
**When** the new client starts and migrates.
**Then** explicit choices survive; invalid data safely falls back; unrelated preferences/saves are untouched; migration is repeatable; and disabling the editor falls back to the shipped safe layout without touching saves or unrelated preferences.
**Production Path**: `/game`; `/settings?section=interface`.
### AC-7: Recovery and offline behavior
**Given** all optional HUD widgets are hidden and network is unavailable.
**When** a save fails or the player wants to restore/edit the HUD.
**Then** error recovery and Menu/Settings remain operable, defaults can be restored and customization works without sign-in.
**Production Path**: `/game`; `/settings?section=interface`.
### AC-8: Future widget compatibility
**Given** a preset contains an unknown optional widget or a capability is later removed/re-added.
**When** the preset loads and game capabilities change.
**Then** unsupported entries remain inert and dormant preferences resume when supported; malformed or required unsupported entries are explained and rejected.
**Production Path**: `/settings?section=interface` → Interface → HUD.

**Evidence Matrix**:

| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Functional E2E + targeted unit/integration; visual where appearance is asserted | `hud_customization.spec.ts`, journey trace and relevant screenshots | `/game`; `/settings?section=interface` | Not run — fill during implementation verification |
| AC-2 | Functional E2E + targeted unit/integration; visual where appearance is asserted | `hud_customization.spec.ts`, journey trace and relevant screenshots | `/game` → Pause → Customize HUD | Not run — fill during implementation verification |
| AC-3 | Functional E2E + targeted unit/integration; visual where appearance is asserted | `hud_customization.spec.ts`, journey trace and relevant screenshots | `/game` → Pause → Customize HUD; `/settings?section=interface` | Not run — fill during implementation verification |
| AC-4 | Functional E2E + targeted unit/integration; visual where appearance is asserted | `hud_customization.spec.ts`, journey trace and relevant screenshots | `/game` | Not run — fill during implementation verification |
| AC-5 | Functional E2E + targeted unit/integration; visual where appearance is asserted | `hud_customization.spec.ts`, journey trace and relevant screenshots | `/game`; `/settings?section=interface` | Not run — fill during implementation verification |
| AC-6 | Functional E2E + targeted unit/integration; visual where appearance is asserted | `hud_customization.spec.ts`, journey trace and relevant screenshots | `/game`; `/settings?section=interface` | Not run — fill during implementation verification |
| AC-7 | Functional E2E + targeted unit/integration; visual where appearance is asserted | `hud_customization.spec.ts`, journey trace and relevant screenshots | `/game`; `/settings?section=interface` | Not run — fill during implementation verification |
| AC-8 | Functional E2E + targeted unit/integration; visual where appearance is asserted | `hud_customization.spec.ts`, journey trace and relevant screenshots | `/settings?section=interface` → Interface → HUD | Not run — fill during implementation verification |

**Test Hooks**:

- **Baseline:** record results for `apps/frontend/client/src/lib/views/game/ui/game_ui_view_model.test.ts`, `.../ui/hud_slots.test.ts`, `.../ui/hud/quest_overlay_view_model.test.ts`, `.../ui/hud/music_player_view_model.test.ts`, `apps/frontend/client/src/lib/services/__tests__/preference_service_construction.test.ts`, `apps/frontend/client/src/lib/services/settings/motion_preference_service.test.ts`, `apps/frontend/client/src/lib/services/game/quest_overlay_service.test.ts` and `apps/frontend/client/src/lib/services/audio/music_player_service.test.ts`; record any unrelated baseline failures.
- **Moon Task:** `bun moon run client:typecheck`, `bun moon run client:test`, `bun moon run e2e:test-client`, plus affected shared-project checks resolved from current Moon config. Use Biome and the repository's required validation flow; before PR run required affected-project gates and `bun moon run :validate` when mandated by current guidance. Do not invent project IDs from directory names.
- **Integration:** production `/game` using a real local fixture campaign and actual feature services; inject deterministic provider results for asynchronous operations. Use real storage boundaries for migration/atomicity tests. Assertions must establish behavior and domain invariants, not simply duplicate implementation conditions.
- **Functional:** `apps/e2e/tests/client/hud_customization.spec.ts` with existing Page Objects and deterministic feature fixtures. Each AC maps to a named case; include negative/cancel/reload paths. Bun identity rune polyfills cannot establish Svelte reactivity: verify state/lifecycle/focus in compiled Playwright, reusing `apps/e2e/tests/client/reactive_lifecycle.spec.ts` patterns where appropriate.
- **Visual:** add `apps/e2e/src/visual/suites/hud_customization.visual.ts` using the current runner's `defineConfig` and `export default` conventions. Declare cases with `name`, real `route` and `searchParams`; route fixtures through the repository's existing test fixture mechanism. Do not invent production query parameters solely to bypass domain integration. A dev sandbox may supplement but not replace production cases.
- **Visual cases:** `explore-default`, `dialogue-long`, `inventory-detail`, `combat-actions`, `settings-error`, `compact`, `large-text`, `high-contrast`, `reduced-motion`. Select the cases materially affected by this contract and explain any omitted context.
- **TypeBox visual response schema:** an object with `score` (0–100), `unreadableText` (boolean), `overlappingControls` (boolean), `missingCriticalAction` (boolean), and `issues` (bounded string array), adapted to the existing visual runner wrapper. AI evaluation prompt: “Evaluate this Aikami production journey against the supplied expected state. Score 90+ only when text hierarchy is readable, essential controls are visible and nonoverlapping, focus/selection is apparent where expected, and the scene retains appropriate prominence. Identify concrete defects; do not reward decoration at the expense of usability.” Treat any missing critical action as a failure regardless of score.
- **Viewports/input:** 1920×1080 and 1280×800 normal; 1024×768 compact; 390×844 touch-oriented management; 200% text at desktop/compact; long translated labels/RTL; keyboard, standard controller, pointer and touch controls. Browser/Tauri runtime support must be recorded. UI operability on a narrow viewport does not certify all mobile world gameplay.
- **Performance evidence:** record hardware/runtime/build, campaign fixture, sample count and p50/p95. Compare a repeated 60-second exploration/combat scene before/after for UI-caused frame-time regression (proposed ≤5% p95 regression). Measure operations stated in Success Measures separately. If the environment cannot run a required gate, mark it unverified with the exact blocker; do not fabricate timings or mark the contract verified.

**Watch Points**:

- Production Path rule: the routes above are the ones that exist or that this contract adds — `/game` and `/settings?section=interface` (deep-link resolved by `readSearchParam('section')` in `apps/frontend/client/src/lib/views/settings/settings_view_model.svelte.ts`). Registering the new `interface` entry in `SETTINGS_SECTIONS` (`.../settings/settings_sections.ts`, group `play`, contexts `['page','pause']`) and the Pause → Customize HUD action are in scope. If either cannot be delivered, replace the affected Production Path with the route actually shipped before any AC is marked verified.
- Screenshot/AI appearance scores cannot prove focus, input ownership, immutable installation, moderation or domain idempotency; keep functional/integration assertions.
- Keep every required control reachable when optional HUD is hidden. Explicit user accessibility overrides have priority over visual preferences.

## Implementation Sequence

1. Define registry invariants, preset schema and pure visibility/layout resolver tests with adversarial viewport cases.
2. Build the paused editor over fixtures and the real host; integrate input parity and preview/commit snapshots.
3. Migrate legacy options and integrate one settings authority; implement fallback/restore and capability dormancy.
4. Validate real movement/overlay/reload flows, compact/large-text layouts, offline recovery and all acceptance artifacts.

## Edge Cases & Gotchas

Widget disappears during focus; controller disconnected during edit; overlapping large widgets; 200% text in compact viewport; safe-area rotation; no configured hotbar actions; reordered registry; removed theme-provided preset; stale legacy false values.

## Open Questions

Must be resolved before status becomes `approved`:

None outstanding. The registry-ID question is resolved from the execution base: the seed set is `player-status`, `party-status`, `objective`, `hotbar`, `interaction`, `menu`, `clock`, `autosave`, `music-player`, `onboarding-hint`, `system-notice` — derived from `HudWidgetId` in `.../ui/hud_slots.ts` plus the widgets actually positioned in `.../ui/game_ui_view.svelte`. `menu` (recovery navigation) and `system-notice` (save-failure/disconnection) are required and never hideable; the rest are eligible for `always` / `contextual` / `hidden`. No minimap or quest-marker widget is registered while C-502/C-503 are `draft`; do not invent one to satisfy a preview. Exact widget minimum dimensions are measured from the rendered widgets during implementation and recorded as bounded constants in the registry, with a unit test asserting every registered widget has finite positive minimums — so the schema cannot ship with invented numbers.

## Amendments

Changes to ACs or scope require a version bump and user approval. Routine implementation placement can follow current project conventions while preserving the defined invariants.

| Version | Date | Change | Approved by |
|---|---|---|---|
| 2.0.0 | 2026-09-14 | Initial source-grounded draft; no implementation or verification claimed | Pending owner approval |
| 2.0.1 | 2026-09-14 | Critic pass — exact file paths in the Reuse Map, enumerated legacy storage keys, canonical schema/type/constants placement, concrete Production Paths and docs target, resolved Open Question. No AC semantics or scope changed. | Pending owner approval |

## Promotion Lifecycle

> [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle). A sandbox is not integrated; `release_verified` requires production and visual evidence.

## Status Lifecycle

> [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle). Keep `draft` until authorized; never mark completed before merge/CI. Record actual execution and AC evidence during implementation.

## Execution Report

### Summary

Shipped the trusted HUD widget registry (11 widgets, 4 shipped presets) in `@aikami/constants`, the versioned preset/snapshot TypeBox schemas in `@aikami/schemas`, the ONE pure resolver (`hud_layout_policy.ts` + `hud_layout_geometry.ts` + `hud_layout_overlap.ts`) with contextual settle, capability dormancy, reserved regions and viewport reflow, the single preference authority (`HudPreferenceService`, with one-shot legacy migration and a transactional editor session), the paused HUD layout editor with pointer/keyboard/gamepad parity, the new **Interface** settings section, temporary Hide HUD, and the preset exchange path. The play HUD now renders the resolved layout instead of per-widget booleans.

Two real defects were found and fixed by the new E2E journeys: (1) the editor ViewModel was being **re-created on the first edit** because the overlay-lifecycle `$effect` tracked the preference snapshot it read during construction (fixed with `untrack`), and (2) at 200% text in a compact viewport the objective and hotbar **overlapped** because anchor columns were not disjoint (fixed with per-anchor column shares plus a collapse-when-it-cannot-fit rule).

### AC Status

| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | Registry/preset/visibility semantics, reserved required surfaces, capability dormancy, overlay policy — unit tests + production E2E on `/game` and `/settings?section=interface`. |
| AC-2 | ✅ | Pointer/keyboard/gamepad parity proven at the pure-command layer, at the editor ViewModel, and in compiled Playwright (drag + arrow keys reach the same configuration; reserved `bottom-center` refuses unrelated widgets). |
| AC-3 | ✅ | Cancel restores the exact prior snapshot, Save survives reload, per-widget vs layout reset are scoped, dirty close asks first — unit + E2E. |
| AC-4 | ✅ | Contextual settle reserves space without painting (neighbours' rects unchanged), focused widget stays mounted, inactive widgets are absent from the DOM. |
| AC-5 | ✅ | Desktop intent returns unchanged after compact/touch visits; zero geometric overlaps asserted at every supported viewport × text scale, plus a DOM overlap measurement in E2E. |
| AC-6 | ✅ | Legacy `'0'`/`'1'` encodings survive, marker committed with the values, old keys left intact, corrupt and future-version snapshots fall back without being rewritten, unrelated preferences untouched, rollback flag falls back to the safe layout without deleting the snapshot. |
| AC-7 | ⚠️ | Menu (required) and recovery stay operable with Hide HUD on; defaults restorable; customization works with no sign-in. "Network unavailable" was not explicitly simulated (the client is offline-first and no cloud call is on the path) — no dedicated offline test. |
| AC-8 | ✅ | Unknown optional ids stay dormant (never dropped), a capability returning resumes the preference, malformed presets are rejected, and a preset missing a required surface is refused with an explanation. |

### Files Created

| File | Purpose |
|---|---|
| `packages/shared/constants/src/lib/game/hud_widgets.ts` | Widget registry (ids, labels, capabilities, measured minimums, required set, priority) and the four shipped presets; storage keys; scale/anchor/density bounds. |
| `packages/shared/constants/src/lib/game/hud_widgets.test.ts` | Registry invariants (finite positive minimums, unique ids, presets cover the registry, required widgets never hidden). |
| `packages/shared/schemas/src/lib/game/hud_layout.ts` | TypeBox schemas + parsers for the preset, the device-local snapshot and the migration marker (bounded, duplicate-free, `additionalProperties: false`). |
| `packages/shared/schemas/src/lib/game/hud_layout.test.ts` | Adversarial parsing: duplicate ids, non-finite values, excess widgets, invalid anchors, out-of-range scales, unknown versions, path/URL ids. |
| `packages/shared/types/src/lib/game/hud_layout.ts` | Derived types (`Static<typeof …>`) + registry-derived `HudWidgetId`/`HudSlot`/preset types. |
| `apps/frontend/client/src/lib/utils/hud/hud_layout_policy.ts` | The ONE pure resolver: preset/override merge, visibility policy, contextual settle, capability dormancy, reflow, overflow. |
| `apps/frontend/client/src/lib/utils/hud/hud_layout_geometry.ts` | Anchor regions, disjoint column shares, stack placement, box math. |
| `apps/frontend/client/src/lib/utils/hud/hud_layout_overlap.ts` | The overlap invariant helpers. |
| `apps/frontend/client/src/lib/utils/hud/hud_layout_policy.test.ts` | AC-1/4/5/8 adversarial cases. |
| `apps/frontend/client/src/lib/utils/hud/hud_layout_state.ts` | Pure editor state machine: commands, draft/undo/redo/save/cancel, resets, export/import. |
| `apps/frontend/client/src/lib/utils/hud/hud_layout_state.test.ts` | AC-2/3/8 at the command layer (three input devices → one configuration). |
| `apps/frontend/client/src/lib/utils/hud/hud_preference_migration.ts` | One-shot legacy mapping + stored-version detection. |
| `apps/frontend/client/src/lib/utils/hud/hud_preference_migration.test.ts` | AC-6 encodings, marker contents, repeatability. |
| `apps/frontend/client/src/lib/services/settings/hud_preference_service.svelte.ts` | The single HUD preference authority (snapshot, migration, editor session, Hide HUD, rollback switch, exchange). |
| `apps/frontend/client/src/lib/services/settings/hud_preference_service.test.ts` | Construction-time restore, migration-once, corrupt/future fallback without rewrite, transactional editing, rollback, import. |
| `apps/frontend/client/src/lib/views/game/ui/hud_layout_bridge.ts` | Live game state → resolver input; Hide HUD snapshot; capability/relevance derivation. |
| `apps/frontend/client/src/lib/views/game/ui/hud_view_state.svelte.ts` | rAF-coalesced viewport + text-scale measurement. |
| `apps/frontend/client/src/lib/views/game/ui/game_hud_surface.svelte.ts` | The HUD presentation surface the markup reads (resolved layout, overflow, focus). |
| `apps/frontend/client/src/lib/views/game/ui/hud/hud_layout_editor_view_model.svelte.ts` | Editor ViewModel (command dispatch, preview fixtures, keyboard/gamepad parity, unsaved-change handling). |
| `apps/frontend/client/src/lib/views/game/ui/hud/hud_layout_editor_view_model.test.ts` | AC-2/3 at the ViewModel level. |
| `apps/frontend/client/src/lib/views/game/ui/hud/hud_layout_editor_overlay.svelte` | The paused editor surface (labelled drop regions, widget list, preview tabs, undo/redo/reset/cancel/save). |
| `apps/frontend/client/src/lib/views/game/ui/hud/hud_layout_editor_composition.ts` | Editor production wiring + the rollback flag application. |
| `apps/frontend/client/src/lib/views/settings/interface/settings_interface_view_model.svelte.ts` | Interface settings ViewModel (presets, per-widget controls, restore defaults, exchange). |
| `apps/frontend/client/src/lib/views/settings/interface/settings_interface_view.svelte` | Interface settings surface. |
| `apps/frontend/client/src/lib/views/settings/interface/settings_interface_composition.ts` | Interface settings production wiring. |
| `apps/e2e/tests/client/hud_customization.spec.ts` | 15 production-path Playwright cases, one per AC. |
| `apps/e2e/src/visual/suites/hud_customization.visual.ts` | Visual suite (8 cases) for the editor and the Interface section. |
| `apps/frontend/docs/src/content/docs/guides/customizing-your-hud.mdx` | User-facing guide (auto-registered by the Guides sidebar). |

### Files Modified

| File | Change |
|---|---|
| `apps/frontend/client/src/lib/views/game/ui/game_ui_view.svelte` | Renders the resolved layout (anchor wrappers, per-widget gate, labelled overflow entry, editor overlay, Hide HUD-aware). |
| `apps/frontend/client/src/lib/views/game/ui/game_ui_view_model.svelte.ts` | Adds the `hud` presentation surface, the editor ViewModel and its lifecycle port. |
| `apps/frontend/client/src/lib/views/game/ui/game_ui_view_model_types.ts` | `GameUIHudCapabilities` / `GameUIHudViewCapabilities`. |
| `apps/frontend/client/src/lib/views/game/ui/game_ui_overlay_lifecycle.svelte.ts` | Editor ViewModel lifecycle (with the load-bearing `untrack`). |
| `apps/frontend/client/src/lib/views/game/ui/game_ui_composition.ts` | Wires the HUD authority, view measurement and editor factory. |
| `apps/frontend/client/src/lib/views/game/ui/game_ui_hud_visibility.ts` | Becomes thin adapters over the single policy. |
| `apps/frontend/client/src/lib/views/game/ui/hud_slots.ts` | Slot table forwards to the registry. |
| `apps/frontend/client/src/lib/views/game/ui/hud_slots.test.ts` | Slot assertions follow the registry (`player-status` → `top-end`, `party-status` → `top-start`). |
| `apps/frontend/client/src/lib/services/game/game_overlay_service.svelte.ts` / `game_overlay_types.ts` / `overlay_compatibility.ts` | `HUD_EDITOR` overlay type, `openHudEditor`/`closeHudEditor`, routing rows. |
| `apps/frontend/client/src/lib/views/game/ui/overlays/pause_menu/*` | Customize HUD + Hide HUD actions and their capability/fixtures. |
| `apps/frontend/client/src/lib/views/settings/settings_sections.ts`, `settings_sections_composition.ts`, `settings_view_model.svelte.ts`, `settings_composition.ts`, `settings_content.svelte` | New `interface` section (group `play`, contexts `page` + `pause`). |
| `apps/frontend/client/src/lib/views/game/ui/overlays/settings/*` | Renders the Interface section in the pause settings overlay. |
| `apps/frontend/client/src/lib/types/game.ts` | `HUD_EDITOR` overlay type. |
| `apps/frontend/client/src/lib/services/index.ts` | Exports the HUD preference service. |
| `apps/frontend/client/src/lib/test_setup.ts` | `sessionStorage` polyfill (Hide HUD is session-scoped). |
| `apps/frontend/client/src/browser_tests/pause_menu.browser.test.ts` | Passes the new HUD capability. |
| `apps/e2e/tests/client/play_shell.spec.ts` | C-527 slot testids follow the renamed anchor wrappers. |
| `packages/frontend/configs/src/lib/feature_flags.ts`, `environment.ts` | `hudCustomization` kill switch (`PUBLIC_HUD_CUSTOMIZATION=0`). |
| `scripts/src/lib/ops/guard_orphaned_capability_baseline.json` | One baseline entry for the new service's type-only contract exports (same pattern as `MotionPreferenceServiceInterface`). |

### Deviations from Spec

1. **Pure-module placement.** The contract's Reuse Map named `views/game/ui/` for the resolver. The service must consume the same merge/preset logic and `guard-service-conventions` S11 forbids services importing `$lib/views/**`, so the pure HUD domain modules live in `apps/frontend/client/src/lib/utils/hud/`. `views/game/ui/hud_slots.ts` still forwards to the registry, so the named call site is preserved.
2. **`hud_slots.ts` slot mapping corrected.** The old literal table had `player-status` → `top-start` while the view rendered the HP bar in `top-end`. The registry records what the view actually does; the C-527 slot test was updated accordingly.
3. **Two defects fixed beyond the literal AC wording** (both required to meet the ACs, both recorded above): the editor ViewModel re-creation, and the 200%+compact overlap.
4. **Hide HUD is session-scoped** (`sessionStorage`) rather than purely in-memory, so a reload of the same tab keeps the player's temporary choice while the preference snapshot stays untouched. Required surfaces (`menu`, `system-notice`) are never hidden.
5. **`AC-7` network-unavailable case is not separately simulated** — no cloud call is on the HUD path, and the client is offline-first. Marked ⚠️ above rather than claimed.
6. **Visual suite not executed.** This agent has no browser/`ai_validate_image` tool, so `hud_customization.visual.ts` is authored to the runner's conventions but has not been scored. The geometric overlap invariant it would check visually is asserted deterministically instead (unit + DOM measurement in E2E).

### Test Results

- Unit: **3427 PASS / 3436** (7 skipped, 2 todo, **0 failures**) — `apps/frontend/client`, `bun run test:unit`.
  - New: policy 20/20, state 18/18, migration 13/13, service 15/15, editor ViewModel 11/11, constants 10/10, schemas 12/12.
- E2E: **15 PASS / 15** — `bunx playwright test --project=client tests/client/hud_customization.spec.ts` against the production routes on the worktree dev server.
- Guards: all pass (`source-file-size`, `mvvm-conventions`, `service-conventions`, `type-safety`, `orphaned-capability`, `data-plane`, `view-model-composition`, `test-boundary`, `image-component`).
- Typecheck/build: `client:typecheck`, `client:build`, `e2e:typecheck`, `types`/`schemas`/`constants`/`frontend-configs` typecheck — all clean.
- Baseline (C-527 `play_shell.spec.ts`): **12 pass / 17**, with **5 pre-existing failures** — all `waitForFunction` timeouts against the world render loop plus the font-request case. Every failing capture shows the worktree's `ContentPackLoader: manifest not found (HTTP 404)` "Boot Failed" overlay, i.e. the game world does not boot in this environment. The C-527 case that exercises the renamed HUD slot testids (`quiet-exploration`) passes. New failures introduced by this contract: **0**.
- Visual: **not run** (no browser/AI-vision tool exposed to this agent) — see Deviations #6.
- Performance evidence: **not collected** — the environment cannot boot the world (see above), so the before/after 60-second frame-time comparison could not be run. Not claimed as verified.

### Notes for the verifier

- `validate()` (the Pi tool) fails in this workspace with `Parse failed: Invalid project record at index 1` on `moon query projects` output — a tool-side parser issue, not a project-config error (`moon query projects` itself exits 0). Per-project moon tasks were used instead.
- The worktree dev server serves `/game` and `/settings?section=interface` with HTTP 200, but `/game` renders the boot-failure overlay because the content-pack manifest is missing. That is pre-existing and unrelated to this contract; it does bound what a verifier can assert visually without first provisioning the pack.
