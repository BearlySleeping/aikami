# Contract: C-141 NPC Interaction & Dialogue Trigger

## Goal
Implement proximity-based interaction in the ECS engine so the player can walk up to an NPC and press an interact key (e.g., 'E' or 'Enter') to trigger a conversation. This will bridge the engine's spatial awareness with the Svelte 5 Dialogue Overlay, injecting the specific NPC's persona into the AI context.

## Tech Stack
- **Framework:** Svelte 5, Vitest
- **Engine:** Web Worker ECS, Engine Bridge

---

## Task 1: Housekeeping - Fix Client Unit Tests
**File:** `apps/frontend/client/src/lib/services/game/game_state_service.test.ts`
- Resolve the 11 failing unit tests caused by the Svelte 5 `$state` mock issues. 
- *Hint:* Ensure Svelte's reactive graph is either properly mocked or executed within a valid component context/`$effect.root` if testing raw `.svelte.ts` view models in Vitest. 

## Task 2: Engine Proximity & Interaction System
**File:** `packages/frontend/engine/src/systems/interaction_system.ts` (or `input_system.ts`)
- Add an 'Interact' action to the engine's input map (e.g., mapping the 'E' key or 'Enter' key).
- When the 'Interact' action is triggered while in `EXPLORE` mode:
  - Query all entities with `NpcData` (or `Interactable`) and `Position` components.
  - Calculate the distance between the Player and these entities.
  - Find the closest entity within a defined interaction radius (e.g., `1.5` grid tiles).
  - If a valid NPC is found, emit an `NPC_INTERACTED` message across the `EngineBridge` containing the NPC's ID and associated `NpcData` properties.

## Task 3: Bridge the Interaction to the UI
**File:** `apps/frontend/client/src/lib/views/game/ui/game_ui_view_model.svelte.ts`
- Listen for the `NPC_INTERACTED` event from the `EngineBridge`.
- Upon receiving the event:
  - Call `GameStateService.setMode('DIALOGUE')` to lock player movement.
  - Update the active overlay state to mount `dialogue_overlay.svelte`.
  - Pass the received `NpcData` (name, avatar, persona prompt) into the `DialogueOverlayViewModel`.

## Task 4: Contextualize the AI Prompt
**File:** `apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay_view_model.svelte.ts`
- Ensure the ViewModel accepts the `NpcData` on initialization.
- Pre-pend the NPC's specific persona description (e.g., "You are an old, grumpy blacksmith...") to the system prompt context array before sending the first message payload to Ollama or OpenRouter.
- Update the UI to display the NPC's name and LPC avatar correctly in the chat header.

## Task 5: Unit & Integration Testing
- **File:** `packages/frontend/engine/src/systems/interaction_system.test.ts`
  - Write engine tests to verify that pressing the interact key only fires the bridge event if an NPC is within the interaction radius.
- **File:** `apps/e2e/tests/client/npc_interaction.spec.ts`
  - Create a Playwright test loading a dev sandbox.
  - Move the player next to an NPC, trigger the interact key, and verify that the `DialogueOverlay` successfully mounts and displays the NPC's name.

## Acceptance Criteria
- [ ] Client test suite is 100% green (failing `GameStateService` tests resolved).
- [ ] Pressing the interact key near an NPC successfully transitions the game to `DIALOGUE` mode.
- [ ] The Dialogue overlay renders with the correct NPC context and avatar.
- [ ] The AI chat request includes the NPC's specific persona prompt.
- [ ] Unit and E2E tests pass.
