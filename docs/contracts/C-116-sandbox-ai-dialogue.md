<!-- completed: 2026-06-29 -->
## Metadata

| Field | Value |
|---|---|
| **Source** | Aikami Feature Spec — Dynamic NPC Systems |
| **Target** | `apps/frontend/client/src/lib/views/dev/sandbox/` — Sandbox AI Dialogue Engine |
| **Priority** | P1 — Completes the vertical slice interactive loop (ECS Engine -> Svelte UI -> AI -> Svelte UI) |
| **Dependencies** | C-115 |
| **Status** | **completed** |
| **Contract version** | 1.0.0 |

## Overview

We have directional movement and interaction triggers working via the EngineBridge. This contract wires the Svelte `SandboxViewModel` to the `AiTextIntelligenceService` (or equivalent mock service) in the frontend application. When the player presses `E` to interact, Svelte will pause engine input, prompt the AI using the NPC's identity, and stream the generated text response reactively into the Svelte dialogue overlay.

## Design Reference

**Aikami patterns**: 
- `apps/frontend/client/src/lib/services/ai/ai_text_intelligence_service.svelte.ts` Svelte streaming adapters.
- Svelte 5 reactivity (`$state` / `$effect` / async generator consumption).

## Architecture Directives

- Let Pi determine the exact injection pattern for the AI service in Svelte Kit (whether it's passed via context, route `load()`, or direct import), adhering to the existing codebase patterns.
- Ensure the ECS game loop input is strictly paused via `gameWorld.setInputLocked(true)` when Svelte opens the dialogue, and `false` when closed.
- The prompt sent to the AI should dynamically read the `npcName` from the interaction payload.

## State & Data Models

Expand Svelte's `SandboxViewModel` internal state:

    // Expected conceptual state extensions
    dialogNpcName: string = $state('');
    dialogText: string = $state('');
    isStreaming: boolean = $state(false);

    // Desired flow pseudo-code
    async handleInteraction(npc: NpcMetaEntry) {
        this.gameWorld.setInputLocked(true);
        this.showDialog = true;
        this.dialogNpcName = npc.npcName;
        this.dialogText = '';
        this.isStreaming = true;
        
        // consume async generator
        for await (const chunk of aiService.generateStream(...)) {
            this.dialogText += chunk;
        }
        this.isStreaming = false;
    }

## Acceptance Criteria

### AC-1: Input Locking & UI Mount
**Given** the player is near an NPC and walking
**When** the player presses the interact key (`E` or `Enter`)
**Then** the `SandboxViewModel` locks game engine input (character halts movement), and the Svelte dialogue UI mounts.

**Test Hooks**:
- Manual: Try to use WASD/Arrows while dialogue is open. Character should not move.

### AC-2: AI Stream Consumption
**Given** the dialogue UI is mounted
**When** Svelte triggers the AI service prompt
**Then** the UI reactively updates Svelte's `$state` `dialogText` character-by-character as the stream yields chunks.

**Test Hooks**:
- Integration/Unit: Svelte async generator loop successfully appends to `dialogText` without blocking the main UI thread.

### AC-3: Dialogue Dismissal & Unlocking
**Given** the AI stream has completed
**When** the player clicks "Continue" or presses a UI dismiss key
**Then** the Svelte UI unmounts, `dialogText` clears, and `gameWorld.setInputLocked(false)` restores engine movement.

### AC-4: Stream Abort / Cancellation
**Given** the AI stream is actively generating text
**When** the player dismisses the dialogue early
**Then** the Svelte ViewModel aborts the stream (via `AbortController` or breaking the loop) and unlocks the engine, preventing background memory leaks.

## Implementation Notes

1. **Files to modify**:
   - `apps/frontend/client/src/lib/views/dev/sandbox/sandbox_view_model.svelte.ts`
   - `apps/frontend/client/src/lib/views/dev/sandbox/sandbox_view.svelte` (add streaming visual indicators).
   - The Svelte Route (if the AI service needs to be provided via Svelte Context).
2. **Order of operations**:
   - Make the `AiService` available to the `SandboxViewModel`.
   - Update `onInteractRequest` to trigger the streaming function.
   - For dev/testing, the system prompt can be simple: *"You are {npcName}, an NPC in a 2D RPG. The player has just walked up to you. Greet them in 1-2 short sentences."*
   - Implement the `AbortController` cleanup logic when dismissing the dialog.

## Edge Cases & Gotchas

- **Mock Fallbacks**: If the developer hasn't set up OpenAI/Gemini/Ollama keys in their `.env`, ensure Svelte gracefully falls back to a Mock stream so the dev sandbox doesn't throw a fatal 500 error.
- **Svelte 5 Updates**: Modifying a string `$state` continuously inside a `for await` loop can sometimes trigger overly aggressive DOM updates. Ensure the text binding in Svelte is structured cleanly.
