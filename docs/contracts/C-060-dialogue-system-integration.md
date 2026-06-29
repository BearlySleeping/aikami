# Contract: C-060 — Dialogue System Integration

| Field | Value |
| ----- | ----- |
| Source | Architect |
| Target | Pi |
| Priority | High |
| Dependencies | C-059 |
| Status | not_started |
| Version | 1.0 |

## Overview
We need to connect our newly built Client-Side Stream Sync orchestration layer directly into the game's ECS and Dialogue UI. When a player interacts with an NPC, the system must trigger the Stream Orchestrator, feed the progressive text into the existing Svelte dialogue components, and provide the PixiJS Texture Injector with the correct target display object. Additionally, we must fix a pre-existing failing test in the Client package to ensure our CI pipeline remains green.

## Design Reference
- Review `apps/frontend/game/src/lib/systems/interaction_system.ts` for how interactions are currently handled.
- Review `apps/frontend/game/src/lib/ui/dialogue_controller.ts` or the Svelte components rendering the dialogue.
- Review the broken `game_state_service.test.ts` to identify the `$state` issue in `dialog.svelte.ts`.

## Architecture Directives
- **Interaction Bridge**: A system/listener that catches ECS interaction events and translates them into Stream Orchestrator generation requests.
- **Dialogue UI Adapter**: Connects the Stream Orchestrator's progressive text and state to the Svelte UI, handling the "skip" or "next" inputs to trigger the unified `AbortController`.
- **Target Resolver**: Resolves the ECS `npcId` to the actual PixiJS `Sprite` or `Mesh` reference so the Texture Injector knows where to apply the newly generated ComfyUI textures.
- **Test Suite Repair**: Identify and resolve the `$state` compilation/execution issue breaking the game state tests.

## State & Data Models
The bridge needs to map the ECS entity data to the Orchestrator's expected payload conceptually:

    {
        prompt: "Player says hello",
        npcId: entity.components.NpcData.id,
        personaId: entity.components.NpcData.personaId,
        targetSprite: entity.components.PixiSprite.reference
    }

## Acceptance Criteria

- **AC1: Test Suite Repair**
  - Given the Client test suite
  - When running the `game_state_service.test.ts`
  - Then it passes successfully without `$state` related errors.
  - Test Hook: Run the specific test file and ensure a 0 exit code.

- **AC2: ECS Interaction Trigger**
  - Given a player entity near an NPC entity
  - When the player triggers an interaction
  - Then the Interaction Bridge successfully invokes the Stream Orchestrator's `generateDialogue` method with the correct NPC metadata.
  - Test Hook: Mock the Stream Orchestrator, dispatch an ECS interaction event, and assert the orchestrator was called with the correct `npcId` and `personaId`.

- **AC3: UI State Mapping & Abort**
  - Given an active dialogue generation
  - When the player presses the "skip" or "close" button in the UI
  - Then the Dialogue UI Adapter calls `cancelGeneration()` on the orchestrator.
  - Test Hook: Render the Dialogue UI component in isolation, click the skip button, and assert the cancel mock is invoked.

- **AC4: Sprite Target Resolution**
  - Given an NPC interaction
  - When the orchestrator prepares the PixiJS Texture Injector
  - Then it successfully resolves and passes the specific PixiJS DisplayObject associated with that NPC entity.
  - Test Hook: Assert that the target provided to the Texture Injector mock matches the mock Sprite attached to the ECS entity.

## Implementation Notes
1. Start by fixing `game_state_service.test.ts` (AC1). Do not proceed until the build is green. The issue is likely related to how Bun handles `.svelte.ts` files in test environments; either mock the dialog service or adjust the test environment config.
2. Implement the `Interaction Bridge` in the game package to listen to ECS events and fire the Orchestrator.
3. Update the `DialogueController` or relevant Svelte UI components to subscribe to the Orchestrator's state (AC3).
4. Implement the `Target Resolver` to pull the PixiJS reference out of the ECS so the texture injector has a destination (AC4).

## Edge Cases & Gotchas
- **Rapid Re-triggering**: A player might mash the interact button. Ensure the `Interaction Bridge` ignores subsequent interact events if the orchestrator `isGenerating` is true, unless it's explicitly a "skip/cancel" action.
- **Missing Sprites**: If an NPC doesn't have a visual representation loaded yet, the Target Resolver should handle it gracefully without crashing the orchestrator (e.g., skip the image injection phase).
