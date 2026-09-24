---
id: C-551
title: "Management content on game UI roles"
source: direct
contract_type: thin
status: implemented
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: "https://github.com/BearlySleeping/aikami/pull/393"
created_at: "2026-09-24T00:00:00Z"
---

# Contract C-551: Management content on game UI roles

## Metadata

| Field | Value |
|---|---|
| **Source** | `docs/reference/emberwatch-polish-review-and-plan.md` §6 “Management workspace” + “Theme and layout discipline” (P4, management surface group) |
| **Target** | `apps/frontend/client/src/lib/views/game/ui/hud/management_host.svelte`; character, inventory and journal production views; `packages/frontend/theme/src/lib/aikami_game_ui.css` |
| **Type** | thin |
| **Priority** | P1 — management is a core player task and currently mixes violet product controls with the brass/orange game accent while wasting task space |
| **Dependencies** | C-543 (production management host and game-scoped roles), C-547 (dialogue presentation/game-role pattern), C-529 (theme runtime), C-548 evidence sequence |
| **Status** | implemented |
| **Promotion** | integrated |
| **Docs Impact** | internal — production task composition and theme roles change without a player-facing feature page |
| **Contract version** | 2.0.0 |
| **Production Surface** | `/game` — management workspace hosted by `management_host.svelte` |

## Problem & Baseline Evidence

- **Current behavior**: the selected management rail tab, focus ring, primary actions and stat numerics use the daisyUI-compatible violet/cyan/yellow vocabulary rather than the game’s brass/orange accent. Character opens as an editor, inventory separates equipment from an undersized/empty bag, and journal permanently reserves a 20rem editor column.
- **Reproduction**: open the production `/game` management workspace from a real Emberwatch campaign. At 1280×720 the empty inventory’s grey bar clips at the bottom; character resembles unrestricted editing; journal leaves a permanent blank editor. Compare with C-547’s dialogue stage, which already uses `game-*` roles.
- **Existing implementation to reuse**: C-543’s single management host and section-state ownership; existing inventory/equipment, player, quest and journal services; C-547’s `dialogue_stage_presentation.svelte.ts` pattern; game-scoped semantic tokens and roles in `aikami_game_ui.css`.
- **Known gaps**: no summary-first character mode; no composed inventory detail state; no on-demand note editor; view-local mappings remain in Views; production visual evidence omits populated real-store states; two known dialogue POM failures and one dialogue transcript gap remain from C-547 findings.
- **Baseline tests**: `client:test` — 4,039 pass, 0 fail, 7 skip, 2 todo; `frontend-theme:test` — 99 pass. C-547 reports ten red dialogue Playwright specs split between the Send selector and NPC approach helper.

## Surface: before → intended after

| Surface | Before | After |
|---|---|---|
| Management rail/header | violet selected tab, mixed `base-*`/`primary` chrome | brass/orange game selection, neutral panel chrome, game focus ring |
| Character | class-first editable form with tiny steppers and “Save” | identity + HP/AC/level + core abilities read view; explicit Edit mode; “Saving throws” / “Save prof.” |
| Inventory | centered equipment cross over a weak/clipping bag; no selected-item reading surface | composed paperdoll + bag + detail/selection panel; purposeful composed empty state |
| Journal | notes list beside a permanent 20rem editor | list/detail with editor opened on demand; quest recap remains read-only |
| Dialogue transcript | short content can leave a dead gap above chips | transcript remains content-sized; composer/chips stay attached |

## User Outcome

After this contract, a player can inspect character, inventory and journal tasks from the existing production management workspace, understand the current state immediately, take the next action without editing chrome dominating the view, and see one coherent brass/orange game accent at normal, compact and 200% text sizes.

## Scope Boundaries

- **In Scope:** management host rail/header, character sheet summary/edit gating, composed inventory paperdoll/bag/detail and empty state, journal notes list/detail/on-demand editor, minimum game selection/numeric/empty roles, view-local presentation extraction, management production visual states, axe/a11y coverage, the C-547 dialogue transcript gap and two known POM fixes.
- **Out of Scope:** pause/end-session/settings redesign, HUD work, a new theme system, gameplay or ViewModel behaviour changes, query-driven production variants, deploy/promotion, or changes to visual rubric thresholds/prompts.

## Acceptance Criteria

### AC-1: One game accent across management controls
**Given** the management workspace is open
**When** any rail item, primary action, focusable control or character numeric is rendered
**Then** selection, focus and numeric emphasis use existing game tokens/roles; the scoped surfaces no longer use the listed legacy `base-*`, `primary`, `badge`, `tabs-bordered`, `stat`, `alert` or `join` classes.

**Verification**: scoped legacy-class audit, `frontend-theme:test`, axe/a11y Playwright and production light/dark captures.

### AC-2: Inventory is a composed task surface
**Given** real inventory/equipment stores are empty or populated
**When** the inventory section renders at any required viewport/text scale
**Then** equipment, bag and selected-item detail share one responsive composition; populated content fills useful space and empty content uses a composed `game-empty` state without bottom clipping.

