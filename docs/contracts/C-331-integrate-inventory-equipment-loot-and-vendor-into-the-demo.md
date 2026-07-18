# Contract C-331: Integrate Inventory, Equipment, Loot, and Vendor into the Demo Loop

## Metadata

| Field | Value |
|---|---|
| **Source** | docs/TODO.md § C-331 — Phase 1 — Playable, Polished, Offline-Capable Vertical Slice |
| **Target** | `apps/frontend/client/src/lib/services/game/` (inventory/equipment/vendor/world-state services), `apps/frontend/client/src/lib/views/{inventory,vendor}/`, `packages/frontend/engine/src/systems/{interaction_system,turn_manager_system}.ts`, `packages/shared/schemas/src/lib/{database/item,game/content_pack}.ts`, `apps/frontend/client/static/content-packs/emberwatch/manifest.json`, `apps/e2e/` |
| **Priority** | P0 — existing inventory/economy systems need one coherent use in the adventure |
| **Dependencies** | C-153, C-154, C-163, C-142 (all completed, legacy); C-316 (verified); C-314, C-321, C-326, C-328 (implemented); C-329, C-330 (**approved but not yet implemented — risk, see Open Questions resolution in Scope Boundaries**) |
| **Status** | approved |
| **Promotion** | `integrated` — inventory, vendor, and character-dashboard overlays are already mounted on the production `/game` journey (`game_ui_view.svelte`); this contract hardens them in place. Dev sandboxes `/dev/inventory` and `/dev/vendor` are updated alongside. |
| **Docs Impact** | internal → none (player-facing HUD/controls documentation lands with C-332) |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: All the pieces of an item economy exist but they are not one coherent, persistent system:
  1. **Hardcoded item catalog** — `apps/frontend/client/src/lib/services/game/inventory_service.svelte.ts` defines `ITEM_CATALOG` as a hardcoded `Record<string, ItemDefinition>`; the Emberwatch content pack's `items` section (`static/content-packs/emberwatch/manifest.json`) is never consulted at runtime. Vendor prices are a second hardcoded map (`VENDOR_ITEM_BASE_PRICES` in `vendor_service.svelte.ts`); the content-pack item schema has **no price field at all**.
  2. **No persistence** — `inventoryService` (items + gold), `equipmentService` (slots), and collected-pickup tracking never call `registerSerializable(...)` (`serializable_service.ts` registry contains only `gameState`, `combat`, `time`, `quest`). The ECS snapshot persists only `Position`, `Appearance`, `CombatStats` (`packages/frontend/engine/src/serialization/ecs_serializer.ts` `PERSISTENT_COMPONENTS`). After reload: gold resets to 100, inventory and equipment are empty, and map item entities respawn → duplicate pickups.
  3. **Two divergent equip paths** — `inventory_view_model.svelte.ts` `equipItem()` mutates `equippedWeapon/equippedArmor` directly via an `as unknown as` cast, skipping `equipmentService.equipItem()` entirely: the item is never removed from inventory, the previously equipped item is never returned, and no `UPDATE_PLAYER_APPEARANCE` bridge command is sent (the command exists in `packages/frontend/engine/src/types.ts` for exactly this purpose per C-163, but nothing in the client sends it).
  4. **Placeholder combat loot** — `turn_manager_system.ts` `_handleEnemyDefeated()` emits `INVENTORY_UPDATED` with a fabricated `loot_${enemyId}` item that **replaces** the entire frontend inventory array (the service does `this.inventory = event.inventory`). The content-pack `encounters[].loot` table (wardShard 100%, healthPotion 50%) is never applied.
  5. **Lossy pickup events** — `interaction_system.ts` stores every picked-up item as generic id `1` in the ECS `Inventory` component and then emits an `INVENTORY_UPDATED` payload where **every filled slot reuses the just-picked-up item's string id** — picking up two different items reports both as the latest one, and the frontend's replace-semantics wipe vendor purchases and quest rewards.
  6. **No sell flow** — `vendor_service.svelte.ts` supports buy + AI haggle only (`refusesToSell` is the vendor refusing service, not a player sell feature).
  7. **No consumable use** — nothing consumes `healthPotion`/`manaPotion`; no heal path exists out of combat (`player_state_service.svelte.ts` only mirrors HP from engine events).
  8. **No AI-readable inventory summary** — `npc_dialogue_service.svelte.ts` `generateTurn()` accepts `gameStateFacts` but production callers pass none; NPC dialogue AI never sees the player's items, gold, or equipment.
  9. **Manifest data gaps** — Emberwatch `lost_pendant` quest rewards `steelSword`, which is absent from the manifest `items` record; `wardPendant`/`wardAmulet` declare `equipmentSlot: "neck"` but the shared `EquipmentSlotSchema` (`packages/shared/schemas/src/lib/database/item.ts`) only allows `weapon | armor`; `ContentPackItemEntry` and `ItemDefinition` are two divergent shapes.
  10. **No capacity/stack rules frontend-side** — engine caps at `MAX_INVENTORY_SLOTS = 24` (`packages/frontend/engine/src/components/inventory.ts`) and silently drops overflow; the frontend service has no cap and no "inventory full" feedback.
