<!-- completed: 2026-06-29 -->
<!-- audit: legacy — no execution report -->
# Contract: C-149 Combat Mechanics & AI Gatekeeping

## Goal
Feed the player's real-time ECS state (Inventory, Stats, Skills/Spells) into the LLM context. Empower the AI to gatekeep invalid freeform actions (e.g., using items they don't have) and reflect this mechanically in the Svelte UI. Finally, resolve the remaining 15 pre-existing client test failures.

## Tech Stack
- **Framework:** Svelte 5, TypeBox
- **Engine:** Web Worker ECS, Engine Bridge

---

## Task 1: Housekeeping - The Final Test Sweep
**File:** `apps/frontend/client/src/lib/views/character/create/character_view_model.test.ts` (and `dialogue_overlay_view_model.test.ts` if applicable)
- Resolve the remaining 15 pre-existing unit test failures. 
- *Hint:* Check for missing module mocks (e.g., missing `$services` exports) or asynchronous issues like `bitmap decode` stubs required by PixiJS/browser APIs in Vitest.
- **Do not proceed until the client test suite is 100% green.**

## Task 2: Character Sheet Serialization
**File:** `apps/frontend/client/src/lib/views/combat/combat_view_model.svelte.ts`
- Create a private method `_buildCharacterSheetContext()` that pulls the player's current state from `GameStateService` (Inventory, HP, Level, Attack, Defense).
- Serialize this data into a clean string format (e.g., "Player Inventory: 3x Apple, 1x Rusty Sword. Player Stats: ATK 5, DEF 3.").
- Inject this string into the system prompt whenever `executeCustomAction` is called, ensuring the LLM knows exactly what the player is capable of.

## Task 3: Schema Updates for Gatekeeping
**File:** `apps/frontend/client/src/lib/game/core/ai/prompts/combat_action_schema.ts`
- Update `CombatActionSchema` to include:
  - `actionValid`: `Type.Boolean()` (True if the player has the required items/stats/spells to perform the action).
  - `invalidReason`: `Type.Optional(Type.String())` (If `actionValid` is false, the DM's explanation of why, e.g., "You reach for a potion, but your bags are empty!")

## Task 4: UI Enforcement of Invalid Actions
**File:** `apps/frontend/client/src/lib/views/combat/combat_view_model.svelte.ts`
- Update `executeCustomAction()`:
  - If the extracted LLM response has `actionValid === false`:
    - Append the `invalidReason` to the combat log (and optionally synthesize it via TTS).
    - **Do not** send the `COMBAT_ACTION` command to the engine (the player loses their turn or gets a chance to try again, depending on your preferred design).
  - If `actionValid === true`, proceed with sending the command to the engine as usual.

## Task 5: Unit & E2E Testing
- **File:** `apps/frontend/client/src/lib/views/combat/combat_view_model.test.ts`
  - Add tests mocking a structured response where `actionValid` is false, asserting that the engine command is *not* sent.
- **File:** `apps/e2e/tests/client/combat_sandbox.spec.ts`
  - Add a test where the player attempts to use an item they don't have. Assert that the `invalidReason` appears in the combat log and the turn does not advance.

## Acceptance Criteria
- [ ] Client test suite passes with 0 failures.
- [ ] The LLM receives the player's current inventory and stats in the system prompt.
- [ ] The LLM can successfully reject impossible actions via the TypeBox schema.
- [ ] The UI gracefully handles rejected actions by logging the DM's reasoning without crashing or advancing engine state.
- [ ] Unit and E2E tests pass cleanly.
