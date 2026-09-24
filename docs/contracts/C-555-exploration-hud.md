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
| AC-4 | Interaction hint is near the action and does not cover feet. | `INTERACTION_TARGET_CHANGED` now carries target CSS-pixel coordinates from `interaction_proximity_system.ts` / `camera_system.ts`; `InteractionPrompt` anchors above target feet and removes the bottom-centre translate containing block while active. `packages/frontend/engine/src/systems/interaction_proximity_system.ts:95`, `packages/frontend/client/src/lib/views/game/ui/hud/interaction_prompt.svelte:8`, `aikami_game_ui.css:1550`. |
| AC-5 | Dialogue has collision/priority rules. | Optional HUD widgets are withdrawn for `DIALOGUE`; required Menu and system notice stay docked top-end. `apps/frontend/client/src/lib/utils/hud/hud_layout_policy.test.ts:136`; `hud_layout_policy.ts` existing `HUD_HIDDEN_WHILE_BUSY` policy remains the single owner. |
| AC-6 | Customization, presets, and temporary hiding remain available. | No preference schema/service/editor changes. Default preset only changes placement; required-widget coercion and temporary hidden snapshot remain intact. |
| AC-7 | Dev cog is absent from production builds. | Root cause was `app_view_model.svelte.ts` importing Eruda whenever `PUBLIC_MODE=emulator`, even when serving a Vite production bundle. `import.meta.env.DEV` now gates the import. `apps/frontend/client/src/lib/views/app/app_view_model.svelte.ts:202-207`; build guard `apps/frontend/client/scripts/check_no_eruda.ts`, invoked at `build_client.ts:98` and tracked in `moon.yml:118`. Production build scanned 105 text assets and found no `eruda.init`/`loglevel-plugin`. |
| AC-8 | Inventory no longer shows letter monograms. | Existing LPC `LpcItemIcon` is used when `lpcAssetId` resolves; fallback is a category map, never an item-id map: weapon ⚔️, armor 🛡️, consumable 🧪, key 🗝️, misc 📦. `apps/frontend/client/src/lib/utils/inventory_utils.ts:9-18`; inventory projection `inventory_view_model.svelte.ts:70-77,205-217`; markup `inventory_view.svelte:160,198`. |
| AC-9 | Save confirmation and timestamp coexist. | `saveStatusLabel` now returns `Game Saved! · Last saved ...` after a successful manual save, while failures remain visible and `lastSavedAt` continues to come from the real campaign seam. Regression coverage is in `pause_menu_view_model.test.ts` and the production E2E spec. |

## Verification

