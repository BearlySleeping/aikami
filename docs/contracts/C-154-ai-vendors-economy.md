<!-- completed: 2026-06-29 -->
<!-- audit: legacy — no execution report -->
## Metadata

| Field | Value |
|---|---|
| **Source** | Roadmap Phase 2: World Depth & Economy |
| **Target** | `apps/frontend/client/src/lib/views/vendor/` and engine interaction |
| **Priority** | P1 — Introduces economy and AI roleplay utility |
| **Dependencies** | C-142, C-149, C-153 |
| **Status** | **completed** |
| **Contract version** | 1.0.0 |

## Overview

This contract introduces the World Economy by adding Gold and AI-driven Vendors. Players will be able to interact with specific NPC vendors, open a dual-pane Trading/Dialogue UI, and buy items. Leveraging our structured LLM extraction, players can type freeform dialogue to haggle, persuade, or intimidate the vendor into adjusting their price multipliers.

## Design Reference

Follow the `CombatViewModel` and `DialogueOverlayViewModel` patterns for LLM extraction and streaming. Follow the `InventoryView` for item grid rendering. 

## Architecture Directives

- **Engine Data:** Add a `Vendor` tag/component or simply extend `NPCDialog` to include an `isVendor: boolean` and `vendorInventory: string[]` field. Tiled map spawn points need to be able to set this.
- **State Service:** Ensure `GameStateService` tracks `gold` (number) and has methods for `addGold` and `removeGold`. 
- **Vendor UI Overlay:** A new `VendorView` (and ViewModel). It should act as a split-screen: left side shows the AI Chat (reusing DaisyUI chat bubbles), right side shows the vendor's item stock and the player's current gold.
- **AI Haggling:** Create a `vendor_action_schema.ts` with fields for `priceMultiplier` (number, default 1.0, ranges from 0.5 to 1.5 based on haggle success), `narrative`, and `refusesToSell` (boolean, if the player makes them too angry).
- **Transaction Flow:** When a player clicks "Buy" on an item, calculate the final price (Base Price * current `priceMultiplier`). Check player gold, deduct gold, add item to player inventory, and play the pickup SFX.

## State & Data Models

    // Conceptual additions to GameStateService / UI Models
    export interface VendorItem {
        itemId: string;
        basePrice: number;
    }

    // Schema for LLM extraction
    const VendorActionSchema = Type.Object({
        narrative: Type.String(),
        priceMultiplier: Type.Number(),
        refusesToSell: Type.Boolean()
    });

## Acceptance Criteria

### AC-1: Vendor Interaction
**Given** the player is near a vendor NPC
**When** they press 'E' to interact
**Then** the engine emits the interaction event, the game enters `MENU` or `DIALOGUE` mode, and the `VendorView` overlay opens.

### AC-2: Standard Transaction
**Given** the player is in the Vendor UI and has enough gold
**When** the player clicks "Buy" on an item
**Then** the item is added to the player's inventory, the gold is deducted, and a success sound plays.

### AC-3: AI Haggling
**Given** the player types a message attempting to haggle (e.g., "I saved your town, give me a discount!")
**When** the AI resolves the structured extraction
**Then** the `priceMultiplier` adjusts (e.g., to 0.8), updating the UI prices, and the AI's response is appended to the chat.

### AC-4: Insufficient Funds & Rejection
**Given** the player attempts to buy an item they cannot afford OR the AI `refusesToSell` due to intimidation failing
**When** the buy action triggers
**Then** the transaction is blocked, no gold is taken, and an error/warning message is displayed in the UI.

**Test Hooks**:
- Unit: Test `VendorViewModel` calculation of `finalPrice` based on the AI's multiplier.
- Integration: Mock the LLM text generation to verify the multiplier correctly updates the state.
- CI: Standard build and lint.

**Watch Points**:
- **Float Math:** Watch out for floating-point issues when multiplying base prices. Use `Math.round()` or `Math.floor()` for final gold costs.
- **Full Inventory:** Ensure the player cannot buy an item if their inventory is full (handle similarly to pickup).

## Implementation Notes

1. **Files to create**:
    - `apps/frontend/client/src/lib/views/vendor/vendor_view.svelte`
    - `apps/frontend/client/src/lib/views/vendor/vendor_view_model.svelte.ts`
    - `apps/frontend/client/src/lib/game/core/ai/prompts/vendor_action_schema.ts`
2. **Files to modify**:
    - `packages/frontend/engine/src/components/npc_dialog.ts` (or create new `vendor.ts`)
    - `packages/frontend/engine/src/systems/entity_spawner.ts` (parse vendor fields from Tiled properties)
    - `apps/frontend/client/src/lib/services/game/game_state_service.svelte.ts` (add gold state if missing)
    - `apps/frontend/client/src/lib/views/game/ui/game_ui_view_model.svelte.ts` (handle vendor overlay routing)
3. **Order of operations**:
    - Add `gold` to `GameStateService`.
    - Update ECS Spawner and Components to recognize Vendors.
    - Build the `VendorViewModel` and `VendorActionSchema`.
    - Build the `VendorView` UI.
    - Wire it all together in `GameUIViewModel`.

## Edge Cases & Gotchas

- **Shared State:** The `priceMultiplier` should reset to `1.0` when the player closes the vendor interface, so they don't keep a permanent 50% discount on subsequent visits unless explicitly desired by design (for MVP, reset it on close).
- **Price Gouging:** If the player is rude, the AI can set the multiplier to > 1.0 (e.g., 1.5x price). Ensure the UI clearly reflects that they are being penalized!