- **Reproduction**: Start an Emberwatch campaign on `/game` → buy `ironSword` from Keth → equip it in the inventory overlay (item stays in the list — path 3) → save via pause menu → reload the campaign → gold is 100, inventory is empty, sword unequipped. Defeat the shade → inventory becomes `[loot_<eid>]` (path 4).
- **Existing implementation to reuse**: See Existing System & Reuse Map below — pickup/interaction ECS systems, overlay router + keyboard flow, buy/haggle vendor UI, quest reward idempotency (`quest_state_service.svelte.ts` `_deliverRewards`, `rewardsGranted` flag), `defeatedEnemies` respawn-suppression pattern (`world_state_service.svelte.ts`), Turso save pipeline (`game_save_service.svelte.ts` + `serializable_service.ts`).
- **Known gaps**: Everything listed under Current behavior; no gamepad flow (deferred to C-346).
- **Baseline tests** (run before starting):
  - `packages/frontend/engine/src/__tests__/economy.test.ts` — ECS Inventory/Wallet observers
  - `packages/frontend/engine/src/systems/interaction_system.test.ts` — pickup → `INVENTORY_UPDATED`
  - `packages/frontend/engine/src/__tests__/turn_manager.test.ts` — loot emit on victory
  - `apps/frontend/client/src/lib/views/vendor/vendor_view_model.test.ts` — vendor VM
  - `apps/frontend/client/src/lib/services/game/quest_state_service.test.ts` — reward delivery idempotency
  - `apps/e2e/tests/client/inventory_pickup.spec.ts` — overlay open/close/focus
  - `apps/e2e/src/visual/suites/inventory.visual.ts` — inventory visual suite

## User Outcome

After this contract, a player in the Emberwatch demo can pick up the Ward Pendant on the Old Road, buy an Iron Sword and potions from Keth (and sell unwanted loot back), equip the sword with an immediate attack-stat change, visible stat compare, and sprite update, drink a Health Potion to heal, defeat the shrine Shade and receive its authored loot exactly once, and reload the campaign with inventory, gold, equipment, derived stats, and appearance all intact — while NPC dialogue AI accurately references what the player owns.

## Success Measures

