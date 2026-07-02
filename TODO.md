# ARCHITECTURAL OVERVIEW: MISSING FEATURE MATRIX

Cross-referencing the current state of `aikami` (Svelte 5 + bitECS engine) against the feature density of `sillytavern` and `risuai`, the following domains are critically missing or incomplete.

To achieve a fully dynamic 2D JRPG driven by LLMs and D&D 2024 rules, we must construct these five foundational pillars:

### 1. Provider Configuration & Secrets Engine (Config Setup)

- **Missing Parity with ST/RisuAI**: We currently lack a comprehensive Svelte 5 UI and state manager for AI providers.
- **Requirements**:
- A robust `settings_view.svelte` to configure Text (OpenAI, Anthropic, OpenRouter, Local Ollama), Speech (ElevenLabs, Piper, local), and Image (DALL-E, Stable Diffusion) providers.
- Secure key storage (Local Storage/IndexedDB AES encryption fallback + Firebase user profile syncing).
- Model override controls: Temperature, Top P, context limits, and specific "Thinking Levels" (for models like Claude 3.5 or DeepSeek).
- Instruct template formatters (ChatML, Alpaca, etc.) strictly bound to the `AiService` adapter.

### 2. "Session Zero" Conversational Character Creation

- **Current State**: `persona_creation_view.svelte` is a static, basic form.
- **Requirements**:
- A dedicated conversational flow (`SessionZeroViewModel`) where an AI "Dungeon Master" interviews the player.
- AST Parsing (utilizing our new `packages/shared/parser`) to extract structured data in real-time from the conversation (Race, Class, Background, Appearance).
- Automated webhooks to trigger image generation (avatar) and pixel-art spritesheet generation based on the agreed-upon appearance.
- An "Advanced Mode" toggle that exposes the raw `Character` JSON schema for manual stat point allocation.

### 3. Dynamic NPC & Relational Systems

- **Current State**: `npc.ts` and `context_system.ts` exist for proximity, but relationships are not tracked or utilized.
- **Requirements**:
- **ECS Components**: `Affection`, `Faction`, and `Memory`.
- **Interaction Intents**: The LLM must be able to output macros like `{{intent:trade}}` or `{{intent:attack}}` based on the player's chat inputs.
- **Party System**: ECS hierarchy allowing NPCs to switch from "Wandering" state to "Following Player" state, sharing the player's movement vectors.

### 4. JRPG Turn-Based Combat Engine

- **Current State**: The bitECS worker currently handles movement and rendering. Combat is non-existent.
- **Requirements**:
- **ECS Systems**: `combat_system.ts` to manage turn queues, initiative rolls (hooked into Svelte `dice_service`), and action points.
- **Components**: `Health`, `Stats` (STR, DEX, CON, etc. matching D&D 2024), `Equipment_Slots`, and `StatusEffects`.
- **Battle State**: A transition state that halts real-time movement, locks the camera, and mounts the Svelte 5 Combat UI.

### 5. Economy, Bartering, and Quests

- **Current State**: No inventory or economy systems in the frontend engine.
- **Requirements**:
- **Inventory ECS**: Abstract `Inventory` component handling items with Valibot/Zod schemas for rarity, value, and effects.
- **Bartering UI**: A dual-pane Svelte 5 trading interface. Prices scale dynamically based on the NPC's `Affection` component and the player's Charisma modifier.
- **Quest Graph**: A Firebase Dataconnect schema mapping quest nodes, objectives, and rewards, injected into the LLM context when relevant.

## Potential next contracts:

Engine-UI Synchronization (The Bridge)
Establish a one-way reactive data flow from the bitECS game engine to your Svelte 5 ViewModels. When an entity moves or takes damage in the engine, the UI instantly reacts.

Multimedia AI Integration (Voice & Image)
Expand on the Ollama rewiring by fully integrating your ComfyUI image generator (for dynamic avatars/sprites) and your TTS microservice (Kokoro/Piper) into the active Chat ViewModel.

State Persistence & Cloud Saves
Wire your pristine ViewModels and Engine state up to Firebase Firestore/Data Connect. This will enable saving, loading, and persisting player progression across the web and desktop.

Asset Pipeline & Animation Polish
Finalize the LPC (Liberated Pixel Cup) spritesheet injection into your PixiJS renderer, ensuring characters dynamically load and animate correctly when walking, attacking, or casting.

The Vertical Slice (Core Game Loop)
Stop building systems in isolation and combine movement, interaction, chat, questing, and combat into a single, unbroken 5-minute playable prototype.

## Links

https://github.com/SpicyMarinara/SillyTavern-Spotify-Music-Extension
