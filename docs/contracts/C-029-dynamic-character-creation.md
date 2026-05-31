// docs/contracts/C-029-dynamic-character-creation.md
# Contract C-029: Menu Auth Wiring & Vanilla PixiJS Character Creation

## Core Objective
First, wire the previously established Firebase REST Device Auth flow (C-028) into the existing `menu_controller.ts` so users can authenticate from the main menu. Second, establish a narrative-driven character creation interface in `apps/frontend/game` using PixiJS Containers and Vanilla DOM overlays (no Svelte). The system will use a conversational UI to guide the user through a D&D 2024-compliant character generation process, culminating in real-time avatar generation, spritesheet compiling, and bitECS stat initialization.

## Design References
- **Target App**: `apps/frontend/game/`
- **Menu Controller**: `apps/frontend/game/src/menu/menu_controller.ts`
- **UI Architecture**: PixiJS v8 primitives (`Container`, `Text`, `Graphics`) paired with vanilla HTML/CSS absolute-positioned overlays for complex text inputs.
- **AI Infrastructure**: Lightweight Firebase REST client (`functions.ts`) mapping to the provider engine.

## Detailed Changes
1. **Auth Wiring (`menu_controller.ts`)**:
   - Inject a "Login" or "Connect Account" button into the main menu PixiJS scene.
   - Bind this button to trigger the `auth_controller.ts` Device Flow.
   - Display the shortcode natively in the Pixi canvas and poll for the authentication state change. Update the menu to show "Logged In" once the token resolves.
2. **Vanilla Chat Overlay & State**:
   - Create `character_creation_controller.ts` to manage the phases: `INTRO`, `CHAT`, `GENERATING_ASSETS`, `MANUAL_TWEAK`, `COMPLETE`.
   - Implement a chat UI utilizing a hybrid approach: PixiJS for the background/portraits, and a floating standard DOM `<div id="chat_overlay">` for scrollable chat history and the `<input>` field, managed purely via Vanilla JS to avoid PixiJS text input limitations.
3. **AI Dungeon Master Persona**:
   - Construct a system prompt enforcing the D&D 2024 ruleset.
   - Stream/fetch conversational responses via the REST client and extract structured JSON (stats/traits) upon interview completion.
4. **Asset Generation & Stat Allocation**:
   - Trigger image generation using the extracted "Appearance" traits.
   - Map the generated avatar to a basic spritesheet rendered in the PixiJS canvas.
   - Build a post-chat "Advanced Options" PixiJS view to display the AI-generated raw statistics with increment/decrement buttons before confirming the bitECS entity creation.

## Acceptance Criteria
- **Given** the user is on the main menu, **When** they click "Login", **Then** the PixiJS UI displays a code and polls for authentication.
- **Given** an authenticated user selects "New Game", **Then** the hybrid PixiJS/DOM character creation chat initializes.
- **Given** the chat concludes, **Then** the AI yields a structured JSON object containing raw stats and a visual description, triggering the generation of a canvas avatar.
- **Given** the generated stats, **When** the user accesses the advanced menu, **Then** they can manually adjust points using PixiJS buttons before saving to Firestore and bitECS.

## Watch Points
- **Strictly No Svelte**: `apps/frontend/game` must remain framework-agnostic for the UI layer. Use Vanilla TypeScript for DOM manipulation and PixiJS for rendering.
- **DOM / Canvas Sync**: Ensure the floating DOM elements (chat inputs/logs) correctly align with the canvas dimensions and are properly destroyed/hidden when the PixiJS scene changes.
