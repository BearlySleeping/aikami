---
id: C-527
title: "Coherent play shell and management navigation"
source: "direct"
contract_type: full
status: implemented
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: "https://github.com/BearlySleeping/aikami/pull/353"
  pr_number: 353
created_at: "2026-09-14"
---

# Contract C-527: Coherent play shell and management navigation

## Metadata

| Field | Value |
|---|---|
| **Source** | User request: optimal customizable Aikami UI/HUD/menus and community themes; source review at `b3e8234b6ced2c6c8ae1a62aa023850ed3ad85c4` |
| **Target** | Client game composition, overlay/input seams, shared theme roles, and existing management views |
| **Type** | full |
| **Priority** | P1 — coherent player experience and safe customization foundation |
| **Dependencies** | Existing overlay/input/feature capabilities; preserve C-525 combat behavior. C-502/C-503 are optional future integrations, not blockers. |
| **Status** | implemented |
| **Promotion** | — |
| **Docs Impact** | User-facing → proposed guide under `apps/frontend/docs/src/content/docs/`; add/update the current navigation and actual page in this PR. Theme/HUD author docs where relevant. |
| **Contract version** | 2.0.0 |
| **Production Surface** | `/game` and `/settings` |

ID `C-527` is registered in [PROGRESS.md](PROGRESS.md) as part of the C-527–C-530 UI/HUD bundle and is reserved for this document; re-confirm no collision with a merged contract before implementation begins. This document records proposed behavior; its ACs are not yet verified or approved by this planning deliverable.

## Problem & Baseline Evidence

- Current production HUD composition places widgets independently in `game_ui_view.svelte`; the seven-item management strip has a separate fixed top-center placement.
- Management renders through an active-overlay switch; a coherent sibling-section workspace is not the default production surface.
- The combat root currently uses `min(28vw, 32rem)` and one sidebar. Do not repeat the obsolete duplicate-combat finding from the earlier design document.
- The shared theme already owns semantic colors and primitive classes. Explicit dark selection is already fixed. Source Serif is declared; bundled font delivery still needs verification.
- Reproduce by loading a local campaign at `/game`, observing navigation/HUD composition, opening Inventory/Journal/Character, resizing, and checking focus/pause transitions. Baseline source review did not run these journeys.
- Baseline tests to inspect/run (all confirmed present at the reviewed commit): `apps/frontend/client/src/lib/views/game/ui/game_ui_view_model.test.ts`, `apps/frontend/client/src/lib/services/game/game_overlay_service.test.ts`, `apps/frontend/client/src/lib/services/game/input_action_service.test.ts`, `apps/frontend/client/src/lib/services/game/inventory_service.test.ts`, `apps/frontend/client/src/lib/views/game/ui/quest_tracker_view_model.test.ts`, and `apps/e2e/src/visual/suites/game_hud.visual.ts`.
- Path claims above were re-verified against the working tree during critique: `game_view.svelte` is the sole combat grid root and uses `min(28vw, 32rem)`; `hud/management_nav.svelte` renders exactly seven labeled buttons in one fixed top-center strip; `app.css` declares Source Serif 4 in `--font-display` with no bundled font binaries in the tree; and `packages/frontend/theme` is imported by `apps/frontend/client/src/app.css`, `apps/frontend/hub/src/app.css` and `apps/frontend/docs/astro.config.ts` (the cross-app blast radius asserted by AC-6 and Directive 10).

## User Outcome

A player can explore a quiet, readable game scene, open any existing management feature quickly, switch sections in one workspace, and return to play or conversation without losing context.

## Success Measures

- Default mouse/touch path to a management section takes at most two activations; configured section shortcuts take one. Sibling sections take one activation.
- Warm shell/section navigation p95 input-to-visible response ≤100ms on a documented reference machine over 30 interactions; separately record feature-data loading. Target no new >50ms main-thread task from shell code.
- Offline boot/play/menu navigation remain available with no sign-in or font/CDN requests.
- Production journey: explore → Inventory → Character → Journal/Quests → return to the exact originating play or conversation context.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Game composition | `apps/frontend/client/src/lib/views/game/game_view.svelte` | Modify layout only; preserve engine and combat ownership |
| HUD and overlay projection | `apps/frontend/client/src/lib/views/game/ui/game_ui_view.svelte; game_ui_hud_visibility.ts` | Modify host and visibility, reuse feature data |
| Overlay stack and pause lifecycle | `apps/frontend/client/src/lib/services/game/game_overlay_service.svelte.ts` | Extend existing authority; no competing router |
| Input actions/glyphs | `apps/frontend/client/src/lib/services/game/input_action_service.svelte.ts` | Reuse bindings and device detection |
| Theme/primitive classes | `packages/frontend/theme/src/lib/aikami_theme.css; aikami_ui.css` | Preserve class API; add game-scoped roles |
| Management section entry points | `apps/frontend/client/src/lib/views/game/ui/hud/management_nav.svelte`; `GameOverlayType` in `apps/frontend/client/src/lib/types/game.ts` | Modify — regroup the seven nav buttons into five sections; keep `QUEST_LOG`, `REPUTATION`, `INVENTORY`, `CHARACTER_DASHBOARD`, `PARTY_ROSTER`, `WORLD` as deep-open destinations |
| Design reference | `docs/design/game_ui_hud_overhaul.md`; Obsidian sandbox view `apps/frontend/client/src/lib/views/dev/obsidian/` (route `apps/frontend/client/src/routes/(dev)/dev/(sandbox)/sandbox/obsidian/`) | Reuse proven visual vocabulary; revalidate stale findings |

Paths abbreviated to sibling filenames in this table are relative to the named feature directory. Verify exact exports at the implementation base.

## Overview

Introduce the production play shell and a single management section host. Migrate existing feature views into that host without duplicating their domain workflows. Ship the refined Obsidian Chronicle appearance and a stable default HUD; user editing and community packages follow in separate contracts.

## Design Reference

- `docs/design/aikami_ui_hud_theme_review_2026q3.md` in this bundle defines visual direction, navigation mapping, defaults and ecosystem boundaries.
- Existing `docs/design/game_ui_hud_overhaul.md` and the Obsidian sandbox (`apps/frontend/client/src/lib/views/dev/obsidian/`) are context; do not copy stale defect claims or treat a dev sandbox as production evidence.
- Read current `AGENTS.md`, `.context/CONTEXT.md`, `.context/index.md` and required project skills: `aikami-conventions`, `svelte-conventions`, `aikami-ui`, `testing`; add backend/PixiJS skills when actually touching those boundaries.
- Keep Aikami semantic HTML/classes; complex components only for meaningful structure, behavior, accessibility or a reusable API.