**Verification**: production `/game` empty and populated captures at 1280×720, 1920×1080, 800×600 and 200% text; `inventory` visual suite; management inventory keyboard spec.

### AC-3: Character inspection is summary-first and editing is explicit
**Given** the product’s existing character customization and developer-tool gate
**When** a player opens Character
**Then** identity, HP/AC/level and core abilities are shown as a read view; NumberSteppers and proficiency controls appear only after an explicit Edit action or an already-authorized developer-tools path; saving-throw labels use existing unambiguous i18n.

**Verification**: character view-model/browser tests, `character_sheet` visual suite and production empty/populated captures.

### AC-4: Journal uses list/detail and opens its editor on demand
**Given** notes exist or are absent
**When** the player reviews quests, notes or recaps
**Then** active quests remain readable, notes use list/detail, editing opens in-surface only on demand, and recap remains read-only; no permanent 20rem editor column remains.

**Verification**: journal presentation/ViewModel tests, `management_workspace` visual cases and production captures with real quest/journal stores.

### AC-5: View-local presentation leaves Views without growing ViewModels
**Given** the current character, inventory, journal and management host markup
**When** presentation mappings/selection/edit disclosure are moved
**Then** they live in sibling presentation modules like C-547, Views contain no local transformation logic, and no scoped ViewModel grows beyond its guard baseline.

**Verification**: presentation unit tests and whole-repo structural guards.

### AC-6: Production evidence covers the real management task
**Given** the C-548 candidate-plane sequence and WebGL production game
**When** evidence is captured
**Then** each section is captured empty and populated at 1280×720, 1920×1080, 800×600 and 200% text in light and dark, including the dialogue-stage ↔ inventory pair; populated states are seeded through real stores, not bypass query parameters; rubric thresholds/prompts remain unchanged.

**Verification**: `/tmp/opencode/c551-evidence/index.md`, visual suite capture logs and production WebGL assertion.

### AC-7: C-547 dialogue follow-ups are repaired
**Given** the merged C-547 stage
**When** short dialogue renders and the two known Playwright journeys run
**Then** the transcript sizes to content without a dead gap; Send is found by role/accessible name; NPC approach waits for world readiness and uses WASD; the previously red specs pass without changing their assertions.

**Verification**: re-captured 1920×1080 and 200% dialogue evidence; before/after Playwright pass counts.

## Edge Cases & Gotchas (optional)

- **Character policy**: do not infer a new progression rule. Preserve the existing developer-tools gate and add an explicit player-facing Edit action unless repository contracts establish a stricter existing product decision.
- **200% text**: no fixed editor column, clipped empty bar, or rail label may force horizontal scrolling.
- **Production fixtures**: seed real service state through existing seams; visual suite query parameters may select a named case only if the rendered production component receives the same service state as normal play.
- **Theme contrast**: brass/orange roles must retain axe-compliant contrast on every surface in both variants.

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

## Execution Report

### Summary

Implemented the management-content pass on the production `/game` management host. Character now opens as a summary with an explicit Edit disclosure, Inventory is a responsive paperdoll/bag/detail composition with a real empty state, and Journal is quest-first with note list/detail editing on demand and read-only recaps. Management selection, controls, focus and numeric emphasis use the shared game accent roles. View-local mappings and disclosure state moved into sibling presentation modules; the feature ViewModels were not expanded with presentation logic.

The production evidence seam now mutates the real inventory, equipment, quest and player-journal stores. The legacy `QUEST_LOG` entry point remains an input alias, but routes to the canonical Journal host. Inventory can be opened over Dialogue through the production overlay router, preserving the conversation as the management return context.

### AC Status

| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | Management selection, controls, focus and numeric roles use the brass/orange game accent. Scoped static class-token audit found no exact legacy `base-*`, `primary`, `badge`, `tabs-bordered`, `stat`, `alert` or `join` tokens (`game-*` replacements are allowed); theme tests and axe passed. |
| AC-2 | ✅ | Inventory composes equipment paperdoll, carried bag, selected detail and a deliberate `game-empty` state. Compact/200% keyboard coverage and the 800×600 evidence matrix pass without bottom clipping. |
| AC-3 | ✅ | Character summary shows identity, level, HP, Armor Class, attack, experience and six abilities. Edit is explicit; the standalone/developer path starts authorized and retains Pro/JSON tools. Saving-throw wording is explicit. |
| AC-4 | ✅ | Journal defaults to Quests, Notes uses list/detail, the editor opens only after New/Edit, and Recaps remain read-only. Legacy `QUEST_LOG` routing converges on Journal. |
| AC-5 | ✅ | Character, Inventory and Journal presentation modules own selection, mapping and disclosure state. MVVM, composition, source-size, type-safety, orphan and test-boundary guards pass; no scoped ViewModel exceeds its reviewed guard baseline. |
| AC-6 | ✅ | `/tmp/opencode/c551-evidence/index.md` records 48 management captures plus four dialogue↔Inventory pair captures. Every capture asserts PixiJS WebGL, bounded geometry and real-store seed counts. |
| AC-7 | ✅ | Dialogue follow-up journeys use accessible Send selection, world-readiness/WASD NPC approach and the production interaction key. Focused branching/skill-check rerun: 6/6; prior full five-file lane: 15/15. |

