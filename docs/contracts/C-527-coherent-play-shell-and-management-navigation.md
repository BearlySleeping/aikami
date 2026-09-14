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
  pr_url: null
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
| AC-1 | Functional E2E + targeted unit/integration | `apps/e2e/tests/client/play_shell.spec.ts` case `quiet-exploration`; `play_shell.visual.ts` cases `explore-default`, `compact`; journey trace + screenshots | /game | Not run — fill during implementation verification |
| AC-2 | Functional E2E + targeted unit/integration | `play_shell.spec.ts` case `section-switch-and-return`; `play_shell.visual.ts` cases `explore-default`, `inventory-detail`; journey trace + screenshots | /game | Not run — fill during implementation verification |
| AC-3 | Functional E2E + targeted integration | `play_shell.spec.ts` cases `focus-pause-scopes`; `apps/e2e/tests/client/reactive_lifecycle.spec.ts`-style compiled assertions; overlay/input unit tests | /game; /settings | Not run — fill during implementation verification |
| AC-4 | Functional E2E + targeted unit | `play_shell.spec.ts` cases `combat-narrow`, `combat-no-duplicate-action`; `play_shell.visual.ts` case `combat-actions`; existing `apps/e2e/src/visual/suites/combat.visual.ts` reinterpreted as no-regression | /game | Not run — fill during implementation verification |
| AC-5 | Functional E2E + visual | `play_shell.spec.ts` cases `reflow-200-text`, `touch-management`; `play_shell.visual.ts` cases `compact`, `large-text`, `high-contrast` | /game; /settings | Not run — fill during implementation verification |
| AC-6 | Functional E2E + cross-app visual no-regression | `play_shell.spec.ts` cases `offline-fonts`, `explicit-motion`; `play_shell.visual.ts` case `reduced-motion`; hub/site/docs appearance no-regression check (`bun moon run e2e:test-site-visual`, and the hub suites touching `apps/frontend/hub/src/app.css`) | /game; /settings | Not run — fill during implementation verification |
| AC-7 | Targeted integration + functional E2E | `play_shell.spec.ts` cases `pending-save-return`, `double-activation-idempotent`; existing `inventory_service.test.ts` / `game_save_service.test.ts` unchanged-or-green | /game | Not run — fill during implementation verification |
| AC-8 | Delivery report | Recorded reference-machine latencies (p50/p95), 60s scene frame-time before/after table, visual run ID, per-AC result table | /game | Not run — fill during implementation verification |

Artifact filenames are the proposed names; keep them aligned with the actual committed files before verification. Every row must additionally cite the command and the run output that produced the evidence.

**Test Hooks**:

- **Baseline:** Run client unit tests covering HUD/overlay/input and existing inventory/quest feature journeys; record failures before editing. No tests were run during this drafting task.
- **Moon Task:** `bun moon run client:typecheck`, `bun moon run client:test`, `bun moon run e2e:test-client`, plus affected shared-project checks resolved from current Moon config. Use Biome and the repository's required validation flow; before PR run required affected-project gates and `bun moon run :validate` when mandated by current guidance. Do not invent project IDs from directory names.
- **Integration:** production `/game` using a real local fixture campaign and actual feature services; inject deterministic provider results for asynchronous operations. Use real storage boundaries for migration/atomicity tests. Assertions must establish behavior and domain invariants, not simply duplicate implementation conditions.
- **Functional:** `apps/e2e/tests/client/play_shell.spec.ts` with existing Page Objects and deterministic feature fixtures. Each AC maps to a named case; include negative/cancel/reload paths. Bun identity rune polyfills cannot establish Svelte reactivity: verify state/lifecycle/focus in compiled Playwright, reusing `apps/e2e/tests/client/reactive_lifecycle.spec.ts` patterns where appropriate.
- **Visual:** add `apps/e2e/src/visual/suites/play_shell.visual.ts` using the current runner's `defineConfig` and `export default` conventions. Declare cases with `name`, real `route` and `searchParams`; route fixtures through the repository's existing test fixture mechanism. Do not invent production query parameters solely to bypass domain integration. A dev sandbox may supplement but not replace production cases.
- **Visual cases:** `explore-default`, `dialogue-long`, `inventory-detail`, `combat-actions`, `settings-error`, `compact`, `large-text`, `high-contrast`, `reduced-motion`. Select the cases materially affected by this contract and explain any omitted context.
  - **Omitted: `dialogue-long`.** A long conversation on `/game` requires a text AI provider or an AI-generated dialogue chip; the deterministic lane has neither and the composition root exposes no dialogue test seam (unlike combat). Capturing it would mean screenshotting a provider-setup screen and claiming it was a conversation. Covered instead by `compare-section-switch` (the management workspace with the sections that host the same reading panel) and by the E2E `focus-pause-scopes` / `section-preserves-state` cases.
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
| 2.0.1 | 2026-09-14 | **Proposed (pending owner approval).** (1) `world.subview = 'codex'` is documented as the World section's name for the World view's default tab, not a `WorldTab` value — feeding it to `setActiveTab` throws, so the ViewModel translates it (`WORLD_TAB_BY_SUBVIEW`). This resolves the Open Question "Feature capability inventory": the codex content exists (the World view); it is simply not a subview id. (2) `clock/music off for new users` needs a persisted preference that does not exist in the settings surface; adding one is new persistence surface outside this contract's Scope Boundaries, so it is deferred rather than invented. (3) Bundling licensed font binaries (`Source Serif 4`, `Inter`) is deferred — `app.css` performs no network font request and declares local fallback chains, which is the AC-6 "documented fallbacks" branch; no `*.woff2`/`*.ttf` and no font package exist in the tree. (4) An explicit persisted reduced-motion selection is deferred; the single effective policy (`resolveReducedMotion`) already exists and honours an explicit `reduce`/`full` under either OS preference. (5) Controller focus parity, IME preservation and `defaultPrevented` handling remain unverified by a test. | Pending owner approval |

## Promotion Lifecycle

> [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle). A sandbox is not integrated; `release_verified` requires production and visual evidence.

## Status Lifecycle

> [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle). Keep `draft` until authorized; never mark completed before merge/CI. Record actual execution and AC evidence during implementation.

## Execution Report

### Summary

Attempt 2 closes the blockers from verification. AC-4 (narrow-viewport combat containment) and AC-8
(measured delivery) are now implemented; AC-2 now preserves each section's own state and captures a
return context; AC-6 gains an offline-font guarantee test and an explicit, single effective motion
policy; AC-3 gains focus restoration and a held-key test. The visual suite was structurally broken in
attempt 1 (256x256 canvas crop, inverted gate) and is now fixed and passing 9/9 on the production
route; the five missing E2E cases were added and all 15 client cases pass. Two real defects were found
and fixed along the way: the clock HUD painted over the management rail's Back control, and the
`world.subview = 'codex'` mapping fed an invalid tab into `WorldViewModel.setActiveTab`, which threw
and produced a 500 error page.

### AC Status

| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | One labeled Menu entry replaces the seven-item bar; named HUD slots own all geometry; the corner chrome is withdrawn while the host owns the screen. `quiet-exploration` asserts the absence of the old bar and the presence of the slots on `/game`. New-user clock/music defaults are deferred (Amendment 2.0.1 item 2) — no such persisted preference exists to preserve or default. |
| AC-2 | ✅ | Five canonical sections in a code-owned registry with both directions of the legacy mapping; one host; sibling switch replaces rather than stacks; per-section ViewModels are created once per host session and kept alive, so a search draft, a selected tab and a section's own state survive a round trip (`section-preserves-state`, `pending-save-return`). Return context captures origin overlay, conversation identity (`npcId`/`draftId`) and scroll anchor; Back restores focus to the origin element or the replacement Menu entry. |
| AC-3 | ⚠️ | Escape unwinds the host; focus restoration is now explicit (`_restoreHostFocus`, verified by `focus-pause-scopes`); held-key leak is covered by `held-key-does-not-resume-movement` (the player stays put until fresh input). Still unverified by a test: IME preservation, controller focus parity, `defaultPrevented` handling. `/settings` return-to-origin is covered only by the E2E path through the in-game Settings overlay, not by the `/settings` route directly. |
| AC-4 | ✅ | `combat_layout.ts` resolves split vs bottom action sheet from the viewport, with the invariant that the scene keeps a minimum width (unit-tested exhaustively across 400–2560px). `game_view.svelte` renders the SAME `CombatSidebar` in whichever container is legal — one workflow owner, never a duplicate dock. `combat-narrow` proves the sheet appears at 700x900 with a labelled region and a scene region above it, and disappears again at 1280x800; `combat-no-duplicate-action` proves exactly one of each action control and at most one engine resume. |
| AC-5 | ✅ | 200% text and 390x844 verified reachable on `/game` (`reflow-200-text`, `touch-management`); the 200% rail fits one line with no two-axis scroll (DOM-measured); visual cases `large-text`, `compact`, `high-contrast` all pass with the defect gates satisfied. |
| AC-6 | ⚠️ | No network font request anywhere (`app_fonts.test.ts` asserts it for `app.css`, `app.html` and the shared theme), local fallback chains declared, single effective motion policy with an explicit override under either OS preference (`motion_policy.test.ts`), `data-motion` published on the game UI layer and asserted both ways by `explicit-motion`. `offline-fonts` aborts every off-origin request and still renders the shell. Not done: bundling licensed font binaries and a persisted explicit reduced-motion setting (Amendment 2.0.1 items 3–4); the hub/site/docs cross-app visual run was not executed (the shared theme is untouched, so the blast radius is unchanged by construction). |
| AC-7 | ✅ | No domain service, persistence or schema code changed. `pending-save-return` leaves durable state in two sections, navigates away and back twice, and asserts the state survived — which is only possible because the section was never re-initialised, so no item/save/listener work replayed. `double-activation-idempotent` proves repeated activation keeps exactly one host, one section body and one workflow owner. |
| AC-8 | ✅ | Recorded below: p50/p95 activation latency over 30 interactions, a 60s scene frame-time comparison against the pre-C-527 tree, and a long-task capture. Harness committed as `play_shell_perf.spec.ts`, artifact at `test-results/play-shell-perf.json`. |

### Files Created

| File | Purpose |
|---|---|
| `apps/frontend/client/src/lib/views/game/ui/management_sections.ts` | Five-section registry, `ManagementLocation` normalization, legacy `GameOverlayType` ↔ section mapping derived from one table. |
| `apps/frontend/client/src/lib/views/game/ui/management_sections.test.ts` | 18 tests asserting the contract's mapping table verbatim and the subview fallback rules. |
| `apps/frontend/client/src/lib/views/game/ui/hud_slots.ts` + `.test.ts` | Named HUD slots and the widget→slot assignment (7 tests). |
| `apps/frontend/client/src/lib/views/game/ui/combat_layout.ts` + `.test.ts` | Split-vs-sheet combat container policy with the scene-minimum invariant (9 tests). |
| `apps/frontend/client/src/lib/views/game/ui/motion_policy.ts` + `.test.ts` | The single effective motion policy (6 tests). |
| `apps/frontend/client/src/lib/views/game/ui/hud/management_host.svelte` | The single management host: section rail + active section body. |
| `apps/frontend/client/src/app_fonts.test.ts` | Offline font guarantee over `app.css`, `app.html` and the shared theme (4 tests). |
| `apps/e2e/tests/client/play_shell.spec.ts` | 14 production-path journeys covering all eight ACs. |
| `apps/e2e/tests/client/play_shell_perf.spec.ts` | AC-8 harness: in-page activation latency, long tasks, 60s scene frame time; asserts the budgets and writes the artifact. |
| `apps/e2e/src/visual/suites/play_shell.visual.ts` | 9 visual cases with the mandated schema, `screenshotSelector` on every case and correct defect gates. |
| `apps/frontend/docs/src/content/docs/features/menus-and-management.md` | User guide, narrowed to shipped behaviour. |

