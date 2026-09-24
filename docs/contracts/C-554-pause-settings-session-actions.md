---
id: C-554
title: "Pause, settings and session actions on game UI roles"
source: direct
contract_type: thin
status: implemented
github: { issue_number: null, issue_url: null, project_item_id: null, pr_url: null }
created_at: "2026-09-24T16:57:28Z"
---

# Contract C-554: Pause, settings and session actions on game UI roles

## Metadata

| Field | Value |
|---|---|
| **Source** | `docs/reference/emberwatch-polish-review-and-plan.md` §6 “Pause and settings”, §8 and §9 (P4, pause/settings surface group) |
| **Baseline** | `3f30e75eb8ba` on `task/sa-c554-pause-settings-1837` |
| **Target** | `apps/frontend/client/src/lib/views/game/ui/overlays/pause_menu/`, `apps/frontend/client/src/lib/views/game/ui/overlays/settings/`, `apps/frontend/client/src/lib/views/settings/ai/`, `packages/frontend/theme/src/lib/aikami_game_ui.css`, focused E2E/POM coverage |
| **Type** | thin |
| **Priority** | P1 — pause and settings are production game tasks and currently mix obsolete product chrome, weak save feedback and ambiguous lifecycle actions |
| **Dependencies** | C-528 (HUD preference authority and editor), C-529 (theme runtime/accessibility), C-533 (overlay stack), C-547/C-551 (presentation-module and game-role patterns), PR #394 (per-capability connections and task routing) |
| **Status** | implemented |
| **Promotion** | none — implementation only; no deploy, publish, promote or sync --apply |
| **Docs Impact** | internal contract and evidence index only |
| **Contract version** | 1.0.0 |
| **Production Surface** | `/game` — pause menu, in-game settings root and full AI capability settings pages |

## Problem & Baseline Evidence

- **Pause menu:** Resume, Save Game, Settings, Customize HUD, End Session and Quit to Main Menu are stacked without hierarchy. Save feedback exposes only a transient string rather than last-saved time. Confirmation says unsaved progress is lost and uses an alarm-red primary action even though autosave normally protects progress.
- **Settings root:** the in-game settings overlay still uses `modal`, `base-*`, `tabs-boxed` and `btn-primary` chrome instead of the `game-*` roles established by C-547/C-551.
- **HUD destination:** C-528 already provides one Interface destination containing presets, per-widget placement/visibility, interface scale and temporary Hide HUD. The pause menu separately opens the layout editor. Preserve the required menu entry and keep Hide HUD reachable from Interface; do not create another customization registry.
- **Session action finding:** `End Session` opens the C-240/C-344 recap flow, persists a session recap and can start a new session while retaining campaign/play state. `Quit to Main Menu` stops autosave, clears the crash/session marker and navigates to the app landing screen. Behaviour differs meaningfully, so both remain, with neutral copy and explicit consequences.
- **AI settings:** PR #394 already added per-capability `+ New connection` and per-role text routing. The remaining §6 gap is the unconfigured capability detail: it repeats “Not configured”/“Set Up” without explaining the capability, current availability, setup consequence or what remains playable without it.
- **Boot policy:** no cloud account or sign-in may be required to boot or play. Local/offline content and non-AI gameplay remain available when any AI capability is unconfigured.

## User Outcome

A player can pause, understand whether the campaign is saved, save immediately, enter one coherent settings/HUD customization destination, and distinguish ending the current session from leaving the game without mistaking either normal navigation action for data-destroying alarm state. Each AI capability explains what it enables, whether it is available now, how to configure it, and which game systems remain playable without it.

## Scope Boundaries

- **In Scope:** pause task order and semantic copy; save status/last-saved presentation; neutral confirmed lifecycle actions; one settings entry point to existing Interface/HUD controls; quick Hide HUD retained in Interface; game-scoped pause/settings/AI capability presentation; capability explanation/availability/setup/playable-without projection; unit, production E2E, axe and production-build evidence.
- **Out of Scope:** content packs, Emberwatch map/building/atlas builders, captures owned by C-553/C-555+, provider/backend changes, cloud sign-in, boot gates, a new theme engine, new HUD storage, new session persistence semantics, deployment, publishing, promotion or catalogue synchronization.

