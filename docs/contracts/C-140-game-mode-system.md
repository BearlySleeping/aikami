# Contract: C-140 Game Mode System & Input Routing

## Goal
Implement a centralized Game Mode state machine (`EXPLORE`, `DIALOGUE`, `MENU`) to strictly route keyboard/pointer inputs. Create an isolated `/dev/sandbox/mode` route to verify that transitioning out of `EXPLORE` successfully locks player movement in the ECS engine while activating the appropriate Svelte 5 UI overlays.

## Tech Stack
- **Framework:** Svelte 5 (Runes: `$state`, `$effect`)
- **Engine:** Web Worker ECS, Engine Bridge Messaging
- **Routing:** SvelteKit (`/dev/sandbox/mode`)

---

## Task 1: Define Game Modes & State
**File:** `apps/frontend/client/src/lib/types/game.ts`
- Export a new enum or union type: `export type GameMode = 'EXPLORE' | 'DIALOGUE' | 'MENU';`

**File:** `apps/frontend/client/src/lib/services/game/game_state_service.svelte.ts`
- Add a new state property: `currentMode: GameMode = 'EXPLORE'`.
- Add a method: `setMode(mode: GameMode)` that updates this state and broadcasts the change to the ECS worker via `EngineBridge`.

## Task 2: Engine Integration (Input Locking)
**File:** `packages/frontend/engine/src/engine_bridge.ts` & `ecs_worker.ts`
- Add a new message type: `SET_GAME_MODE`.
- When the worker receives this message, store the mode in a globally accessible engine state (e.g., inside `GameWorld` or a `GameState` ECS component).

**File:** `packages/frontend/engine/src/systems/movement_system.ts` (or `input_system.ts`)
- Wrap the player movement logic in a conditional check. If the engine's current mode is **not** `EXPLORE`, ignore all movement input vectors (force velocity to 0).

## Task 3: UI Reactivity & Mode Indicator
**File:** `apps/frontend/client/src/lib/components/mode_indicator.svelte`
- Inject `GameStateService`.
- Build a small, non-intrusive floating badge (top-right or top-left) that displays the `currentMode`. Use Svelte 5 `$derived` to change its color based on the mode (e.g., Green for EXPLORE, Blue for DIALOGUE, Gray for MENU).

**File:** `apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay.svelte`
- Ensure this overlay only mounts, or its input field only gains `autofocus`, when `GameStateService.currentMode === 'DIALOGUE'`.

## Task 4: Isolated Dev Sandbox
**Files:**
- `apps/frontend/client/src/routes/dev/sandbox/mode/+page.svelte`
- `apps/frontend/client/src/routes/dev/sandbox/mode/mode_sandbox_view_model.svelte.ts`
- Create an isolated testing environment.
- Mount the `game_canvas.svelte` and load a dummy map with the player.
- Add a floating UI panel with 3 buttons: [Set EXPLORE], [Set DIALOGUE], [Set MENU].
- Clicking these buttons calls `GameStateService.setMode()`.
- *Verification Goal:* When the user clicks "Set DIALOGUE", pressing WASD or Arrow Keys must *not* move the character on the canvas.

## Task 5: Unit & E2E Testing
- **File:** `apps/frontend/client/src/lib/services/game/game_state_service.test.ts`
  - Assert `setMode` correctly changes state and fires the bridge message.
- **File:** `apps/e2e/tests/client/mode_sandbox.spec.ts`
  - Write a Playwright test that loads `/dev/sandbox/mode`.
  - Assert the mode indicator shows `EXPLORE`.
  - Click "Set DIALOGUE", trigger a keyboard 'W' press, and visually assert (or check coordinates) that the player did not move.

## Acceptance Criteria
- [ ] `GameMode` state is successfully tracked and rendered in `mode_indicator.svelte`.
- [ ] Changing modes transmits state to the Web Worker.
- [ ] Player movement is strictly disabled when not in `EXPLORE` mode.
- [ ] The `/dev/sandbox/mode` route exists and allows manual toggling of states.
- [ ] Unit and Playwright E2E tests pass.