### Files Modified

| File | Change |
|---|---|
| `apps/frontend/client/src/lib/views/game/ui/game_ui_view_model.svelte.ts` | Management session with keep-alive section ViewModels; return-context capture/restore; focus restoration; motion preference; removed the seven-branch dispatch. |
| `apps/frontend/client/src/lib/views/game/game_view.svelte` | Responsive combat container: split rail or labelled bottom action sheet, one `CombatSidebar` either way. |
| `apps/frontend/client/src/lib/views/game/ui/game_ui_view.svelte` | HUD regrouped into named slots; one `<ManagementHost>`; `data-motion`; unique `game-ui-overlay-layer` test id. |
| `apps/frontend/client/src/lib/views/game/ui/game_ui_hud_visibility.ts` | HUD chrome withdrawn for every management destination (clock/autosave no longer paint over the rail). |
| `apps/frontend/client/src/lib/views/game/ui/hud/management_nav.svelte` | Seven buttons → one labeled Menu entry. |
| `apps/frontend/client/src/lib/views/game/ui/hud/management_host.svelte` | Rail + body, raised above the HUD layer. |
| `apps/frontend/client/src/lib/views/game/ui/game_ui_view_model_types.ts` | Capability surface extended (`close*`, `replaceOverlay`). |
| `apps/frontend/client/src/lib/views/game/quest_tracker_view.svelte`, `hotbar/hotbar_view.svelte`, `ui/hud/interaction_prompt.svelte` | Stopped owning viewport coordinates; hotbar restored to clickable. |
| `apps/e2e/src/visual/core/capture.ts` | `requiredFalseFields` support; WebGL launch args (without them no combat surface can be captured). |
| `apps/e2e/src/visual/core/evaluate.ts`, `runner.ts` | `requiredFalseFields` gate (a defect flag must fail the case when TRUE). |
| `apps/frontend/client/src/lib/views/game/ui/game_ui_view_model.test.ts` | +16 tests: management navigation, return context, HUD chrome withdrawal. |

### Deviations from Spec

1. **`world.subview = 'codex'` is a navigation label, not a `WorldTab`.** Feeding it to
   `setActiveTab` threw (`Cannot read properties of undefined (reading 'length')` at `activeTabCount`)
   and surfaced as a 500 error page when the World section was opened. The registry keeps `codex` as
   the canonical location and the ViewModel translates it to the World view's own default tab
   (`WORLD_TAB_BY_SUBVIEW`). Amendment 2.0.1 item 1.
2. **HUD chrome is now withdrawn while the management host is open.** This is a behaviour change not
   named by an AC, and it fixes a defect the visual model caught at 200% text: the clock (z-50) painted
   over the rail's Back control (host z-20). Without it AC-5's "no overlapping controls" is false.
3. **`HotbarView` had no `pointer-events-auto`** under a `pointer-events-none` HUD root, so hotbar
   clicks were already dead before this contract. Restored while moving the widget into a slot.
4. **Library-level fixes** needed to run the contract's own gates: `requiredFalseFields` was added to
   the visual runner (the contract's `missingCriticalAction` gate is inverted without it), and the
   visual runner's chromium now enables WebGL (without it no production combat surface can be
   captured).
5. **`combat-actions` uses `startRealEncounter('inn_wand_encounter')`**, not `startCombat`: the latter's
   content-pack-resolved roster is rejected with `invalidStateShape` on a freshly booted campaign, so
   the encounter mounted and then tore itself down before the capture.
