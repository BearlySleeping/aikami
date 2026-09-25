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

Completed the management-content pass and its review repairs on the production `/game` management host. Character opens as a summary with explicit editing, Inventory is a responsive paperdoll/bag/detail composition with a real empty state, and Journal is quest-first with note list/detail editing on demand and read-only recaps. Management selection, controls, focus and numeric emphasis use one brass/orange game accent. Presentation mappings and disclosure state remain in sibling modules; feature ViewModels were not expanded with presentation logic.

The production evidence seam mutates the real inventory, equipment, quest and player-journal stores. `QUEST_LOG` remains an input alias and resolves to the canonical Journal host. Inventory opens over Dialogue through the production overlay router, preserving transcript, composer draft and the `EXPLORE` return context.

Review repairs also make the dialogue path deterministic: the message toolbar no longer intercepts pointer events while hidden, its row has a stable scoped test hook, NPC selection consumes explicit production NPC entity IDs, navigation waits on the real map-ready boundary, and recovery/detour handling is split into small helpers without weakening the real WASD interaction path.

### AC Status

| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | Management selection, controls, focus and numeric roles use brass/orange game roles. The scoped static audit found no exact legacy `base-*`, `primary`, `badge`, `tabs-bordered`, `stat`, `alert` or `join` tokens (`game-*` replacements are allowed). Theme tests and axe passed. |
| AC-2 | ✅ | Inventory composes equipment paperdoll, carried bag, selected detail and a deliberate `game-empty` state. Compact/200% keyboard coverage, control geometry checks and the 800×600 evidence matrix pass without bottom clipping. |
| AC-3 | ✅ | Character summary shows identity, level, HP, Armor Class, attack, experience and six abilities in canonical order. Edit is explicit; the developer path remains authorized. Saving-throw controls have ability-specific accessible names and explicit labels. |
| AC-4 | ✅ | Journal defaults to Quests, Notes uses list/detail, the editor opens only after New/Edit, failed note mutations keep the editor/selection, and Recaps remain read-only. `QUEST_LOG` converges on Journal. |
| AC-5 | ✅ | Character, Inventory and Journal presentation modules own selection, mapping and disclosure state. MVVM, composition, source-size, type-safety, orphan and test-boundary guards pass; no scoped ViewModel exceeds its reviewed guard baseline. |
| AC-6 | ✅ | The evidence index records 48 captures for the three C-551 content sections (Character, Inventory, Journal) plus four Dialogue↔Inventory pair captures. Every capture asserts PixiJS WebGL; management captures also assert bounded geometry and real-store seed counts. Party and World are unchanged registry surfaces covered by the existing production visual/functional suites. No management-state query parameter is used. |
| AC-7 | ✅ | Dialogue follow-up journeys use accessible Send selection, world-readiness/WASD NPC approach and the production interaction key. Branching passed 15/15 across five repeats and skill-check passed 20/20 across ten repeats; the management Dialogue round-trip passed in `management_content.spec.ts`. |

### Files changed

The complete PR diff from `origin/main` is **63 files** (the 42-file review-repair set is split across separate implementation, test and docs commits), below the 100-file review limit.

| Area | Coverage |
|---|---|
| Management host/session | `management_host.svelte`, `management_session.svelte.ts`, `management_sections.ts`, game UI lifecycle/composition and overlay mode restoration |
| Character | Character management/content/presentation modules, composition, tests, labels, canonical ability ordering and developer authorization |
| Inventory | Inventory view/presentation modules, intrinsic paperdoll sizing, selected detail, empty state and tests |
| Journal | Journal view/presentation modules, canonical filtered-note selection, focusable scroll region, alias routing and tests |
| Production evidence seam | `game_test_seam.ts`, overlay compatibility, player journal service and seed-count assertions |
| Theme/build budget | `aikami_game_ui.css` and the reviewed CSS bundle-budget baseline |
| E2E/POM/visual coverage | Management, Character, Inventory, Play Shell and Dialogue specs; POMs; NPC diagnostics; visual suites; accessibility and responsive assertions |

