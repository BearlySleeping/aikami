# Contract C-107: Inventory System MVVM & Dev Sandbox

## Context
RPG inventory systems are highly stateful and prone to edge-case bugs (over-encumbrance, insufficient funds, item duplication). By applying our Svelte 5 MVVM Sandbox pattern, we can build and test the Inventory/Bartering UI in total isolation. We will use the `DevToolsPanel` to inject edge cases like maxing out gold or filling the bag with junk.

## Scope
- `apps/frontend/client/src/lib/views/inventory/inventory_view_model.svelte.ts` (New/Refactor)
- `apps/frontend/client/src/lib/views/inventory/inventory_view.svelte` (New/Refactor)
- `apps/frontend/client/src/routes/(dev)/dev/inventory/+page.svelte` (New sandbox route)

## Acceptance Criteria
- [ ] **ViewModel Creation:** Create or refactor `inventory_view_model.svelte.ts` to export an `InventoryViewModel` class using Svelte 5 `$state`. It should track `items` (array of objects), `gold` (number), and `maxCapacity` (number). Include basic methods like `dropItem(id)` or `useItem(id)`.
- [ ] **Dumb View:** Create `inventory_view.svelte` that takes `vm: InventoryViewModel` as a prop and renders a simple grid/list of items and the current gold balance.
- [ ] **Dev Override:** Create `inventory_dev_view_model.svelte.ts` extending the base class.
- [ ] **Sandbox Route:** Create `(dev)/dev/inventory/+page.svelte`. Instantiate `InventoryDevViewModel`, pass it to `<InventoryView />`, and mount `<DevToolsPanel />`.
- [ ] **Dev Tools Wiring:** Implement at least 3 dev methods in `InventoryDevViewModel` and wire them to the DevToolsPanel:
  - Action: `giveMaxGold()` (Sets gold to 999,999).
  - Action: `fillWithJunk()` (Fills the inventory array with mock "Junk" items up to max capacity).
  - Action: `clearInventory()` (Empties all items and sets gold to 0).
- [ ] **Nav Update:** Add the Inventory Sandbox to the dev layout sidebar navigation (`dev_layout_view_model.svelte.ts`).

## Implementation Notes
1. If the `views/inventory` folder does not exist yet, create it. This sandbox will serve as the foundational UI shell for the real inventory system.
2. You can define a lightweight mock `Item` interface directly in the ViewModel for now (e.g., `{ id: string, name: string, quantity: number }`) if a shared schema doesn't exist yet.

## Edge Cases
- Ensure the UI handles the "Empty Inventory" state gracefully (e.g., displaying text like "Your bag is empty").

---

## Execution Log (2026-06-10)

### Files Created
- `apps/frontend/client/src/lib/views/inventory/inventory_view_model.svelte.ts` — Base ViewModel with `$state` fields (`items`, `gold`, `maxCapacity`), derived getters (`usedSlots`, `capacityPercent`, `isEmpty`, `isFull`), and methods (`dropItem`, `useItem`).
- `apps/frontend/client/src/lib/views/inventory/inventory_view.svelte` — Thin Svelte 5 view consuming `InventoryViewModelInterface`. Renders gold display, capacity progress bar, item list with Use/Drop buttons, empty state ("Your bag is empty"), and full-warning banner.
- `apps/frontend/client/src/lib/views/inventory/inventory_dev_view_model.svelte.ts` — Dev override extending `InventoryViewModel`. Injects mock starting items (sword, potion, shield, arrows). Provides three sandbox actions: `giveMaxGold()` (gold → 999,999), `fillWithJunk()` (fills to maxCapacity with randomized junk items), `clearInventory()` (empties items + gold → 0).
- `apps/frontend/client/src/routes/(dev)/dev/inventory/+page.svelte` — Sandbox route mounting `<InventoryView>` and `<DevToolsPanel>` with three wired actions.

### Files Modified
- `apps/frontend/client/src/lib/views/dev/layout/dev_layout_view_model.svelte.ts` — Added `/dev/inventory` nav item (backpack icon) to `_NAV_ITEMS` array (9 → 10 items).
- `apps/frontend/client/src/lib/views/dev/layout/dev_layout_view_model.test.ts` — Updated count assertion (9 → 10) and added `/dev/inventory` route check.

### Verification
- `client:fix` — Passed (0 warnings after fixing non-null assertions).
- `client:typecheck` — Pre-existing svelte-check error in `app_loading.svelte` (unrelated — CSS transform failing on vite config resolution).
- `client:test` — Dev layout view model tests pass (6/6, including updated nav count and route). 33 pre-existing failures in service-level tests (AiTextIntelligenceService, ImageGenerationService, ImageViewModel) — all unrelated.

### Notes
- Biome flagged non-null assertions (`!`) — replaced with safe guards (`if (!item) return` and `?? 'Junk'` fallback).
- The `fillWithJunk` method uses random quantities (1-5) to fill exactly up to `maxCapacity` (30), cycling through 12 junk name variations.
