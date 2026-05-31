// docs/contracts/C-020-spatial-context-injection.md

# Contract: C-020 Spatial Context Injection

## Design References

- SillyTavern World Info (`sillytavern/public/scripts/world-info.js`)
- RisuAI Lorebook (`risuai/src/ts/process/lorebook.svelte.ts`)
- Aikami Core: `apps/frontend/game/src/engine/systems/`
- Aikami UI: `apps/frontend/pwa/src/lib/client/services/game/game_state_service.ts`

## Detailed Changes

1. **ECS System**: Create `apps/frontend/game/src/engine/systems/context_system.ts`. This system will query the `Position` of the `Player` against all entities with a `NpcDialog` or `Interactable` component using a simple AABB or distance check.
2. **Engine Bridge Integration**: Update `engine_bridge.ts` to emit `context_entered(entity_id, payload)` and `context_exited(entity_id)` events when proximity thresholds are crossed.
3. **PWA State Binding**: Modify `apps/frontend/pwa/src/lib/client/services/game/game_state_service.ts` to include an `$state` array called `active_contexts`. Bind this to the bridge events.
4. **Prompt Builder**: Update the AI prompt generation layer (e.g., `apps/frontend/pwa/src/lib/client/utils/ai_prompt.ts`) to dynamically map the `active_contexts` array into the system prompt (injecting character lore or item data).

## Acceptance Criteria

- **Given** the player is in the game world.
- **When** the player moves within 50 pixels of the NPC "Gandalf".
- **Then** the `context_system` emits a `context_entered` event.
- **Then** `game_state_service` mounts Gandalf's Firebase Dataconnect schema into `active_contexts`.
- **When** an AI chat request is triggered.
- **Then** the system prompt includes Gandalf's specific contextual lore.
- **When** the player moves away (> 50 pixels).
- **Then** the `context_exited` event fires, purging Gandalf from `active_contexts`.

## Watch Points

- **Performance**: The distance calculation in `context_system.ts` must run every tick (or staggered, e.g., every 10 ticks) without causing GC spikes. Avoid instantiating new objects in the loop.
- **Token Limits**: Ensure injected contexts do not exceed model context window limits. Implement a strict token-truncation or prioritization queue later if necessary.
- **Immutability**: Ensure Svelte 5 `$state` updates for arrays are handled correctly to trigger reactivity without mutating the proxy unsafely.