## Acceptance Criteria

### AC-1: Pause prioritizes resume, save feedback and settings
**Given** the player opens the production pause menu
**When** it renders
**Then** Resume is first; a save area shows current save state and last-saved time when available; `Save now` performs the existing manual save; Settings is the next primary task; the required HUD menu entry remains reachable.

**Verification:** presentation unit tests, production `/game` E2E and captures at all required viewports/text scale/themes.

### AC-2: Session lifecycle actions are distinct, explained and neutral
**Given** the pause menu offers End Session and Quit to Main Menu
**When** each is selected
**Then** copy explains that End Session creates/saves a recap and can start a new session without deleting the campaign, while Quit to Main Menu leaves the current game and preserves normal local saves; the action that requires confirmation uses neutral game-control styling, not alarm red.

**Verification:** ViewModel/presentation unit tests, production E2E confirmation assertions and capture evidence.

### AC-3: One coherent interface/customization destination
**Given** existing C-528 HUD preferences and Interface settings
**When** the player uses pause settings
**Then** Interface is the single destination for presets, widget visibility/placement, interface scale and temporary Hide HUD; no competing customization state or duplicate quick-hide authority is introduced.

**Verification:** production E2E from Pause → Settings → Interface, existing C-528 suite plus focused C-554 assertions.

### AC-4: Settings surfaces use game UI roles responsively
**Given** the in-game settings root is open
**When** rendered at 1280×720, 1920×1080, 800×600, 200% text and light/dark themes
**Then** panel, scrim, header, selected section, controls and focus use `game-*` roles; section navigation and content remain operable without overlap or horizontal clipping.

**Verification:** theme tests, production E2E geometry checks, axe and evidence matrix.

### AC-5: Unconfigured AI capability explains the actual gap
**Given** a text, image or voice capability has no configured connection
**When** its capability detail is opened
**Then** it names what the capability does, states that it is currently unavailable/not configured, presents a clear setup action using the existing connection editor, and states what remains playable without it; it does not claim unavailable AI behavior is enabled or require cloud sign-in.

**Verification:** pure presentation unit tests for all three capabilities, production E2E unconfigured/configured states, axe and captures.

### AC-6: PR #394 capability setup and task routing remain intact
**Given** PR #394 behavior
**When** capability details render
**Then** `+ New connection` remains available per capability and text task-role routing remains available where connections exist; C-554 adds explanation rather than replacing those controls.

**Verification:** existing AI activity tests, capability detail tests and focused DOM assertions.

### AC-7: Automated and accessibility coverage
**Given** the changed production surfaces
**When** validation runs
**Then** presentation unit tests, client production-route E2E and axe specs pass; no guard baseline, waiver or threshold is raised.

**Verification:** Moon client/theme/e2e test/typecheck/lint lanes, axe specs, `validate`, and `bun moon ci --base=origin/main`.

### AC-8: Evidence comes from a production build
**Given** a successful production client build
**When** `/game` is served from built output, not the dev server
**Then** evidence covers pause, settings root, and one AI capability unconfigured/configured at 1280×720, 1920×1080, 800×600, 200% text, light and dark; screenshots, montage and `/tmp/opencode/c554-evidence/index.md` record app/content identity and capture conditions.

**Verification:** evidence files, WebGL/renderer assertions, SHA-256 manifest and production preview URL/process record.

## Capability Checklist

