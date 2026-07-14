<!-- completed: 2026-06-29 -->
# Contract C-110: Sandbox E2E Playwright Harness

## Context
During the Phase 2 overhaul, we built isolated MVVM dev sandboxes for Character, Chat, Combat, Inventory, and Quests. Because these sandboxes use Mock ViewModels (`DevViewModel`) and a floating `<DevToolsPanel>`, they are completely deterministic and require zero backend services. We need to lock in this architecture by writing Playwright E2E tests that navigate to these sandboxes, interact with the dev tools, and assert that the UI updates correctly.

## Scope
- `apps/e2e/tests/client/sandboxes.spec.ts` (New test file)

## Acceptance Criteria
- [ ] **Test Setup:** Create a new Playwright test file specifically for the dev sandboxes.
- [ ] **Character Sandbox:** Write a test that navigates to `/dev/character`, clicks the "Force Error State" (or similar) dev tool button, and verifies the UI reacts appropriately.
- [ ] **Chat Sandbox:** Write a test that navigates to `/dev/chat`, triggers a mock AI reply via the dev tools, and verifies the message appears in the DOM.
- [ ] **Combat Sandbox:** Write a test that navigates to `/dev/combat`, triggers the "Force Player 1 HP" dev tool, and verifies the HP bar or text updates.
- [ ] **Inventory Sandbox:** Write a test that navigates to `/dev/inventory`, clicks "Fill with Junk", and verifies the inventory list populates.
- [ ] **Quest Sandbox:** Write a test that navigates to `/dev/quest`, injects mock quests, and verifies they render in the DOM.

## Implementation Notes
1. Place the new test file in your existing `apps/e2e/tests/client/` directory.
2. The tests should be fast. You do not need to test every single edge case, just verify that the Dev Tools panel successfully manipulates the ViewModel and the View reacts.
3. If necessary, update the underlying Svelte components in the Client to include `data-testid` attributes to make Playwright targeting more reliable.

## Edge Cases
- Ensure Playwright is configured to wait for Svelte 5 `$effect` DOM updates after clicking the Dev Tool buttons.

---

## Execution Log (2026-06-10)

### Changes Made

1. **DevToolsPanel** (`apps/frontend/client/src/lib/components/dev/dev_tools_panel.svelte`):
   - Added `data-testid` attribute to action buttons: `dev-action-{slug}` where slug is the label lowercased with non-alphanumeric chars replaced by `-`.

2. **Combat View** (`apps/frontend/client/src/lib/views/combat/combat_view.svelte`):
   - Added `data-testid="player-hp-text"` and `data-testid="enemy-hp-text"` to HP display spans.

3. **Inventory View** (`apps/frontend/client/src/lib/views/inventory/inventory_view.svelte`):
   - Added `data-testid="gold-amount"` to gold display span.
   - Added `data-testid="inventory-item-list"` to items `<ul>`.

4. **Quest View** (`apps/frontend/client/src/lib/views/quest/quest_view.svelte`):
   - Added `data-testid="active-quests-header"` to the Active quests `<h2>`.

5. **Test File** (`apps/e2e/tests/client/sandboxes.spec.ts`):
   - Created with 11 test blocks across 5 describe suites:
     - **Character Sandbox** (2 tests): Load verification + Force Error State action.
     - **Chat Sandbox** (2 tests): Load verification + Simulate Bot Reply action.
     - **Combat Sandbox** (2 tests): Load verification + Force Player HP to 1 action.
     - **Inventory Sandbox** (2 tests): Load verification + Fill with Junk action.
     - **Quest Sandbox** (2 tests): Load verification + Inject Mock Quests / Fail Random Quest flow.

### Test Results

```
Running 11 tests using 10 workers
  ✓ setup › authenticate test user (853ms)
  ✓ Quest Sandbox › should load the quest dev sandbox with auto-injected mock quests (936ms)
  ✓ Character Sandbox › should load the character dev sandbox with mock chat messages (927ms)
  ✓ Chat Sandbox › should load the chat dev sandbox with NPC card and seed messages (925ms)
  ✓ Combat Sandbox › should load the combat dev sandbox with mock HP values (992ms)
  ✓ Inventory Sandbox › should load the inventory dev sandbox with mock items (998ms)
  ✓ Combat Sandbox › should update player HP to 1 via Force Player HP to 1 action (2.0s)
  ✓ Inventory Sandbox › should fill inventory with junk items via Fill with Junk action (2.0s)
  ✓ Character Sandbox › should react to Force Error State action (2.0s)
  ✓ Quest Sandbox › should re-inject mock quests via Inject Mock Quests action (2.8s)
  ✓ Chat Sandbox › should inject a bot reply via Simulate Bot Reply action (4.5s)

  11 passed (6.5s)
```

### Notes

- Used `waitForTimeout` instead of `waitForLoadState('networkidle')` because dev sandbox pages have long-lived Firestore connections that prevent network idle resolution.
- DevTool action buttons are queried via `data-testid` (e.g., `dev-action-force-error-state`).
- Key UI elements are queried via `data-testid` attributes added to combat, inventory, and quest views.
- Chat bot reply assertion matches against specific mock reply text patterns (stars, constellation, prophecy, Shadowmere, observatory).
- All tests use `authUser` fixture per existing dev test conventions.
- Playwright browser version mismatch (Nix provides 1217, Playwright 1.60.0 expects 1223) was worked around with symlinks in `/tmp/aikami-playwright-browsers`.