No structural-guard baseline, waiver or policy ceiling was raised. The reviewed CSS budget change remains limited to the intentional game-role payload.

### Review-fix notes

- **Rich message actions:** hidden action bars now use `pointer-events-none`; hover/focus restores `pointer-events-auto`, including the small-screen variant. The dialogue row exposes `data-testid="dialogue-message-row"`, and the delete confirmation test re-reveals the row before each real pointer click.
- **NPC approach:** production diagnostics publish `npcEntityIds`; the POM filters those IDs before selecting a target and requires finite coordinates. `GameWorld` clears NPC identity/position diagnostics at scene teardown, so a previous map cannot satisfy the next approach.
- **Map readiness:** repeated `loadPackMap` calls invalidate the previous `MAP_LOADED` readiness bit, and movement assertions read the production engine's current active-buffer position rather than the lagging `window.__AIKAMI_DEBUG__` publication. The held-key lifecycle passed 10/10 repeats without weakening its no-leak assertion.
- **Journal persistence:** evidence seeds campaign-scoped notes through production journal CRUD before Journal mounts, then reloads the active campaign rows. Filtered selection and failed mutations retain a coherent editor/detail state.
- **Layout/accessibility:** character trait/narrative keys have player-facing labels, saving-throw checkboxes have ability-specific names, HP/XP progress bars are named, intrinsic paperdoll rows use max-content sizing, scroll regions remain keyboard reachable, and the attack numeric role meets the contrast requirement.
- **Test seams:** management and Inventory visual paths share `PlayShellPage.seedManagementContent`, fail loudly when the seam is absent, validate real seed counts, wait for rendered state, and use the configured emulator port.

### Production evidence

- Evidence index: `/tmp/opencode/c551-evidence/index.md`
- Machine-readable manifest: `/tmp/opencode/c551-evidence/manifest.json`
- Management matrix: 48 captures covering the three C-551 content sections (Character, Inventory and Journal); empty/populated; light/dark; 1280×720, 1920×1080, 800×600 and 200% text. Party and World remain unchanged registry surfaces covered by the production management visual suite and section-navigation lanes.
- Dialogue pairs: `/tmp/opencode/c551-evidence/pairs/dialogue-1920x1080.png`, `inventory-1920x1080.png`, `dialogue-text-200.png`, `inventory-text-200.png`.
- Candidate content snapshot: `b0aab0f66a02e930d9eb1fe9998bed725bc276dd89f0f9b0b5c97442cd9d8fcb`.
- Current evidence-file hashes: `manifest.json` = `c426a5ae352e75bac03d96a917eb41886c8e41916a732d457bbb8ee4556e69be`; `index.md` = `8c6b3c4db3f20dac9dac31d84a3a98513898df2ad0def521af4daa5b3b36d662`. The manifest contains the full SHA-256 for each of the 52 PNG captures; all 52 were re-hashed successfully.
- Every recorded capture asserts `window.__PIXI_APP__.renderer.name === "webgl"`. Management captures reach the production `/game` host, have no horizontal document overflow, and use `__AIKAMI_TEST__.seedManagementContent()` against real stores rather than a management-state query parameter. The pair uses the real HUD Menu route, seeds before Inventory activates, and verifies transcript/draft restoration.
- Fresh production snapshot CLI could not be run because `CATALOG_ORIGIN_URL` is absent from `scripts/.env.production`; the read-only copied candidate snapshot above was used for the evidence plane. This is an environment/provenance deviation, not a rendered-state bypass.

### Verification