| Capability | Still works? | Verified by |
|---|---|---|
| Resume / Escape returns to exploration | ✅ | Existing overlay stack plus pause E2E |
| Manual save writes map-safe snapshot and updates campaign slot | ✅ | Existing game overlay tests plus pause E2E |
| Last-saved feedback derives from real campaign state | ✅ | Pause presentation/ViewModel tests and production E2E |
| End Session recap/edit/new-session flow | ✅ | Existing C-240/C-344 tests plus C-554 navigation/contrast assertions |
| Quit to Main Menu navigation and crash marker reset | ✅ | Existing overlay service tests plus C-554 confirmation E2E |
| Interface presets/widgets/scale/Hide HUD | ✅ | Existing C-528 suite and C-554 route assertion |
| Per-capability connection setup | ✅ | Existing capability editor plus PR #394 `+ New connection` assertion |
| Text task-role routing | ✅ | Existing `ai_activity_view_model.test.ts` and `client:test` |
| Offline/no-sign-in boot | ✅ | Existing boot/release-gate suite; no new boot dependency introduced |
| Light/dark, compact and 200% text | ✅ | C-554 production E2E and evidence |

## Edge Cases & Gotchas

- **No fake UI states:** configured/unconfigured evidence uses the real config service through the production settings page. Test setup may seed the same store; no query parameter may select alternate rendered markup.
- **Last-saved time:** prefer a reactive campaign capability rather than snapshotting a string inside the pause ViewModel. A missing timestamp is a valid “not saved yet” state.
- **Confirmation semantics:** confirmation is required for leaving the current game because it changes context, but copy must state that normal local saves are preserved. End Session already has its own confirmation/recap workflow.
- **200% text:** no fixed-height action list; pause/settings panels own one scroll region and controls wrap without horizontal overflow.
- **Axe scope:** run axe on the visible production overlay, not the obscured game canvas, and fail on all serious/critical violations.

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
|---|---|---|---|
| 1.0.0 | 2026-09-24 | Initial contract | direct request |

## Promotion Lifecycle

> Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

---

## Execution Report

### Summary

Implemented the C-554 pause/settings/session UI pass on the production `/game` path. Resume is first, save feedback now includes the campaign's last-saved timestamp through the existing campaign store, `Save now` retains the map-safe manual-save operation, and Settings opens the existing in-game settings overlay. The pause and settings surfaces use scoped `game-*` roles, remain neutral for normal session navigation, and keep the required HUD menu/Interface customization destination. AI capability details now explain capability purpose, honest availability, setup action, and offline-playable systems while preserving PR #394's per-capability `+ New connection` and task-routing controls.

### AC Status

| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | Pause menu order, `Save now`, live save status, campaign-derived last-saved label, and Settings entry implemented. |
| AC-2 | ✅ | End Session and Quit remain separate; End Session uses the recap/new-session flow, Quit clears the session marker and navigates to the app, and Quit confirmation is neutral with preserved-save copy. |
| AC-3 | ✅ | Existing C-528 Interface section remains the single HUD customization destination; temporary Hide HUD remains there and required Menu remains reachable. |
| AC-4 | ✅ | Pause/settings scrims, panels, tabs, controls, focus and responsive overflow use scoped game roles. |
| AC-5 | ✅ | Text/image/voice guidance projections distinguish not configured, configured-not-tested, reachable, testing and unreachable; unconfigured detail states playable systems. |
| AC-6 | ✅ | Existing PR #394 `+ New connection` and role-routing controls remain in capability detail content. |
| AC-7 | ✅ | Unit/theme/typecheck/lint/build/guards, `validate`, focused production E2E and axe pass. E2E was run against an isolated fallback build on free offset ports; no other agent server was killed. |
| AC-8 | ✅ | Built output served through `vite preview`; corrected real-campaign captures and labeled montage are under `/tmp/opencode/c554-evidence/`. |

### Files created / modified

| Area | Files |
|---|---|
| Contract | `docs/contracts/C-554-pause-settings-session-actions.md` |
| Pause presentation | `apps/frontend/client/src/lib/views/game/ui/overlays/pause_menu/pause_menu_presentation.ts`, `pause_menu_presentation.test.ts`, `pause_menu_view.svelte`, `pause_menu_view_model.svelte.ts`, fixtures/tests |
| Save seam | `apps/frontend/client/src/lib/services/game/game_overlay_types.ts`, `game_overlay_service.svelte.ts` |
| Settings | `apps/frontend/client/src/lib/views/game/ui/overlays/settings/settings_overlay.svelte` |
| AI capability presentation | `apps/frontend/client/src/lib/views/settings/ai/capability_guidance.ts`, `capability_guidance.test.ts`, capability detail ViewModel/content |
| Theme | `packages/frontend/theme/src/lib/aikami_game_ui.css` |
| E2E | `apps/e2e/tests/client/pause_settings.spec.ts` |