- **Time/latency target**: All inventory/equipment/vendor transactions are synchronous local state updates — under 16 ms (one frame); no network calls in the transaction path. Catalog hydration from the content pack adds no measurable boot cost (pack is already loaded by the composition root).
- **Offline/degraded behavior**: Buy, sell, equip, unequip, consume, loot, and persistence are fully deterministic and work with zero AI/network. AI haggling degrades to authored vendor fallback lines (content-pack dialogue keys) instead of the current bare `'...'`; prices stay at the deterministic base value.
- **Production journey enabled**: The complete Phase 1 economy loop on `/game`: pick up → stack → buy/sell → equip → consume → quest/combat loot → save → reload with consistent state across ECS, UI, and AI context.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| ECS pickup + interaction | `packages/frontend/engine/src/systems/interaction_system.ts` | **Modify** — emit per-item `ITEM_PICKED_UP` delta (event exists, C-329) with real itemId + quantity + spawnId; stop emitting lossy full-array `INVENTORY_UPDATED` |
| ECS combat loot emit | `packages/frontend/engine/src/systems/turn_manager_system.ts` `_handleEnemyDefeated` | **Modify** — remove `loot_${enemyId}` placeholder; loot resolution moves to the client (content-pack owner) keyed off `COMBAT_ENDED`/`ENCOUNTER_COMPLETED` |
| Item spawn from maps | `packages/frontend/engine/src/systems/entity_spawner.ts` (`item_pickup` spawn points, e.g. `wardPendant` on `old_road.json`) | **Modify** — skip spawning items whose spawnId is in the collected list (mirror `defeatedEnemies` handling) |
| Inventory state + gold | `apps/frontend/client/src/lib/services/game/inventory_service.svelte.ts` | **Modify** — content-pack catalog, capacity/stack rules, `removeItem`, `useConsumable`, serialization |
| Equipment slots + derived stats | `apps/frontend/client/src/lib/services/game/equipment_service.svelte.ts` | **Modify** — keep as the single equip path; add serialization + `UPDATE_PLAYER_APPEARANCE` emit |
| Vendor buy + AI haggle | `apps/frontend/client/src/lib/services/game/vendor_service.svelte.ts` | **Modify** — content-pack pricing, sell flow, authored fallback lines, transaction hardening |
| Inventory overlay UI | `apps/frontend/client/src/lib/views/inventory/` | **Modify** — route equip through `equipmentService`, add use/sell affordances + stat compare |
| Vendor overlay UI | `apps/frontend/client/src/lib/views/vendor/` | **Modify** — add Sell tab/section with confirmation |
| Overlay router + keyboard flow | `apps/frontend/client/src/lib/services/game/game_overlay_service.svelte.ts` (`open_inventory`, Escape close, MENU/EXPLORE mode switch) | **Reuse** — no changes to open/close/input-capture semantics |
| Quest reward delivery (idempotent) | `apps/frontend/client/src/lib/services/game/quest_state_service.svelte.ts` `_deliverRewards` + `rewardsGranted` (C-329) | **Reuse** — rewards land via `inventoryService.addItem`/`addGold`; benefits from capacity + persistence automatically |
| Respawn suppression pattern | `apps/frontend/client/src/lib/services/game/world_state_service.svelte.ts` `defeatedEnemies` | **Reuse pattern** — add `collectedPickups` (spawn IDs) with the same load-map threading |
| Save/load pipeline | `game_save_service.svelte.ts` + `serializable_service.ts` registry (C-321) | **Reuse** — register inventory/equipment/collected-pickups snapshots; no schema change to the save envelope |
| Content pack loader + provider wiring | `game_composition_root.svelte.ts` Phase 5c (`loadContentPack`, `npcDialogueService.configure`) | **Modify** — expose `getItem`/`getAllItems`/`getEncounter().loot` to services; add `gameStateFacts` provider |
| NPC dialogue context projection | `npc_dialogue_service.svelte.ts` `buildContext`/`generateTurn` (`gameStateFacts` param exists) | **Reuse** — pass compact inventory summary from the dialogue overlay call site |
| Item/equipment schemas | `packages/shared/schemas/src/lib/database/item.ts`, `.../game/content_pack.ts` | **Modify** — unify `ItemDefinition` with `ContentPackItemEntry`, add price/consumable-effect fields |
| Appearance update command | `packages/frontend/engine/src/types.ts` `UPDATE_PLAYER_APPEARANCE { weapon?, armor? }` (C-163) | **Reuse** — finally send it from the equip path |
| Pickup SFX / juice | `game_overlay_service.svelte.ts` `onInventoryCountChange`, `audioService.playSfx` (C-163) | **Reuse** |

## Overview

Turn the disconnected inventory, equipment, loot, and vendor fragments into one content-pack-driven, persistent economy inside the Emberwatch demo loop. The frontend `inventoryService` becomes the single source of truth for owned items and gold; the engine reports pickup deltas and encounter outcomes; the content pack is the single source of item definitions, prices, and loot tables; and the whole state survives campaign reload and is projected into NPC dialogue AI context.

## Design Reference

- **Service split + composition root**: C-314 (`game_composition_root.svelte.ts` phases; constructor-injected service dependencies as in `EquipmentServiceOptions`).
- **Idempotent reward delivery**: C-329's `rewardsGranted` flag in `quest_state_service.svelte.ts` — the model for loot idempotency.
- **World-flag persistence + respawn suppression**: `worldStateService.defeatedEnemies` threading into `loadMap` (see `game_overlay_service.svelte.ts` `respawnPlayer`).
- **Serializable registry**: `combat_service.svelte.ts` / `time_service.svelte.ts` `registerSerializable` usage.
- **Bounded AI with authored fallbacks**: C-328 (`npc_dialogue_service.svelte.ts` authored-turn fallback on AI failure) — the vendor haggle fallback follows the same philosophy.
- **Schema-first types**: TypeBox in `packages/shared/schemas/`, types derived via `Static<>` re-exported from `@aikami/types` (aikami-conventions Pillar 2).

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- **Shared schemas** (`packages/shared/schemas/src/lib/`):
  - `database/item.ts` — extend `ItemDefinitionSchema` into the unified runtime item shape (label, itemType, attack/defense bonuses, equippable slot, base price, optional consumable effect). Keep `EquipmentSlotSchema` as `weapon | armor` for Phase 1.
  - `game/content_pack.ts` — extend `ContentPackItemEntrySchema` with optional `basePrice` and optional `effect` (consumable heal); constrain `equipmentSlot` to the shared `EquipmentSlotSchema` instead of free string. Bump nothing structural — all additions optional.
  - Derived types re-exported from `packages/shared/types/` via `Static<>`.