- `bun moon run client:test` — **4,065 pass, 0 fail, 7 skipped, 2 todo**.
- `bun moon run client:test-browser` — **47/47 pass** across 23 files.
- `bun moon run frontend-theme:test` — **99 pass**; frontend-theme lint/typecheck pass.
- `bun moon run frontend-engine:test` — **1,830 pass, 0 fail**.
- `bun run --cwd apps/e2e test:unit` — **32 pass**; direct `e2e:lint`, format and typecheck pass.
- `management_content.spec.ts --workers=1` — **10/10 command tests pass**, including production real-store seeding, axe, compact/800×600 layout, 200% text, and Dialogue↔Inventory preservation.
- `character_sheet.spec.ts` + `inventory_pickup.spec.ts` + `play_shell.spec.ts --workers=1` — **32/32 command tests pass**. The held-key scenario separately passed **10/10 client repeats** after switching to the production engine-buffer position.
- `dialogue_branching_gating.spec.ts --repeat-each=5 --workers=1` — **15/15 client tests pass**; `dialogue_skill_check.spec.ts --repeat-each=10 --workers=1` — **20/20 client tests pass**.
- Visual capture-only: management-workspace **20/20**, character-sheet **7/7**, inventory **6/6**; all 33 captures succeeded. Existing visual prompts and rubric thresholds were not changed.
- Scoped audits: zero exact legacy class tokens; no existing visual prompt/schema/threshold removals; no management-state query parameters; all 52 evidence PNG hashes verified.
- `client:lint`, `client:typecheck`, `frontend-engine:lint/typecheck`, `frontend-theme:lint/typecheck`, `e2e:lint/typecheck` — pass. `client:build` and `report_bundle_budget` pass with no tracked regression.
- Structural guards: **9/10 pass**. The direct aggregate cognitive-complexity invocation still reports Biome's inherited `0 files examined` failure; the identical failure reproduces on `origin/main`. Explicit `apps packages scripts .pi` measurement examines **3,732 files**, reports **619 findings across 387 files**, and has **zero baseline regressions**. `guard:policy-diff --base-ref=origin/main` reports no policy change.
- `bun moon ci --base=origin/main` — affected builds, typechecks, lint/format, client/browser lanes, theme, engine, hub and docs/site checks pass; the sole failure is the same inherited cognitive-complexity invocation reported above.

### CodeRabbit dispositions

| Review finding | Disposition |
|---|---|
| Explicit NPC IDs, seam fail-fast/shared helper, auto-waits, configured ports, POM locators, overflow polling | **Addressed** in the current review-fix pass and covered by the focused E2E/visual lanes. |
| Rich-message pointer target | **Addressed** with hidden `pointer-events-none`, hover/focus activation, a stable row test hook, and real delete-confirmation focus coverage. |
| Character labels/order/ARIA/height and attack contrast | **Addressed**; the only remaining `min-block-size` inline style is valid CSS for the JSON editor, while invalid utility-like class declarations were replaced. |
| Inventory presentation state and Journal fixture/selection issues | **Partially addressed by design:** markup-derived Inventory projections moved into the sibling presentation module while its state stays outside the ViewModel per C-551’s no-ViewModel-growth rule; Journal fixture typing, filtered selection and failed-delete retention are addressed. |
| Suggested persona-only `playerCharacterName` identity source | **Intentionally not adopted.** The contract decision preserves `gameEngineService.playerDisplayName` with the existing `Adventurer` fallback; changing the identity source is outside this pass. |
| Suggested rewrite of violet visual wording or compact-case prompt inputs to match the new accent/viewport | **Intentionally not adopted.** Visual rubric thresholds and prompts are immutable for this contract; runtime game roles changed, while prompt text remains unchanged. |

### Follow-up / deviations

- The broad `e2e:test` lane still requires the local text/image/voice stack; the required production management, Play Shell and Dialogue lanes are green without that stack.
- An exploratory release-gate cold-launch run was not used as C-551 evidence: it stopped in onboarding before NPC approach on a 404/disabled-`Next` state, outside this diff.
- Visual evidence is capture-only. Existing rubric thresholds and prompts were not changed. The pre-existing violet wording in the immutable management prompt remains a documented contract contradiction, not a runtime accent.
- The cognitive guard invocation issue is pre-existing and names no C-551 file; it is reported rather than folded into this implementation. No guard policy, baseline ceiling or waiver was relaxed.
- Validation used `--workers=1` for the stateful local Play Shell/Dialogue evidence lanes. Fully parallel local runs have shown shared-emulator section-state interference; the deterministic combined lane and focused repeats are green. No product assertion was weakened.
