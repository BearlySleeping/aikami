# Contract: C-148 Combat Immersion (Dice UI, Images & Voice)

## Goal
Enhance the turn-based combat overlay with rich sensory feedback. Add a visual d20 dice rolling animation, display generated cinematic scene images in the background, and allow the enemy to occasionally speak taunts/reactions using the native WebGPU Kokoro TTS system.

## Tech Stack
- **Framework:** Svelte 5, CSS Animations
- **Services:** `ImageGenerationService`, `TtsService`, `DiceService`
- **Schema:** TypeBox (LLM structured output)

---

## Task 1: Extend AI Combat Schema for Voice
**File:** `apps/frontend/client/src/lib/game/core/ai/prompts/combat_action_schema.ts`
- Extend `CombatActionSchema` to include:
  - `enemyQuote`: `Type.Optional(Type.String())` (A short, in-character taunt or reaction from the enemy based on the player's action. Max 1 sentence).

## Task 2: Enemy Voice Wiring
**File:** `apps/frontend/client/src/lib/views/combat/combat_view_model.svelte.ts`
- Inject `TtsService`.
- Inside `executeCustomAction()`, after extracting the LLM response:
  - If `enemyQuote` is present, immediately call `TtsService.synthesize(enemyQuote, { voiceId: 'default_enemy_voice' })`.
  - Append the quote to the battle log visually (e.g., *Slime gurgles: "Squish!"*).

## Task 3: Visual Dice Roll UI
**File 1:** `apps/frontend/client/src/lib/views/combat/combat_view_model.svelte.ts`
- Add `$state`: `activeDiceRoll: { value: number, isRolling: boolean, isSuccess: boolean } | null = null`.
- When the `COMBAT_LOG` bridge event contains a dice result (or calculate it internally before sending), populate `activeDiceRoll`. Set `isRolling = true` for ~1.5 seconds before revealing the `value` and resolving the attack.

**File 2:** `apps/frontend/client/src/lib/views/combat/components/combat_dice_ui.svelte` (New Component)
- Create a visual d20 component.
- Use CSS animations (spin/shake) triggered when `isRolling` is true.
- When `isRolling` turns false, display the final number with a flash of Green (Success/Hit) or Red (Failure/Miss).

## Task 4: Cinematic Image Backgrounds
**File 1:** `apps/frontend/client/src/lib/views/combat/combat_view_model.svelte.ts`
- Add `$state`: `combatBackgroundImageUrl: string | null = null`.
- Update `executeCustomAction()`: When `generateImage === true`, wait for `ImageGenerationService.generateImage()` to return, then assign the URL to `combatBackgroundImageUrl`.

**File 2:** `apps/frontend/client/src/lib/views/combat/combat_view.svelte`
- Wrap the combat UI in a container that uses `combatBackgroundImageUrl` as a CSS `background-image` (with `background-size: cover` and a dark semi-transparent overlay so UI remains readable).
- Add a manual "🖼️ Generate Scene" button (icon only) to allow the player to force an image generation of the current combat state if the AI didn't auto-flag it.

## Task 5: Unit & Visual Testing
- **File:** `apps/frontend/client/src/lib/views/combat/combat_view_model.test.ts`
  - Mock Svelte 5 state correctly (use `$effect.root`) and assert that `activeDiceRoll` and `combatBackgroundImageUrl` update correctly.
- **File:** `apps/e2e/tests/client/combat_immersion.spec.ts`
  - Playwright visual test: Load the dev combat sandbox, trigger a custom action, and assert the dice UI mounts and the image URL updates.

## Acceptance Criteria
- [ ] The LLM occasionally outputs an `enemyQuote` which is spoken via Kokoro TTS.
- [ ] A 2D/3D visual dice appears, rolls, and highlights success/failure.
- [ ] Auto-generated or manually requested images render as the combat background.
- [ ] Unit and visual E2E tests pass.