- **Engine** (`packages/frontend/engine/src/`):
  - `systems/interaction_system.ts` — on pickup emit `ITEM_PICKED_UP { itemId, quantity, spawnId }` (extend the existing C-329 event with quantity + spawnId); drop the lossy full-inventory `INVENTORY_UPDATED` emit from the pickup path.
  - `systems/turn_manager_system.ts` — delete the `loot_${enemyId}` placeholder `INVENTORY_UPDATED` emit; keep XP grant and `COMBAT_ENDED { victory, defeatedEnemyId }`.
  - `systems/entity_spawner.ts` — accept a `collectedPickups: string[]` option on map load (same channel as `defeatedEnemies`) and skip those item spawn points.
  - `types.ts` — event/command type updates for the above (additive).
- **Client services** (`apps/frontend/client/src/lib/services/game/`):
  - `inventory_service.svelte.ts` — `configureCatalog(items)` from content pack (composition root Phase 5c); hardcoded `ITEM_CATALOG` becomes the fallback for packless contexts (dev sandboxes); add `removeItem`, `useConsumable`, capacity (`MAX_INVENTORY_SLOTS` = 24 mirrored from `@aikami/frontend/engine` export), stack rules, `addItem` returns success/failure for full-inventory feedback; `registerSerializable('inventory', …)`; listen to `ITEM_PICKED_UP` deltas (additive) instead of replace-semantics `INVENTORY_UPDATED`.
  - `equipment_service.svelte.ts` — remains the **only** equip/unequip path; after each successful equip/unequip send `UPDATE_PLAYER_APPEARANCE { weapon, armor }` over the bridge (bridge access via composition root wiring); `registerSerializable('equipment', …)`.
  - `vendor_service.svelte.ts` — prices from the item catalog (`basePrice`); add `sellItem(itemId)` at a fixed 50% floor of basePrice; buy/sell share one validated transaction helper (integer gold, reject non-positive/insufficient, stack-aware); AI haggle failure falls back to the vendor's authored content-pack dialogue line (via `npcDialogueService` content provider) instead of `'...'`.
  - `world_state_service.svelte.ts` — add `collectedPickups: string[]` (spawn IDs), serialized alongside `defeatedEnemies`, threaded into `loadMap`.
  - `game_composition_root.svelte.ts` — extend the content provider with `getItem`/`getAllItems` and encounter loot access; wire `inventoryService.configureCatalog`; on `ENCOUNTER_COMPLETED { victory: true }` roll the content-pack loot table (existing seeded RNG from C-330 if available, else `Math.random`) and deliver via `inventoryService.addItem` guarded by a per-encounter `lootGranted` flag persisted with world state.
- **Client views** (`apps/frontend/client/src/lib/views/`):
  - `inventory/inventory_view_model.svelte.ts` — delete the `as unknown as` mutable cast; delegate to `equipmentService.equipItem`/`unequipItem`; expose stat-compare data (current vs candidate attack/defense delta) and `useConsumable`; keep zero-logic View.
  - `vendor/vendor_view_model.svelte.ts` + `vendor_view.svelte` — Sell section listing player-owned sellable items with price preview and confirmation.
  - Dialogue overlay call site — pass `gameStateFacts` (compact inventory/gold/equipment summary, ≤ 5 lines) into `npcDialogueService.generateTurn`.
- **Content** (`apps/frontend/client/static/content-packs/emberwatch/manifest.json`): add `steelSword` item; change `wardPendant`/`wardAmulet` slots to schema-valid values (`wardAmulet` → `armor`; `wardPendant` → no slot, key item); add `basePrice` to vendor-sellable items; add heal `effect` to `healthPotion`; bump pack `version` 2.0.0 → 2.1.0.
- **E2E** (`apps/e2e/`): extend `tests/client/inventory_pickup.spec.ts` journey + new vendor/economy spec; extend `suites/inventory.visual.ts` and vendor visual suite.

## State & Data Models