- Generated Emberwatch portraits/audio/atlas/props/maps/asset seed successfully; `git status` showed no generated tracked diff.
- Client typecheck: passed, 0 errors / 0 warnings.
- Theme, constants, and E2E typechecks: passed.
- C-555 E2E spec: 5 passed, 0 failed, including the new 800×600 dialogue/autosave non-overlap assertion and axe WCAG 2A/AA checks. Auth setup also passed.
- Pause ViewModel focused suite: 8 passed, 0 failed.
- Engine interaction projection suite: 7 passed, 0 failed.
- Client focused tests (HUD policy, inventory ViewModel, pause ViewModel): 48 passed, 0 failed. Full client unit lane: 4102 passed, 0 failed, 7 skipped, 2 todo.
- E2E C-555 spec command: `env -u CI PUBLIC_EMULATOR_PORT_OFFSET=14 bunx playwright test tests/client/exploration_hud.spec.ts --project=client` — 5 passed, 0 failed.
- Client/theme/constants/E2E lint and fix: passed for changed source. The repository's E2E unit lane has 2 inherited environment-sensitive failures in `preflight.test.ts` / `service_map.test.ts` when the ambient offset is present; rerun with `env -u PUBLIC_EMULATOR_PORT_OFFSET` still reports the base branch's port/fallback expectation failures. No C-555 E2E unit files were changed.
- Production build: passed with `PUBLIC_APP_ID=client PUBLIC_MODE=emulator PUBLIC_ASSETS_BASE_URL=http://localhost:8788 bun moon run client:build -- --mode production`; `check-no-eruda` passed, chunk-cycle/deploy-asset/dynamic-import/budget guards passed.
- Empty-map / LPC diagnosis: production map source is the content-pack registry tag `emberwatch:maps:village`, not `static/game-data/maps`. The read-only production snapshot command was attempted but could not authenticate because this worktree has no R2 credentials. Final ignored local origin setup uses the fetched published seed's 12,699 LPC rows plus local Emberwatch candidate overrides; system Chromium WebGL was required because Playwright headless shell selected Canvas2D and produced 1×1 custom-shader tilemap textures. No content source was changed.
- Evidence: `/tmp/opencode/c555-evidence/index.md`, labeled `/tmp/opencode/c555-evidence/sheet.png`, plus eight PNGs. Final VLM evidence check scored 90/100 (pass).

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
- `apps/frontend/client/src/lib/views/game/ui/game_ui_view_model_interface.ts`
- `apps/frontend/client/src/lib/views/game/ui/game_ui_view_model_types.ts`
- `apps/frontend/client/src/lib/views/game/ui/game_ui_view.svelte`
- `apps/frontend/client/src/lib/views/game/ui/hud/interaction_prompt.svelte`
- `apps/frontend/client/src/lib/services/game/bridge_listeners.ts`
- `apps/frontend/client/src/lib/services/game/game_overlay_service.svelte.ts`
- `apps/frontend/client/src/lib/services/game/game_overlay_types.ts`
- `apps/frontend/client/src/lib/services/game/game_test_seam.ts`
- `apps/frontend/client/src/lib/views/game/ui/game_ui_view_model.test.ts`
- `packages/frontend/engine/src/systems/camera_system.ts`
- `packages/frontend/engine/src/systems/interaction_proximity_system.ts`
- `packages/frontend/engine/src/__tests__/interaction_proximity_system.test.ts`
- `packages/frontend/engine/src/types.ts`
- `apps/frontend/client/src/lib/views/game/ui/hud/onboarding_hint.svelte`
- `apps/frontend/client/src/lib/views/game/ui/overlays/pause_menu/pause_menu_view_model.svelte.ts`
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

- The evidence evaluator scored the final contact sheet 95/100; individual PNGs remain authoritative captures.
- Evidence index records the failed credentialed snapshot attempt, ignored local-origin setup, WebGL requirement, and exact map registry path. Final contact sheet labels are visible and VLM validation scored 95/100.
- The evidence origin remains an ignored local setup; no generated map, atlas, manifest, snapshot, or content-pack source is tracked as a C-555 change.
- Final validation: `validate` passed. `env -u CI bun moon ci --base=origin/feat/emberwatch-polish-batch` completed 56 actions but hit the repository's known parallel `tsconfig.test.json` directory-mismatch race in `client:test` / `client:test-unit`; standalone `bun run test:unit` passed 4102/0, and the focused C-555 E2E run passed 5/5.

## Execution report

Implemented C-555 across the existing HUD resolver, theme roles, inventory projection, save regression coverage, production build guard, and E2E/axe coverage. Default exploration now has grouped vitals/guidance, a quiet clock/menu composition, contextual interaction placement, and dialogue-safe widget priority. Inventory uses LPC art with category fallbacks instead of letters. Successful manual saves retain both `Game Saved!` and the latest `Last saved` timestamp. The global autosave snackbar is moved away from the dialogue stage while dialogue is active, with an 800×600 geometric regression assertion. Production builds cannot mount Eruda, and generated-map production screenshots plus labeled evidence sheet are saved under `/tmp/opencode/c555-evidence/`.

**Status:** implemented; ready for independent verification.
