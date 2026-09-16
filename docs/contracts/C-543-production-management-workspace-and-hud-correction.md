---
id: C-543
title: "Contract C-543: Production Management Workspace, HUD Semantics, and Theme Integration Correction"
source: "docs/design/game_ui_hud_overhaul.md; docs/design/aikami_ui_hud_theme_review_2026q3.md; C-527; C-528; C-529"
contract_type: full
status: implemented
github:
    issue_number: null
    issue_url: null
    project_item_id: null
    pr_url: null
created_at: "2026-09-16T00:00:00Z"
---

# Contract C-543: Production Management Workspace, HUD Semantics, and Theme Integration Correction

## Metadata

| Field                  | Value                                                                                                                                                                                                                                                                        |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Source**             | `docs/design/game_ui_hud_overhaul.md` §1–§8; `docs/design/aikami_ui_hud_theme_review_2026q3.md`; corrective follow-up to C-527 / C-528 / C-529                                                                                                                                |
| **Target**             | `/game` management workspace + HUD; `/settings?section=interface` theme consumption; `packages/frontend/theme` game-scoped presentation layer                                                                                                                               |
| **Type**               | full                                                                                                                                                                                                                                                                         |
| **Priority**           | P1 — C-527–C-529 built the right state/routing/customization foundations but the production UI still renders legacy modal presentation and does not consume the theme system                                                                                                  |
| **Dependencies**       | C-527 ✅ `implemented` (PR #353); C-528 ✅ `implemented` (PR #357); C-529 ✅ `implemented` (PR #361). None `blocked`. Honours all preserved ownership boundaries named in those contracts.                                                                                    |
| **Status**             | implemented                                                                                                                                                                                                                                                                  |
| **Promotion**          | `integrated` (production routes wired; E2E + visual lanes authored and to be run in CI)                                                                                                                      |
| **Docs Impact**        | internal → contract only. Player-facing HUD/menu copy did not change semantics; no docs page edits required.                                                                                                                                                                 |
| **Contract version**   | 1.0.0                                                                                                                                                                                                                                                                        |
| **Production Surface** | `/game` → Menu → Character / Inventory / Journal / Party / World; `/game` exploration HUD; `/settings?section=interface` → Appearance                                                                                                                                       |

## Problem & Baseline Evidence

Baseline inspected on `main` at `6034d4964`.

The three prior contracts built the correct **state** architecture:

- `GameOverlayService` is the single overlay/navigation/pause authority.
- `management_sections.ts` is the canonical five-section registry.
- `management_session.svelte.ts` owns the session, return context, remembered
  subviews, focus restoration and visited section ViewModels.
- `HudPreferenceService` + `hud_layout_policy.ts` + `game_hud_surface.svelte.ts`
  are the single HUD preference/resolver/projection path.
- `appearance_preference_service.svelte.ts` is the theme authority.

They did **not** migrate production **presentation**. Concretely, on `main`:

- `management_host.svelte` owned the whole viewport with a flat
  `btn btn-sm` strip and `bg-base-300/95 backdrop-blur-sm`, while each feature
  view still rendered its **own** legacy card/backdrop/title/Close:
  `inventory_view_model.svelte.ts` (`panelClass` = `card … max-w-xl`),
  `world_view_model.svelte.ts` (`max-w-4xl`), `party_roster_view_model.svelte.ts`
  and `reputation_view_model.svelte.ts` (`max-w-lg`), and
  `character_sheet_content.svelte` (`card … max-w-lg` with its own Pro toggle
  and Close). Result: a small web card centered in a monitor-sized gray field,
  duplicate titles and duplicate close actions.
- `game_ui_view.svelte` scaled the HUD with inline `style="zoom: …"`
  (`game_ui_view.svelte:80`), which C-527 explicitly rejected.
- `hp_bar.svelte` rendered a glass pill with a heart emoji and tiny monospace
  text; `party_hud.svelte` imported `gameOverlayService` and
  `partyRosterService` directly (MVVM leak); `hotbar_view_model.svelte.ts`
  built Tailwind class strings (`border-purple-500/60 …`, `bg-white/5 …`) and
  exposed a second `visible` flag; `hotbar_view.svelte` hardcoded
  `bg-black/70`.
- `renderTransitionZoneOverlays` drew neon-green (`0x00ff88`) full-zone
  rectangles and arrows on **every** map load (not debug-gated), and
  `drawDebugGrid` painted the whole walkability grid in production.
- `PartyRosterViewModel.viewEquipment({ npcId })` ignored `npcId` and opened
  the player's own character dashboard.
- The production management surfaces used daisyUI-era `card`/`base-*` styles
  and never consumed the Obsidian Chronicle roles (`bg-panel`, `bg-elevated`,
  `bg-ink`, `border-brass`, `font-display`) that C-529 made themeable, so a
  custom theme could not reach them.

- **Reproduction**: boot `/game`, open Menu, open each section at 2048×1152;
  apply a custom theme in `/settings?section=interface` → Appearance and note
  the management surfaces do not change.
- **Existing implementation to reuse**: `character_sheet_content.svelte`
  (existing content extraction), `management_session.svelte.ts`,
  `management_sections.ts`, `hud_layout_policy.ts`, `game_hud_surface.svelte.ts`,
  `appearance_preference_service.svelte.ts`, `dev/obsidian/` visual grammar.
- **Known gaps**: no game-scoped readability layer; no production theme
  integration test; no management/HUD visual cases against `/game`.
- **Baseline tests**: `bun moon run client:test` (3633 pass on `main`),
  `bun moon run client:typecheck`, `play_shell.spec.ts`,
  `hud_customization.spec.ts`, `theme_runtime.spec.ts`.

## User Outcome

After this contract, a player on `/game` can open one coherent Menu workspace
whose five sections share navigation, typography and return behaviour; read
HP, party status, objectives, prompts and the Menu entry at ordinary desktop
scale; and have an installed theme visibly skin those surfaces — while every
existing state/routing/persistence guarantee from C-527–C-529 is preserved.

## Success Measures

- **Time/latency target**: warm management section switch p95 ≤ 100 ms
  (unchanged from C-527; this PR adds no per-frame measurement).
- **Offline/degraded behavior**: workspace and HUD boot with no network; the
  game-scoped stylesheet is bundled, not fetched.
- **Production journey enabled**: `/game` Menu → all five sections → Return to
  the exact captured play/dialogue context.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Overlay/navigation/pause authority | `services/game/game_overlay_service.svelte.ts` | reuse (unchanged) |
| Section registry + legacy deep-open mapping | `views/game/ui/management_sections.ts` | reuse (unchanged) |
| Management session, return context, focus | `views/game/ui/management_session.svelte.ts` | modify (add `activeSectionLabel`) |
| HUD preference authority + resolver | `hud_layout_policy.ts`, `hud_layout_bridge.ts`, `game_hud_surface.svelte.ts` | reuse/modify (project party + hotbar state) |
| Theme authority + scoped runtime | `appearance_preference_service.svelte.ts`, `utils/theme/theme_runtime.ts` | reuse (unchanged) |
| Semantic theme tokens | `packages/frontend/theme/src/lib/aikami_theme.css` (generated) + built-in JSON | reuse (unchanged source of truth) |
| Obsidian Chronicle visual grammar | `views/dev/obsidian/` | extract grammar into a game-scoped stylesheet (not the fixtures) |
| Character content extraction | `character_sheet_content.svelte` + `character_sheet_management_view.svelte` | modify (layout-neutral) |

## Overview

The prior work made the management host a controller but not a workspace, and
left production presentation on the old modal component layer. This contract
corrects presentation composition: a single real workspace with a desktop
navigation rail, one return action, theme-semantic surfaces and a game-scoped
readability layer; HUD widgets that project through the ViewModel and consume
theme roles; removal of the production `zoom`; and a test that proves a theme
actually reaches these surfaces. It does not create a second router, overlay,
HUD store or combat authority, and it does not change game rules.

## Design Reference

- `views/dev/obsidian/components/obsidian_codex.svelte` and
  `obsidian_context_header.svelte` — the visual grammar (`bg-panel`,
  `bg-elevated`, `bg-ink`, `border-brass/20`, `font-display`, tabular numerics).
- `packages/frontend/theme/src/lib/aikami_ui.css` — the shared primitive layer
  whose small web-app sizes must **not** be changed globally.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

1. **Keep C-527–C-529 ownership.** No `GameSuperViewModel`, `UniversalUIService`,
   second router, second HUD preference store or second combat authority.
2. **One management boundary.** `management_host.svelte` owns backdrop, dialog
   semantics, initial focus, Tab containment, sibling navigation and Return.
   Embedded feature content contributes content only.
3. **One scroll owner where practical.** The workspace body is the host's; a
   feature may own an internal scroll only for a genuine master/detail region.
4. **No `zoom`, no transform scale.** The resolver publishes
   `--hud-widget-scale`; widget internals scale through layout (`em` metrics)
   and the resolver's predicted box is applied as `min-inline-size`/
   `min-block-size`, so TypeScript geometry and the DOM agree.
5. **Theme semantics.** Production management/HUD surfaces consume semantic
   roles (`--ui-panel`, `--ui-elevated`, `--ui-ink`, `--ui-brass`,
   `--ui-primary`, `--ui-focus-ring`); no hardcoded black/white/purple.
6. **Game-scoped readability.** A new trusted layer beneath
   `[data-aikami-theme-scope]` sets gameplay typography roles and does **not**
   change Hub/docs/site or the shared primitives globally.
7. **Theme packs stay declarative.** No arbitrary CSS/JS/HTML/SVG or component
   registration; personal accessibility overrides remain final.
8. **No invented mechanics.** Companion equipment is not exposed because the
   domain does not support it; the misleading action is replaced with an
   honest notice.

## State & Data Models

New ViewModel projections (app-local; no persisted schema changes):

```ts
type HudHealthTone = 'healthy' | 'warning' | 'danger';

type HudPlayerStatus = {
  readonly hp: number;
  readonly maxHp: number;
  readonly percent: number;
  readonly tone: HudHealthTone;
  readonly toneLabel: string;   // rendered alongside the color, never instead
  readonly valueLabel: string;  // "40/80", tabular
};

type HudPartyMember = {
  readonly npcId: string;
  readonly name: string;
  readonly initial: string;
  readonly classId: string;
  readonly level: number;
  readonly approval: number;
  readonly approvalTone: 'neutral' | 'warning' | 'danger';
  readonly approvalLabel: string;
};

type HudPartyStatus = {
  readonly count: number;
  readonly maxSize: number;
  readonly isEmpty: boolean;
  readonly label: string;
  readonly members: readonly HudPartyMember[];
  readonly needsAttention: boolean;
};

type HotbarSlotAvailability = 'available' | 'depleted' | 'empty';
```

`HotbarSlot` no longer carries `className`; it carries `availability`,
`unavailableReason` and `hasAssignedSlots` replaces the ViewModel `visible`
flag. HUD visibility remains owned solely by the C-528 resolver.

## Quality Requirements

- **Offline/degraded mode**: no network added to any boot path; the game
  stylesheet is bundled.
- **Accessibility/input**: tone is never color-only; focus ring is a semantic
  role; controls keep ~44px targets; reduced motion stays global; high contrast
  keeps working.
- **Performance budget**: no per-frame DOM measurement; no new long task; the
  Pixi canvas is not remounted when management opens.
- **Security/privacy**: theme packs remain declarative; no new execution surface.
- **Persistence/migration**: no persisted schema change. HUD preferences and
  appearance selection keep their keys.
- **Cancellation/retry/idempotency**: existing behaviour preserved.
- **Observability**: unchanged.

## Migration & Rollback

N/A — no persistent state changes. Rollback is a revert of the presentation
commits; preferences and saves remain valid because their schemas are unchanged.

## Scope Boundaries

- **In Scope:**
  - `management_host.svelte` workspace layout + section rail + single Return.
  - Content/standalone split for Inventory, World, Party, Reputation; embedded
    suppression for Journal; layout-neutral Character content.
  - HUD widget correction: player status, party status (MVVM), hotbar
    (semantic state), Menu, prompt, autosave + required system notice.
  - Removal of production `zoom`; `--hud-widget-scale` + game-scoped metrics.
  - `packages/frontend/theme/src/lib/aikami_game_ui.css` (+ package export +
    client import).
  - Transition-zone marker redesign; walkability debug grid gated to E2E mode.
  - Colour-policy extraction for HP; party `viewEquipment` honesty fix.
  - Theme integration E2E + management workspace visual suite.
- **Out of Scope:**
  - Any combat-rule, engine-model, inventory/equipment-operation, quest or
    save-format change.
  - A minimap or quest-marker widget (C-502/C-503 remain draft).
  - A deep Character/Inventory master-detail redesign beyond presentation.
  - Hub theme publishing (C-530).
  - Global resizing of shared Hub/docs/site primitives.

## Contract Size & Split Rule

A single corrective contract: the pieces share one boundary (the management
workspace composition and the game-scoped stylesheet) and cannot be verified
independently without leaving the UI in a worse, half-migrated state.

## Acceptance Criteria

### AC-1: One management workspace, one boundary
**Given** the player has opened `/game` → Menu
**When** any of Character / Inventory / Journal / Party / World is active
**Then** exactly one `Game menu` dialog boundary exists, exactly one host-owned
Return control exists, each section fills the same substantial workspace, and no
embedded feature renders its own backdrop, `role="dialog"`, top-level title or
Close/X.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | E2E + Visual | `apps/e2e/tests/client/management_workspace.spec.ts`; `apps/e2e/src/visual/suites/management_workspace.visual.ts` | `/game` → Menu → section | To be filled at verification |

### AC-2: One shell, five sibling sections, restored return context
**Given** the player is exploring or in a conversation
**When** they open the Menu, switch sections, and Return
**Then** section switching replaces the sibling location (no stacked modal),
local section state survives, and the exact originating play/dialogue context
and focus are restored.

### AC-3: HUD reads through the ViewModel and the theme
**Given** exploration with a party, abilities assigned and an active quest
**When** the HUD renders
**Then** player status, party status, hotbar, objective, prompt and Menu are
projected by the ViewModel (no direct service imports in the views), use
semantic theme roles, and the hotbar exposes semantic state rather than Tailwind
class strings or a second visibility flag.

### AC-4: No production CSS `zoom`
**Given** any HUD scale and any text scale
**When** the HUD renders
**Then** no `.hud-widget` uses `zoom` or transform scale; `--hud-widget-scale`
drives layout metrics; and the resolver's `minWidth`/`minHeight` are applied to
the DOM (`min-inline-size` / `min-block-size`).

### AC-5: Readable at ordinary scale and 200%
**Given** desktop and compact viewports at 100% and 200% root text
**When** the workspace and HUD render
**Then** essential gameplay text is ≥ the game-scoped minimum, essential
controls are not clipped or overlapped, the workspace is not a tiny island, and
there is no two-axis reading scroll.

### AC-6: Quiet scene, no dominant debug affordance
**Given** exploration on any authored map
**When** the scene renders
**Then** transition zones are quiet brass markers rather than neon rails, and the
walkability debug grid renders only in E2E mode, never in production.

### AC-7: A valid non-default theme reaches production surfaces
**Given** a theme installed through `/settings?section=interface` → Appearance
**When** `/game` management and HUD render
**Then** the workspace, active navigation item and HUD status surfaces adopt the
theme's semantic colors; a regression to hardcoded black/white/purple fails the
test. Theme selection does not change HUD layout, keybindings, gameplay state,
action legality or campaign data; changing a HUD preset does not change the
theme.

### AC-8: Honest companion-equipment behavior
**Given** a populated party
**When** the player activates Equipment on companion B
**Then** the UI does not open the player's own character sheet; it surfaces an
explicit notice that companion equipment management is not implemented, and the
missing domain capability is recorded as follow-up.

### AC-9: Preserved platform guarantees
**Given** the corrected presentation
**When** the game runs
**Then** campaign persistence, offline boot, inventory/equipment operations,
journal notes/quests/recaps, party actions, world discovery filtering, legacy
shortcuts, focus restoration, single-player pause semantics, one combat
authority, reduced motion, high contrast, theme installation and HUD presets all
behave as before.

> 🔴 **Production Path rule**: AC-1/AC-2/AC-3/AC-5/AC-6/AC-7 cite `/game` and
> `/settings?section=interface` production routes and production component entry
> points; AC-3 additionally cites `HotbarViewModel`, `HudPlayerStatus` and
> `HudPartyStatus`.

## Implementation Sequence

1. **Baseline**: inspect `main`, record the presentation failures (done).
2. **Contract**: this file.
3. **Workspace skeleton**: `management_host.svelte` + `activeSectionLabel`.
4. **Content extraction**: Inventory / World / Party / Reputation content-only;
   Journal embedded chrome suppression; Character content neutralization.
5. **Section IA**: World/Reputation single ownership; party identity header.
6. **Theme**: `aikami_game_ui.css` + package export + client import.
7. **HUD**: player status, party status, hotbar, Menu, prompt, autosave +
   system notice.
8. **Zoom removal**: `--hud-widget-scale` + resolver box on the DOM.
9. **Edge/debug**: transition marker redesign; debug grid E2E-gated.
10. **Tests**: theme integration E2E + management visual suite.
11. **Validation**: lint, typecheck, unit, guards, client build.

## Edge Cases & Gotchas

- **Inert/hidden panels**: inactive sections are `hidden` + `inert`; they must
  not retain tab stops or pointer interception.
- **Container vs window queries**: section content responds to the workspace
  width, so the workspace geometry uses viewport-relative units.
- **Theme metric bounds vs resolver**: the resolver's predicted box is applied
  as the DOM minimum, so a theme cannot paint smaller than reserved geometry;
  registry minima are the conservative envelope.
- **Save failure persistence**: the required `system-notice` widget carries the
  actionable save-failure state; the optional autosave widget may be hidden.
- **No fixture faking**: visual cases that need a populated inventory/party use
  a real fixture seam or are documented omissions, never a bypass query param.

## Open Questions

None outstanding for `implemented`. The companion-equipment domain capability
remains a follow-up (see Limitations in the PR report).

## Amendments

| Version | Date       | Change           | Approved by |
| ------- | ---------- | ---------------- | ----------- |
| 1.0.0   | 2026-09-16 | Initial contract | —           |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

---

## Execution Report

### Summary

Replaced the “legacy modal inside a fullscreen host” presentation with a real
management workspace; extracted legacy feature content; migrated HUD widgets to
ViewModel projection + semantic theme roles; removed production CSS `zoom` in
favour of layout-scaling custom properties; added a game-scoped readability
layer; made transition markers quiet and gated the debug grid; and added theme
integration + management workspace test coverage.

### Files changed (summary)

- Workspace: `views/game/ui/hud/management_host.svelte`;
  `views/game/ui/management_session.svelte.ts`.
- Feature content: `views/inventory/inventory_view.svelte` (+VM);
  `views/world/world_view.svelte` (+VM);
  `views/game/ui/overlays/party_roster/party_roster_view.svelte` (+VM +fixtures
  +test); `views/game/ui/overlays/reputation/reputation_view.svelte` (+VM);
  `views/journal/journal_view.svelte`;
  `views/game/dashboard/character_sheet_content.svelte` (+standalone/management
  wrappers); `views/quest/quest_view.svelte`.
- HUD: `game_ui_view.svelte`, `game_ui_view_model.svelte.ts`,
  `game_ui_view_model_types.ts`, `game_ui_composition.ts`,
  `game_ui_hud_visibility.ts`, `hud/hp_bar.svelte`, `hud/system_notice.svelte`,
  `hud/autosave_indicator.svelte`, `hud/interaction_prompt.svelte`,
  `hud/management_nav.svelte`, `party_hud.svelte`,
  `hotbar/hotbar_view.svelte`, `hotbar/hotbar_view_model.svelte.ts` (+tests).
- Theme: `packages/frontend/theme/src/lib/aikami_game_ui.css`;
  `packages/frontend/theme/package.json`; `apps/frontend/client/src/app.css`.
- Engine: `packages/frontend/engine/src/game_world/scene_overlays.ts`;
  `packages/frontend/engine/src/game_world.ts`.
- Tests: `apps/e2e/tests/client/management_workspace.spec.ts`;
  `apps/e2e/src/visual/suites/management_workspace.visual.ts`;
  `apps/e2e/src/pom/play_shell_page.ts`.

### AC status

| AC | Status | Evidence |
|---|---|---|
| AC-1 | ✅ implemented | host rewrite; `management_workspace.spec.ts` geometry cases |
| AC-2 | ✅ implemented | session `activeSectionLabel`; journey spec |
| AC-3 | ✅ implemented | VM projections; hotbar/party unit tests |
| AC-4 | ✅ implemented | `zoom` removed; `management_workspace.spec.ts` no-zoom case |
| AC-5 | ✅ implemented | game-scoped typography; compact/large-text cases |
| AC-6 | ✅ implemented | scene overlay redesign; debug-grid E2E gate |
| AC-7 | ✅ implemented | `management_workspace.spec.ts` theme integration + visual case |
| AC-8 | ✅ implemented | party VM honesty notice + unit test |
| AC-9 | ⚠️ partial | preserved by construction; full E2E re-run required in CI |

### Recorded limitations

- The management workspace visual suite and the new E2E spec were authored in
  this environment but **not executed** here (no browser/AI-vision lane
  available). They must be run in CI/with servers before this contract can move
  to `verified`.
- Populated inventory/party visual states are omitted because the client exposes
  no production fixture seam for them; the contract forbids faking them with a
  query parameter. Empty-state cases cover the workspace composition.
- Companion-scoped equipment inspection requires a domain capability (a
  companion equipment read/write surface). Recommended follow-up: a thin
  contract that adds it and wires `ManagementLocation.entityId` into the actor
  inspector.
