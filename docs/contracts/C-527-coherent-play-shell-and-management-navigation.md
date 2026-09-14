---
id: C-527
title: "Coherent play shell and management navigation"
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

# Contract C-527: Coherent play shell and management navigation

## Metadata

| Field | Value |
|---|---|
| **Source** | User request: optimal customizable Aikami UI/HUD/menus and community themes; source review at `b3e8234b6ced2c6c8ae1a62aa023850ed3ad85c4` |
| **Target** | Client game composition, overlay/input seams, shared theme roles, and existing management views |
| **Type** | full |
| **Priority** | P1 — coherent player experience and safe customization foundation |
| **Dependencies** | Existing overlay/input/feature capabilities; preserve C-525 combat behavior. C-502/C-503 are optional future integrations, not blockers. |
| **Status** | draft |
| **Promotion** | — |
| **Docs Impact** | User-facing → proposed guide under `apps/frontend/docs/src/content/docs/`; add/update the current navigation and actual page in this PR. Theme/HUD author docs where relevant. |
| **Contract version** | 2.0.0 |
| **Production Surface** | `/game` and `/settings` |

Draft ID is provisional and unreserved. Confirm it is still unused before adding this file to the repository. This document records proposed behavior; its ACs are not yet verified or approved by this planning deliverable.

## Problem & Baseline Evidence

- Current production HUD composition places widgets independently in `game_ui_view.svelte`; the seven-item management strip has a separate fixed top-center placement.
- Management renders through an active-overlay switch; a coherent sibling-section workspace is not the default production surface.
- The combat root currently uses `min(28vw, 32rem)` and one sidebar. Do not repeat the obsolete duplicate-combat finding from the earlier design document.
- The shared theme already owns semantic colors and primitive classes. Explicit dark selection is already fixed. Source Serif is declared; bundled font delivery still needs verification.
- Reproduce by loading a local campaign at `/game`, observing navigation/HUD composition, opening Inventory/Journal/Character, resizing, and checking focus/pause transitions. Baseline source review did not run these journeys.
- Baseline tests to inspect/run: `game_ui_view_model.test.ts`, `game_overlay_service.test.ts`, `input_action_service.test.ts`, existing inventory/quest tests, and `apps/e2e/src/visual/suites/game_hud.visual.ts`.

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
| Design reference | `docs/design/game_ui_hud_overhaul.md; views/dev/obsidian/` | Reuse proven visual vocabulary; revalidate stale findings |

Paths abbreviated to sibling filenames in this table are relative to the named feature directory. Verify exact exports at the implementation base.

## Overview

Introduce the production play shell and a single management section host. Migrate existing feature views into that host without duplicating their domain workflows. Ship the refined Obsidian Chronicle appearance and a stable default HUD; user editing and community packages follow in separate contracts.

## Design Reference

- `docs/design/aikami_ui_hud_theme_review_2026q3.md` in this bundle defines visual direction, navigation mapping, defaults and ecosystem boundaries.
- Existing `docs/design/game_ui_hud_overhaul.md` and `views/dev/obsidian/` are context; do not copy stale defect claims or treat a dev sandbox as production evidence.
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
| AC-1 | Functional E2E + targeted unit/integration; visual where appearance is asserted | `play_shell.spec.ts`, journey trace and relevant screenshots | /game | Not run — fill during implementation verification |
| AC-2 | Functional E2E + targeted unit/integration; visual where appearance is asserted | `play_shell.spec.ts`, journey trace and relevant screenshots | /game | Not run — fill during implementation verification |
| AC-3 | Functional E2E + targeted unit/integration; visual where appearance is asserted | `play_shell.spec.ts`, journey trace and relevant screenshots | /game; /settings | Not run — fill during implementation verification |
| AC-4 | Functional E2E + targeted unit/integration; visual where appearance is asserted | `play_shell.spec.ts`, journey trace and relevant screenshots | /game | Not run — fill during implementation verification |
| AC-5 | Functional E2E + targeted unit/integration; visual where appearance is asserted | `play_shell.spec.ts`, journey trace and relevant screenshots | /game; /settings | Not run — fill during implementation verification |
| AC-6 | Functional E2E + targeted unit/integration; visual where appearance is asserted | `play_shell.spec.ts`, journey trace and relevant screenshots | /game; /settings | Not run — fill during implementation verification |
| AC-7 | Functional E2E + targeted unit/integration; visual where appearance is asserted | `play_shell.spec.ts`, journey trace and relevant screenshots | /game | Not run — fill during implementation verification |
| AC-8 | Functional E2E + targeted unit/integration; visual where appearance is asserted | `play_shell.spec.ts`, journey trace and relevant screenshots | /game | Not run — fill during implementation verification |