### Files created / modified

| Area | Files |
|---|---|
| Management host/session | `apps/frontend/client/src/lib/views/game/ui/management_host.svelte`, `management_session.svelte.ts`, `management_sections.ts`, `game_ui_view_model.svelte.ts`, `game_ui_composition.ts` |
| Character | `character_sheet_management_view.svelte`, `character_sheet_content.svelte`, `character_sheet_view.svelte`, `character_sheet_composition.ts`, `character_sheet_view_model.svelte.ts`, `character_sheet_presentation.svelte.ts` |
| Inventory | `inventory_view.svelte`, `inventory_view_model.svelte.ts`, `inventory_presentation.svelte.ts` |
| Journal | `journal_view.svelte`, `journal_presentation.svelte.ts` |
| Production evidence seam | `game_test_seam.ts`, `overlay_compatibility.ts`, `player_journal_service.svelte.ts` and the associated overlay test |
| Theme/build budget | `packages/frontend/theme/src/lib/aikami_game_ui.css`, `apps/frontend/client/scripts/bundle_budget.baseline.json` |
| E2E/POM/visual coverage | `management_content.spec.ts`, management/Character/Inventory visual suites, `npc_approach.ts`, play-shell/Game/Inventory/Character POM repairs, legacy E2E selectors and unit fixtures |

The complete changed-file set is 45 files, below the 100-file review limit. The reviewed CSS budget baseline was updated only for the intentional new game-role payload (`totalCssBytes` 169,670 → 187,758); no structural-guard baseline or waiver was raised.

### Production evidence

- Evidence index: `/tmp/opencode/c551-evidence/index.md`
- Machine-readable manifest: `/tmp/opencode/c551-evidence/manifest.json`
- Management matrix: 48 captures covering Character, Inventory and Journal; empty/populated; light/dark; 1280×720, 1920×1080, 800×600 and 200% text.
- Dialogue pairs: `/tmp/opencode/c551-evidence/pairs/dialogue-1920x1080.png`, `inventory-1920x1080.png`, `dialogue-text-200.png`, `inventory-text-200.png`.
- Candidate content snapshot: `b0aab0f66a02e930d9eb1fe9998bed725bc276dd89f0f9b0b5c97442cd9d8fcb`.
- Every recorded management/pair capture asserts `window.__PIXI_APP__.renderer.name === "webgl"`, reaches the production `/game` host, has no horizontal document overflow, and uses `__AIKAMI_TEST__.seedManagementContent()` against real stores rather than a management-state query parameter.
- Fresh production snapshot CLI could not be run because `CATALOG_ORIGIN_URL` is absent from `scripts/.env.production`; the read-only copied candidate snapshot above was used for the evidence plane. This is an environment/provenance deviation, not a rendered-state bypass.

### Verification

- `bun moon run client:test` — 4,058 pass, 0 fail, 7 skip, 2 todo.
- `bun moon run frontend-theme:test` — 99 pass; frontend-theme lint/typecheck pass.
- `bun moon run client:typecheck` / `client:lint` — pass.
- `bun run --cwd apps/e2e test:unit` — 32 pass; `e2e:lint` / `e2e:typecheck` pass.
- `management_content.spec.ts` — 8/8 pass, including compact empty Inventory, 200% text and axe (no serious/critical violations).
- Legacy Character/Inventory/management E2E lane — 23/23 pass; focused dialogue branching/skill-check rerun — 6/6 pass.
- Visual capture-only: management-workspace 20/20, character-sheet 7/7, inventory 6/6 (33/33); the production evidence matrix contains 52 hashed captures including the four dialogue pairs.
- `client:build` — pass; `report_bundle_budget.ts` reports no tracked regressions after the reviewed CSS-budget update.
- Structural guards: MVVM, service conventions, image component, data plane, type safety, orphan capability, test boundary, ViewModel composition and source-size all pass. The direct cognitive-complexity invocation reports Biome's inherited “0 files examined” failure in this worktree; the same failure reproduces on `origin/main`. Running the identical guard with explicit `apps packages scripts .pi` roots measures 619 findings in 387 files and passes the unchanged baseline, including the C-551 files.
- `bun moon ci --base=origin/main` — all affected builds/tests/checks pass; the sole failure is the same inherited cognitive-complexity invocation reported above.

### Follow-up / deviations

- The broad `e2e:test` lane still requires the local AI-service stack; the required production management and dialogue lanes above are green.
- Visual capture is recorded as capture-only evidence. Existing rubric thresholds and prompts were not changed.
- The cognitive guard invocation issue is pre-existing and names no C-551 file; it is reported rather than folded into this contract's implementation. No guard policy, baseline ceiling or waiver was relaxed.
