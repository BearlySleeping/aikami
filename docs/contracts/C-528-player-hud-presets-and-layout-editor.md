---
id: C-528
title: "Player HUD presets and layout editor"
source: "direct"
contract_type: full
status: draft
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
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
| **Dependencies** | C-527 stable HUD host and input/pause policy. Integrate C-502/C-503 only if implemented on the actual base. |
| **Status** | draft |
| **Promotion** | — |
| **Docs Impact** | User-facing → proposed guide under `apps/frontend/docs/src/content/docs/`; add/update the current navigation and actual page in this PR. Theme/HUD author docs where relevant. |
| **Contract version** | 2.0.0 |
| **Production Surface** | `/game` and `/settings` → Interface → HUD |

Draft ID is provisional and unreserved. Confirm it is still unused before adding this file to the repository. This document records proposed behavior; its ACs are not yet verified or approved by this planning deliverable.

## Problem & Baseline Evidence

- Production visibility is mostly hardcoded by overlay state and individual quest/music toggles. Widget components still need a unified editable layout contract.
- A player cannot currently be assumed to have a general editor for placement, contextual visibility, presets or responsive layout recovery.
- Reproduce by finding the current quest/music controls, then trying to independently configure player status, objective and hotbar position and visibility.
- Reuse `game_ui_hud_visibility.ts`, quest/music ViewModels, existing preference storage helpers and C-527 host. Run related visibility, quest overlay, music and preference tests before changes.

## User Outcome

A player can choose a HUD preset, hide or show optional information, move and size supported widgets, preview modes, and keep those choices through reload and viewport changes.

## Success Measures

- Editing a visible setting updates preview within 100ms p95 on the recorded reference machine; no persistence write per pointer move.
- Save/Cancel/Reset are deterministic and work offline. Cancelling restores the exact pre-edit configuration.
- Production journey: Pause → Customize HUD → Minimal → move objective with keyboard → preview Combat → Save → reload → recover original desktop layout after a compact viewport visit.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| HUD host | `C-527 and views/game/ui/` | Extend; child widgets no longer own viewport positioning |
| Visibility policy | `game_ui_hud_visibility.ts` | Evolve into a pure preference/context resolver |
| Legacy options | `quest_overlay_service.svelte.ts; hud/music_player_view_model.svelte.ts` | Migrate explicitly persisted values, preserve domain controls |
| Preference adapters | `packages/frontend/services/src/lib/base/preference/` | Reuse local persistence conventions |
| Input and dialogs | `GameOverlayService; InputActionService; shared Modal` | Reuse scopes/pause/focus, including edit-mode ownership |

Paths abbreviated to sibling filenames in this table are relative to the named feature directory. Verify exact exports at the implementation base.

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
2. Persist three independent concepts: selected preset, per-widget overrides, and accessibility preferences. Theme choice is separate. Keybindings, campaign data, party composition and action permissions are never part of a preset.
3. Visibility values are `always`, `contextual`, `hidden` for eligible optional widgets. Capability and current game-state restrictions still apply to `always`. Contextual visibility uses semantic events/relevance, with a configurable settle delay; a focused widget stays mounted/visible until focus safely moves. Hidden means no pointer interception or tab stop.
4. Ship Adventure, Minimal, Tactical and Readable presets described in the design review. System notices, required combat actions and recovery navigation are outside ordinary hide policies. Hide HUD is temporary and reversible; it does not erase saved preferences or hide destructive confirmations.
5. Editor: labeled outlines, drag-to-anchor, stack reorder, keyboard/controller alternative, scale, density, visibility, Explore/Dialogue/Combat fixture preview, Undo/Redo, per-widget reset, layout reset, Cancel and Save. Preview is read-only fixture presentation over a paused session, not a second engine or a combat simulator.
6. V1 persisted placement uses named anchors and order, with bounded optional inset values relative to the safe content rectangle. No raw global viewport x/y positions and no automatic moving-the-HUD-around-the-player feature. RTL maps start/end logically while preserving meaningful directional game controls.
7. Pure layout policy uses measured widget minimums, viewport class, text scale and reserved regions. Pack lower-priority optional groups, collapse detail, then place overflow behind a labeled accessible entry. Never overlap required action/confirmation/subtitle regions. If minimums cannot fit, use a focused single-surface layout with scrolling.
8. Runtime reflow is derived, not saved. Maintain separate user-selected compact layout overrides if desired; visiting compact mode never mutates desktop intent. A disappearing capability retains dormant preferences and explains unavailability rather than deleting user choices.
9. Storage uses existing local preference conventions, with an explicit version and atomic committed snapshot. Map legacy persisted quest/music choices once; distinguish absent keys from false. Keep unrelated settings and campaign stores untouched. Corrupt versions recover to a safe preset with a readable notice.
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
Define TypeBox validation in shared schemas and derived exported types according to project conventions for exchanged/persisted shapes; UI edit history remains local. Reject duplicate IDs, non-finite values, excess widgets, invalid anchors and out-of-range scales. Unknown optional IDs are inert; required unsupported IDs make an import incompatible. Keep current context and resolved pixels out of the persisted model.

