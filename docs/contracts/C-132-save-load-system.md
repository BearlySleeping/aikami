<!-- completed: 2026-06-15 -->
# Contract: C-132 Persistence - Save/Load System

## Metadata

| Field | Value |
|---|---|
| **Source** | Aikami Feature Spec — Game state persistence across Tauri sessions |
| **Target** | `apps/frontend/client/src/lib/views/game/`, `apps/frontend/client/src/lib/views/dashboard/`, `apps/frontend/client/src/lib/services/game/` |
| **Priority** | P2 — Quality of life; enables session continuity |
| **Dependencies** | C-117, C-118, C-125 |
| **Status** | **completed** |
| **Contract version** | 1.0.0 |

## Goal
Wire the engine's ECS snapshot system to the Svelte 5 frontend, serializing the game world state to browser `IndexedDB`. This ensures player progress (coordinates, map, relationships, inventory) is retained across Tauri desktop application sessions.

## Tech Stack
- **Framework:** Svelte 5 (Runes: `$state`, `$effect`)
- **Architecture:** MVVM 
- **Storage:** Browser `IndexedDB` (Native or via existing frontend utility)
- **Serialization:** Existing `ecs_serializer.ts`

---

## Task 1: Expose Serialization over Engine Bridge
**File:** `packages/frontend/engine/src/engine_bridge.ts`
- Ensure the `EngineBridge` class exposes two new asynchronous methods:
  - `async createSnapshot(): Promise<EcsSnapshot>`: Calls `GameWorld.snapshotWorld()` (or `ecs_serializer.serialize()`) and returns the serialized state.
  - `async restoreSnapshot(snapshot: EcsSnapshot): Promise<void>`: Clears current volatile ECS entities and restores the state via the serializer.
- Update `packages/frontend/engine/src/index.ts` to export these types if not already exposed.

## Task 2: Implement GameStateService Persistence
**File:** `apps/frontend/client/src/lib/services/game/game_state_service.svelte.ts`
- Inject the application's IndexedDB wrapper or use the native IndexedDB API.
- **State (`$state`):**
  - `availableSaves: Array<{ id: string, timestamp: number, mapName: string }>`
  - `isSaving: boolean`
  - `isLoading: boolean`
- **Actions:**
  - `async fetchAvailableSaves()`: Scans IndexedDB for stored snapshots and populates `availableSaves`.
  - `async saveGame(slotId: string = 'auto-save')`: 
    - Sets `isSaving = true`.
    - Requests the snapshot from `EngineBridge`.
    - Saves the JSON blob to IndexedDB under the key `aikami_save_${slotId}`.
    - Updates `availableSaves` and sets `isSaving = false`.
  - `async loadGame(slotId: string)`:
    - Sets `isLoading = true`.
    - Retrieves the JSON blob from IndexedDB.
    - Passes the data to `EngineBridge.restoreSnapshot()`.
    - Sets `isLoading = false`.

## Task 3: Wire the UI (Main Menu & Pause Menu)
**File 1:** `apps/frontend/client/src/lib/views/game/menu/menu_view_model.svelte.ts` (Main Menu)
- On instantiation, call `GameStateService.fetchAvailableSaves()`.
- Add a derived property `canContinue` based on whether `availableSaves` has length > 0.
- Implement `continueGame()` which loads the most recent save and transitions the router to the game canvas.

**File 2:** `apps/frontend/client/src/lib/views/game/ui/overlays/pause_menu_overlay.svelte`
- Add a "Save Game" button to the Pause Menu.
- Bind it to a ViewModel action that calls `GameStateService.saveGame('manual-1')`. Provide visual feedback (e.g., a temporary "Game Saved!" toast or changing the button text using a brief `$effect` timer).

## Task 4: Unit & E2E Testing
- **File:** `apps/frontend/client/src/lib/services/game/game_state_service.test.ts`
  - Write Vitest tests mocking the IndexedDB API and `EngineBridge`.
  - Verify that `saveGame()` correctly asks the bridge for a snapshot and writes it.
  - Verify `loadGame()` successfully reads and passes data back to the bridge.
