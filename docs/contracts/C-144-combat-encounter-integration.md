<!-- completed: 2026-06-29 -->
<!-- audit: legacy — no execution report -->
# Contract: C-144 Combat Encounter Integration

## Goal
Wire the engine's `turn_manager_system` and combat components to the Svelte frontend. Allow the player to collide with an enemy entity on the map to trigger a state transition into a Turn-Based Combat Overlay, locking map movement and routing input to the battle menu.

## Tech Stack
- **Framework:** Svelte 5
- **Engine:** Web Worker ECS, Engine Bridge

---

## Task 1: Define Combat Game Mode & Bridge Events
**File 1:** `apps/frontend/client/src/lib/types/game.ts` (or equivalent mode file)
- Extend the `GameMode` union to include `'COMBAT'`.

**File 2:** `packages/frontend/engine/src/types.ts`
- Add new bridge event types: `COMBAT_STARTED` and `COMBAT_ENDED`.
- Include payload types representing the enemy data (e.g., `enemyId`, `name`, `hp`, `maxHp`).

## Task 2: Engine Encounter Trigger
**File 1:** `packages/frontend/engine/src/systems/entity_spawner.ts`
- Extend `spawnEntities` to support `SpawnPoint` objects with `type === 'enemy'`.
- Give them `Position`, `Sprite`, `CombatStats` (HP, Attack, Defense), and an `Enemy` tag component.

**File 2:** `packages/frontend/engine/src/systems/encounter_system.ts` (New System)
- Create a system that checks for spatial overlap/collision between the Player and any entity with the `Enemy` tag.
- When a collision occurs while the current mode is `EXPLORE`:
  - Halt player velocity.
  - Emit the `COMBAT_STARTED` bridge event with the enemy's stats.
  - Set the engine's internal mode to `COMBAT`.

## Task 3: Svelte Combat Overlay Sync
**File:** `apps/frontend/client/src/lib/views/game/ui/game_ui_view_model.svelte.ts`
- Listen for the `COMBAT_STARTED` event from the `EngineBridge`.
- Upon receiving:
  - Call `GameStateService.setMode('COMBAT')`.
  - Update the active overlay state to mount `combat_view.svelte`.
  - Pass the enemy payload to the `CombatViewModel`.
- Listen for `COMBAT_ENDED`:
  - Dismiss the overlay and restore `GameMode` to `EXPLORE`.

## Task 4: Connect the Combat View Model
**File:** `apps/frontend/client/src/lib/views/combat/combat_view_model.svelte.ts`
- Ensure the ViewModel utilizes `$state` to track the active battle:
  - `isPlayerTurn: boolean`
  - `playerHp: number`, `playerMaxHp: number`
  - `enemyHp: number`, `enemyMaxHp: number`, `enemyName: string`
- Add dummy methods for basic combat actions (e.g., `attack()`, `flee()`) that will eventually post commands back to the engine. For this MVP, `flee()` can immediately emit an instruction to end combat.

## Task 5: Isolated Combat Sandbox
**Files:** - `apps/frontend/client/src/routes/dev/sandbox/combat/+page.svelte`
- `apps/frontend/client/src/routes/dev/sandbox/combat/combat_sandbox_view_model.svelte.ts`
- Create a dedicated dev route to test the transition.
- Spawn the player and a stationary enemy (`type: 'enemy'`) in a small room.
- *Verification Goal:* Walking into the enemy locks movement and visually brings up the `combat_view.svelte` overlay.

## Acceptance Criteria
- [ ] `GameMode` successfully supports `COMBAT`.
- [ ] Bumping into an enemy entity on the map triggers the `COMBAT_STARTED` event.
- [ ] The `GameUIViewModel` safely catches the event, mounts the Combat UI, and locks background movement.
- [ ] The isolated `/dev/sandbox/combat` route loads and successfully tests the encounter trigger.