## Quality Requirements

- **Offline/degraded:** all built-in editing/persistence local; unavailable minimap/markers do not block use.
- **Accessibility/input:** every drag action has form/keyboard/controller parity; visible selection, narrated labels, logical DOM order, text reflow and no disappearing focused control.
- **Performance:** no per-frame storage, expensive global DOM measurements or Svelte tick mirroring. Coalesce resize/drag preview to animation frames and measure layout only when inputs change.
- **Security/privacy:** bounded data-only presets; no scripts/styles/remote URLs; no private campaign content exported.
- **Persistence/migration:** versioned atomic snapshots; explicit false preserved; legacy keys read once and migration marker committed with result.
- **Cancellation/retry/idempotency:** Save is repeatable; Cancel restores snapshot; interrupted write retains last valid snapshot; Undo does not replay gameplay.
- **Observability:** log preference recovery and layout incompatibility without values containing personal content; no drag-coordinate telemetry.

## Migration & Rollback

- Capture legacy quest/music preferences before migrating; preserve explicit choices and use new defaults only for absent values.
- Commit migrated values and version marker together; leave old keys intact during rollback window. Existing controls route to the new authority after migration.
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
**Production Path**: /game; /settings.
### AC-2: Complete editor input parity
**Given** the HUD editor is open.
**When** a player moves/reorders/scales a widget using pointer, keyboard or gamepad.
**Then** each method can reach the same valid configuration, reserved regions are respected and unsaved preview does not mutate committed state.
**Production Path**: /game → Customize HUD.
### AC-3: Transactional editing
**Given** a modified edit draft exists.
**When** the player uses Undo/Redo/Reset then Cancel, or Save then reload.
**Then** Cancel restores the exact prior snapshot; Save restores the new snapshot after reload; reset affects only the requested scope.
**Production Path**: /game; /settings.
### AC-4: Context without instability
**Given** a contextual widget has changed status or gained focus.
**When** movement begins/ends, settle time elapses or an overlay opens.
**Then** visibility follows policy, neighboring controls do not jump, active focus remains safe and hidden nodes cannot capture input.
**Production Path**: /game.
### AC-5: Responsive intent preservation
**Given** a customized desktop layout exists.
**When** viewport shrinks, virtual keyboard appears, text scales to 200%, then desktop returns.
**Then** derived layout remains usable without overlap and the original desktop intent returns unchanged.
**Production Path**: /game; /settings.
### AC-6: Legacy and corrupt preferences
**Given** old settings contain explicit false values or malformed/unknown versions.
**When** the new client starts and migrates.
**Then** explicit choices survive; invalid data safely falls back; unrelated preferences/saves are untouched; migration is repeatable.
**Production Path**: /game; /settings.
### AC-7: Recovery and offline behavior
**Given** all optional HUD widgets are hidden and network is unavailable.
**When** a save fails or the player wants to restore/edit the HUD.
**Then** error recovery and Menu/Settings remain operable, defaults can be restored and customization works without sign-in.
**Production Path**: /game; /settings.
### AC-8: Future widget compatibility
**Given** a preset contains an unknown optional widget or a capability is later removed/re-added.
**When** the preset loads and game capabilities change.
**Then** unsupported entries remain inert and dormant preferences resume when supported; malformed or required unsupported entries are explained and rejected.
**Production Path**: /settings → Interface → HUD.

**Evidence Matrix**:

| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Functional E2E + targeted unit/integration; visual where appearance is asserted | `hud_customization.spec.ts`, journey trace and relevant screenshots | /game; /settings | Not run — fill during implementation verification |
| AC-2 | Functional E2E + targeted unit/integration; visual where appearance is asserted | `hud_customization.spec.ts`, journey trace and relevant screenshots | /game → Customize HUD | Not run — fill during implementation verification |
| AC-3 | Functional E2E + targeted unit/integration; visual where appearance is asserted | `hud_customization.spec.ts`, journey trace and relevant screenshots | /game; /settings | Not run — fill during implementation verification |
| AC-4 | Functional E2E + targeted unit/integration; visual where appearance is asserted | `hud_customization.spec.ts`, journey trace and relevant screenshots | /game | Not run — fill during implementation verification |
| AC-5 | Functional E2E + targeted unit/integration; visual where appearance is asserted | `hud_customization.spec.ts`, journey trace and relevant screenshots | /game; /settings | Not run — fill during implementation verification |
| AC-6 | Functional E2E + targeted unit/integration; visual where appearance is asserted | `hud_customization.spec.ts`, journey trace and relevant screenshots | /game; /settings | Not run — fill during implementation verification |
| AC-7 | Functional E2E + targeted unit/integration; visual where appearance is asserted | `hud_customization.spec.ts`, journey trace and relevant screenshots | /game; /settings | Not run — fill during implementation verification |
| AC-8 | Functional E2E + targeted unit/integration; visual where appearance is asserted | `hud_customization.spec.ts`, journey trace and relevant screenshots | /settings → Interface → HUD | Not run — fill during implementation verification |