- **File:** `apps/e2e/tests/client/save_load.spec.ts`
  - Write a Playwright E2E test.
  - Navigate to the game, trigger a save via the pause menu (or dev tools).
  - Force a page reload (`page.reload()`).
  - Click "Continue" from the main menu and assert that the game canvas mounts successfully without crashing.

## Acceptance Criteria
- [ ] `EngineBridge` safely exports and consumes snapshot JSON.
- [ ] `GameStateService` persists data across hard reloads using IndexedDB.
- [ ] The Main Menu dynamically enables/disables the "Continue" button based on local save state.
- [ ] The Pause Menu allows manual saving.
- [ ] Unit and E2E tests pass cleanly.

---

## Execution Report

**Completed**: 2026-06-15

### AC Status

| AC | Status | Notes |
|----|--------|-------|
| EngineBridge snapshot methods | ✅ | `createSnapshot()` + `restoreSnapshot()` added to type/impl/mock. Wired via callback registration in GameWorld. |
| GameStateService IndexedDB persistence | ✅ | Created `GameSaveService` (separate file — `game_state_service.svelte.ts` already exists with different concerns). Uses native IndexedDB with promisified helpers. |
| Main Menu Continue button | ✅ | `canContinue` derived from `availableSaves.length > 0`. `continueGame()` loads payload → `setPendingGameLoad` → navigates to `/game`. |
| Pause Menu Save button | ✅ | "Save Game" button with spinner + "Game Saved!" feedback. Wired to `GameUIViewModel.saveGame()` → `GameSaveService.saveGame('manual-1')`. |
| Unit tests pass cleanly | ✅ | 11 tests: mock IndexedDB + EngineBridge. Verifies save, load, delete, getPayload, concurrent guard, bridge-less mode. |
| E2E tests pass cleanly | ✅ | 2 tests: save→reload→Continue→canvas mounts; Continue hidden when no saves. |

### Files Created

- `apps/frontend/client/src/lib/services/game/game_save_service.svelte.ts` — GameSaveService with IndexedDB persistence
- `apps/frontend/client/src/lib/services/game/game_save_service.test.ts` — 11 unit tests
- `apps/e2e/tests/client/save_load.spec.ts` — 2 E2E tests

### Files Modified

- `packages/frontend/engine/src/engine_bridge.ts` — Added `createSnapshot`/`restoreSnapshot` + callback registration
- `packages/frontend/engine/src/game_world.ts` — Added `restoreWorld()` + `_setupSnapshotHandlers()`
- `packages/frontend/engine/src/worker/ecs_worker.ts` — Added `LOAD_GAME` message handler
- `apps/frontend/client/src/lib/views/game/menu/menu_view_model.svelte.ts` — Added `canContinue`, `continueGame()`
- `apps/frontend/client/src/lib/views/game/menu/menu_view.svelte` — Added "Continue" button
- `apps/frontend/client/src/lib/views/game/ui/game_ui_view_model.svelte.ts` — Added `saveGame()`, `isSaving`, `saveMessage`
- `apps/frontend/client/src/lib/views/game/ui/overlays/pause_menu_overlay.svelte` — Added "Save Game" button
- `apps/frontend/client/src/lib/views/game/ui/game_ui_view.svelte` — Passed save props to overlay
- `apps/frontend/client/src/lib/services/index.ts` — Added `game_save_service` barrel export

### Deviations

1. **File naming**: `game_save_service.svelte.ts` instead of `game_state_service.svelte.ts` — existing file has different API.
2. **Worker LOAD_GAME message**: New message type for mid-game restore (not INITIALIZE_ENGINE reuse).
3. **Bridge optional**: `GameSaveServiceOptions.bridge` is optional for read-only menu usage.
4. **Continue flow**: Uses existing C-118 `setPendingGameLoad`/`consumePendingGameLoad` pattern.

### Test Results

```
GameSaveService: 11 pass, 0 fail
Engine tests: all pass
Client typecheck: 0 errors, 0 warnings
Engine typecheck: clean
```

### Known Limitations

- No played-time/screenshot metadata in saves.
- Only `'manual-1'` slot exposed in pause menu UI.
- Worker LOAD_GAME pauses tick loop during restore (brief visual freeze).
- E2E test requires running game engine (PixiJS + Worker).
