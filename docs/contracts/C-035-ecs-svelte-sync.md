<!-- completed: 2026-06-29 -->
| Metadata | Value |
| :--- | :--- |
| Source | Architect |
| Target | Pi |
| Priority | High |
| Dependencies | bitECS core setup |
| Status | completed |
| Contract version | 1.0 |

**Overview**
We need to bridge our bitECS turn-based combat engine with our Svelte 5 frontend. This contract establishes the reactive ViewModels that read from the ECS world state and expose it to the Svelte components. This ensures the UI automatically updates health bars, turn order, and status effects without tightly coupling the DOM to the ECS logic.

**Design Reference**
Follow the existing Svelte 5 reactive class patterns used in our player inventory system. Keep the ECS logic isolated; the ViewModel should only observe and broadcast.

**Architecture Directives**
- Combat State ViewModel
- ECS Query Observer
- Turn Manager Controller
- Combat UI View

**State & Data Models**

    class CombatViewModel {
        activeEntities = $state<number[]>([]);
        currentTurnEntity = $state<number | null>(null);
        
        syncWithECS(world: IWorld) {
            // Query bitECS and update $state
        }
    }

**Acceptance Criteria**

*AC-1: ViewModel Initialization*
Given a running combat instance
When the Combat State ViewModel is instantiated
Then it should attach an observer to the bitECS combat world

*AC-2: Reactive Turn Updates*
Given an active combat encounter
When the ECS turn component updates to a new entity
Then the ViewModel's `currentTurnEntity` state should immediately reflect the new entity ID

*AC-3: Cleanup and Memory*
Given an active Combat UI View
When the player exits the combat route
Then the ECS Query Observer must be fully disposed to prevent memory leaks

**Implementation Notes**
1. Write the tests for `CombatViewModel` isolation and reactivity.
2. Implement the bitECS query listeners to extract health, turn, and position data.
3. Map the extracted ECS data to the Svelte `$state` properties.
4. Hook the ViewModel into the Combat UI route using context or direct instancing.
5. Ensure the `onDestroy` or equivalent teardown method unregisters the ECS listeners.

**Edge Cases & Gotchas**
- ECS ticks happen extremely fast. Do not sync the ViewModel on every single micro-tick if the data hasn't changed. Throttle or deeply compare the state to prevent Svelte from over-rendering.
- Ensure dead entities are cleanly removed from the ViewModel's reactive arrays so we don't end up with ghost UI elements.
