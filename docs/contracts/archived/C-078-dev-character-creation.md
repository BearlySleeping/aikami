<!-- completed: 2026-06-29 -->
# Contract: C-078 — Dev Character Creation Sandbox

## Metadata
| Field | Value |
|-------|-------|
| Source | `apps/frontend/client/src/lib/views/dev/character/` |
| Target | `apps/frontend/client/src/lib/views/dev/character/` |
| Priority | P2 |
| Dependencies | C-076, C-077 |
| Status | completed |
| Version | 1.0 |

## Overview
This contract builds out the `/dev/character` sandbox into the foundational production character creation flow. It replaces the legacy PixiJS-based DOM overlay with a native Svelte 5 ViewModel pattern. The flow consists of an interactive DM chat (with a skip option), a structured JSON extraction phase to generate `PersonaData`, concurrent ComfyUI avatar generation, and a final "Advanced Mode" point-buy tweak UI.

## Design Reference
- **Sandboxes**: Follow the DaisyUI + Tailwind aesthetic established in the Voice, Image, and Text dev sandboxes (C-064, C-065, C-066).
- **Prompting**: Reference the D&D 2024 DM system prompt created in C-029 (`apps/frontend/client/src/lib/client/game/core/ai/prompts/dnd_creation.ts`).
- **Data Structure**: Use the `PersonaData` schema from `@aikami/types` and `@aikami/schemas`.
- **Services**: Leverage `devTextService` for the chat loop, `aiService.createPersona` for the structured extraction, and `imageGenerationService` for the avatar.

## Architecture Directives
- **CharacterViewModel**: Manages the state machine (`CHAT`, `GENERATING`, `TWEAK`). Holds the chat history array, the extracted `PersonaData`, and the generated `avatarUrl`.
- **Chat Phase**: A conversational UI where the user talks to the DM. Must include a "Generate Character" (skip/finalize) button that can be triggered at any time.
- **Extraction Phase**: Compiles the chat history into a single context block and calls `aiService.createPersona()`.
- **Image Generation**: Uses `ImageGenerationService.generateImage()` passing the physical description extracted from the persona data.
- **Tweak Phase**: Renders form inputs bound to the `PersonaData` `$state` (STR, DEX, CON, INT, WIS, CHA, name, visual description, background), allowing manual overrides before saving.

## State & Data Models

    type CreationPhase = 'CHAT' | 'GENERATING' | 'TWEAK';
    
    type ChatMessage = {
        role: 'user' | 'assistant' | 'system';
        content: string;
    };

## Acceptance Criteria

**AC-1: DM Chat Interface**
- **Given** the user is in the `CHAT` phase,
- **When** they submit a message,
- **Then** the message is appended to the history and `devTextService` (or similar endpoint) streams a response using the DM persona system prompt.

**AC-2: Structured Persona Extraction**
- **Given** the chat history,
- **When** the user clicks "Generate Character",
- **Then** the phase changes to `GENERATING`, the chat history is compiled, and `aiService.createPersona()` is called, yielding a strictly typed `PersonaData` object.

**AC-3: Avatar Generation**
- **Given** the successfully extracted `PersonaData`,
- **When** the visual description/appearance field is available,
- **Then** `imageGenerationService.generateImage()` is called to generate the character avatar, and the resulting object URL is stored in the ViewModel.

**AC-4: Advanced Tweak UI**
- **Given** the phase is `TWEAK`,
- **When** the user views the UI,
- **Then** they see the generated avatar, editable text inputs for Name/Background/Appearance, and editable numeric inputs (+/- buttons or ranges) for core stats (STR, DEX, CON, INT, WIS, CHA). Changes instantly update the underlying `$state` object.

## Implementation Notes
1. Update `CharacterViewModel` to include `$state` for `phase`, `messages`, `persona`, and `avatarUrl`.
2. Implement the `sendChatMessage()` function. You may need to format the `messages` array into a single prompt string if using `devTextService` directly, or utilize `StreamOrchestrator` if preferred for dialogue.
3. Implement `generateCharacter()` to trigger `aiService.createPersona(compiledHistory)`.
4. Once `createPersona` returns, immediately trigger `imageGenerationService.generateImage({ prompt: persona.appearance })` and shift the UI to the `TWEAK` phase so the user can edit stats while the image loads.
5. Build the view with DaisyUI components (`chat-bubble` for messages, `range` or `number` inputs for stats, `card` layouts).

## Edge Cases & Gotchas
- The user might skip the chat entirely by typing "I am a chaotic neutral goblin rogue" and hitting Generate immediately. The prompt passed to `createPersona` must handle short or direct inputs gracefully.
- Ensure the image generation handles demo mode gracefully (already built into `ImageGenerationService`, just ensure you don't block the UI waiting for it).
- Svelte 5 `$state` deeply proxies objects, so binding form inputs directly to `viewModel.persona.stats.str` will work out of the box.