**Test Hooks**:

- **Baseline:** Existing HUD visibility, quest/music settings, input-action and preference adapter tests; record any unrelated baseline failures.
- **Moon Task:** `bun moon run client:typecheck`, `bun moon run client:test`, `bun moon run e2e:test-client`, plus affected shared-project checks resolved from current Moon config. Use Biome and the repository's required validation flow; before PR run required affected-project gates and `bun moon run :validate` when mandated by current guidance. Do not invent project IDs from directory names.
- **Integration:** production `/game` using a real local fixture campaign and actual feature services; inject deterministic provider results for asynchronous operations. Use real storage boundaries for migration/atomicity tests. Assertions must establish behavior and domain invariants, not simply duplicate implementation conditions.
- **Functional:** `apps/e2e/tests/client/hud_customization.spec.ts` with existing Page Objects and deterministic feature fixtures. Each AC maps to a named case; include negative/cancel/reload paths. Bun identity rune polyfills cannot establish Svelte reactivity: verify state/lifecycle/focus in compiled Playwright, reusing `apps/e2e/tests/client/reactive_lifecycle.spec.ts` patterns where appropriate.
- **Visual:** add `apps/e2e/src/visual/suites/hud_customization.visual.ts` using the current runner's `defineConfig` and `export default` conventions. Declare cases with `name`, real `route` and `searchParams`; route fixtures through the repository's existing test fixture mechanism. Do not invent production query parameters solely to bypass domain integration. A dev sandbox may supplement but not replace production cases.
- **Visual cases:** `explore-default`, `dialogue-long`, `inventory-detail`, `combat-actions`, `settings-error`, `compact`, `large-text`, `high-contrast`, `reduced-motion`. Select the cases materially affected by this contract and explain any omitted context.
- **TypeBox visual response schema:** an object with `score` (0–100), `unreadableText` (boolean), `overlappingControls` (boolean), `missingCriticalAction` (boolean), and `issues` (bounded string array), adapted to the existing visual runner wrapper. AI evaluation prompt: “Evaluate this Aikami production journey against the supplied expected state. Score 90+ only when text hierarchy is readable, essential controls are visible and nonoverlapping, focus/selection is apparent where expected, and the scene retains appropriate prominence. Identify concrete defects; do not reward decoration at the expense of usability.” Treat any missing critical action as a failure regardless of score.
- **Viewports/input:** 1920×1080 and 1280×800 normal; 1024×768 compact; 390×844 touch-oriented management; 200% text at desktop/compact; long translated labels/RTL; keyboard, standard controller, pointer and touch controls. Browser/Tauri runtime support must be recorded. UI operability on a narrow viewport does not certify all mobile world gameplay.
- **Performance evidence:** record hardware/runtime/build, campaign fixture, sample count and p50/p95. Compare a repeated 60-second exploration/combat scene before/after for UI-caused frame-time regression (proposed ≤5% p95 regression). Measure operations stated in Success Measures separately. If the environment cannot run a required gate, mark it unverified with the exact blocker; do not fabricate timings or mark the contract verified.

**Watch Points**:

- Production Path rule requires a resolvable route/named entry point/declared command. Replace proposed feature routes and tooling command descriptions with exact implemented routes/commands before approval/verification.
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

No unresolved design defaults. Confirm available supported widget IDs at the execution base and record exact bounded metrics in the schema before approval; do not invent a minimap capability to satisfy previews.

## Amendments

Changes to ACs or scope require a version bump and user approval. Routine implementation placement can follow current project conventions while preserving the defined invariants.

| Version | Date | Change | Approved by |
|---|---|---|---|
| 2.0.0 | 2026-09-14 | Initial source-grounded draft; no implementation or verification claimed | Pending owner approval |

## Promotion Lifecycle

> [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle). A sandbox is not integrated; `release_verified` requires production and visual evidence.

## Status Lifecycle

> [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle). Keep `draft` until authorized; never mark completed before merge/CI. Record actual execution and AC evidence during implementation.
