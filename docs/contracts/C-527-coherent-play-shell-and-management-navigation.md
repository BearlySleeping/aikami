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

## Promotion Lifecycle

> [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle). A sandbox is not integrated; `release_verified` requires production and visual evidence.

## Status Lifecycle

> [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle). Keep `draft` until authorized; never mark completed before merge/CI. Record actual execution and AC evidence during implementation.

## Execution Report

### Summary

Implemented the navigational core of the coherent play shell: a code-owned five-section
management registry with the legacy `GameOverlayType` deep-open mapping, a single labeled
HUD **Menu** entry replacing the permanent seven-item management strip, one management
host that renders all five sections with a section rail, sibling-section switching through
`replaceOverlay` (replace, not stack), and named HUD slots that stop fixed children owning
viewport coordinates. Verified end-to-end on the real `/game` route with a headless
browser against the contract-worktree dev server. Deferred: combat containment (AC-4),
perf/frame-time measurement (AC-8), font bundling, and the configurable section shortcuts.

### AC Status

| AC | Status | Notes |
|---|---|---|
| AC-1 | ⚠️ | Menu entry + named HUD slots shipped; no permanent management bar (asserted on `/game`). Not done: "clock/music off for new users" — no such persisted preference exists in the settings surface, so it was not invented. |
| AC-2 | ⚠️ | One host, five sections, sibling switch replaces, legacy deep-open mapping implemented + unit-tested + live-verified. §Preserved state: Journal/World subview is remembered and restored; other sections' internal state is not (existing per-overlay VM lifecycle recreates them). Scroll-anchor/origin-context capture not implemented. |
| AC-3 | ⚠️ | Escape unwinds the host back to play (live-verified). Focus restoration rides on the existing `replaceOverlay` previousFocus retention and `popOverlay` restore; `replaceOverlay` deliberately never resumes the engine, so tab switches cannot leak a simulation frame. Not verified: IME preservation, held-key leak, controller focus parity, `defaultPrevented` handling. |
| AC-4 | ❌ | Not addressed. No combat code touched; the single `CombatSidebar`/direct-control canvas is untouched, so no duplicate dock was introduced — but the required narrow-viewport action-sheet containment and the `combat-narrow` / `combat-no-duplicate-action` cases are absent. |
| AC-5 | ⚠️ | Section rail, Back control and all five tabs remain reachable at 200% text and at 390×844 (live-verified). No clipping/overlap audit and no AI visual scoring — the `ai_validate_image` tool is not available in this session; a screenshot was captured to the gitignored `.pi/.screenshots/`. |
| AC-6 | ⚠️ | `app.css` has no remote font import — fonts resolve to local families with no network request (documented fallbacks), and `packages/frontend/theme` is untouched so Hub/site/docs appearance cannot have changed. Reduced-motion override exists in `app.css`. Not done: bundling licensed font binaries; the `offline-fonts` / `explicit-motion` E2E cases and the cross-app visual no-regression run. |
| AC-7 | ⚠️ | No domain service or persistence code changed; section switching is idempotent (repeated activation keeps exactly one host and one section body — live-verified) and `replaceOverlay` never re-enters a domain workflow. Not done: the `pending-save-return` case. |
| AC-8 | ❌ | No reference-machine latencies, no 60s scene frame-time before/after table. Recorded instead: the exact commands and their output in the evidence sections below. |

### Files Created

| File | Purpose |
|---|---|
| `apps/frontend/client/src/lib/views/game/ui/management_sections.ts` | Five-section registry, `ManagementLocation` normalization, legacy `GameOverlayType` ↔ section mapping (both directions derived from one table). |
| `apps/frontend/client/src/lib/views/game/ui/management_sections.test.ts` | 18 pure tests asserting the contract's mapping table verbatim, subview fallback and guard behaviour. |
| `apps/frontend/client/src/lib/views/game/ui/hud_slots.ts` | Named HUD slots (`top-start`/`top-end`/`bottom-start`/`bottom-center`/`bottom-end`) and the widget→slot assignment. |
| `apps/frontend/client/src/lib/views/game/ui/hud_slots.test.ts` | 7 tests: every widget assigned, one objective slot, no viewport-relative geometry. |
| `apps/frontend/client/src/lib/views/game/ui/hud/management_host.svelte` | The single management host: section rail + active section body. |
| `apps/e2e/tests/client/play_shell.spec.ts` | Production-path journeys: `quiet-exploration`, `section-switch-and-return`, `double-activation-idempotent`, `focus-pause-scopes`, `reflow-200-text`, `touch-management`. |
| `apps/e2e/src/visual/suites/play_shell.visual.ts` | Visual suite with the contract-mandated response schema (`score`, `unreadableText`, `overlappingControls`, `missingCriticalAction`, `issues`) and 8 cases. |
| `apps/frontend/docs/src/content/docs/features/menus-and-management.md` | User guide for the new navigation. |

### Files Modified