> Testing conventions: [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions).

## Architecture Directives

1. Preserve Svelte MVVM, narrow injected capabilities and sibling composition factories. The shell owns presentation and focus; feature services continue to own inventory, quest, save, conversation and combat work. Do not create one universal replacement ViewModel.
2. Add a small code-owned section registry with `character`, `inventory`, `journal`, `party`, `world`. Journal hosts existing Quests and notes; World hosts existing reputation where appropriate. Existing quest/reputation shortcuts deep-open the correct subview. Preserve all production actions; do not invent spells/guild mechanics absent from the domain.
3. `openSection` replaces a sibling management section. A separate detail stack handles item/actor detail. A captured return context preserves originating overlay/conversation, actor, draft identity and scroll anchor. Transient view state lives locally; this contract does not create a new campaign save format.
4. Keep Pause and Settings distinct from management. Pause owns Resume and system actions. Settings content is shared with `/settings`, with return-to-origin behavior in-game. Keep save-error and quit confirmation semantics.
5. Consolidate key dispatch through the existing input/overlay authority. Modal/local popup/targeting/management/world scopes have deterministic priority. Check `defaultPrevented`, IME composition and editable targets. Stop movement when a blocking UI opens; a held key must not resume movement until fresh gameplay input after closing. Keyboard focus and controller focus follow the same logical destination model.
6. Retain single-player pause semantics for management. Switching tabs does not pause/resume repeatedly or leak a simulation frame. Release only pause ownership acquired by this surface. Do not cancel committed async domain work on close; late responses remain bound to their original context.
7. Default layout uses named slots with stable geometry: compact player/party status, one objective, contextual interaction/hotbar, and a labeled Menu entry. Clock/music off for new users; preserve explicit existing preferences. One compact/expanded quest projection replaces positioning of competing implementations. Fixed children stop owning viewport coordinates. Reserve system-notice and action regions.
8. Preserve the current single CombatSidebar/action workflow and direct-control canvas. Use content/remaining-scene constraints to adapt the container; at insufficient width use an accessible bottom/action-sheet presentation. Do not add a second action dock bound to separate combat lifecycle or reopen combat rules contracts.
9. Use refined Obsidian Chronicle tokens from the accompanying design review. Essential game text starts at an 18px-equivalent readable scale; Inter body, sparse Source Serif 4 headings, tabular numerals. Audit runtime font loading and bundle licensed local fonts/fallbacks. No live font service dependency. Update project typography guidance for the existing display role when needed.
10. Scope the game theme beneath a stable game theme root. Verify Tailwind alias resolution and theme inheritance for portaled dialogs; global Hub/site/docs appearance must not accidentally change. Preserve Aikami-owned semantic classes and shared native-dialog Modal. Do not wrap each button in a new component.
11. Explicit reduced-motion selection takes effect under either OS preference; use a single effective policy. Support text growth and opaque reading panels. Remove the sandbox-only `zoom` probe from any proposed production scaling strategy; use reflow-capable metrics and layout.
12. Keep the earlier Obsidian design proposal as historical context; add an implementation note mapping superseded findings and the narrower scope here. Do not silently mark that entire broader proposal implemented.

## State & Data Models

```ts
type ManagementSectionId = 'character' | 'inventory' | 'journal' | 'party' | 'world';
type ManagementLocation = {
  section: ManagementSectionId;
  subview?: string; // validated against the trusted section's own allowed values
  entityId?: string;
};
type GamePresentation = 'scene' | 'conversation' | 'management';
type InputScope = 'world' | 'composer' | 'targeting' | 'management' | 'modal';
type HudSlot = 'top-start' | 'top-end' | 'bottom-start' | 'bottom-center' | 'bottom-end';
```
These are conceptual UI-local types. Reuse existing overlay/focus models where possible. Game mode, presentation, navigation and pause ownership are separate dimensions with an explicit supported-state resolver; do not accept every Cartesian combination. No executable component references cross persistence/package boundaries.

**Legacy entry-point mapping.** The five canonical sections replace the seven current nav destinations without deleting the domain features behind them. `GameOverlayType` values (`INVENTORY`, `CHARACTER_DASHBOARD`, `QUEST_LOG`, `JOURNAL`, `PARTY_ROSTER`, `REPUTATION`, `WORLD`) stay valid as deep-open destinations and map onto sections as follows — implement this mapping explicitly rather than widening `ManagementSectionId` back to seven values:

| Legacy entry point | Canonical location |
|---|---|
| `character` (`CHARACTER_DASHBOARD`) | `{ section: 'character' }` |
| `inventory` (`INVENTORY`) | `{ section: 'inventory' }` |
| `journal` (`JOURNAL`) | `{ section: 'journal', subview: 'notes' }` |
| `quests` (`QUEST_LOG`) | `{ section: 'journal', subview: 'quests' }` |
| `party` (`PARTY_ROSTER`) | `{ section: 'party' }` |
| `reputation` (`REPUTATION`) | `{ section: 'world', subview: 'reputation' }` |
| `world` (`WORLD`) | `{ section: 'world', subview: 'codex' }` |

`subview` values are validated against the owning section's own allowlist; unknown values fall back to the section default rather than throwing.

## Quality Requirements

- **Offline/degraded:** built-in fonts/theme/menu data resolve locally; absent AI affects generation only.
- **Accessibility/input:** keyboard, mouse, touch-operable controls, and standard gamepad management navigation; no hover-only actions or drag-only operation. No claim of full blind world navigation in this UI contract. Verify semantic DOM, screen-reader labels, focus restoration, IME, reduced motion and 200% text scale.
- **Performance:** budgets in Success Measures; preserve one canvas instance and one workflow owner. Avoid full-scene blur and per-frame Svelte layout updates. Measure scene frame-time regression separately.
- **Security/privacy:** management and theme presentation never change domain permissions; exported evidence uses fixtures instead of private conversations.
- **Persistence/migration:** no campaign schema change; preserve current preferences and legacy shortcuts.
- **Cancellation/retry/idempotency:** section switching/remounts do not replay item/save/combat actions; stale async results stay with their origin.
- **Observability:** development logs for navigation/pause mismatch and errors; no per-frame logging or transcript telemetry.

