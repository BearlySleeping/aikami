<!-- completed: 2026-06-29 -->
<!-- audit: legacy — no execution report -->
# Contract: C-147 Progression, Game Over, and Persistence

## Goal
Implement the consequences of combat. Route a player's defeat to a "Game Over" screen, award Experience Points (XP) and Level Ups upon victory, and ensure defeated enemies are persistently recorded so they do not respawn when transitioning back and forth between maps.

## Tech Stack
- **Framework:** Svelte 5
- **Engine:** Web Worker ECS, Engine Bridge

---

## Task 1: Experience & Leveling
**File:** `packages/frontend/engine/src/components/combat_stats.ts`
- Extend the player's `CombatStats` (or create a new `Progression` component) to include `xp`, `level`, and `xpToNextLevel`.

**File:** `packages/frontend/engine/src/systems/turn_manager_system.ts`
- Upon enemy defeat, grant a predetermined amount of XP to the player.
- If `xp >= xpToNextLevel`, trigger a level up: increase `maxHp`, fully restore `hp`, increase base attack/defense, and scale `xpToNextLevel`.
- Emit a `PLAYER_LEVELED_UP` bridge event to notify the UI.

## Task 2: Enemy Persistence
**File:** `apps/frontend/client/src/lib/services/game/game_state_service.svelte.ts`
- Add a `$state` array or set called `defeatedEnemies: string[]` to track the unique IDs of dead enemies.
- When listening to `COMBAT_ENDED` with a victory flag, push the `enemyId` to this list.

**File:** `packages/frontend/engine/src/game_world.ts` & `entity_spawner.ts`
- Update the map loading sequence so that when the Svelte frontend calls `loadMap`, it passes the `defeatedEnemies` array to the engine.
- In the `EntitySpawner`, ignore any `SpawnPoint` where `type === 'enemy'` and the ID exists in the `defeatedEnemies` array.

## Task 3: Game Over Routing
**File:** `apps/frontend/client/src/lib/views/game/ui/game_ui_view_model.svelte.ts`
- When `COMBAT_ENDED` is received with a `defeat` flag, change the game mode to `MENU` and mount a new `game_over_overlay.svelte`.
- Build `game_over_overlay.svelte` with a simple "You Died" message and a button to "Respawn" or "Load Last Save".

## Task 4: Unit & E2E Testing
- **File:** `packages/frontend/engine/src/systems/turn_manager_system.test.ts`
  - Add tests verifying that XP is awarded and level-up math triggers correctly.
- **File:** `apps/e2e/tests/client/progression_persistence.spec.ts`
  - Write an E2E test verifying that a defeated enemy on Map A does not respawn after the player transitions to Map B and back to Map A.

## Acceptance Criteria
- [ ] Players earn XP from victories and can level up, restoring HP and increasing stats.
- [ ] Defeated enemies are tracked in Svelte state and filtered out during map loads.
- [ ] Player defeat triggers a Game Over UI overlay.
- [ ] Unit and E2E tests pass cleanly.
