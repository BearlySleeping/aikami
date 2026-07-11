<!-- completed: 2026-06-29 -->
<!-- audit: legacy — no execution report -->
# Contract: C-128 Dialogue Overlay & AI Chat

## Goal
Implement the Dialogue UI overlay and wire it to the ECS interaction system and the AI Text Generation services, allowing the player to seamlessly chat with NPCs in the game world.

## Context
When a player interacts with an NPC in the ECS, the engine should emit an event (e.g., `START_DIALOGUE`) containing the target NPC's data. The `GameUIViewModel` must catch this, switch the `activeOverlay` to `'DIALOGUE'`, and pass the NPC data to a new `DialogueViewModel`. This ViewModel will orchestrate the conversation using the AI text services while rendering a visual-novel-style dialogue box over the game canvas.

## Tasks

1. **ECS-to-Svelte Interaction Bridge:**
   - Update `GameUIViewModel` (or a dedicated listener) to listen for dialogue/interaction events from the ECS.
   - When triggered, set `activeOverlay = 'DIALOGUE'` and capture the target NPC's entity ID or data payload.

2. **Create the Dialogue Overlay Component:**
   - Create `src/lib/views/game/ui/overlays/dialogue/dialogue_overlay.svelte` and `dialogue_overlay_view_model.svelte.ts`.
   - Build a classic RPG/Visual Novel UI layout:
     - A semi-transparent text box positioned at the bottom of the screen.
     - The NPC's name displayed prominently.
     - A scrollable history of the current conversation.
     - A text input field for the player to type their response.

3. **Wire the AI Chat Flow:**
   - The `DialogueOverlayViewModel` should inject the necessary AI/Chat services.
   - When the player submits a message, append it to the chat history and trigger an AI generation request using the NPC's persona/prompt data.
   - Ensure the AI response streams (if supported) or appends to the UI cleanly.

4. **Overlay Router Integration:**
   - Update `game_ui_view.svelte` to render the `DialogueOverlay` when `activeOverlay === 'DIALOGUE'`.
   - Provide a way to exit the conversation (e.g., an "End Chat" button or pressing Escape). Exiting should tell the `GameUIViewModel` to clean up, set `activeOverlay = 'NONE'`, and resume the engine/unlock player input.

## Out of Scope
- Voice generation (TTS) or Audio playback (this will be a separate polish contract).
- Complex 3D/Live2D animated avatars during dialogue.
- Trading, quest giving, or complex state mutations as a result of the chat (just focus on standard conversational ping-pong for now).

## Acceptance Criteria
- Triggering an interaction with an NPC in the game world successfully mounts the Dialogue Overlay.
- The game world remains paused or input is locked while the dialogue overlay is active.
- The player can type a message, send it, and receive a coherent response from the configured AI Text Provider based on the NPC's persona.
- Closing the dialogue gracefully unmounts the overlay and restores game control.
- Typechecks and builds pass with 0 errors.