### End Session vs Quit finding

`End Session` passes the active session's elapsed duration to `sessionService.endSession({ playtimeMinutes })` through the END_SESSION overlay. It locks chat, generates a session recap, supports recap editing, and offers Start New Session while campaign/local save state remains available. `Quit to Main Menu` stops autosave, clears the crash/session marker, and navigates to the app landing route; it does not invoke the recap/new-session flow. Both behaviours are meaningful, so both actions remain. The quit confirmation now says existing local saves stay on-device and changes since the last save may not be available, rather than claiming all unsaved progress is deleted.

### Evidence

- Index: `/tmp/opencode/c554-evidence/index.md`
- Labeled montage: `/tmp/opencode/c554-evidence/sheet.png`
- Hashes: `/tmp/opencode/c554-evidence/SHA256SUMS`
- Corrected real-campaign captures: `real-1280x720-*`, `real-1920x1080-*`, `real-800x600-*`, `real-text-200-*`, `real-light-*`, `real-dark-*`, plus `real-flow-game.png`, `real-flow-pause.png`, `real-flow-pause-saved.png`, and `real-flow-settings.png`.
- Real flow: `New Adventure → local text setup → Continue → All set → Thaldrin → motivation → Enter World`; no bypass query parameters. `real-flow-pause-saved.png` follows a production `Save now` click and shows a real saved campaign state.
- AI captures: `ai-text-unconfigured.png` and `ai-text-configured.png`; configured capture used the production connection editor with an Ollama local connection (`http://127.0.0.1:11434`, model `llama3.2`) and does not claim endpoint reachability.
- Bottom band: the prior full-width strip was the production preview tooling/diagnostics band, not the settings panel; it is excluded from the corrected C-554 UI evidence and documented as tooling residue.
- Dev cog: visible bottom-right in the production build and intentionally left untouched for C-555.
- Evidence was captured from built `apps/frontend/client/build` via `vite preview`, not the dev server.

### Verification

- `bun moon run client:typecheck` — pass, 0 errors/0 warnings.
- `bun moon run frontend-theme:typecheck` — pass.
- `bun moon run e2e:typecheck` — pass.
- `bun moon run client:lint` — pass.
- `bun moon run e2e:lint` — pass.
- `bun moon run client:test` — pass, 4,098 tests, 0 failures, 7 skipped, 2 todo.
- `bun moon run frontend-theme:test` — pass.
- `bun moon run client:build` / `bun run --cwd apps/frontend/client build:production` — pass; production output and bundle budget pass.
- `validate({ test: true })` — pass after reducing the touched service module below its existing source-size ceiling; all 10 structural guards pass.
- `bun moon ci --base=origin/main` — pass, 48 completed / 2 skipped.
- `PATH=/tmp/c554-bin:$PATH PUBLIC_EMULATOR_PORT_OFFSET=191 bun run --cwd apps/e2e test:client -- tests/client/pause_settings.spec.ts --workers=1` — pass, 5/5 tests, including pause/settings bounds, HUD-under-scrim assertion, 200% pause scroll, capability detail and axe audits. Preflight used isolated fallback ports 5465/5469; no other agent server was killed.
- `magick montage ... -label` — pass; generated labeled `sheet.png` with explicit light/dark rows.
- `git diff --check` — pass.

### Deviations / follow-ups

- Evidence uses explicit `data-theme` and `document.documentElement.style.fontSize` product mechanisms; no alternate rendered implementation or query-driven UI state was introduced.
- The production preview tooling cog remains visible bottom-right and is intentionally C-555 scope.
- No content packs, maps, atlases, catalog snapshots, sync commands, deploy, publish, promotion, or policy files were changed.
