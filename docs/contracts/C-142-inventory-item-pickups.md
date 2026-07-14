<!-- completed: 2026-06-29 -->
<!-- audit: legacy — no execution report -->
# Contract: C-142 Inventory Sync & Item Pickups

## Goal
Wire the existing ECS `Inventory` component to the Svelte 5 frontend, allowing the player to pick up items scattered around the map and view them in a dedicated Inventory UI overlay.

## Tech Stack
- **Framework:** Svelte 5
- **Engine:** Web Worker ECS, Engine Bridge

---

## Task 1: Map Parsing & Item Spawning
**File:** `packages/frontend/engine/src/systems/entity_spawner.ts`
- Extend the `spawnEntities` logic (from C-136) to handle `SpawnPoint` objects with `type === 'item'`.
- Instantiate these entities with a `Position`, `Sprite` (using `lpc_asset_catalog` for item icons), and an `Interactable` component. Add custom properties to define the `itemId` and `quantity`.
- Ensure the Player entity is instantiated with an empty `Inventory` component.

## Task 2: Engine Pickup Logic
**File:** `packages/frontend/engine/src/systems/interaction_system.ts`
- Extend the 'Interact' key logic (from C-141).
- If the closest interactable entity is an `item` (not an `npc`):
  - Add the item's data (ID, quantity) to the Player's `Inventory` component.
  - Destroy the item entity from the ECS world so it disappears from the map.
  - Emit an `INVENTORY_UPDATED` message across the `EngineBridge` containing the updated inventory array.

## Task 3: Svelte Inventory State Sync
**File:** `apps/frontend/client/src/lib/services/game/game_state_service.svelte.ts`
- Add an `inventory: Array<{ itemId: string, quantity: number }>` property to the `$state`.
- Listen for the `INVENTORY_UPDATED` event from the `EngineBridge` and update this array reactively.

## Task 4: Inventory UI Overlay
**Files:** - `apps/frontend/client/src/lib/views/inventory/inventory_view_model.svelte.ts`
- `apps/frontend/client/src/lib/views/game/ui/game_ui_view_model.svelte.ts`
- Wire the Svelte 5 `InventoryViewModel` to read from `GameStateService.inventory`.
- Update `GameUIViewModel` to allow toggling the `inventory_view.svelte` overlay via a keyboard shortcut (e.g., 'I' or 'Tab').
- Ensure that opening the inventory sets the `GameMode` to `MENU` (locking player movement) and closing it restores `EXPLORE`.

## Task 5: Unit & E2E Testing
- **File:** `packages/frontend/engine/src/systems/interaction_system.test.ts`
  - Assert that interacting with an item destroys the entity and mutates the player's inventory component.
- **File:** `apps/e2e/tests/client/inventory_pickup.spec.ts`
  - Create a Playwright sandbox test where the player walks up to an item, presses 'E', opens the inventory ('I'), and visually verifies the item is present in the UI.

## Acceptance Criteria
- [ ] Items placed in Tiled are rendered on the map.
- [ ] Pressing 'E' near an item adds it to the player's inventory and removes it from the map.
- [ ] Pressing 'I' toggles the Inventory overlay and locks movement (GameMode: MENU).
- [ ] The Svelte UI reactively displays the correct items and quantities.
- [ ] Unit and E2E tests pass.