## Migration & Rollback

- Preserve old entry-point methods as adapters to the new section host until their callers migrate; never leave two active ownership paths.
- New shell may use a local release flag during integration; built-in new-user behavior changes only when all production ACs pass. Prior explicit preferences remain authoritative.
- Keep a safe built-in layout and existing system settings accessible if shell state is invalid. Clear only invalid UI state, never campaigns/drafts.
- Reverting the feature release restores the old presentation with campaign storage untouched. Remove temporary adapters/flags once rollout is verified; do not indefinitely maintain two shells.

## Scope Boundaries

- **In Scope:** production default shell/HUD composition; five-section navigation hosting existing features; input/focus/pause integration; responsive combat containment; shared default game theme and locally loaded fonts; existing feature entry-point migration.
- **Out of Scope:** HUD editor; third-party theme parsing/Hub; a universal timeline or dialogue rewrite; combat rules changes; new minimap/quest projection; new inventory/guild mechanics; online pause semantics; repository-wide reskin.

## Contract Size & Split Rule

> Split on independent mergeability: [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule).

**For this contract:** This is one default-interface journey, independently useful before customization or Hub. C-528 edits the layout after this stable host exists; C-529 adds theme data/runtime; C-530 adds distribution. Do not absorb their acceptance criteria here.

## Acceptance Criteria

### AC-1: Quiet production exploration
**Given** a new local campaign with default preferences.
**When** the player moves and interacts.
**Then** the scene dominates; Menu, compact status and one objective have stable slots; only eligible contextual controls appear; no seven-item permanent default management bar.
**Production Path**: /game.
### AC-2: Connected management and shortcuts
**Given** the player opens Inventory directly or through Menu.
**When** they switch Character → Journal/Quests and close.
**Then** one management host remains; each section preserves its own state and returns to its captured origin; legacy quest/reputation shortcuts reach equivalent content.
**Production Path**: /game.
### AC-3: Focus, input and pause correctness
**Given** world movement or a conversation draft is active.
**When** management, a child detail, Pause and Settings are opened/closed using supported inputs.
**Then** Back unwinds one applicable scope, focus returns, held keys do not leak, IME is preserved, and pause remains acquired exactly while required.
**Production Path**: /game; /settings.
### AC-4: One combat authority
**Given** legacy or direct-control combat is active.
**When** the viewport shrinks or management is inspected.
**Then** there is one legal-action workflow, required turn/target controls remain reachable, direct-control scene input is correctly scoped, and no duplicate command or unintended unpause occurs.
**Production Path**: /game.
### AC-5: Readable responsive default
**Given** a supported browser/Tauri viewport at default or 200% text scale.
**When** game, conversation, management and Settings are shown.
**Then** content reflows without clipped essential actions or two-axis reading scroll; panels are readable over light/dark scenes; touch and controller focus targets remain usable.
**Production Path**: /game; /settings.
### AC-6: Font, scope and motion guarantees
**Given** network is disabled and OS appearance/motion differs from explicit player selection.
**When** the game starts, changes built-in variant and enables reduced motion.
**Then** approved font faces load locally or documented fallbacks render, explicit choices work, motion reduction works, and unrelated app/Hub styles remain unchanged.
**Production Path**: /game; /settings.
### AC-7: Preserved domain operations
**Given** a save, conversation response or item operation is pending.
**When** the player navigates away and back or repeats a UI activation.
**Then** results remain attached to their origin, do not execute twice, and actionable errors remain available.
**Production Path**: /game.
### AC-8: Measured delivery
**Given** the default shell is production-integrated.
**When** the required tests and reference-machine journeys run.
**Then** evidence records latencies, scene frame-time comparison, screenshots and all AC results; sandbox-only success is insufficient.
**Production Path**: /game.

**Evidence Matrix**:

| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Functional E2E + targeted unit/integration | `apps/e2e/tests/client/play_shell.spec.ts` case `quiet-exploration`; `play_shell.visual.ts` cases `explore-default`, `compact`; journey trace + screenshots | /game | PASS. `env -u CI PUBLIC_EMULATOR_PORT_OFFSET=2574 bunx playwright test tests/client/play_shell.spec.ts --project=client` -> 16/16 passed; `quiet-exploration` asserts no `management-nav`, no `nav-*` buttons, the Menu entry, all named HUD slots, and (deterministically, by bounding box) that no two HUD regions overlap. `PUBLIC_EMULATOR_PORT_OFFSET=2574 bun run src/visual/runner.ts --suite=play-shell` -> 9/9, explore-default 90, compact 95. Screenshots: apps/e2e/test-results/visual/play-shell_explore-default.png. |
| AC-2 | Functional E2E + targeted unit/integration | `play_shell.spec.ts` case `section-switch-and-return`; `play_shell.visual.ts` cases `explore-default`, `inventory-detail`; journey trace + screenshots | /game | PASS. `env -u CI PUBLIC_EMULATOR_PORT_OFFSET=2574 bunx playwright test tests/client/play_shell.spec.ts --project=client` -> 16/16; `section-switch-and-return` (one host, five tabs, sibling switch replaces, Back returns) and `section-preserves-state` (a typed Journal search draft and a picked World tab survive repeated sibling switches) both green. Unit: `management_sections.test.ts` 18 pass + `game_ui_view_model.test.ts` return-context cases. Visual: inventory-detail 95, compare-section-switch 95. |
| AC-3 | Functional E2E + targeted integration | `play_shell.spec.ts` cases `focus-pause-scopes`; `apps/e2e/tests/client/reactive_lifecycle.spec.ts`-style compiled assertions; overlay/input unit tests | /game; /settings | PARTIAL. `env -u CI PUBLIC_EMULATOR_PORT_OFFSET=2574 bunx playwright test tests/client/play_shell.spec.ts --project=client` -> 16/16; `focus-pause-scopes` asserts the host takes focus, Escape unwinds one scope and focus returns to the pre-host element; `held-key-does-not-resume-movement` is non-vacuous (it first proves the player was moving, then that a released key cannot resume motion). Compilation-level coverage is the Vitest browser lane (`moon run client:test-browser` -> 22 files / 44 tests passed). NOT covered by any test: IME preservation, controller focus parity, `defaultPrevented` (Amendment 2.0.1 item 5). |
| AC-4 | Functional E2E + targeted unit | `play_shell.spec.ts` cases `combat-narrow`, `combat-no-duplicate-action`; `play_shell.visual.ts` case `combat-actions`; existing `apps/e2e/src/visual/suites/combat.visual.ts` reinterpreted as no-regression | /game | PASS. `env -u CI PUBLIC_EMULATOR_PORT_OFFSET=2574 bunx playwright test tests/client/play_shell.spec.ts --project=client` -> 16/16; `combat-narrow` measures real bounding boxes (sheet present as a labelled `region` at 700x900 with the scene region above it, absent again at 1280x800) and `combat-no-duplicate-action` asserts exactly one of each action control and at most one engine resume on a 390x844 viewport. Unit: `combat_layout.test.ts` 9 pass (split/sheet invariant swept across 400-2560px). Visual: combat-actions 90. `combat.visual.ts` was not modified, so it remains the /dev/combat no-regression suite. |
| AC-5 | Functional E2E + visual | `play_shell.spec.ts` cases `reflow-200-text`, `touch-management`; `play_shell.visual.ts` cases `compact`, `large-text`, `high-contrast` | /game; /settings | PASS. `env -u CI PUBLIC_EMULATOR_PORT_OFFSET=2574 bunx playwright test tests/client/play_shell.spec.ts --project=client` -> 16/16; both cases green, and a DOM measurement on the production route confirms the 200% rail fits one line with `scrollWidth == innerWidth` (no two-axis reading scroll). `PUBLIC_EMULATOR_PORT_OFFSET=2574 bun run src/visual/runner.ts --suite=play-shell` -> 9/9 with the defect gates satisfied: large-text 95, compact 95, high-contrast 90. |
| AC-6 | Functional E2E + cross-app visual no-regression | `play_shell.spec.ts` cases `offline-fonts`, `explicit-motion`; `play_shell.visual.ts` case `reduced-motion`; hub/site/docs appearance no-regression check (`bun moon run e2e:test-site-visual`, and the hub suites touching `apps/frontend/hub/src/app.css`) | /game; /settings | PASS except the cross-app run. `env -u CI PUBLIC_EMULATOR_PORT_OFFSET=2574 bunx playwright test tests/client/play_shell.spec.ts --project=client` -> 16/16: `offline-fonts` aborts every off-origin request and still renders the shell with no font request; `explicit-motion` covers both OS preferences; `explicit-motion-setting` proves the in-game control drives the HUD under an opposing OS preference and survives a reload (**/game**); `explicit-motion-settings-page` proves the standalone **/settings** route shows the stored choice after a reload and that /game agrees. Unit: `app_fonts.test.ts` 4 pass, `motion_preference_service.test.ts` 8 pass (incl. construction-time restore), `motion_policy.test.ts` 6 pass. Visual: reduced-motion 100. 🔴 The cited `bun moon run e2e:test-site-visual` is UNRESOLVABLE — see the Test Hooks note and Amendment 2.0.1 item 6; the substitute is an empty `git diff ab9a4f304 HEAD` over `packages/frontend/theme`, `apps/frontend/hub/src/app.css`, `apps/frontend/site`, `apps/frontend/docs/src/styles` and `apps/frontend/client/src/app.css`, which is an argument rather than a run. |
| AC-7 | Targeted integration + functional E2E | `play_shell.spec.ts` cases `pending-save-return`, `double-activation-idempotent`; existing `inventory_service.test.ts` / `game_save_service.test.ts` unchanged-or-green | /game | PASS. `env -u CI PUBLIC_EMULATOR_PORT_OFFSET=2574 bunx playwright test tests/client/play_shell.spec.ts --project=client` -> 16/16; `pending-save-return` leaves durable state in two sections and asserts it survives two away-and-back round trips (only possible if no section was re-initialised, so no item/save/listener work replayed); `double-activation-idempotent` keeps one host, one section body and one workflow owner. `inventory_service.test.ts` and `game_save_service.test.ts` are unchanged and green in `bun run test:unit` -> 3281 pass / 0 fail. |
| AC-8 | Delivery report | Recorded reference-machine latencies (p50/p95), 60s scene frame-time before/after table, visual run ID, per-AC result table | /game | PASS. `env -u CI PUBLIC_EMULATOR_PORT_OFFSET=2574 bunx playwright test tests/client/play_shell_perf.spec.ts --project=client` -> budgets asserted in-test and artifact written to `apps/e2e/test-results/play-shell-perf.json`: activation p50 70.1ms / p95 75.7ms / max 82.3ms over 30 activations (budget 100ms); 60s scene rAF p50 16.7ms / p95 16.8ms over 3598 frames vs base `ab9a4f304` p50 16.7ms / p95 16.7ms over 3600 frames (<=0.6% p95 regression, budget 5%); `longTasksOver50ms: []`. Visual run: `play-shell` suite, 9 cases, report at `apps/e2e/test-results/visual/report.html`. Full per-AC table in the Execution Report. |

Artifact filenames are the proposed names; keep them aligned with the actual committed files before verification. Every row must additionally cite the command and the run output that produced the evidence.

**Test Hooks**:

- **Baseline:** Run client unit tests covering HUD/overlay/input and existing inventory/quest feature journeys; record failures before editing. No tests were run during this drafting task.
- **Moon Task:** `bun moon run client:typecheck`, `bun moon run client:test`, `bun moon run e2e:test-client`, plus affected shared-project checks resolved from current Moon config. Use Biome and the repository's required validation flow; before PR run required affected-project gates and `bun moon run :validate` when mandated by current guidance. Do not invent project IDs from directory names.
- **Integration:** production `/game` using a real local fixture campaign and actual feature services; inject deterministic provider results for asynchronous operations. Use real storage boundaries for migration/atomicity tests. Assertions must establish behavior and domain invariants, not simply duplicate implementation conditions.
- **Functional:** `apps/e2e/tests/client/play_shell.spec.ts` with existing Page Objects and deterministic feature fixtures. Each AC maps to a named case; include negative/cancel/reload paths. Bun identity rune polyfills cannot establish Svelte reactivity: verify state/lifecycle/focus in compiled Playwright, reusing `apps/e2e/tests/client/reactive_lifecycle.spec.ts` patterns where appropriate.
- **Visual:** add `apps/e2e/src/visual/suites/play_shell.visual.ts` using the current runner's `defineConfig` and `export default` conventions. Declare cases with `name`, real `route` and `searchParams`; route fixtures through the repository's existing test fixture mechanism. Do not invent production query parameters solely to bypass domain integration. A dev sandbox may supplement but not replace production cases.
- **Visual cases:** `explore-default`, `dialogue-long`, `inventory-detail`, `combat-actions`, `settings-error`, `compact`, `large-text`, `high-contrast`, `reduced-motion`. Select the cases materially affected by this contract and explain any omitted context.
  - 🔴 **`bun moon run e2e:test-site-visual` (cited above for the AC-6 cross-app row) is unresolvable.** `apps/e2e/package.json` maps that task to `playwright test ... tests/site/visual_regression`, and `apps/e2e/tests/site/visual_regression/` does not exist. Re-audited during implementation: `moon run e2e:test-site-visual` cannot produce the cross-app no-regression artifact the Evidence Matrix asks for. The substitute used instead is a diff-based proof over the same paths — `git diff <pre-C-527 base> HEAD -- packages/frontend/theme apps/frontend/hub/src/app.css apps/frontend/site apps/frontend/docs/src/styles apps/frontend/client/src/app.css` is empty, so Hub/site/docs appearance cannot have changed. That is an argument, not a run, and is recorded as such. Clearing this needs a follow-up decision (fix the task definition or amend the Evidence Matrix), not a silent substitution.
  - **Omitted: `dialogue-long`.** A long conversation on `/game` requires a text AI provider or an AI-generated dialogue chip; the deterministic lane has neither and the composition root exposes no dialogue test seam (unlike combat). Capturing it would mean screenshotting a provider-setup screen and claiming it was a conversation. Covered instead by `compare-section-switch` and by the E2E `focus-pause-scopes` / `section-preserves-state` cases.
  - **Added: `compare-section-switch`.** Journal is opened via the rail rather than a query parameter, so the workspace's single-surface behaviour is captured on the production entry path.
  - **`combat-actions` is not the same fixture as `combat.visual.ts`.** The latter drives `/dev/combat`; this one runs the production `/game` route and starts a real encounter through the composition root's test seam (`startRealEncounter`, encounter `inn_wand_encounter` — the same authored fixture the C-516 suite uses, chosen because `startCombat`'s content-pack-resolved roster is rejected with `invalidStateShape` on a freshly booted campaign). `combat.visual.ts` is therefore a no-regression suite, not a duplicate of this case.
  - **`settings-error`** opens the real in-game Settings overlay from the pause menu; no error state is injected, so the case asserts readability and error-presentation robustness rather than a specific failure.
  - Every case sets `screenshotSelector`: without it the runner clips a 256×256 region centred on the canvas, which contains none of the HUD, the rail or the Back control. The contract's defect flag `missingCriticalAction` is gated with `requiredFalseFields` (added to the runner for this contract) — gating it with `requiredTrueFields` would invert the gate and make a correct UI unpassable.
- **TypeBox visual response schema:** an object with `score` (0–100), `unreadableText` (boolean), `overlappingControls` (boolean), `missingCriticalAction` (boolean), and `issues` (bounded string array), adapted to the existing visual runner wrapper. AI evaluation prompt: “Evaluate this Aikami production journey against the supplied expected state. Score 90+ only when text hierarchy is readable, essential controls are visible and nonoverlapping, focus/selection is apparent where expected, and the scene retains appropriate prominence. Identify concrete defects; do not reward decoration at the expense of usability.” Treat any missing critical action as a failure regardless of score.
- **Viewports/input:** 1920×1080 and 1280×800 normal; 1024×768 compact; 390×844 touch-oriented management; 200% text at desktop/compact; long translated labels/RTL; keyboard, standard controller, pointer and touch controls. Browser/Tauri runtime support must be recorded. UI operability on a narrow viewport does not certify all mobile world gameplay.
- **Performance evidence:** record hardware/runtime/build, campaign fixture, sample count and p50/p95. “Input-to-visible” means activation event timestamp → first frame in which the destination section's root element is painted and focusable (Performance Observer + `requestAnimationFrame` after the state commit, not the click handler's own duration). “No new >50ms main-thread task” means no Long Task (`PerformanceObserver` `longtask`) attributable to shell/presentation code across the measured journey beyond the baseline capture. Compare a repeated 60-second exploration/combat scene before/after for UI-caused frame-time regression (proposed ≤5% p95 regression). Measure operations stated in Success Measures separately. If the environment cannot run a required gate, mark it unverified with the exact blocker; do not fabricate timings or mark the contract verified.

**Watch Points**:

- Production Path rule requires a resolvable route/named entry point/declared command. Routes (`/game`, `/settings` — both exist under `apps/frontend/client/src/routes/`) and Moon tasks (`client:typecheck`, `client:test`, `e2e:test-client`, `e2e:run-visual-tests`, `e2e:test-site-visual`) are verified against the current tree; re-confirm before verification in case project IDs or task names change.
- Screenshot/AI appearance scores cannot prove focus, input ownership, immutable installation, moderation or domain idempotency; keep functional/integration assertions.
- Keep every required control reachable when optional HUD is hidden. Explicit user accessibility overrides have priority over visual preferences.

## Implementation Sequence

1. Capture baseline production journeys and available input/capability behavior; map every old entry point to its new home.
2. Implement scoped tokens/font delivery, section metadata, state/focus/pause resolver and pure policy tests.
3. Integrate one production host and stable HUD layout, migrate feature containers, then adapt combat and compact layouts.
4. Run compiled interaction/E2E, offline and visual checks; record AC evidence and remove competing ownership paths.

## Edge Cases & Gotchas

Late NPC responses while inventory is open; repeated Escape; nested native dialogs; non-default remaps; controller disconnect and held input; long quest titles; no companions; missing portraits; viewport resize during combat; save error while optional HUD is hidden; dynamic keyboard height.

## Open Questions

Must be resolved before status becomes `approved`:

- **Contract ID allocation** — resolved: `C-527` is registered in [PROGRESS.md](PROGRESS.md) alongside C-528–C-530. No product question blocks drafting; recommended defaults above are explicit.
- **Feature capability inventory** — unresolved. Confirm against the implementation base which of the assumed capabilities (quest notes, World/Factions reputation content, Party relationship entries) actually exist, so no section is either empty or forced to invent mechanics. Owner: implementer, resolved in Implementation Sequence step 1.
- **Supported runtime and controller matrix** — unresolved. Record the concrete browser/Tauri versions and the specific gamepad models covered by AC-3/AC-5 before verification. Owner: contract owner.

Any actual domain change discovered while resolving these must become a separate scoped proposal.

## Amendments

Changes to ACs or scope require a version bump and user approval. Routine implementation placement can follow current project conventions while preserving the defined invariants.

| Version | Date | Change | Approved by |
|---|---|---|---|
| 2.0.0 | 2026-09-14 | Initial source-grounded draft; no implementation or verification claimed | Pending owner approval |
| 2.0.1 | 2026-09-14 | **Proposed (pending owner approval).** (1) `world.subview = 'codex'` is documented as the World section's name for the World view's default tab, not a `WorldTab` value — feeding it to `setActiveTab` throws, so the ViewModel translates it (`WORLD_TAB_BY_SUBVIEW`). This resolves the Open Question "Feature capability inventory": the codex content exists (the World view); it is simply not a subview id. (2) `clock/music off for new users` needs a persisted preference that does not exist in the settings surface; adding one is new persistence surface outside this contract's Scope Boundaries, so it is deferred rather than invented. (3) Bundling licensed font binaries (`Source Serif 4`, `Inter`) is deferred — `app.css` performs no network font request and declares local fallback chains, which is the AC-6 "documented fallbacks" branch; no `*.woff2`/`*.ttf` and no font package exist in the tree. (4) ~~An explicit persisted reduced-motion selection is deferred~~ — **withdrawn: implemented.** `MotionPreferenceService` (persisted, Settings → Gameplay → Motion, restored at boot by the composition root) drives the single `resolveReducedMotion` policy; `explicit-motion-setting` proves the control changes the HUD and survives a reload. (5) Controller focus parity, IME preservation and `defaultPrevented` handling remain unverified by a test. (6) **New:** the AC-6 Evidence Matrix's `bun moon run e2e:test-site-visual` is unresolvable (the task maps to a test directory that does not exist); the cross-app no-regression row was satisfied by an empty-diff argument over the theme/appearance paths instead. Either the task definition or the Evidence Matrix needs fixing in a follow-up. (7) ~~**New, outside this contract:** `questOverlayService.initialize()` is never called by the composition root, so the quest-overlay visibility preference is not restored across reloads either.~~ — **withdrawn: fixed with the same idiom.** Both preference services now restore in their CONSTRUCTOR rather than in an `initialize()` that an entry point has to remember to call. The forgotten-call-site failure mode is what caused `MotionPreferenceService` to show `auto` on `/settings` after a reload (the game boot restored it; the settings route never did), so the fix is the class of bug, not just the one instance: `MotionPreferenceService` and `QuestOverlayService` both own their restore, `initialize()` remains as an idempotent explicit re-read, and each service exposes a factory so a test can construct a fresh instance and observe the restore. | Pending owner approval |

## Promotion Lifecycle

> [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle). A sandbox is not integrated; `release_verified` requires production and visual evidence.

## Status Lifecycle

> [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle). Keep `draft` until authorized; never mark completed before merge/CI. Record actual execution and AC evidence during implementation.

## Execution Report

### Summary

Attempt 5 fixes the pre-push gate that went red after attempt 4. The guards found two real problems,
both fixed: a service file exported a test-only factory that had no production caller
(`guard-orphaned-capability`), and `game_ui_view_model.svelte.ts` had grown 418 lines past its reviewed
size ceiling (`guard-source-file-size`). Fixing the second properly also retired that file's exception
entry entirely — it is now under the 800-line hard limit, so the reviewed ceiling that said "must keep
coming down" has come down. The extraction split the ViewModel's two biggest responsibilities into their
own modules (the management host session, and the overlay → ViewModel lifecycle graph) and the whole
pre-push chain (`moon run :validate`, nine guards, lint, format, typecheck, unit, browser and E2E lanes)
is green on the final tree.

### AC Status

| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | One labeled Menu entry replaces the seven-item bar; named HUD slots own all geometry; corner chrome withdrawn while the host owns the screen. `quiet-exploration` asserts the absence of the old bar, the slots, and — deterministically, by bounding box — that no two HUD regions overlap. |
| AC-2 | ✅ | Five canonical sections in a code-owned registry with both directions of the legacy mapping; one host; sibling switch replaces rather than stacks; per-section ViewModels created once per host session and kept alive, so state survives round trips. Return context (origin overlay, conversation identity, scroll anchor) captured; focus restored. |
| AC-3 | ⚠️ | Escape unwinds the host; focus restoration asserted; a held key cannot resume movement (non-vacuous). Still untested: IME preservation, controller focus parity, `defaultPrevented` (Amendment 2.0.1 item 5). |
| AC-4 | ✅ | `combat_layout.ts` resolves split vs bottom action sheet with a scene-minimum-width invariant (swept across 400–2560px); one `CombatSidebar` in whichever container is legal; `combat-narrow` measures real bounding boxes, `combat-no-duplicate-action` proves one of each control and at most one engine resume. |
| AC-5 | ✅ | 200% text and 390x844 verified reachable; the 200% rail fits one line with no two-axis scroll; visual `large-text`, `compact`, `high-contrast` pass with the defect gates satisfied. |
| AC-6 | ✅ | Both Production Paths verified. No network font request anywhere, local fallback chains declared, and a persisted explicit motion selection restored BY THE SERVICE ITSELF (no entry point can forget). `explicit-motion` covers both OS preferences; `explicit-motion-setting` proves the in-game control drives the HUD under an opposing OS preference and survives a reload; `explicit-motion-settings-page` proves the `/settings` route shows the stored choice after a reload and that `/game` agrees. Deferred: binary font bundling (item 3) and the cross-app run (item 6 — the cited command is unresolvable). |
| AC-7 | ✅ | No domain service, persistence or schema code changed. `pending-save-return` leaves durable state in two sections and asserts it survives two round trips; `double-activation-idempotent` proves repeated activation keeps one host and one workflow owner. |
| AC-8 | ✅ | Recorded below: p50/p95 activation latency over 30 interactions, a 60s scene frame-time comparison against the pre-C-527 tree, and a long-task capture with an idle control window. |

