<!-- completed: 2026-06-29 -->
## Metadata

| Field | Value |
|---|---|
| **Source** | Roadmap Phase 1: The Player Journey |
| **Target** | `apps/frontend/client/src/lib/views/` and `apps/frontend/client/src/lib/services/` |
| **Priority** | P1 — Core RPG progression and player feedback |
| **Dependencies** | C-152 |
| **Status** | **completed** |
| **Contract version** | 1.0.0 |

## Overview

This contract introduces the Character Dashboard (Character Sheet) and the Equipment System. Players need a way to view their progression (Level, XP, HP, Attack, Defense) and actively engage with the loot they find by equipping it. This bridges the gap between the UI inventory state and the engine's ECS `CombatStats`.

## Design Reference

We will build a new Svelte overlay component (similar to the Quest and Inventory screens) toggled via a hotkey. The Inventory UI will be expanded to support an "Equipped" slot, communicating changes down to the game engine.

## Architecture Directives

- **Input Binding:** Map the 'C' key in the input manager to toggle the Character Dashboard UI overlay.
- **Character Dashboard UI:** Create a Svelte component that subscribes to the `GameStateService` (or relevant stores) to display the player's current Level, Current/Max HP, XP (and XP required for next level), Attack, and Defense.
- **Equipment UI:** Add a sub-panel or designated slots within the existing Inventory UI for "Equipped Weapon" and "Equipped Armor".
- **Equip Action:** Allow players to select a weapon/armor piece from their bag and "Equip" it. This should move the item to the equipped slot.
- **ECS Synchronization:** When an item is equipped or unequipped, trigger an event or engine call to dynamically update the player entity's `CombatStats` component (e.g., adding +5 Attack when a sword is equipped).

## State & Data Models

- **GameStateService Updates:** Introduce fields to track currently equipped items (e.g., `equippedWeapon`, `equippedArmor`). 
- **Item Schema Update (if needed):** Ensure items have properties defining their stat bonuses (e.g., `attackBonus: number`, `defenseBonus: number`).

## Acceptance Criteria

### AC-1: Dashboard Toggle
**Given** the player is in the active game world
**When** the user presses the 'C' key
**Then** the Character Dashboard overlay toggles open and closed.

### AC-2: Stat Visualization
**Given** the Character Dashboard is open
**When** viewing the panel
**Then** the player's current Level, XP, HP, Attack, and Defense are accurately displayed and reflect their engine-side ECS stats.

### AC-3: Equipping Items
**Given** the player has an equippable weapon in their inventory
**When** the player interacts with the weapon and chooses to "Equip" it
**Then** the weapon moves to the active Equipment slot, and the player entity's `CombatStats.attack` is increased by the weapon's `attackBonus`.

### AC-4: Unequipping Items
**Given** the player has an equipped weapon
**When** the player chooses to "Unequip" it
**Then** the weapon returns to the standard inventory, and the player entity's `CombatStats.attack` is decreased by the weapon's `attackBonus`.

**Test Hooks**:
- Unit: Verify `GameStateService` correctly handles moving items between inventory and equipment slots, and calculates total stats correctly.
- Integration: Ensure equipping an item correctly dispatches the stat update to the engine's ECS.

**Watch Points**:
- Be careful with stat recalculation. Instead of permanently modifying the base stat, consider calculating total stats as `Base Stat + Equipped Bonuses` to avoid stats permanently inflating due to rounding or unequip bugs.

## Implementation Notes

1. **Files to create/modify**:
    - `apps/frontend/client/src/lib/views/game/dashboard/character_dashboard.svelte` (New component)
    - `apps/frontend/client/src/lib/views/game/inventory/inventory_view.svelte` (Update for equip actions)
    - `apps/frontend/client/src/lib/services/game/game_state_service.svelte.ts` (Add equipment tracking and stat calculation getters)
    - Game engine bridge to update the ECS player entity.
2. **Stat Math:** Keep the math simple for the MVP. Total Attack = Base Attack (from level) + Weapon Attack.