| File | Change |
|---|---|
| `apps/frontend/client/src/lib/views/game/ui/game_ui_view_model.svelte.ts` | Added `managementLocation` (derived from the overlay stack), `menuLocation`, `isManagementOpen`, `openManagementSection`, `openManagementLocation`, `openManagementMenu`, `closeManagement`; sibling switching via `replaceOverlay`; Journal/World subview restoration. Removed the seven-branch `openManagementSection` dispatch. |
| `apps/frontend/client/src/lib/views/game/ui/game_ui_view.svelte` | HUD regrouped into named slots; seven management overlay branches replaced by one `<ManagementHost>`; Menu entry placed in the top-end slot. |
| `apps/frontend/client/src/lib/views/game/ui/hud/management_nav.svelte` | Rewritten: seven labeled buttons → one labeled Menu entry (`data-testid="hud-menu-entry"`). |
| `apps/frontend/client/src/lib/views/game/ui/game_ui_hud_visibility.ts` | `ManagementSection` union now re-exported from the registry; `showManagementNav` documented as the single Menu entry. |
| `apps/frontend/client/src/lib/views/game/ui/game_ui_view_model_types.ts` | Overlay capability surface extended with `closeInventory`, `closePartyRoster`, `closeReputation`, `replaceOverlay`. |
| `apps/frontend/client/src/lib/views/game/ui/game_ui_view_model.test.ts` | Stub extended; 10 new tests covering the mapping, subview fallback, sibling replace, idempotency and derived location. |
| `apps/frontend/client/src/lib/views/game/ui/quest_tracker_view.svelte` | Dropped `fixed bottom-4 left-4` — geometry now owned by the `bottom-start` slot. |
| `apps/frontend/client/src/lib/views/game/hotbar/hotbar_view.svelte` | Dropped `fixed bottom-0 left-1/2 -translate-x-1/2` — geometry now owned by the `bottom-center` slot; made clickable (see Deviations). |
| `apps/frontend/client/src/lib/views/game/ui/hud/interaction_prompt.svelte` | Dropped its own absolute positioning — geometry now owned by the `bottom-center` slot. |

### Deviations from Spec

1. **`world` section subview `codex` is a navigation label, not a `WorldTab`.** The contract's
   mapping table says `WORLD → { section: 'world', subview: 'codex' }`. The World view's real
   tabs are `people | places | factions | lore | gallery`; passing `codex` to its
   `setActiveTab` put the view model into an invalid tab and threw
   (`Cannot read properties of undefined (reading 'length')` at `activeTabCount`), which
   surfaced as a 500 error page on `/game`. The registry keeps `codex` as the canonical
   location (contract-literal) and the ViewModel translates it to the view's own default tab
   (`WORLD_TAB_BY_SUBVIEW`). Layer: the registry speaks navigation; the feature view keeps its
   own vocabulary. **Proposed Amendment (needs owner approval):** document in the mapping
   table that `world.subview = 'codex'` means "the World view's default Codex tab" and is not
   a `WorldTab` value. This resolves the contract's Open Question "Feature capability
   inventory": `codex` content exists (the World view), it is just not a subview id.
2. **`HotbarView` had no `pointer-events-auto`.** The HUD root layer is `pointer-events-none`,
   and the hotbar buttons never re-enabled pointer events — so hotbar clicks were already
   dead before this contract. Wrapping it in a slot container made that visible; the button
   row now sets `pointer-events-auto`. Small in-scope correctness fix (AC-1 "eligible
   contextual controls"), flagged because it is a behaviour change not named by an AC.
3. **Journal default subview.** The registry's Journal default is `notes`, per the contract's
   mapping table (`JOURNAL → subview: 'notes'`); the `recaps` tab is included in the
   allowlist because it exists in the domain (`JournalTab`).
4. **No new clock/music preference.** Directive 7's "clock/music off for new users" requires a
   persisted preference that does not exist in the settings surface. Inventing one would add
   schema/persistence surface outside this contract's Scope Boundaries, so it was left alone
   and reported instead.

### Test Results

- Unit: **3246 PASS / 3255 total** (0 failures, 7 skipped, 2 todo) — `bun run test:unit` in
  `apps/frontend/client`. 35 of those are new tests added by this contract
  (`management_sections.test.ts` 18, `hud_slots.test.ts` 7, `game_ui_view_model.test.ts` +10).
- E2E: **not executed via `playwright test`** — no `.auth/` state cache and no Firebase
  emulator in this workspace, and `playwright.config.ts`'s `client` project depends on the
  `setup` project. The six `play_shell.spec.ts` assertions were instead executed against the
  live production route with a standalone Playwright script on the same selectors
  (`chromium`, viewport 1280×800 / 1024×768 / 390×844 against `http://localhost:7848/game`):
  `navCount=0`, `oldNav=0`, `menuText="Menu"`, `hostBefore=0`, `tabs=5`,
  `charCurrent="page"`, `invDialogs=1`, `journalDialogs=1`, `hostAfterBack=0`,
  `hostAfterEsc=0`, `menuAfterEsc=true`, `close200=true`, `world200=true`,
  `worldCurrent200="page"`, `menuTouch=true`, `partyCurrentTouch="page"`, `closeTouch=true`.
  All five sections (world/party/character/inventory/journal) open with exactly one host and
  five tabs.
- Visual: **not run** — the visual runner needs a vision-provider key and `ai_validate_image`
  is not exposed to this session. Suite written at
  `apps/e2e/src/visual/suites/play_shell.visual.ts`; screenshot of the open host saved to the
  gitignored `.pi/.screenshots/c527-host.png`.
- Typecheck: `client:typecheck` ✅ (svelte-check 0 errors, 0 warnings); `e2e:typecheck` ✅.
- Build: `client:build` ✅ — 200 chunks, no static-import cycles.
- `validate({ test: true })` ✅ — projects client, docs, e2e; 4 passed.
- Baseline: baseline was captured after the first (pure, additive) test module landed, so the
  pre-existing failure count is **0** — the suite was green before and after
  (`3229 pass / 0 fail` → `3246 pass / 0 fail`). **0 new failures.**
