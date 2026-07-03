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

## Deferred: LPC Semantic Bundling

- **Status**: Deferred for upstream LPC compatibility.
- **Why**: LPC character assets must remain as loose files in their native folder
  structure to stay compatible with upstream LPC generator tools and sprite editors.
  Semantic bundling (packing LPC sprites into atlases or texture arrays) would break
  the drag-and-drop workflow for artists and designers.
- **Contract**: C-210 WebGPU Tilemap Integration — tilemaps use WebGPU chunked Mesh
  rendering; LPC characters remain unbundled.

Future Roadmap: The "Omniscient Sandbox" Update

This document outlines high-level architectural goals and feature implementations inspired by the demand for private, system-agnostic, and deeply immersive Virtual Tabletop (VTT) experiences (inspired by Chrome.GM).

The overarching goal is to evolve Aikami from a character-chat application into a fully fledged, local-capable, multiplayer RPG sandbox.

1. Local-First AI Execution (The Privacy Pivot)

Current State: Tied to cloud APIs via AiServiceInterface.
Goal: Allow users to run the game 100% offline without subscription fees, leveraging the Tauri v2 desktop wrapper.

    [ ] Implement WebGPU LLM Integration: Since PixiJS v8 already utilizes WebGPU, investigate using WebLLM (MLC LLM) to run small, quantized models (like Llama 3 8B) directly in the client browser/Tauri app.

    [ ] Ollama / LM Studio Adapter: Create a new provider in packages/backend/ai/ for local desktop inference endpoints (e.g., http://localhost:11434).

    [ ] Hybrid Fallback Engine: Implement a fallback circuit breaker in AiServiceInterface. If the local model is too slow or the user is on a mobile PWA, gracefully failover to cloud providers (Gemini/OpenRouter) seamlessly.

    [ ] Local Voice Models: Research and integrate lightweight, offline TTS models (e.g., Piper TTS or Silero) that can run within the Tauri backend to bypass ElevenLabs API costs.

2. Dynamic Ruleset Engine ("Bring Your Own Game")

Current State: Hardcoded D&D-style character sheets.
Goal: System agnosticism. The AI should understand and enforce any tabletop rulebook.

    [ ] PDF Ingestion & RAG Pipeline: Build a document ingestion pipeline. Users upload a rulebook PDF. The app chunks the text and stores it in Firebase Data Connect using the pgvector extension (which is already planned for memory storage).

    [ ] Dynamic UI Generation: When a new system is loaded, prompt the AI to generate a JSON schema for the required character sheet fields. Use Svelte 5 runes to dynamically render the character sheet UI based on this generated schema rather than hardcoding STR/DEX/CON.

    [ ] Mechanics Enforcement Prompting: Inject the RAG retrieval data into the system prompt whenever a dice roll or action is called, ensuring the AI acts as a rigid referee rather than just a storyteller.

3. The "Director" Agent (Omniscient GM)

Current State: Heavy focus on 1-on-1 Persona-to-NPC relationships.
Goal: An invisible AI manager that controls the environment, not just dialogue.

    [ ] World State Manager Agent: Create a separate, background LLM agent whose sole job is to monitor the ChatSummaryData and update the WorldStateData (e.g., moving NPCs around, changing faction dispositions, advancing time).

    [ ] PixiJS Bridge Integration: Connect the Director Agent to the EngineBridge. If the Director Agent determines a storm has started in the story, it should emit a GameCommand to the PixiJS bitECS engine to activate the rain particle system and darken the lighting.

    [ ] NPC Autonomy (GOAP): Give NPCs background schedules. When the user isn't looking, the Director Agent should simulate their actions so the world feels alive when the player returns.

4. Total Immersion UI (Voice & Flow)

Current State: Phase 4 plans for TTS.
Goal: Frictionless, hands-free gameplay.

    [ ] Speech-to-Text (STT) Input: Add a push-to-talk microphone button in the ChatView. Use the Web Speech API (or Whisper local) to transcribe player audio.

    [ ] Continuous Streaming Mode: Combine STT and TTS so the user can leave the keyboard entirely. The AI narrates, the user speaks, and the AI replies instantly—creating a true "sitting at the table" feel.

    [ ] Session Playback / Export: Implement a feature to export a completed chat/adventure into a formatted PDF or EPUB "Novel," turning the user's roleplay session into a readable book.

5. Co-Op Multiplayer (The Shared Sandbox)

Current State: Group chats with multiple NPCs, but single human user.
Goal: Multiple human players in the same PixiJS world.

    [ ] Multi-Persona Instancing: Leverage Firebase Data Connect and PowerSync's real-time capabilities to allow a host to invite a friend's PersonaId into their WorldId.

    [ ] Spatial Chat Routing: In the PixiJS 2D engine, route chat messages based on spatial proximity. If Player A is in the Tavern and Player B is in the Forest, they interact with different NPCs and receive different AI context windows.

    [ ] Party State Tracking: Update the GroupChatData model to distinguish between "Human Player" inputs and "NPC" inputs, allowing the AI GM to address multiple humans in the same response payload.

*** ### Critical Developer Notes for Implementation:

    Cost Warning: If implementing the Director Agent, running a background LLM to constantly evaluate world state will drain cloud API tokens rapidly. Local-first execution (Task 1) is a prerequisite for Task 3.

    Database Schema: The pgvector integration for Data Connect will be the most crucial bottleneck to solve for the Rulebook RAG feature. Prioritize schema testing for vector embeddings early.

## Links

https://github.com/SpicyMarinara/SillyTavern-Spotify-Music-Extension


## Bun Segfault (2026-07-03)

- **Issue**: Bun 1.3.13 crashes with `Segmentation fault at address 0x42` on full client test suite (`bun test`)
- **Context**: Observed during C-214 engine/api-core consolidation. Individual test files pass fine.
- **Status**: Needs investigation — likely Bun bug or Svelte 5 rune interaction
- **Workaround**: Run individual test files instead of full suite