```typescript
// packages/shared/schemas/src/lib/database/item.ts — unified runtime item definition
// (TypeBox schema; type derived via Static<>)
export type ItemDefinition = {
  label: string;
  itemType: 'weapon' | 'armor' | 'consumable' | 'key' | 'misc';
  attackBonus: number;
  defenseBonus: number;
  equippable: boolean;
  slot?: 'weapon' | 'armor';
  /** Deterministic vendor base price in gold. 0 = not sold by vendors. */
  basePrice: number;
  /** Consumable effect — present only for itemType 'consumable'. */
  effect?: { kind: 'heal'; amount: number };
};

// Serializable registry payloads (client services)
export type InventorySnapshot = {
  items: Array<{ itemId: string; quantity: number }>;
  gold: number;
};

export type EquipmentSnapshot = {
  equippedWeapon?: string;
  equippedArmor?: string;
};

// world_state_service addition (persisted with existing world snapshot)
export type WorldPickupState = {
  /** Spawn-point IDs of already-collected map items — suppressed on map load. */
  collectedPickups: string[];
  /** Encounter IDs whose loot was already granted — duplicate-loot guard. */
  lootGrantedEncounters: string[];
};

// Engine bridge event (extends existing C-329 event — additive)
export type ItemPickedUpEvent = {
  type: 'ITEM_PICKED_UP';
  itemId: string;
  quantity: number;
  /** Tiled spawn-point ID for respawn suppression. */
  spawnId: string;
};

// AI context projection (passed as gameStateFacts: string[])
// Example rendered facts — compact, bounded:
//   "Gold: 132"
//   "Inventory: Iron Sword x1, Health Potion x2, Ward Shard x1"
//   "Equipped: Iron Sword (weapon), Leather Armor (armor)"
```

## Quality Requirements

- **Offline/degraded mode**: All transactions (pickup, stack, buy, sell, equip, consume, loot, save) are deterministic local operations — zero AI/network dependency. AI vendor haggling degrades to authored content-pack fallback lines with unchanged base prices; buy/sell buttons keep working.
- **Accessibility/input**: Keyboard flow preserved and extended — existing `open_inventory` toggle, Escape close, focus restore via `game_overlay_service` MENU/EXPLORE switching; new Sell/Use/Equip controls are real `<button>`s with `aria-label`s, tab-reachable, following existing overlay markup (see `inventory_view.svelte` close-button pattern). Gamepad/touch: N/A — deferred to C-346 per TODO.md phasing.
- **Performance budget**: Transactions O(slots) with 24-slot cap — sub-millisecond; no per-frame work added; catalog built once at boot from the already-loaded pack; save payload grows by < 2 KB.
- **Security/privacy**: N/A — local single-player state, no auth surface, no user data leaves the device. AI prompts include only fictional game state.
- **Persistence/migration**: Inventory, gold, equipment, collected pickups, and loot-granted flags all survive reload via the existing Turso save pipeline; old saves without the new snapshot keys hydrate to current defaults (registry already skips missing keys in `hydrateAllServices`).
- **Cancellation/retry/idempotency**: Buy/sell validate-then-commit atomically in one synchronous block (no partial gold/item states); loot delivery idempotent per encounter ID; pickups idempotent per spawn ID; quest rewards already idempotent (C-329). Vendor haggle request is abortable/ignorable — failure leaves the session usable.
- **Observability**: All services extend `BaseFrontendClass` — `create()` auto-logs public calls; add contextual `this.debug()` on rejected transactions (insufficient gold, inventory full, invalid item) and loot rolls (encounter ID, rolled entries).

## Migration & Rollback

