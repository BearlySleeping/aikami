---
id: C-555
title: "Exploration HUD and inventory icon polish"
source: direct
status: implemented
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-09-24T20:50:00Z"
---

# C-555 — Exploration HUD (UI PR-4)

## Baseline and scope

Base: `feat/emberwatch-polish-batch` / `d0934bce7`. C-555 was unused before this contract; only C-554's execution report mentioned the production dev cog as follow-up scope. Runtime producer-to-consumer path remains:

`engine bridge / campaign + overlay services → GameUIViewModel → game_hud_surface resolver → game_ui_view.svelte → shared game UI CSS`.

The existing HUD preference service, presets, temporary Hide HUD state, pause editor, and campaign save seam remain authoritative. No content-pack, atlas, map-builder, backend, or deployment changes are included.

## Acceptance matrix

| ID | Acceptance criterion | Implementation / proof |
| --- | --- | --- |
| AC-1 | Default exploration HUD is compact and comfortable without configuration. | Player vitals and party status share `top-start`; quiet clock and one Menu remain top-end; objective and tutorial share `bottom-start`; interaction stays in the bottom-centre stack. `packages/shared/constants/src/lib/game/hud_widgets.ts:341`, `:413`; `apps/frontend/client/src/lib/views/game/ui/game_ui_view_model.svelte.ts:280`. |
| AC-2 | Tutorial prompt is grouped with objective guidance rather than detached. | `hasObjective` includes the onboarding hint, while onboarding retains its own preference/widget identity. `onboarding_hint.svelte` now uses the shared `hud-onboarding` roles; `packages/frontend/theme/src/lib/aikami_game_ui.css:1392`. |
| AC-3 | Autosave is quiet and cannot collide with bottom-right controls. | Autosave remains a resolved top-end widget; system errors remain required; no bottom-end placement was added. The compact `.hud-notice` role is unchanged. |
| AC-4 | Interaction hint is near the action and does not cover feet. | Production interaction label is rendered in the bottom-centre resolver stack above the hotbar; `hud-prompt` adds semantic elevation and bottom margin. `packages/frontend/theme/src/lib/aikami_game_ui.css:1340`. |
| AC-5 | Dialogue has collision/priority rules. | Optional HUD widgets are withdrawn for `DIALOGUE`; required Menu and system notice stay docked top-end. `apps/frontend/client/src/lib/utils/hud/hud_layout_policy.test.ts:136`; `hud_layout_policy.ts` existing `HUD_HIDDEN_WHILE_BUSY` policy remains the single owner. |
| AC-6 | Customization, presets, and temporary hiding remain available. | No preference schema/service/editor changes. Default preset only changes placement; required-widget coercion and temporary hidden snapshot remain intact. |
| AC-7 | Dev cog is absent from production builds. | Root cause was `app_view_model.svelte.ts` importing Eruda whenever `PUBLIC_MODE=emulator`, even when serving a Vite production bundle. `import.meta.env.DEV` now gates the import. `apps/frontend/client/src/lib/views/app/app_view_model.svelte.ts:202-207`; build guard `apps/frontend/client/scripts/check_no_eruda.ts`, invoked at `build_client.ts:98` and tracked in `moon.yml:118`. Production build scanned 105 text assets and found no `eruda.init`/`loglevel-plugin`. |
| AC-8 | Inventory no longer shows letter monograms. | Existing LPC `LpcItemIcon` is used when `lpcAssetId` resolves; fallback is a category map, never an item-id map: weapon ⚔️, armor 🛡️, consumable 🧪, key 🗝️, misc 📦. `apps/frontend/client/src/lib/utils/inventory_utils.ts:9-18`; inventory projection `inventory_view_model.svelte.ts:70-77,205-217`; markup `inventory_view.svelte:160,198`. |
| AC-9 | Save confirmation wins over timestamp. | `saveStatusLabel` already gives `Game Saved!` precedence over `lastSavedLabel`; C-555 adds explicit regression coverage in `pause_menu_view_model.test.ts`. Real `campaignService.activeCampaign.lastSavedAt` remains the fallback projection. |

## Verification

