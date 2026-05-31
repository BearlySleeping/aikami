# Contract C-030: Persistent NPC Interactivity & Spatial Triggers

## Core Objective
Establish the foundational interaction layer within `apps/frontend/game` using `bitECS` to govern spatial triggers, enabling the player to initiate dialogue with NPCs. The system will leverage a reusable Vanilla DOM dialogue overlay and a new Firebase Callable function to generate context-aware AI persona responses.

## Design References
- **Target App**: `apps/frontend/game/`
- **Architecture**: `bitECS` for spatial positions and interaction radii. PixiJS v8 for rendering. Vanilla JS for the DOM overlay.
- **Backend API**: New Firebase Callable `prompt_npc_dialogue`.

## Detailed Changes
1. **ECS Interaction System**:
   - Implement `apps/frontend/game/src/systems/interaction_system.ts`.
   - Calculate distance between the `Player` entity and `NPC` entities equipped with an `Interactable` component.
   - Bind an interaction key (e.g., 'E' or 'Enter'). When triggered within the interaction radius, emit an interaction event and lock player movement via the `movement_system`.
2. **NPC Component Architecture**:
   - Define new `bitECS` components: `Interactable` (radius), `NPCData` (mapped to an external static store holding Name, Base Persona ID, and current Relationship Value).
3. **Dialogue Overlay Controller**:
   - Create `apps/frontend/game/src/ui/dialogue_controller.ts`. Adapt the Vanilla DOM hybrid approach from C-029 into a reusable overlay for standard in-world NPC conversations.
   - Ensure DOM elements are properly layered (`z-index`) and destroyed/hidden when dialogue concludes, restoring player movement.
4. **Backend Persona Integration**:
   - Create a new Firebase Callable function `prompt_npc_dialogue.ts`.
   - The prompt must dynamically inject the NPC's base persona rules, the player's character data (from C-029), and a floating "Relationship Value" (e.g., -100 to 100) to adjust the tone of the response.

## Acceptance Criteria
- **Given** the player moves within the radius of an NPC, **When** the interact key is pressed, **Then** player movement locks and the Vanilla DOM dialogue overlay initializes.
- **Given** the dialogue overlay is active, **When** the player submits a message, **Then** the game calls `prompt_npc_dialogue` via the REST client, returning an in-character response.
- **Given** the player closes the dialogue, **Then** the DOM overlay is destroyed and player movement control is restored.

## Watch Points
- **Input Bleed**: Strictly prevent keyboard input meant for the chat DOM `<input>` from triggering bitECS systems (e.g., moving the character with WASD while typing).
- **Framework Boundaries**: Do NOT use Svelte for the dialogue overlay. Rely strictly on Vanilla TypeScript/DOM manipulation.
- **Performance**: Use squared distance checks (`dx*dx + dy*dy <= r*r`) in the `interaction_system` to avoid costly `Math.sqrt()` operations per frame.