- **Old data compatibility**: Saves created before this contract lack `inventory`/`equipment` snapshot keys and the world pickup state — `hydrateAllServices` skips missing keys, services keep their reset defaults (100 gold, empty inventory), matching today's observed behavior. No save-envelope version bump required (additive keys only).
- **Migration**: None beyond additive snapshot keys and the Emberwatch manifest bump to 2.1.0 (schema additions are `Type.Optional`, so 2.0.0 packs still validate).
- **Rollback**: Revert the client/engine changes; saves containing the new keys remain loadable by old code (unknown registry keys are ignored by `hydrateAllServices`'s map lookup).
- **Feature flag or kill switch**: None — this hardens existing production overlays; degraded behavior (AI-off vendor) is the built-in fallback path.
- **Failure recovery**: Save writes go through the existing atomic `GameSaveService` path; a failed save surfaces the existing autosave error snackbar and leaves in-memory state intact.

## Scope Boundaries

- **In Scope:**
  - Content-pack-driven item catalog + prices (with hardcoded fallback for dev sandboxes)
  - Pickup delta events, stacking, 24-slot capacity with player feedback, collected-pickup respawn suppression
  - Persistence of inventory/gold/equipment/pickup/loot state through the existing save pipeline
  - Vendor buy + sell + transaction validation + authored offline fallback lines
  - Single equip path with stat compare UI, immediate derived-stat update, and `UPDATE_PLAYER_APPEARANCE` sprite feedback
  - Out-of-combat consumable use (heal via existing player-stats bridge path)
  - Encounter loot-table application (idempotent, additive)
  - AI-readable inventory/gold/equipment summary in NPC dialogue context
  - Emberwatch manifest fixes (`steelSword`, slots, prices, potion effect)
  - Unit/E2E/visual coverage per Evidence Matrix
- **Out of Scope:**
  - In-combat item usage UI and turn-economy integration (C-330 owns combat actions)
  - Quest reward delivery logic (C-329 owns it; this contract only makes the underlying services persistent and capacity-aware)
  - HUD redesign, overlay-stack navigation rework (C-332)
  - Gamepad/touch input (C-346)
  - Item durability, weight, multi-slot equipment, accessory slots (C-337)
  - World interactables/chests/general loot tables outside authored encounters (C-342)
  - Engine-side redesign of the ECS `Inventory` SoA component internals (frontend service is the source of truth; engine slots stay generic)
  - Turso cloud sync (C-357)

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** 5 ACs (at the limit, not over). Touched projects: client (primary), engine (three surgical event/spawner edits), shared schemas (additive fields), e2e — technically > 2, but the engine/schema edits are small enablers of the single releasable system (the demo economy loop) and cannot ship independently without leaving the loop broken mid-state (e.g. loot placeholder wiping persistent inventories). Splitting by layer would create contracts that fail their own acceptance gates until the sibling lands. Deferred phases are already carved out to C-332/C-337/C-342/C-346 above. **Verdict: keep as one contract.**

## Acceptance Criteria

### AC-1: Content pack is the single source of item truth
**Given** the Emberwatch campaign is active and `/game` has booted
**When** any item is displayed, priced, equipped, or granted (inventory overlay, vendor list, quest reward, encounter loot)
**Then** its label, type, stat bonuses, slot, price, and consumable effect come from the content-pack `items` record hydrated into `inventoryService` at composition-root time; `steelSword` resolves correctly (no "Unknown Item"); all Emberwatch `equipmentSlot` values validate against the shared `weapon | armor` schema; unknown item IDs still fall back to the safe default definition; dev sandboxes without a pack keep working via the fallback catalog.

### AC-2: Pickup, stacking, capacity, and no duplication across reload
**Given** the player picks up the Ward Pendant on the Old Road and buys 2 Health Potions (stacking to one slot with quantity 3 alongside a looted potion)
**When** the campaign is saved (pause menu or autosave) and reloaded from the main menu
**Then** inventory contents, stack quantities, gold, and equipment are exactly as before saving; the Ward Pendant spawn point does **not** respawn on the Old Road map; picking up items beyond 24 distinct slots is rejected with visible "inventory full" feedback and the map entity remains; and a second pickup event for an already-collected spawnId is a no-op.

### AC-3: Vendor buy and sell with validated transactions and offline fallback
**Given** a vendor session with Keth (gold = 100, ironSword basePrice = 50)
**When** the player buys an Iron Sword, tries to buy a second one after spending below its price, then sells a Ward Shard
**Then** buy: gold 100 → 50, sword added (stack-aware); insufficient-gold buy is rejected atomically with feedback and no state change; sell: shard leaves inventory (quantity-aware) and gold increases by `floor(basePrice × 0.5)`; all gold values remain non-negative integers; **and** with AI unavailable, opening the vendor and haggling shows the authored content-pack vendor line (not `'...'`), while buy/sell keep working at base prices.

### AC-4: Single equip path with stat compare, sprite feedback, and consumable use
**Given** an Iron Sword in inventory and a Rusty Sword equipped
**When** the player inspects the Iron Sword and equips it, then drinks a Health Potion after losing HP
**Then** the inventory overlay shows the attack/defense delta vs the equipped item before confirming (+2 attack); equipping routes through `equipmentService.equipItem` (Iron Sword leaves inventory, Rusty Sword returns to it), `totalAttack` updates in the same frame in the character dashboard, and one `UPDATE_PLAYER_APPEARANCE { weapon: 'ironSword', armor: … }` bridge command is emitted; unequipping restores base stats and emits the command with `weapon: undefined`; using the potion decrements its stack (removing at zero), heals by the authored effect amount capped at max HP, and is rejected with feedback at full HP; equip/use SFX play (existing C-163 juice path).

### AC-5: Encounter loot delivery and AI-visible inventory
**Given** the player defeats the Shade in `ruined_ward_encounter` (loot: wardShard ×1 @ 100%, healthPotion ×1 @ 50%)
**When** the encounter completes with victory and the player then talks to any NPC with AI enabled
**Then** loot from the content-pack table is **added** to the existing inventory (never replacing it; no `loot_<eid>` placeholder items exist anywhere); repeating/replaying the encounter-completed event grants nothing (per-encounter `lootGranted` guard, persisted across reload); and the next `npcDialogueService.generateTurn` call includes `gameStateFacts` listing current gold, a bounded inventory summary, and equipped items, visible in the composed system prompt under `[GAME STATE]`.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit | `apps/frontend/client/src/lib/services/game/inventory_service.test.ts` (new — catalog hydration, fallback) + `packages/shared/schemas/src/lib/game/content_pack.test.ts` (extended — price/effect/slot validation, Emberwatch manifest fixture) | `/game` (inventory + vendor overlays) | Filled during verification |
| AC-2 | Unit + E2E | `inventory_service.test.ts` (stack/capacity/serialize/hydrate), `world_state_service` collected-pickups test, `packages/frontend/engine/src/systems/interaction_system.test.ts` (extended — `ITEM_PICKED_UP` delta + spawn suppression); E2E `apps/e2e/tests/client/economy_loop.spec.ts` (new — pickup → save → reload assertions) | `/game` full journey | Filled during verification |
| AC-3 | Unit + E2E | `apps/frontend/client/src/lib/services/game/vendor_service.test.ts` (new — buy/sell/validation/fallback), `vendor_view_model.test.ts` (extended); E2E sell flow in `economy_loop.spec.ts` | `/game` vendor overlay via Keth | Filled during verification |
| AC-4 | Unit + Visual | `apps/frontend/client/src/lib/services/game/equipment_service.test.ts` (new — single path, appearance emit), `inventory_view_model` test (delegation, compare data, consumable); Visual: `apps/e2e/src/visual/suites/inventory.visual.ts` (extended case) | `/game` inventory + character dashboard | Filled during verification |
| AC-5 | Unit + Integration | composition-root loot test (`game_composition_root.test.ts` extended — idempotent roll), `packages/frontend/engine/src/__tests__/turn_manager.test.ts` (updated — no placeholder emit), `npc_dialogue_service.test.ts` (extended — gameStateFacts in prompt) | `/game` encounter + dialogue | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test` (service/VM units), `bun moon run engine:test` (interaction/turn-manager/economy), `bun moon run schemas:test` (content-pack validation), `bun moon run :typecheck`; full gate via `validate()`.
- Integration: manual emulator run — `herdr_session start client`, play the Emberwatch loop on `/game`: pendant pickup → Keth buy/sell → equip → potion → shade loot → pause-save → quit → continue → verify state; repeat with AI provider disconnected for the fallback path.
- E2E / Visual:
    - **Functional**: `apps/e2e/tests/client/economy_loop.spec.ts` (new) — cases: pickup adds item + suppressed respawn after reload; buy/sell updates gold and list; equip moves item and updates dashboard stats; save/reload consistency. Reuses `apps/e2e/src/pom/inventory_page.ts` + new `vendor_page.ts` POM. Extend `inventory_pickup.spec.ts` only if overlay semantics change (they should not).
    - **Visual**: extend `apps/e2e/src/visual/suites/inventory.visual.ts` (route `/dev/inventory`, `defineConfig` + `export default`, existing `InventorySchema` + new booleans `equipCompareVisible`, `useButtonVisible`) — prompt criteria: "Score 90+: item cards show name, quantity badge, gold value; equipped-slot panel visible; stat-compare delta visible on an equippable item; Use button visible on consumables; no overflow." Extend the vendor suite (`suites/vendor.visual.ts` if absent, route `/dev/vendor`) with a Sell-section case: "Score 90+: buy list and sell list both visible with prices, player gold visible, confirmation affordance present."

**Watch Points**:
- AC-1: `getItemDefinition` is imported directly by several modules (`vendor_service`, VMs) — keep the export but back it by the configured catalog singleton so call sites don't churn.
- AC-2: `INVENTORY_UPDATED` replace-semantics listeners exist in `game_state_service.svelte.ts` and `inventory_service.startListening` — remove/repoint them together with the engine emit change or purchases will still be wiped by the next pickup. `onInventoryCountChange` SFX in `game_overlay_service` must keep firing off the new delta path.
- AC-3: Sell must not allow selling currently-equipped items (they are not in the inventory array once equipped via the service path — verify the UI cannot show them as sellable).
- AC-4: `UPDATE_PLAYER_APPEARANCE` handler engine-side may need the item→LPC-layer mapping; if an item has no visual layer mapping, stat/SFX feedback alone satisfies the AC — the command must still be emitted with the current slot state (forward-compatible).
- AC-5: Loot roll uses RNG — the E2E/unit tests must inject a seeded/fixed roll (mirror C-330's declared-before-RNG discipline); dropChance 0.5 entries assert both branches deterministically.

## Implementation Sequence

1. **Phase 1 (Data/Logic)**: Extend TypeBox schemas (`item.ts`, `content_pack.ts`) + derived types; fix the Emberwatch manifest (steelSword, slots, prices, potion effect, version 2.1.0); implement `inventoryService` catalog hydration, capacity/stack/remove/use, serialization; `equipmentService` serialization + appearance emit; `worldStateService` collected-pickups/loot-granted state; `vendorService` pricing-from-catalog + sell + transaction hardening + fallback lines. Unit tests alongside.
2. **Phase 2 (Integration)**: Engine edits (`ITEM_PICKED_UP` delta with spawnId/quantity, remove placeholder loot emit, spawn suppression); composition-root wiring (catalog, loot application on `ENCOUNTER_COMPLETED`, `gameStateFacts` provider, bridge for appearance command); ViewModel/View updates (equip delegation, compare UI, Use button, Sell section, full-inventory feedback); dialogue call-site facts; dev sandbox VMs updated to the new service APIs.
3. **Phase 3 (Validation)**: `validate()` (fix + typecheck + build + test); targeted moon tasks per Test Hooks; new/extended E2E + visual suites green; manual emulator journey (AI on + AI off) per Integration hook.

## Edge Cases & Gotchas

- **Legacy save without new keys**: must hydrate to defaults silently — assert no throw when `inventory`/`equipment` snapshots are absent.
- **Save mid-vendor-session**: vendor session state (`priceMultiplier`, messages) is intentionally **not** persisted — only inventory/gold; reopening the vendor after reload starts a fresh session at base prices.
- **Equipped items during save**: equipment snapshot stores item IDs, not definitions — hydration after a pack version change re-resolves definitions from the current catalog (stat changes in a patched pack apply retroactively; that is correct).
- **Stack split on equip**: equipping from a stack of 2 must decrement to 1, not remove the stack (existing `equipmentService` logic handles this — keep it covered by a test).
- **Inventory full during quest/loot delivery**: authored rewards and encounter loot must not be silently lost — deliver over-capacity **rewards** anyway (rewards bypass the cap; only world pickups respect it) and log a debug warning. This keeps C-329's idempotent delivery contract intact.
- **`ITEM_PICKED_UP` without spawnId** (programmatic/dev spawns): treat as non-suppressible pickup — always add, never record suppression.
- **Haggle clamp**: keep the 0.5–1.5 price multiplier clamp; sell price is computed from **base** price, not the haggled multiplier (prevents haggle-then-sell arbitrage).
- **Gold coin item**: `goldCoin` pickups should convert to gold balance, not occupy a slot — define behavior in the catalog (itemType `misc` with zero price today; converting is a one-line special case in the pickup handler and must be tested).
- **Dev sandboxes** (`/dev/inventory`, `/dev/vendor`, `/dev/sandbox/vendor`): run without a content pack — fallback catalog keeps them functional; update their DevViewModels for renamed/extended service APIs.

## Open Questions

Must be resolved before status becomes `approved`:

- None — sell ratio fixed at 50% floor, capacity fixed at 24 slots (engine constant), sprite feedback defined as best-effort layer mapping with mandatory command emission, loot RNG seeding follows C-330's kernel if merged first (else `Math.random` behind an injectable roll function). Note for approver: C-329 and C-330 are `approved` but not yet implemented — if C-331 is implemented first, the quest-reward and encounter-completion touchpoints reuse whatever exists (`quest_state_service` reward delivery and `ENCOUNTER_COMPLETED` event are already in the codebase), so sequencing is a scheduling concern, not a blocker.

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

---
