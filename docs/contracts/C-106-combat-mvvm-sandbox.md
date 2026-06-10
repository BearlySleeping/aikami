# Contract C-106: Combat System MVVM & Dev Sandbox

## Context
We are extending our Svelte 5 MVVM and Sandbox architecture to the Combat/Battle System. Testing turn-based combat UI normally requires playing the game until an encounter triggers. By creating a `CombatDevViewModel` and a dedicated `(dev)/dev/combat` sandbox, we can instantly force specific combat states (low HP, enemy turns, critical hits) via the DevToolsPanel to rapidly iterate on the UI.

## Scope
- `apps/frontend/pwa/src/lib/views/combat/combat_view_model.svelte.ts` (Ensure it is a class)
- `apps/frontend/pwa/src/lib/views/combat/combat_view.svelte` (Ensure it is dumb/prop-driven)
- `apps/frontend/pwa/src/routes/(dev)/dev/combat/+page.svelte` (New sandbox route)

## Acceptance Criteria
- [ ] **ViewModel Refactor:** Ensure `combat_view_model.svelte.ts` exports a standard class (`CombatViewModel`) using Svelte 5 `$state`. All combat state (player HP, enemy HP, current turn, combat log) must live here.
- [ ] **Dev Override:** Create `combat_dev_view_model.svelte.ts`. This class MUST `extend CombatViewModel`.
- [ ] **Sandbox Route:** Create `(dev)/dev/combat/+page.svelte`. It must instantiate `CombatDevViewModel`, pass it to `<CombatView />`, and mount `<DevToolsPanel />`.
- [ ] **Dev Tools Wiring:** Implement at least 3 dev methods in `CombatDevViewModel` and wire them to the DevToolsPanel:
  - Action: `forcePlayer1HP()` (Sets player HP to 1 to test critical UI states).
  - Action: `simulateEnemyTurn()` (Forces an enemy attack, updates HP/Combat Log).
  - Action: `endBattle(victory: boolean)` (Forces the battle to end in a win or loss state).
- [ ] **Nav Update:** Add the Combat Sandbox to the dev layout sidebar navigation (`dev_layout_view_model.svelte.ts`).

## Implementation Notes
1. If `combat_view_model.svelte.ts` does not exist or is tightly coupled to the engine, stub out a clean, decoupled ViewModel that represents the *UI state* of combat (not the backend ECS logic). 
2. The `simulateEnemyTurn()` should push a string like "[Dev Mock] Goblin dealt 15 damage!" into the combat log so we can test the log UI.

## Edge Cases
- Ensure the production combat view doesn't break if passed a ViewModel that isn't connected to the actual game engine yet.
