<!-- completed: 2026-06-29 -->
# Contract: C-145 Turn-Based Combat Loop & Dice RNG

## Goal

Implement the core turn-based combat loop using Dice RNG for hit calculations and damage. Wire the Svelte UI's base combat actions (Attack, Flee) to the ECS engine, calculate outcomes, resolve win/loss conditions, remove defeated enemies, and grant loot to the player's inventory.

## Tech Stack

- **Framework:** Svelte 5
- **Engine:** Web Worker ECS, Engine Bridge
- **Mechanics:** Dice RNG (d20 system)

---

## Task 1: Bridge Combat Commands

**File:** `packages/frontend/engine/src/types.ts` & `ecs_worker.ts`

- Add a new bridge command: `COMBAT_ACTION` with a payload defining the action type: `type: 'ATTACK' | 'FLEE' | 'DEFEND'`.
- Ensure the ECS worker listens for this command and routes it to the `turn_manager_system.ts`.

## Task 2: Dice-Based Combat Math & Turn Resolution

**File:** `packages/frontend/engine/src/systems/turn_manager_system.ts`

- Implement a lightweight RNG utility (e.g., `rollDice(sides: number)`) in the engine.
- When a `COMBAT_ACTION` (Attack) is received:
    - **Hit Check:** Roll `1d20`. If the roll + Player Accuracy >= Enemy Evasion/Defense, it's a hit.
    - **Damage Roll:** Roll weapon damage (e.g., `1d6` + Player Attack stat).
    - Deduct the damage from the Enemy's `CombatStats.hp`.
    - Emit a `COMBAT_LOG` bridge event (e.g., "Player rolls a 14 to hit. Hits for 4 damage!").
- If the Enemy survives, simulate the Enemy's turn using the same `1d20` hit check against the Player's Defense, followed by a damage roll.
    - Emit the Enemy's `COMBAT_LOG`.
- Emit a `COMBAT_STATE_UPDATE` to sync the new HP totals to the frontend.

## Task 3: Win Conditions, Death, and Loot

**File:** `packages/frontend/engine/src/systems/turn_manager_system.ts`

- If `Enemy HP <= 0`:
    - Destroy the enemy entity from the ECS (removing it from the map).
    - Dispatch an `INVENTORY_UPDATED` event granting the player loot (e.g., `itemId: 'slime_jelly', quantity: 1`).
    - Emit `COMBAT_ENDED` with a `victory` flag.
- If `Player HP <= 0`:
    - Emit `COMBAT_ENDED` with a `defeat` flag.

## Task 4: Svelte UI Sync

**File:** `apps/frontend/client/src/lib/views/combat/combat_view_model.svelte.ts`

- Update the `attack()` method to send the `COMBAT_ACTION` command to the engine.
- Listen for `COMBAT_STATE_UPDATE` to reactively update the player and enemy HP bars.
- Listen for `COMBAT_LOG` to populate a scrolling battle log in the UI.
- Listen for `COMBAT_ENDED`. If victorious, show a brief "Victory!" toast/overlay before calling `GameStateService.setMode('EXPLORE')`.

## Task 5: Unit & Sandbox Testing

- **File:** `packages/frontend/engine/src/systems/turn_manager_system.test.ts`
    - Write unit tests ensuring dice rolls properly evaluate hit/miss thresholds, HP doesn't drop below 0, and death properly destroys the entity.
- **File:** `apps/e2e/tests/client/combat_sandbox.spec.ts`
    - Update the Playwright test from C-144.
    - Trigger the encounter, click "Attack" repeatedly until the slime is defeated (accounting for potential misses), and verify the overlay closes and the slime is no longer on the map.

## Acceptance Criteria

- [ ] Clicking "Attack" in the UI sends a command to the engine.
- [ ] Engine uses a d20-style RNG calculation to determine hits and damage.
- [ ] Combat log displays turn-by-turn dice results and damage events.
- [ ] Defeating an enemy destroys its entity and grants loot.
- [ ] Unit and E2E tests pass cleanly.
