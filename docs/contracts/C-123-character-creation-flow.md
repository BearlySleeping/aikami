# Contract: C-123 Character Creation Flow

## Goal
Replace the `/setup` placeholder with the functional Character Creation view, allowing the player to define their persona and seamlessly transition into the `/game` route upon completion.

## Context
During C-120, the character views were structurally isolated (e.g., `src/lib/views/character/create/`). The user has now passed the Provider Gate and is ready to build their character. This contract wires that existing isolated view into the `/setup` route and ensures that completing the creation process saves the profile locally and pushes the user into the game.

## Tasks

1. **Wire the Setup Route:**
   - Update `src/routes/setup/+page.svelte` to instantiate and render the character creation view (e.g., `CharacterCreateView.svelte`) and its corresponding ViewModel.

2. **Update the Creation ViewModel:**
   - Ensure the `CharacterCreateViewModel` (or equivalent) handles the core inputs: Name, Stats/Attributes, and a brief Backstory/Prompt.
   - Implement a "Finish" or "Enter World" action.
   - This action must save the newly created character using the local `PersonaRepository` or `CharacterService`.

3. **Route to Game:**
   - Upon successful save, the ViewModel must navigate the user to the `/game` route, officially handing control over to the game engine.

## Out of Scope
- Initializing the PixiJS canvas or the ECS game loop (this will be handled in C-124).
- Generating AI images for the character portrait (unless the existing ViewModel already handles it flawlessly; otherwise, leave it for a future polish contract).

## Acceptance Criteria
- Navigating from the Start Menu via "Start Game" lands the user on the Character Creation UI.
- The user can input their character details.
- Clicking the completion button saves the data and routes the browser to `/game` without errors.
- Typecheck and tests pass (excluding the pre-existing 156 errors).