**Test Hooks**:

- **Baseline:** Run client unit tests covering HUD/overlay/input and existing inventory/quest feature journeys; record failures before editing. No tests were run during this drafting task.
- **Moon Task:** `bun moon run client:typecheck`, `bun moon run client:test`, `bun moon run e2e:test-client`, plus affected shared-project checks resolved from current Moon config. Use Biome and the repository's required validation flow; before PR run required affected-project gates and `bun moon run :validate` when mandated by current guidance. Do not invent project IDs from directory names.
- **Integration:** production `/game` using a real local fixture campaign and actual feature services; inject deterministic provider results for asynchronous operations. Use real storage boundaries for migration/atomicity tests. Assertions must establish behavior and domain invariants, not simply duplicate implementation conditions.
- **Functional:** `apps/e2e/tests/client/play_shell.spec.ts` with existing Page Objects and deterministic feature fixtures. Each AC maps to a named case; include negative/cancel/reload paths. Bun identity rune polyfills cannot establish Svelte reactivity: verify state/lifecycle/focus in compiled Playwright, reusing `apps/e2e/tests/client/reactive_lifecycle.spec.ts` patterns where appropriate.
- **Visual:** add `apps/e2e/src/visual/suites/play_shell.visual.ts` using the current runner's `defineConfig` and `export default` conventions. Declare cases with `name`, real `route` and `searchParams`; route fixtures through the repository's existing test fixture mechanism. Do not invent production query parameters solely to bypass domain integration. A dev sandbox may supplement but not replace production cases.
- **Visual cases:** `explore-default`, `dialogue-long`, `inventory-detail`, `combat-actions`, `settings-error`, `compact`, `large-text`, `high-contrast`, `reduced-motion`. Select the cases materially affected by this contract and explain any omitted context.
- **TypeBox visual response schema:** an object with `score` (0–100), `unreadableText` (boolean), `overlappingControls` (boolean), `missingCriticalAction` (boolean), and `issues` (bounded string array), adapted to the existing visual runner wrapper. AI evaluation prompt: “Evaluate this Aikami production journey against the supplied expected state. Score 90+ only when text hierarchy is readable, essential controls are visible and nonoverlapping, focus/selection is apparent where expected, and the scene retains appropriate prominence. Identify concrete defects; do not reward decoration at the expense of usability.” Treat any missing critical action as a failure regardless of score.
- **Viewports/input:** 1920×1080 and 1280×800 normal; 1024×768 compact; 390×844 touch-oriented management; 200% text at desktop/compact; long translated labels/RTL; keyboard, standard controller, pointer and touch controls. Browser/Tauri runtime support must be recorded. UI operability on a narrow viewport does not certify all mobile world gameplay.
- **Performance evidence:** record hardware/runtime/build, campaign fixture, sample count and p50/p95. Compare a repeated 60-second exploration/combat scene before/after for UI-caused frame-time regression (proposed ≤5% p95 regression). Measure operations stated in Success Measures separately. If the environment cannot run a required gate, mark it unverified with the exact blocker; do not fabricate timings or mark the contract verified.

**Watch Points**:

- Production Path rule requires a resolvable route/named entry point/declared command. Replace proposed feature routes and tooling command descriptions with exact implemented routes/commands before approval/verification.
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

No product question blocks drafting: recommended defaults above are explicit. Before approval, allocate the final ID, confirm exact available feature capabilities and record the supported browser/Tauri and controller test matrix. Any actual domain change discovered must be a separate scoped proposal.

## Amendments

Changes to ACs or scope require a version bump and user approval. Routine implementation placement can follow current project conventions while preserving the defined invariants.

| Version | Date | Change | Approved by |
|---|---|---|---|
| 2.0.0 | 2026-09-14 | Initial source-grounded draft; no implementation or verification claimed | Pending owner approval |

## Promotion Lifecycle

> [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle). A sandbox is not integrated; `release_verified` requires production and visual evidence.

## Status Lifecycle

> [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle). Keep `draft` until authorized; never mark completed before merge/CI. Record actual execution and AC evidence during implementation.
