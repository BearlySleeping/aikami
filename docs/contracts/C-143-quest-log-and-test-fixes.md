<!-- completed: 2026-06-29 -->
# Contract: C-143 Quest Log Sync & Technical Debt

## Goal
Resolve the 177 pre-existing unit test failures in the client test suite (primarily `CharacterViewModel`). Once the test suite is 100% green, wire the existing Quest MVP sandbox UI into the main game loop, allowing players to view active quests via a dedicated overlay synced with the ECS engine.

## Tech Stack
- **Framework:** Svelte 5, Vitest
- **Engine:** Web Worker ECS, Engine Bridge

---

## Task 1: Housekeeping - Fix Client Test Suite
**File:** `apps/frontend/client/src/lib/views/character/create/character_view_model.test.ts` (and any other failing suites)
- Investigate and resolve the 177 failing tests.
- *Root Cause Hint:* This is likely due to Svelte 5's `$state` or `$derived` runes being evaluated outside of an active Svelte component context. 
- *Fix Pattern:* Wrap the ViewModel instantiations and reactive assertions inside an `$effect.root(() => { ... })` closure, or use Svelte 5's testing utilities to properly mount the state graph. Ensure all mocks are strictly scoped.
- **Do not proceed to Task 2 until `npm run test` for the client package returns 0 failures.**

## Task 2: Engine Quest Synchronization
**Files:** - `packages/frontend/engine/src/types.ts`
- `packages/frontend/engine/src/worker/ecs_worker.ts`
- Add a new bridge event: `QUESTS_UPDATED`.
- Create a mechanism (or use an existing `Quest` component/system) to emit the `QUESTS_UPDATED` message across the `EngineBridge` whenever a quest is added, progressed, or completed in the ECS. 
- *Note: For this MVP, you can trigger a dummy quest addition inside the `INITIALIZE_ENGINE` or `LOAD_MAP` sequence just so we have data to display.*

## Task 3: Svelte Quest State Sync
**File:** `apps/frontend/client/src/lib/services/game/game_state_service.svelte.ts`
- Add a `quests: Array<QuestData>` property to the `$state`.
- Listen for the `QUESTS_UPDATED` event from the `EngineBridge` and update this array reactively.

## Task 4: Quest UI Overlay
**Files:** - `apps/frontend/client/src/lib/views/quest/quest_view_model.svelte.ts`
- `apps/frontend/client/src/lib/views/game/ui/game_ui_view_model.svelte.ts`
- Wire the Svelte 5 `QuestViewModel` to read its list of active/completed quests from `GameStateService.quests`.
- Update `GameUIViewModel` to allow toggling the `quest_view.svelte` overlay via a keyboard shortcut (e.g., 'Q' or 'J' for Journal).
- Ensure that opening the quest log sets the `GameMode` to `MENU` (locking player movement) and closing it restores `EXPLORE`.

## Task 5: Unit & E2E Testing
- **File:** `apps/frontend/client/src/lib/views/quest/quest_view_model.test.ts`
  - Write unit tests ensuring the ViewModel reactively updates when the `GameStateService` receives new quest data.
- **File:** `apps/e2e/tests/client/quest_log.spec.ts`
  - Create a Playwright sandbox test where the player boots the game, presses 'Q', and visually verifies the Quest UI appears and movement is locked.

## Acceptance Criteria
- [ ] **Critical:** The client unit test suite passes with 0 failures.
- [ ] Pressing 'Q' toggles the Quest overlay and sets the GameMode to MENU.
- [ ] The Quest UI reactively displays the dummy quest dispatched by the engine.
- [ ] New unit tests and E2E tests pass cleanly.