### Files Created

| File | Purpose |
|---|---|
| `apps/frontend/client/src/lib/views/game/ui/management_session.svelte.ts` | **New this attempt.** The management host SESSION: the section ViewModels, the five-section navigation, the captured return context, focus restoration and the `hostJustClosed` edge trigger. Extracted from the ViewModel to respect its size ceiling and to give the host one owner. |
| `apps/frontend/client/src/lib/views/game/ui/game_ui_overlay_lifecycle.svelte.ts` | **New this attempt.** The overlay → ViewModel lifecycle graph (dialogue, combat, vendor, talk-to-party, end-session/settings, the management session effect pair, camera-zoom forwarding, auto-summary), taking setters/getters as ports so reactivity is unchanged. |
| `apps/frontend/client/src/lib/services/__tests__/preference_service_construction.test.ts` | **New this attempt.** Proves the constructor-time restore of both preference services by DYNAMICALLY importing each module after seeding storage (bun isolates per test file, so the dynamic import is the module's first evaluation — a real construction). No exported factory is involved. |
| `apps/frontend/client/src/lib/services/settings/motion_preference_service.svelte.ts` + `.test.ts` | The persisted motion selection, owned (and restored) by the service itself (5 tests). |
| `apps/frontend/client/src/lib/views/game/ui/management_sections.ts` + `.test.ts` | Five-section registry, location normalization, legacy overlay mapping (18 tests). |
| `apps/frontend/client/src/lib/views/game/ui/hud_slots.ts` + `.test.ts` | Named HUD slots and the widget→slot assignment (7 tests). |
| `apps/frontend/client/src/lib/views/game/ui/combat_layout.ts` + `.test.ts` | Split-vs-sheet combat container policy (9 tests). |
| `apps/frontend/client/src/lib/types/motion.ts` + `.test.ts` | The single effective motion policy, in a neutral module both the service and the view depend on (6 tests). |
| `apps/frontend/client/src/lib/views/game/ui/hud/management_host.svelte` | The single management host: section rail + active section body. |
| `apps/frontend/client/src/app_fonts.test.ts` | Offline font guarantee over `app.css`, `app.html` and the shared theme (4 tests). |
| `apps/e2e/tests/client/play_shell.spec.ts` | 15 production-path journeys covering all eight ACs. |
| `apps/e2e/tests/client/play_shell_perf.spec.ts` | AC-8 harness: activation latency, long tasks against an idle control window, 60s scene frame time; asserts the budgets and writes the artifact. |
| `apps/e2e/src/visual/suites/play_shell.visual.ts` | 9 visual cases with the mandated schema, `screenshotSelector` on every case and correct defect gates. |
| `apps/frontend/docs/src/content/docs/features/menus-and-management.md` | User guide, describing shipped behaviour only. |

### Files Modified

| File | Change |
|---|---|
| `apps/frontend/client/src/lib/views/game/ui/game_ui_view_model.svelte.ts` | **1277 → 753 lines.** The management host session and the overlay lifecycle graph moved out; what remains is state, delegation and the lifecycle entry point. |
| `apps/frontend/client/src/lib/services/game/quest_overlay_service.svelte.ts` + `.test.ts` | Restores its persisted visibility in the constructor (its `initialize()` was never called by anything, so a hidden quest card came back on every reload). |
| `apps/frontend/client/src/lib/services/settings/motion_preference_service.svelte.ts` | Restores in the constructor; the test-only factory export was removed (see Deviations). |
| `apps/frontend/client/src/lib/services/game/game_composition_root.svelte.ts` | Boot re-reads the motion preference (belt-and-braces now that the service self-restores). |
| `apps/frontend/client/src/lib/views/settings/gameplay/*` | The Motion control, validated and delegated to the shared service; `resetDefaults` returns it to `auto`. |
| `apps/frontend/client/src/lib/views/game/game_view.svelte` | Responsive combat container: split rail or labelled bottom action sheet. |
| `apps/frontend/client/src/lib/views/game/ui/game_ui_view.svelte`, `hud/management_nav.svelte`, `hud/management_host.svelte`, `game_ui_hud_visibility.ts` | HUD slots, one Menu entry, one host, chrome withdrawn during management, `data-motion`. |
| `apps/e2e/src/visual/core/capture.ts`, `evaluate.ts`, `runner.ts` | `requiredFalseFields` support and WebGL launch args. |
| `scripts/src/lib/ops/guard_source_file_size_exceptions.json` | **The `game_ui_view_model.svelte.ts` exception is REMOVED** — the file is under the 800-line hard limit now, so its reviewed ceiling is gone. |
| `scripts/src/lib/ops/guard_orphaned_capability_baseline.json` | The new service's interface/options added in the documented type-position pattern; one genuine improvement (`GameOverlayService.replaceOverlay` gained a real consumer) locked in. Diff is +4/−1 lines, not a reformat. |

### Deviations from Spec

1. **The ViewModel's two largest responsibilities were extracted into their own modules.** Forced by
   the size guard, but also correct: `management_session.svelte.ts` owns the host session and
   `game_ui_overlay_lifecycle.svelte.ts` owns the overlay lifecycle graph, leaving the ViewModel as
   state + delegation. The exception entry that allowed the file to be 859 lines is deleted, not raised.
2. **A test-only factory export was removed from both preference services.** `guard-orphaned-capability`
   rejects an exported symbol with no production caller, and a factory used only by tests is exactly
   that. The construction-time restore is instead proven by dynamically importing each module after
   seeding storage (bun isolates per test file, so that import is a real first construction), and the
   `/settings` reload behaviour is proven end-to-end.
3. **The AC-8 long-task assertion now compares against an idle control window** instead of asserting
   zero long tasks. A parallel run on a loaded box recorded a 148-second "long task" — the machine
   descheduling the browser, not shell code. The journey may not add materially more over-50ms tasks
   than the same idle window under the same observers (allowance: 2). Serial runs (what CI uses)
   record zero.
4. **Preference services restore at construction, not only in `initialize()`** — the single idiom that
   removed the forgotten-call-site failure mode behind the `/settings` bug and the adjacent quest-overlay
   defect (Amendment 2.0.1 items 4 and 7, both withdrawn as implemented).
5. **`world.subview = 'codex'` is a navigation label, not a `WorldTab`**; the session translates it
   (Amendment 2.0.1 item 1).
6. **HUD chrome is withdrawn while the management host is open**, fixing a defect the visual model
   caught at 200% text: the clock painted over the rail's Back control.
7. **`HotbarView` had no `pointer-events-auto`** under a `pointer-events-none` HUD root, so hotbar
   clicks were already dead. Restored while moving the widget into a slot.
8. **`reducedMotion` is a derived getter, not a cached `$state` field** — required for AC-6's
   "explicit choices work".
9. **`combat-actions` uses `startRealEncounter('inn_wand_encounter')`**, because `startCombat`'s
   content-pack-resolved roster is rejected with `invalidStateShape` on a freshly booted campaign.
10. **`dialogue-long` omitted** from the visual suite, with the reason in Test Hooks.
11. **Deliberately NOT changed (out of scope, recorded):** `game_canvas_view.svelte` and
    `game_ui_view.svelte` both render `id="game-ui-layer"`, so `GamePage.uiLayer`
    (`apps/e2e/src/pom/game_page.ts:164`) hits a strict-mode violation and `game_page.spec.ts` fails 5
    tests. Pre-existing (fails identically on the pre-C-527 base). The one-line fix is to rename the
    canvas-internal layer.

### Directive 10 — theme scope and portaled dialogs (audited)

- Nothing in this contract adds game theme CSS, so no new scoping root was required; the game HUD keeps
  consuming the shared Aikami semantic classes. The one presentation attribute added is `data-motion`,
  scoped to `#game-ui-layer`.
- **Tailwind alias resolution:** `app.css` resolves `@aikami/frontend/theme/…` at build time;
  `client:build` is green (200 chunks, no static-import cycles) and `validate()` covers client, docs,
  e2e and scripts together.
- **Portaled dialogs: there is no portal.** The shared `Modal` renders a native `<dialog>` in-tree and
  calls `showModal()`; it does not append to `document.body`, so a top-layer dialog still inherits
  theme custom properties from its ancestors. The management host is likewise an in-tree `role="dialog"`
  region, and no button was wrapped in a new component.

### Test Results

- **Unit:** 3283 PASS / 3292 total (0 failures, 7 skipped, 2 todo) — `bun run test:unit` in
  `apps/frontend/client`, 253 files.
- **Browser lane (real runes):** 44 PASS / 44 — `moon run client:test-browser`.
- **E2E:** 17 PASS / 17 (0 failures) —
  `env -u CI PUBLIC_EMULATOR_PORT_OFFSET=2574 bunx playwright test tests/client/play_shell.spec.ts tests/client/play_shell_perf.spec.ts --project=client`.
  Cases: quiet-exploration, section-switch-and-return, section-preserves-state, focus-pause-scopes,
  held-key-does-not-resume-movement, combat-narrow, combat-no-duplicate-action, reflow-200-text,
  touch-management, offline-fonts, explicit-motion, explicit-motion-setting,
  explicit-motion-settings-page, double-activation-idempotent, pending-save-return + the perf case.
  🔴 `env -u CI` is required: this shell sets `CI=true`, which makes Playwright refuse to reuse the
  running dev server.
- **Visual:** 9 PASS / 9 with the cache cleared (`rm -f apps/e2e/tmp/vlm-cache.json`), so no result is a
  replay — Total 9, Passed 9, Failed 0, **Cached 0**. Scores: explore-default 90, inventory-detail 95,
  compare-section-switch 90, combat-actions 90, settings-error 95, compact 95, large-text 90,
  high-contrast 90, reduced-motion 100.
- **Pre-push chain:** `moon run :validate` ✅ (172 tasks, 104 cached, 0 failures). All nine
  `scripts:guard-*` checks ✅ (`guard:all`), including `guard-source-file-size` (with the obsolete
  exception removed) and `guard-orphaned-capability`. `client:lint` ✅, `client:format` ✅,
  `client:typecheck` ✅ (0 errors, 0 warnings), `e2e:typecheck` ✅.
- **`validate({ test: true })`** ✅ — projects client, docs, e2e, scripts; 4 passed.
- **Pre-existing failures (unchanged):** `game_page.spec.ts` fails 5 tests on the duplicate
  `#game-ui-layer` id and a `.bg-base-200/80` strict-mode multi-match; confirmed identical on the
  pre-C-527 base. Not a C-527 defect; see Deviations item 11.

#### AC-8 measured delivery (reference machine)

Runtime: headless Chromium 153.0.8010.12 (Nix chromium), viewport 1280×720, `hardwareConcurrency: 32`,
contract-worktree dev server on `:7848`. Artifact: `apps/e2e/test-results/play-shell-perf.json`.
Serial run (`--workers=1`, the worker setting CI uses — the numbers below are from that run):

| Measure | p50 | p95 | max | n |
|---|---|---|---|---|
| Input-to-visible, Menu → section (30 activations) | 80.1 ms | 84.3 ms | 84.4 ms | 30 |
| Scene rAF frame interval, 60 s exploration, after C-527 | 16.7 ms | 16.7 ms | 50.0 ms | 3598 |
| Scene rAF frame interval, 60 s exploration, before C-527 (base `ab9a4f30`) | 16.7 ms | 16.7 ms | 16.8 ms | 3600 |

- **p95 activation latency 84.3 ms ≤ 100 ms budget** ✅
- **UI-caused frame-time regression: 0.0 % at p95** (16.7 ms → 16.7 ms), within the proposed ≤5 % ✅
- **Long tasks > 50 ms: 0 in the journey AND 0 in the 10 s idle control window** ✅
- Per-AC results: AC-1 ✅, AC-2 ✅, AC-3 ⚠️ (IME/controller/`defaultPrevented` untested), AC-4 ✅,
  AC-5 ✅, AC-6 ✅, AC-7 ✅, AC-8 ✅.

These are real recordings, not estimates. The before/after scene sample was taken by checking the
pre-C-527 tree (`ab9a4f304`) into this worktree, restarting the dev server and re-running the same
sampler, then restoring `HEAD`; the sampler is a scene-only rAF probe, because the base tree has no
Menu entry for the shell harness to drive.