6. **`dialogue-long` omitted** from the visual suite with the reason recorded in Test Hooks.
7. **Deferred, with amendment entries:** bundling licensed font binaries; a persisted explicit
   reduced-motion setting; the new-user clock/music preference; controller focus parity, IME and
   `defaultPrevented` tests; the hub/site/docs cross-app visual run.

### Test Results

- **Unit:** 3268 PASS / 3275 total (0 failures, 7 skipped, 2 todo) — `bun run test:unit` in
  `apps/frontend/client`. 42 of those are new (management_sections 18, hud_slots 7, combat_layout 9,
  motion_policy 6, app_fonts 4, game_ui_view_model +16, minus the reshaped ones).
- **E2E:** 15 PASS / 15 (0 failures) —
  `env -u CI PUBLIC_EMULATOR_PORT_OFFSET=2574 bunx playwright test tests/client/play_shell.spec.ts tests/client/play_shell_perf.spec.ts --project=client`.
  `quiet-exploration`, `section-switch-and-return`, `section-preserves-state`, `focus-pause-scopes`,
  `held-key-does-not-resume-movement`, `combat-narrow`, `combat-no-duplicate-action`,
  `reflow-200-text`, `touch-management`, `offline-fonts`, `explicit-motion`,
  `double-activation-idempotent`, `pending-save-return`, `measures shell activation latency...`.
- **Visual:** 9 PASS / 9 — `PUBLIC_EMULATOR_PORT_OFFSET=2574 bun run src/visual/runner.ts --suite=play-shell`.
  Scores: explore-default 90, inventory-detail 95, compare-section-switch 95, combat-actions 90,
  settings-error 95, compact 100, large-text 95, high-contrast 90, reduced-motion 100. Report at
  `apps/e2e/test-results/visual/report.html`.
- **Typecheck:** `client:typecheck` ✅ (0 errors, 0 warnings); `e2e:typecheck` ✅.
- **Build:** `client:build` ✅ — 200 chunks, no static-import cycles.
- **`validate({ test: true })`** ✅ — projects client, docs, e2e; 4 passed.
- **Baseline:** 0 pre-existing failures in the client unit suite; 0 new failures.

#### AC-8 measured delivery (reference machine)

Runtime: headless Chromium 153.0.8010.12 (Nix chromium), viewport 1280×720,
`hardwareConcurrency: 32`, contract-worktree dev server on `:7848`. Artifact:
`apps/e2e/test-results/play-shell-perf.json`.

| Measure | p50 | p95 | max | n |
|---|---|---|---|---|
| Input-to-visible, Menu → section (30 activations) | 71.9 ms | 74.3 ms | 74.4 ms | 30 |
| Scene rAF frame interval, 60 s exploration, after C-527 | 16.7 ms | 16.7 ms | 33.3 ms | 3599 |
| Scene rAF frame interval, 60 s exploration, before C-527 (base `ab9a4f30`) | 16.7 ms | 16.7 ms | 16.8 ms | 3600 |

- **p95 activation latency 74.3 ms ≤ 100 ms budget** ✅
- **UI-caused frame-time regression: 0.0 % at p95** (16.7 ms → 16.7 ms), within the proposed ≤5 % ✅
- **Long tasks > 50 ms during the measured journey: 0** (observer installed for the whole run) ✅
- Per-AC results: AC-1 ✅, AC-2 ✅, AC-3 ⚠️ (IME/controller/`defaultPrevented` untested),
  AC-4 ✅, AC-5 ✅, AC-6 ⚠️ (font binaries + persisted motion setting deferred), AC-7 ✅, AC-8 ✅.

These are real recordings, not estimates. The before/after scene sample was taken by checking the
pre-C-527 tree (`ab9a4f304`) into this worktree, restarting the dev server and re-running the same
sampler, then restoring `HEAD`; the sampler is a scene-only rAF probe, because the base tree has no
Menu entry for the shell harness to drive.
