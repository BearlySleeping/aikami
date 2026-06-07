# Contract: C-062 — Dialogue Context & Memory Manager

| Field | Value |
| ----- | ----- |
| Source | Architect |
| Target | Pi |
| Priority | High |
| Dependencies | C-059, C-060 |
| Status | not_started |
| Version | 1.0 |

## Overview
Our NPCs currently treat every interaction as their first. We need to build a Dialogue Context Manager that hooks into the end of the Stream Sync Orchestrator's lifecycle. It will persist the completed conversation turns to our database layer and construct a sliding-window prompt history for subsequent requests to the Hybrid Text Gateway.

## Design Reference
- Review `packages/frontend/repositories/src/lib/chat.ts` or `message.ts` for existing database schemas and persistence patterns.
- Review `packages/frontend/pwa/src/lib/client/services/media/stream_orchestrator.svelte.ts` (built in C-059) for lifecycle hooks where the final text is realized.

## Architecture Directives
- **Conversation Repository Adapter**: Handles saving the player's input and the NPC's generated response to the local/remote database under a specific `interactionId` or `chatId`.
- **Sliding Window Context Builder**: A utility that fetches the last $N$ messages for a specific `npcId` and `playerId`, formats them into the standard `[{ role: "user" | "assistant", content: "..." }]` array, and enforces a strict token/character limit to prevent blowing up the LLM context window.
- **Orchestrator Memory Hook**: Extends the `Stream Orchestrator` to transparently push the final `currentText` to the repository when the stream gracefully closes.

## State & Data Models
The payload for the LLM Gateway currently takes a simple string prompt. It needs to be updated to accept an array of messages representing the history:

    // Expected Gateway Payload shape:
    {
        npcId: "npc_123",
        messages: [
            { role: "assistant", content: "Hello, traveler." },
            { role: "user", content: "Where is the tavern?" }
        ]
    }

## Acceptance Criteria

- **AC1: Sliding Window Context Builder**
  - Given a history of 50 messages for an NPC
  - When the Context Builder processes them for a new generation
  - Then it returns only the most recent $N$ messages that fit within the configured context budget (e.g., last 10 messages).
  - Test Hook: Unit test the builder with a mocked array of heavy text objects and assert it correctly truncates older messages.

- **AC2: Orchestrator Memory Hook**
  - Given an active dialogue generation
  - When the SSE stream finishes successfully (no abort)
  - Then the Orchestrator automatically fires a save event to the Conversation Repository Adapter with the final accumulated `currentText`.
  - Test Hook: Mock the repository adapter, simulate a successful stream completion in the Orchestrator, and assert the save method was called with the correct string.

- **AC3: Abort/Cancel Exclusion**
  - Given an active dialogue generation
  - When the player presses "skip" and triggers the `AbortController` before the stream ends
  - Then the partial text is NOT saved to the permanent context history.
  - Test Hook: Trigger an abort mid-stream and assert the repository save method is never called.

- **AC4: Gateway Integration**
  - Given an ECS interaction trigger
  - When the Stream Orchestrator prepares the request to the Text Gateway
  - Then it successfully injects the output of the Context Builder into the payload.
  - Test Hook: Assert the mocked `fetch` call to the text API contains the history array, not just the single prompt.

## Implementation Notes
1. Start with the pure logic: `Sliding Window Context Builder` (AC1). This should be a robust utility function easily unit-tested.
2. Implement the `Conversation Repository Adapter`. If `packages/frontend/repositories` doesn't have the exact method needed to append an NPC interaction turn, add it.
3. Update the `Stream Orchestrator` to include the post-stream save hook (AC2) and ensure the abort logic bypasses it (AC3).
4. Update the interaction bridge / orchestrator payload to pass the array of messages to the backend.

## Edge Cases & Gotchas
- **System Prompts**: The context builder must leave room for the NPC's hidden "System Prompt" (their persona definition) which the backend will inject. Don't consume 100% of the token budget with history.
- **Race Conditions**: If a player interacts with two different NPCs very quickly, ensure the Context Builder is querying by explicit `npcId` so histories don't cross-contaminate.
