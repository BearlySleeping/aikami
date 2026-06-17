# Contract: C-146 Freeform AI Combat Actions

## Goal
Implement a freeform text input in the combat UI. When a player types a custom action (e.g., "I do a backflip and kick the slime!"), the frontend will use the `TextGenerationService` and a strict TypeBox schema to translate the intent into mechanical modifiers (advantage, bonus damage), narrate the outcome, trigger image generation if visually spectacular, and dispatch the enhanced command to the ECS engine.

## Tech Stack
- **Framework:** Svelte 5, TypeBox
- **Engine:** Web Worker ECS, Engine Bridge

---

## Task 1: Define the TypeBox Schema
**File:** `apps/frontend/client/src/lib/game/core/ai/prompts/combat_action_schema.ts`
- Import `{ Type }` from `@sinclair/typebox`.
- Create and export `CombatActionSchema`:
  - `actionType`: `Type.Union([Type.Literal('ATTACK'), Type.Literal('DEFEND'), Type.Literal('FLEE')])`
  - `narrative`: `Type.String()` (The DM-style description of the attempt).
  - `bonusDamage`: `Type.Number()` (Extra damage, e.g., 0-5, awarded for clever, highly contextual attacks).
  - `advantage`: `Type.Boolean()` (True if the description is so good it warrants advantage on the d20 roll).
  - `generateImage`: `Type.Boolean()` (True if the action is highly cinematic and drastically changes the scene).
- Export the static type: `export type CombatActionIntent = Static<typeof CombatActionSchema>;`

## Task 2: Enhance Engine Combat Math
**File:** `packages/frontend/engine/src/types.ts` & `turn_manager_system.ts`
- Update the `COMBAT_ACTION` payload type to accept optional `bonusDamage?: number` and `advantage?: boolean`.
- In `turn_manager_system.ts`:
  - If `advantage` is true, roll `1d20` twice and take the higher result for the Hit Check.
  - If the attack hits, add the `bonusDamage` to the final damage calculation.

## Task 3: Implement Custom Action ViewModel Logic
**File:** `apps/frontend/client/src/lib/views/combat/combat_view_model.svelte.ts`
- Inject `TextGenerationService` and `ImageGenerationService`.
- Add `$state`: `isResolvingAiAction = false` (to disable UI buttons while the LLM thinks).
- Add method `async executeCustomAction(prompt: string)`:
  - Set `isResolvingAiAction = true`.
  - Build a contextual prompt combining the player's stats, the enemy's name/HP, and the user's `prompt`.
  - Call `TextGenerationService.extractStructure()` using the new `CombatActionSchema`.
  - Append the returned `narrative` to the local combat log.
  - If `generateImage` is true, asynchronously trigger `ImageGenerationService` to update the background/scene.
  - Send the mapped `COMBAT_ACTION` (with the extracted `actionType`, `advantage`, and `bonusDamage`) to the Engine Bridge.
  - Set `isResolvingAiAction = false`.

## Task 4: UI Input Wiring
**File:** `apps/frontend/client/src/lib/views/combat/combat_view.svelte`
- Add a text input field (`<input type="text" ... />`) beneath the standard Attack/Defend/Flee buttons.
- Add a "Submit Action" button next to it.
- Bind the input to a temporary variable and trigger `viewModel.executeCustomAction()` on submit or 'Enter' key.
- Disable all combat buttons and inputs while `viewModel.isResolvingAiAction === true`, showing a loading spinner.

## Task 5: Unit & E2E Testing
**File:** `packages/frontend/engine/src/systems/turn_manager_system.test.ts`
  - Add tests ensuring `advantage` and `bonusDamage` correctly modify the outcome.
**File:** `apps/e2e/tests/client/combat_sandbox.spec.ts`
  - Write an E2E test verifying the text input exists, accepts a string, disables the UI upon submission, and eventually results in HP modification.

## Acceptance Criteria
- [ ] A TypeBox schema strictly enforces the LLM's combat output format.
- [ ] The engine supports `advantage` rolls and `bonusDamage` injection.
- [ ] The UI allows text-based combat actions and correctly maps them to engine commands.
- [ ] Cinematic actions accurately trigger the Image Generation service.
- [ ] Unit and E2E tests pass.