- Generated Emberwatch portraits/audio/atlas/props/maps/asset seed successfully; `git status` showed no generated tracked diff.
- Client typecheck: passed, 0 errors / 0 warnings.
- Theme, constants, and E2E typechecks: passed.
- Client focused tests (HUD policy, inventory ViewModel, pause ViewModel): 48 passed, 0 failed; full client unit lane in Moon CI: 4100 passed, 0 failed, 7 skipped, 2 todo.
- E2E C-555 spec: 4 passed (default HUD + axe, pause save confirmation, inventory accessibility; setup included). Command: `env -u CI PUBLIC_EMULATOR_PORT_OFFSET=14 bunx playwright test tests/client/exploration_hud.spec.ts --project=client`.
- Client/theme/constants/E2E lint and fix: passed for changed source. The repository's E2E unit lane has 2 inherited environment-sensitive failures in `preflight.test.ts` / `service_map.test.ts` when the ambient offset is present; rerun with `env -u PUBLIC_EMULATOR_PORT_OFFSET` still reports the base branch's port/fallback expectation failures. No C-555 E2E unit files were changed.
- Production build: passed. `PUBLIC_APP_ID=client PUBLIC_MODE=emulator bun moon run client:build -- --mode production`; `check-no-eruda` passed, chunk-cycle/deploy-asset/dynamic-import/budget guards passed.
- Evidence: `/tmp/opencode/c555-evidence/index.md`, labeled `/tmp/opencode/c555-evidence/sheet.png`, plus eight PNGs. VLM evidence check scored 85/100 (pass; evaluator noted the 200% and post-save details are subtle in the montage).

## Files created / modified

### Created

- `apps/frontend/client/scripts/check_no_eruda.ts`
- `apps/e2e/tests/client/exploration_hud.spec.ts`
- `docs/contracts/C-555-exploration-hud.md`

### Modified

- `apps/frontend/client/moon.yml`
- `apps/frontend/client/scripts/build_client.ts`
- `apps/frontend/client/src/env.ts`
- `apps/frontend/client/src/lib/utils/hud/hud_layout_policy.test.ts`
- `apps/frontend/client/src/lib/utils/inventory_utils.ts`
- `apps/frontend/client/src/lib/views/app/app_view_model.svelte.ts`
- `apps/frontend/client/src/lib/views/game/ui/game_ui_view_model.svelte.ts`
- `apps/frontend/client/src/lib/views/game/ui/hud/onboarding_hint.svelte`
- `apps/frontend/client/src/lib/views/game/ui/overlays/pause_menu/pause_menu_view_model.test.ts`
- `apps/frontend/client/src/lib/views/inventory/inventory_presentation.svelte.ts`
- `apps/frontend/client/src/lib/views/inventory/inventory_presentation.test.ts`
- `apps/frontend/client/src/lib/views/inventory/inventory_view.svelte`
- `apps/frontend/client/src/lib/views/inventory/inventory_view_model.svelte.ts`
- `apps/frontend/client/src/lib/views/inventory/inventory_view_model.test.ts`
- `packages/frontend/theme/src/lib/aikami_game_ui.css`
- `packages/shared/constants/src/lib/game/hud_widgets.test.ts`
- `packages/shared/constants/src/lib/game/hud_widgets.ts`

## Risks / follow-ups

- The evidence evaluator scored the contact sheet 85 rather than higher because the 200% and save-confirmation details are visually subtle at montage scale; individual PNGs are the authoritative captures.
- E2E inventory proof uses the production empty state because the production preview intentionally does not expose a state-seeding shortcut. The populated icon path is covered by inventory ViewModel tests and the evidence capture uses the real non-production test seam against the production bundle.
- `PUBLIC_ERUDA_ENABLED` remains a supported development override; it is now intentionally ignored in `import.meta.env.DEV === false` production output.

## Execution report

Implemented C-555 across the existing HUD resolver, theme roles, inventory projection, save regression coverage, production build guard, and E2E/axe coverage. Default exploration now has grouped vitals/guidance, a quiet clock/menu composition, contextual interaction placement, and dialogue-safe widget priority. Inventory uses LPC art with category fallbacks instead of letters. Production builds cannot mount Eruda, and generated-map production screenshots plus labeled evidence sheet are saved under `/tmp/opencode/c555-evidence/`.

**Status:** implemented; ready for independent verification.
